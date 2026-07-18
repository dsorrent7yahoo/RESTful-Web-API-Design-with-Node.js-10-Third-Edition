"""
rag/dynamo_store.py — DynamoDB persistence for the RAG model registry.

PURPOSE
-------
The model registry (which LLM each named model uses, whether it has been tested,
which model is active) must survive server restarts and EC2 reboots.
This module provides the DynamoDB persistence layer for that registry.

WHAT IS DynamoDB?
-----------------
Amazon DynamoDB is a fully managed NoSQL database service.
It stores data as key-value / document items in tables.
This project already uses DynamoDB for the healthcare records (medications,
conditions, observations) — this module extends that to store model metadata.

DYNAMODB TABLES CREATED
-----------------------
rag-model-registry   PK: name (S)
    Stores one item per named model config (main, test, staging, ...).
    Item fields match the ModelConfig schema: name, label, llm_model,
    llm_backend, embed_backend, shard_filter, top_k, alpha, description,
    is_active, created_at, last_tested, test_pass, updated_at.

rag-index-metadata   PK: shard (S)
    Records when each corpus shard was last indexed.
    Item fields: shard, doc_count, indexed_at.

Tables are created automatically with PAY_PER_REQUEST billing on first use.

PERSISTENCE STRATEGY
--------------------
When routers/models.py calls _save_registry():
  1. JSON file written to RAG_MODEL_REGISTRY_PATH (fast local fallback)
  2. Each model item written to rag-model-registry DynamoDB table (persistent)

When routers/models.py calls _load_registry() at startup:
  1. Try DynamoDB first (authoritative, survives reboots)
  2. Fall back to local JSON file if DynamoDB is unavailable

FUNCTIONS
---------
save_model(model_cfg: dict)
    Upsert one model config item to DynamoDB.
    Decimal conversion handles Python float → DynamoDB Number type.

load_all_models() -> dict
    Scan the entire rag-model-registry table.
    Returns {name: cfg} dict.

delete_model(name: str)
    Delete one model item from DynamoDB.

save_index_shard(shard: str, doc_count: int)
    Record that a corpus shard was indexed at this moment.

load_index_metadata() -> dict
    Load all shard metadata from rag-index-metadata.

_ensure_table(table_name, pk)  (internal)
    Creates the DynamoDB table if it does not already exist.
    Uses PAY_PER_REQUEST billing — no capacity planning needed.
"""

import json, logging, os, time
import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)
REGION = os.getenv("AWS_REGION", "us-east-1")
REGISTRY_TABLE = os.getenv("RAG_REGISTRY_TABLE", "rag-model-registry")
INDEX_META_TABLE = os.getenv("RAG_INDEX_META_TABLE", "rag-index-metadata")


def _db():
    return boto3.resource("dynamodb", region_name=REGION)

def _client():
    return boto3.client("dynamodb", region_name=REGION)


def _ensure_table(table_name: str, pk: str = "name") -> None:
    """Create the DynamoDB table if it does not already exist."""
    try:
        _client().describe_table(TableName=table_name)
    except ClientError as e:
        if e.response["Error"]["Code"] != "ResourceNotFoundException":
            raise
        logger.info("Creating DynamoDB table: %s", table_name)
        _db().create_table(
            TableName=table_name,
            AttributeDefinitions=[{"AttributeName": pk, "AttributeType": "S"}],
            KeySchema=[{"AttributeName": pk, "KeyType": "HASH"}],
            BillingMode="PAY_PER_REQUEST",
        )
        _client().get_waiter("table_exists").wait(TableName=table_name)
        logger.info("Table %s ready", table_name)


# ── Model registry ─────────────────────────────────────────────────────────────

def save_model(model_cfg: dict) -> None:
    """Upsert one model config to DynamoDB."""
    _ensure_table(REGISTRY_TABLE, pk="name")
    table = _db().Table(REGISTRY_TABLE)
    item = {k: v for k, v in model_cfg.items() if v is not None}
    item["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    # DynamoDB cannot store Python None or float 0.6 directly — convert
    for k, v in item.items():
        if isinstance(v, float):
            from decimal import Decimal
            item[k] = Decimal(str(v))
    table.put_item(Item=item)
    logger.info("Saved model %r to DynamoDB %s", model_cfg.get("name"), REGISTRY_TABLE)


def load_all_models() -> dict:
    """Load all model configs from DynamoDB. Returns {name: cfg} dict."""
    try:
        _ensure_table(REGISTRY_TABLE, pk="name")
        table = _db().Table(REGISTRY_TABLE)
        resp = table.scan()
        models = {}
        for item in resp.get("Items", []):
            name = item.get("name")
            if name:
                # Convert Decimal back to float
                cfg = {}
                for k, v in item.items():
                    try:
                        from decimal import Decimal
                        cfg[k] = float(v) if isinstance(v, Decimal) else v
                    except Exception:
                        cfg[k] = v
                models[name] = cfg
        logger.info("Loaded %d models from DynamoDB", len(models))
        return models
    except Exception as e:
        logger.warning("Could not load models from DynamoDB: %s", e)
        return {}


def delete_model(name: str) -> None:
    """Delete one model from DynamoDB."""
    try:
        _db().Table(REGISTRY_TABLE).delete_item(Key={"name": name})
        logger.info("Deleted model %r from DynamoDB", name)
    except Exception as e:
        logger.warning("Could not delete model %r: %s", name, e)


# ── Index metadata ─────────────────────────────────────────────────────────────

def save_index_shard(shard: str, doc_count: int) -> None:
    """Record that a shard was indexed."""
    try:
        _ensure_table(INDEX_META_TABLE, pk="shard")
        _db().Table(INDEX_META_TABLE).put_item(Item={
            "shard": shard,
            "doc_count": doc_count,
            "indexed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })
        logger.info("Saved index metadata: shard=%s docs=%d", shard, doc_count)
    except Exception as e:
        logger.warning("Could not save index metadata: %s", e)


def load_index_metadata() -> dict:
    """Load all index shard metadata from DynamoDB."""
    try:
        _ensure_table(INDEX_META_TABLE, pk="shard")
        resp = _db().Table(INDEX_META_TABLE).scan()
        return {item["shard"]: item for item in resp.get("Items", [])}
    except Exception as e:
        logger.warning("Could not load index metadata: %s", e)
        return {}
