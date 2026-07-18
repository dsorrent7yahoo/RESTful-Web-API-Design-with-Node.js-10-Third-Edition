# Databricks notebook source
"""
rag/generator.py — LLM answer generation with four clinical output modes.

PURPOSE
-------
After the retriever finds relevant passages, this module assembles them into a
prompt and calls a large language model (LLM) to generate a grounded clinical answer.
Every generated claim is expected to cite a source passage using [source: id] notation.

WHAT IS GROUNDED GENERATION?
-----------------------------
Without RAG, an LLM generates answers from its training data (which may be outdated
or hallucinated).  With grounded generation, the LLM is instructed: "Answer ONLY
from the provided passages.  Cite every claim."  This dramatically reduces fabricated
drug names, dosages, or guideline references.

FOUR GENERATION MODES
---------------------
standard    Direct clinical answer citing retrieved passages.
            Example: "Metformin is prescribed for diabetes [source: med-876...]."

copilot     Structured Drug-Related Problem (DRP) report in PCNE classification
            format, designed for pharmacist review.
            (Research basis: RAG-CDSS, arXiv:2402.01741)
            Output sections: PROBLEM / CAUSE / SEVERITY / INTERVENTION / SOURCES

sql         Converts the natural-language question into a valid DynamoDB PartiQL
            SELECT statement, using retrieved medication records as few-shot examples.
            (Research basis: CBR-to-SQL, arXiv:2603.05569)

diagnosis   CPG-grounded differential diagnosis using the GARMLE-G framework.
            (Research basis: arXiv:2506.21615)
            Output sections: PRIMARY DIAGNOSIS (ICD/SNOMED) / DIFFERENTIAL /
                             GUIDELINE SUPPORT / RECOMMENDED WORKUP

SUPPORTED LLM BACKENDS (RAG_LLM_BACKEND env var)
-------------------------------------------------
bedrock     Amazon Bedrock — Nova Pro / Nova Lite / Claude via IAM (default).
            Nova models use Amazon Converse API format.
            Claude models use Anthropic Messages API format with inference profiles.
openai      GPT-4o via OpenAI API (requires OPENAI_API_KEY).
ollama      Llama-3.1-8B running locally via Ollama server (no external API).

IMPORTANT — CLAUDE MODEL IDs
------------------------------
Claude on Bedrock requires a cross-region inference profile prefix:
  CORRECT:   us.anthropic.claude-sonnet-4-6
  WRONG:     anthropic.claude-sonnet-4-6  (returns ValidationException)

The _resolve_bedrock_model() helper automatically adds the "us." prefix for
bare anthropic.* model IDs.

FUNCTIONS
---------
_resolve_bedrock_model(model_id: str) -> str
    Adds "us." inference profile prefix for Anthropic models.
    Nova/Titan models pass through unchanged.

CLASS
-----
Generator(backend: str)
    generate(query, passages, mode) -> dict
        Builds the prompt from retrieved passages and calls the LLM.
        Returns {answer, sources_used, mode, tokens: {prompt, completion, total}}.

    _bedrock_call(system, user, mode, passages) -> dict
        Routes to Amazon Converse API (Nova) or Anthropic Messages API (Claude).

    _openai(system, user, mode, passages) -> dict
    _ollama(system, user, mode, passages) -> dict
"""

import json, logging, os, time
logger = logging.getLogger(__name__)

_SAFETY = ("You are a clinical decision support assistant. "
           "Answer ONLY from the provided context passages. "
           "If context is insufficient, state that explicitly. "
           "NEVER fabricate drug names, dosages, or guidelines. "
           "Cite every factual claim with [source: <id>] notation.")

_PROMPTS = {
    "standard": _SAFETY,
    "copilot": (_SAFETY + "\n\nFormat as a PCNE Drug-Related Problem report:\n"
                "1. PROBLEM\n2. CAUSE\n3. SEVERITY (NCC MERP A-I)\n"
                "4. INTERVENTION\n5. SOURCES"),
    "sql": ("You are an Amazon Athena SQL expert for a healthcare Glue Data Catalog. "
            "Database: healthcare_data_lake. "
            "Tables: medications, patients, conditions, observations, encounters. "
            "Full SQL is supported including JOIN, GROUP BY, and aggregations. "
            "Return ONLY the SQL SELECT statement — no markdown, no explanation."),
    "diagnosis": (_SAFETY + "\n\nGARMLE-G framework:\n"
                  "1. PRIMARY DIAGNOSIS (ICD/SNOMED code)\n"
                  "2. DIFFERENTIAL (up to 3 alternatives)\n"
                  "3. GUIDELINE SUPPORT [source: <id>]\n"
                  "4. RECOMMENDED WORKUP"),
}


def _resolve_bedrock_model(model_id: str) -> str:
    """Resolve model ID to an inference profile ID if needed.

    Claude models require a cross-region inference profile prefix (us./ global.)
    when invoked with on-demand throughput.
    Direct on-demand models (Nova, Titan) use their model ID unchanged.
    """
    # Already an inference profile — use as-is
    if model_id.startswith(("us.", "eu.", "ap.", "global.")):
        return model_id
    # Claude models need the us. cross-region prefix
    if "anthropic" in model_id:
        return f"us.{model_id}"
    # Nova and Titan use direct model IDs
    return model_id

