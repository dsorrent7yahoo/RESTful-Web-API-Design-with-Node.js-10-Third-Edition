"""
rag/corpus/guideline_loader.py — Fetches and indexes clinical practice guidelines.

PURPOSE
-------
The diagnosis mode generates CPG-grounded differential diagnoses.  For this to
work, the vector store must contain passages from authoritative clinical guidelines
(WHO, NIH, NICE) that the LLM can cite.  This module downloads those documents
and indexes them as searchable text chunks.

WHAT IS A CLINICAL PRACTICE GUIDELINE (CPG)?
---------------------------------------------
A CPG is an evidence-based document created by a clinical professional society or
government health authority that tells clinicians:
  - Which patients should receive a specific treatment
  - What dosing and monitoring is recommended
  - When to refer to a specialist

Examples indexed by this module:
  WHO Essential Medicines List (EML 2023)
      Lists the most effective and safe medicines for priority conditions.
      URL: who.int/publications/i/item/WHO-MHP-HPS-EML-2023.01

  NIH MedlinePlus Drug Information
      Free drug monographs for patients and clinicians.
      URL: medlineplus.gov/druginfo/meds/

IMPLEMENTS GARMLE-G PATTERN
-----------------------------
GARMLE-G (Generation-Augmented Retrieval framework, arXiv:2506.21615) grounds
LLM diagnosis outputs in CPG content to eliminate hallucinated guideline citations.
This module provides the indexing half of that pattern; the Generator's "diagnosis"
mode prompt template provides the retrieval + generation half.

TEXT CHUNKING
-------------
Long PDFs and HTML pages are split into 400-word sliding-window chunks with a
50-word overlap to ensure no sentence is cut off at a chunk boundary.
Chunks shorter than 10 words are discarded as artefacts of HTML parsing.

CLASS
-----
GuidelineLoader(embedder, vector_store)

    load_pdf(url, source_label, chunk_size, overlap) -> int
        Download a PDF, extract text with pdfminer.six, chunk, embed, index.

    load_html(url, source_label, chunk_size, overlap) -> int
        Download HTML, strip tags with regex, chunk, embed, index.

    load_who_essential_medicines() -> int
        Convenience method for the WHO EML 2023 HTML page.

    load_nih_drug_info(drug_names: list[str]) -> int
        Fetch and index MedlinePlus drug monographs for a list of drug names.

    _download(url) -> bytes | None   Download with httpx (follows redirects).
    _pdf_text(raw) -> str            pdfminer.six text extraction.
    _html_text(raw) -> str           Regex-based HTML tag stripping.
    _index_text(text, source_label, chunk_size, overlap) -> int  Chunk + embed + upsert.
    _split(text, chunk_size, overlap) -> list[str]  Sentence-boundary chunker.
"""

import io, logging, os, re, time
import httpx
logger = logging.getLogger(__name__)
SHARD = "guidelines"

class GuidelineLoader:
    def __init__(self, embedder, vector_store):
        self.embedder = embedder; self.store = vector_store

    def load_pdf(self, url, source_label, chunk_size=400, overlap=50):
        """Download PDF, extract text with pdfminer, chunk, embed, and index into guidelines shard."""
        raw = self._download(url)
        if not raw: return 0
        text = self._pdf_text(raw)
        return self._index_text(text, source_label, chunk_size, overlap) if text.strip() else 0

    def load_html(self, url, source_label, chunk_size=400, overlap=50):
        """Download HTML, strip tags, chunk, embed, and index into guidelines shard."""
        raw = self._download(url)
        if not raw: return 0
        text = self._html_text(raw)
        return self._index_text(text, source_label, chunk_size, overlap) if text.strip() else 0

    def load_who_essential_medicines(self):
        """Convenience: download and index the WHO Essential Medicines List 2023."""
        return self.load_html("https://www.who.int/publications/i/item/WHO-MHP-HPS-EML-2023.01",
                              "WHO Essential Medicines List 2023")

    def load_nih_drug_info(self, drug_names):
        """Fetch and index NIH MedlinePlus monographs for a list of drug names."""
        total = 0
        for name in drug_names:
            slug = name.lower().replace(" ","-")
            try:
                total += self.load_html(f"https://medlineplus.gov/druginfo/meds/a{slug}.html",
                                        f"NIH MedlinePlus — {name}")
                time.sleep(0.3)
            except Exception as e: logger.warning("NIH fetch failed %r: %s", name, e)
        return total

    def _download(self, url):
        """Download bytes from a URL using httpx with redirect following. Returns None on error."""
        try:
            with httpx.Client(timeout=30, follow_redirects=True) as c:
                resp = c.get(url, headers={"User-Agent":"healthcare-rag/1.0"})
                resp.raise_for_status(); return resp.content
        except Exception as e: logger.warning("Download failed %s: %s", url, e); return None

    def _pdf_text(self, raw):
        """Extract plain text from PDF bytes using pdfminer.six. Returns empty string on failure."""
        try:
            from pdfminer.high_level import extract_text
            return extract_text(io.BytesIO(raw))
        except Exception: return ""

    def _html_text(self, raw):
        """Strip HTML tags and collapse whitespace to extract readable prose."""
        try: text = raw.decode("utf-8", errors="ignore")
        except Exception: return ""
        text = re.sub(r"<(script|style)[^>]*>.*?</\1>"," ",text,flags=re.S|re.I)
        text = re.sub(r"<[^>]+>"," ",text)
        return re.sub(r"\s+"," ",text).strip()

    def _index_text(self, text, source_label, chunk_size, overlap):
        """Split text into chunks, embed each, and upsert into the guidelines shard."""
        chunks = self._split(text, chunk_size, overlap)
        if not chunks: return 0
        slug = re.sub(r"[^a-z0-9]+","-",source_label.lower())[:40]
        docs = [{"id":f"guideline-{slug}-{i}","text":c,"source":source_label,"shard":SHARD,
                 "metadata":{"source_label":source_label,"chunk_index":i,"total_chunks":len(chunks)}}
                for i, c in enumerate(chunks)]
        vectors = self.embedder.embed_batch([d["text"] for d in docs])
        for i, doc in enumerate(docs): doc["vector"] = vectors[i]
        count = self.store.upsert_batch(docs)
        logger.info("Indexed %d chunks from '%s'", count, source_label)
        return count

    def _split(self, text, chunk_size, overlap):
        """Sentence-boundary sliding-window chunker. Drops chunks shorter than 10 words."""
        sentences = re.split(r"(?<=[.!?])\s+", text)
        chunks, current = [], []
        for sent in sentences:
            words = sent.split()
            if len(current) + len(words) > chunk_size and current:
                chunks.append(" ".join(current))
                current = current[-overlap:] if overlap else []
            current.extend(words)
        if current: chunks.append(" ".join(current))
        return [c for c in chunks if len(c.split()) >= 10]
