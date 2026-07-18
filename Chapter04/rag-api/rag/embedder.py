"""
rag/embedder.py — Converts clinical text into dense floating-point vectors.

PURPOSE
-------
Before the RAG pipeline can search for relevant passages, every piece of text
(both the indexed documents and the user's question) must be turned into a
vector — a list of numbers that encodes the meaning of the text.

Texts with similar clinical meanings end up geometrically close together in this
vector space, which is why cosine similarity search finds relevant passages.

WHAT IS AN EMBEDDING?
---------------------
An embedding model reads a sentence and outputs a fixed-length list of floats.
For example, "Metformin for diabetes" → [0.12, -0.34, 0.87, ... ] (768 numbers).

Two sentences about the same clinical concept will produce vectors with a high
cosine similarity (close to 1.0).  Two unrelated sentences will have low similarity
(close to 0.0).

WHAT IS ClinicalBERT?
----------------------
BERT (Bidirectional Encoder Representations from Transformers) is a transformer
neural network pre-trained on large text corpora.  "ClinicalBERT" refers to BERT
models further trained on biomedical literature (PubMed, clinical notes) so they
understand medical vocabulary better than a generic BERT model.

The default model used here is pritamdeka/S-PubMedBert-MS-MARCO:
  - Pre-trained on PubMed biomedical abstracts
  - Fine-tuned on MS MARCO (a passage retrieval benchmark)
  - Output: 768-dimensional vectors
  - Runs locally — no API key, PHI never leaves the AWS account

SUPPORTED BACKENDS (RAG_EMBED_BACKEND env var)
-----------------------------------------------
clinicalbert  pritamdeka/S-PubMedBert-MS-MARCO  768-dim  local CPU
openai        text-embedding-3-small             1536-dim OpenAI API
bedrock       amazon.titan-embed-text-v2:0       1024-dim AWS Bedrock

CLASS
-----
Embedder(backend: str)
    Lazy-loading multi-backend text embedder.  The underlying model is NOT
    loaded at construction time — it loads on the first call to embed() or
    embed_batch(), keeping server startup instant.

    embed(text: str) -> list[float]
        Returns a single embedding vector for one string.

    embed_batch(texts: list[str], batch_size: int = 64) -> list[list[float]]
        Embeds a list of strings efficiently.  ClinicalBERT processes batches
        of 64 at a time for maximum GPU/CPU throughput.

    dimension() -> int
        Returns the vector dimension for the current backend (768, 1536, or 1024).
"""

import json, logging, os
logger = logging.getLogger(__name__)

class Embedder:
    def __init__(self, backend="clinicalbert"):
        self.backend = backend
        self._model = None
        self._client = None
        self._dim = None

    def embed(self, text):
        self._ensure_loaded()
        return self._embed_one(text)

    def embed_batch(self, texts, batch_size=64):
        if not texts: return []
        self._ensure_loaded()
        if self.backend == "clinicalbert":
            results = []
            for i in range(0, len(texts), batch_size):
                vecs = self._model.encode(texts[i:i+batch_size], normalize_embeddings=True, show_progress_bar=False)
                results.extend(vecs.tolist())
            return results
        return [self._embed_one(t) for t in texts]

    def dimension(self):
        self._ensure_loaded()
        return self._dim

    def _ensure_loaded(self):
        if self._model is None and self._client is None:
            if self.backend == "clinicalbert": self._load_clinicalbert()
            elif self.backend == "openai": self._load_openai()
            elif self.backend == "bedrock": self._load_bedrock()
            else: raise ValueError(f"Unknown backend: {self.backend!r}")

    def _load_clinicalbert(self):
        from sentence_transformers import SentenceTransformer
        model_name = os.getenv("RAG_CLINICALBERT_MODEL","pritamdeka/S-PubMedBert-MS-MARCO")
        logger.info("Loading model: %s", model_name)
        self._model = SentenceTransformer(model_name)
        self._dim = self._model.get_sentence_embedding_dimension()
        logger.info("Embedder ready dim=%d", self._dim)

    def _load_openai(self):
        from openai import OpenAI
        self._client = OpenAI()
        self._openai_model = os.getenv("RAG_EMBED_MODEL","text-embedding-3-small")
        self._dim = 1536

    def _load_bedrock(self):
        import boto3
        self._client = boto3.client("bedrock-runtime", region_name=os.getenv("AWS_REGION","us-east-1"))
        self._bedrock_model = "amazon.titan-embed-text-v2:0"
        self._dim = 1024

    def _embed_one(self, text):
        if self.backend == "clinicalbert":
            return self._model.encode([text], normalize_embeddings=True)[0].tolist()
        if self.backend == "openai":
            return self._client.embeddings.create(input=[text], model=self._openai_model).data[0].embedding
        if self.backend == "bedrock":
            body = json.dumps({"inputText": text[:8192]})
            resp = self._client.invoke_model(modelId=self._bedrock_model, body=body,
                                             contentType="application/json", accept="application/json")
            return json.loads(resp["body"].read())["embedding"]
        raise ValueError(f"Unknown backend: {self.backend!r}")
