# ── Stage 1: Build React frontend ──────────────────────────────────────────
FROM node:20-slim AS frontend-builder
WORKDIR /frontend
COPY flask-dynamo-db-frontend/package.json flask-dynamo-db-frontend/package-lock.json ./
RUN npm ci
COPY flask-dynamo-db-frontend/ ./
RUN npm run build

# ── Stage 2: Flask backend ──────────────────────────────────────────
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY flask-dynamo-db-backend/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY flask-dynamo-db-backend /app
COPY README.md /app/README.md
COPY coherent-11-07-2022 /coherent-11-07-2022
# Source browser — infrastructure & CI files accessible via /source/file
COPY infra/ /app/infra/
COPY .github/ /app/.github/
COPY docker-compose.flask.yml /app/docker-compose.flask.yml
# React frontend source (no node_modules, no dist — those are in SKIP_DIRS)
COPY flask-dynamo-db-frontend/src /app/flask-dynamo-db-frontend/src
COPY flask-dynamo-db-frontend/index.html /app/flask-dynamo-db-frontend/index.html
COPY flask-dynamo-db-frontend/package.json /app/flask-dynamo-db-frontend/package.json
COPY flask-dynamo-db-frontend/vite.config.js /app/flask-dynamo-db-frontend/vite.config.js
# Serve the built React app from Flask at /
COPY --from=frontend-builder /frontend/dist /app/static/react

ENV PORT=4001 \
    AWS_REGION=us-east-1 \
    DYNAMODB_TABLE=medications \
    AUTO_CREATE_CSV_TABLES=true

EXPOSE 4001

CMD ["sh", "-c", "gunicorn --workers 2 --threads 4 --bind 0.0.0.0:${PORT} app:app"]
