FROM python:3.12-slim

WORKDIR /app

# Install OS deps needed by pdfminer and sentence-transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV RAG_EMBED_BACKEND=clinicalbert \
    RAG_VECTOR_BACKEND=memory \
    RAG_LLM_BACKEND=openai \
    PORT=4005

EXPOSE 4005

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "4005"]