class Generator:
    def __init__(self, backend="openai"):
        self.backend = backend
        self._client = None
        self._bedrock = None

    def generate(self, query, passages, mode="standard"):
        system = _PROMPTS.get(mode, _PROMPTS["standard"])
        ctx = self._context(passages)
        if mode == "sql":
            user = f"Schema examples:\n{ctx}\n\nQuestion: {query}\n\nPartiQL:"
        else:
            user = f"Context passages:\n{ctx}\n\nQuestion: {query}"
        if self.backend == "openai": return self._openai(system, user, mode, passages)
        if self.backend == "bedrock": return self._bedrock_call(system, user, mode, passages)
        if self.backend == "ollama": return self._ollama(system, user, mode, passages)
        raise ValueError(f"Unknown backend: {self.backend!r}")

    def _context(self, passages):
        if not passages: return "(no passages retrieved)"
        return "\n\n".join(
            f"[{i}] [source: {p.get('id',f'doc-{i}')}] ({p.get('source','')})\n{p.get('text','').strip()}"
            for i, p in enumerate(passages, 1))

    def _cited(self, answer, passages):
        cited = [{"id":p["id"],"text":p.get("text","")[:200],"source":p.get("source",""),
                  "score":round(p.get("score",0.0),4)}
                 for p in passages if p.get("id","") in answer]
        if not cited and passages:
            p = passages[0]
            cited = [{"id":p["id"],"text":p.get("text","")[:200],"source":p.get("source",""),
                      "score":round(p.get("score",0.0),4)}]
        return cited

    def _resp(self, answer, passages, mode, usage):
        return {"answer": answer, "sources_used": self._cited(answer, passages), "mode": mode,
                "tokens": {"prompt":usage.get("prompt_tokens",0),
                           "completion":usage.get("completion_tokens",0),
                           "total":usage.get("total_tokens",0)}}

    def _openai(self, system, user, mode, passages):
        if self._client is None:
            from openai import OpenAI
            self._client = OpenAI()
        model = os.getenv("RAG_LLM_MODEL","gpt-4o")
        resp = self._client.chat.completions.create(
            model=model,
            messages=[{"role":"system","content":system},{"role":"user","content":user}],
            temperature=0.1, max_tokens=1024)
        answer = resp.choices[0].message.content or ""
        return self._resp(answer, passages, mode,
                         {"prompt_tokens":resp.usage.prompt_tokens,
                          "completion_tokens":resp.usage.completion_tokens,
                          "total_tokens":resp.usage.total_tokens})

    def _bedrock_call(self, system, user, mode, passages):
        if self._bedrock is None:
            import boto3
            self._bedrock = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION","us-east-1"))
        raw_model = os.getenv("RAG_LLM_MODEL","amazon.nova-pro-v1:0")
        model_id = _resolve_bedrock_model(raw_model)

        # Claude models use the Anthropic Messages API format
        # Nova / Titan use the Amazon Converse API format
        if "anthropic" in model_id.lower():
            body = json.dumps({
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 1024,
                "temperature": 0.1,
                "system": system,
                "messages": [{"role": "user", "content": user}]
            })
            resp = self._bedrock.invoke_model(modelId=model_id, body=body,
                                              contentType="application/json", accept="application/json")
            result = json.loads(resp["body"].read())
            answer = result.get("content", [{}])[0].get("text", "")
            usage = result.get("usage", {})
            return self._resp(answer, passages, mode, {
                "prompt_tokens":    usage.get("input_tokens", 0),
                "completion_tokens": usage.get("output_tokens", 0),
                "total_tokens":     usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
            })

        # Amazon Nova / Titan Converse format
        body = json.dumps({
            "system": [{"text": system}],
            "messages": [{"role": "user", "content": [{"text": user}]}],
            "inferenceConfig": {"temperature": 0.1, "maxTokens": 1024}
        })
        resp = self._bedrock.invoke_model(modelId=model_id, body=body,
                                          contentType="application/json", accept="application/json")
        result = json.loads(resp["body"].read())
        answer = result.get("output",{}).get("message",{}).get("content",[{}])[0].get("text","")
        u = result.get("usage",{})
        return self._resp(answer, passages, mode, {
            "prompt_tokens":    u.get("inputTokens", 0),
            "completion_tokens": u.get("outputTokens", 0),
            "total_tokens":     u.get("totalTokens", 0),
        })

    def _ollama(self, system, user, mode, passages):
        import httpx
        base_url = os.getenv("RAG_OLLAMA_URL","http://localhost:11434")
        model = os.getenv("RAG_LLM_MODEL","llama3.1:8b")
        resp = httpx.post(f"{base_url}/api/chat",
                         json={"model":model,"messages":[{"role":"system","content":system},
                                                         {"role":"user","content":user}],
                               "stream":False,"options":{"temperature":0.1}}, timeout=120.0)
        resp.raise_for_status()
        data = resp.json()
        answer = data.get("message",{}).get("content","")
        return self._resp(answer, passages, mode,
                         {"prompt_tokens":data.get("prompt_eval_count",0),
                          "completion_tokens":data.get("eval_count",0),
                          "total_tokens":data.get("prompt_eval_count",0)+data.get("eval_count",0)})
