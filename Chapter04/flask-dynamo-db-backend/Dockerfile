FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY flask-dynamo-db-backend/requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY flask-dynamo-db-backend /app
COPY coherent-11-07-2022 /coherent-11-07-2022

# Source browser — full project hierarchy for portfolio viewing
COPY infra/ /source/infra/
COPY .github/ /source/.github/
COPY flask-dynamo-db-backend/ /source/flask-dynamo-db-backend/
COPY flask-dynamo-db-frontend/src/ /source/flask-dynamo-db-frontend/src/
COPY flask-dynamo-db-frontend/vite.config.js /source/flask-dynamo-db-frontend/vite.config.js
COPY flask-dynamo-db-frontend/package.json /source/flask-dynamo-db-frontend/package.json
COPY flask-dynamo-db-frontend/index.html /source/flask-dynamo-db-frontend/index.html
COPY healthcare_datalake_databricks.ipynb /source/healthcare_datalake_databricks.ipynb
COPY databricks_client.py /source/databricks_client.py
COPY docker-compose.flask.yml /source/docker-compose.flask.yml
COPY openapi.json /source/openapi.json
COPY README.md /source/README.md

ENV PORT=4001 \
    AWS_REGION=us-east-1 \
    DYNAMODB_TABLE=medications \
    AUTO_CREATE_CSV_TABLES=true

EXPOSE 4001

CMD ["sh", "-c", "gunicorn --workers 2 --threads 4 --bind 0.0.0.0:${PORT} app:app"]
