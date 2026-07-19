# Databricks notebook source
import importlib
import json
import os
import sys
import uuid

import boto3
from flask import Blueprint, jsonify, request

from utils.jwt_utils import jwt_required

claims_pipeline_bp = Blueprint("claims_pipeline", __name__)

REGION = os.getenv("AWS_REGION", "us-east-1")
STATE_MACHINE_ARN = os.getenv("CLAIMS_PIPELINE_STATE_MACHINE_ARN", "").strip()
BUCKET = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
FORECAST_PREFIX = os.getenv("CLAIMS_FORECAST_PREFIX", "claims-forecast/")

_session_execution_map = {}


def _lambda_dir():
    d = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "lambdas"))
    if d not in sys.path:
        sys.path.insert(0, d)
    return d


def _sfn():
    return boto3.client("stepfunctions", region_name=REGION)


def _s3():
    return boto3.client("s3", region_name=REGION)


def _parse_maybe_json(value):
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value:
        try:
            return json.loads(value)
        except Exception:
            return value
    return value


def _safe_session_id():
    return f"session-{uuid.uuid4().hex[:12]}"


def _state_name_to_step(state_name):
    mapping = {
        "GenerateSyntheticClaims": "generate_synthetic_claims",
        "CleanClaims": "clean_claims",
        "StoreClaimsManifest": "store_claims_manifest",
        "ForecastClaimsByProvider": "forecast_claims",
    }
    return mapping.get(state_name, state_name)


def _summarize_execution_steps(execution_arn):
    steps = {
        "generate_synthetic_claims": "PENDING",
        "clean_claims": "PENDING",
        "store_claims_manifest": "PENDING",
        "forecast_claims": "PENDING",
    }
    events_out = []

    resp = _sfn().get_execution_history(executionArn=execution_arn, reverseOrder=False)
    events = resp.get("events", [])
    while "nextToken" in resp:
        resp = _sfn().get_execution_history(
            executionArn=execution_arn,
            reverseOrder=False,
            nextToken=resp["nextToken"],
        )
        events.extend(resp.get("events", []))

    for evt in events:
        typ = evt.get("type", "")
        details_key = f"{typ[0].lower()}{typ[1:]}EventDetails" if typ else ""
        details = evt.get(details_key, {}) if details_key else {}
        state_name = details.get("name") or details.get("stateEnteredEventDetails", {}).get("name")
        step = _state_name_to_step(state_name) if state_name else None

        if step in steps:
            if typ in ("TaskStateEntered", "PassStateEntered"):
                steps[step] = "RUNNING"
            elif typ in ("TaskStateExited", "PassStateExited"):
                steps[step] = "SUCCEEDED"
            elif typ in (
                "TaskFailed",
                "ExecutionFailed",
                "LambdaFunctionFailed",
                "TaskSubmitFailed",
                "TaskTimedOut",
                "ExecutionAborted",
            ):
                steps[step] = "FAILED"

        if typ in (
            "TaskStateEntered",
            "TaskStateExited",
            "TaskFailed",
            "ExecutionSucceeded",
            "ExecutionFailed",
            "ExecutionStarted",
        ):
            events_out.append(
                {
                    "id": evt.get("id"),
                    "type": typ,
                    "step": step,
                    "step_status": steps.get(step) if step else None,
                    "timestamp": evt.get("timestamp").isoformat() if evt.get("timestamp") else None,
                }
            )

    return steps, events_out


def _run_local_pipeline(session_id):
    _lambda_dir()

    import synthetic_fhir_claims
    import claims_cleaner
    import claims_store_manifest
    import claims_forecast

    importlib.reload(synthetic_fhir_claims)
    importlib.reload(claims_cleaner)
    importlib.reload(claims_store_manifest)
    importlib.reload(claims_forecast)

    gen = synthetic_fhir_claims.lambda_handler({"session_id": session_id}, None)
    clean = claims_cleaner.lambda_handler(
        {
            "session_id": session_id,
            "bucket": gen.get("bucket", BUCKET),
            "key": gen.get("key"),
        },
        None,
    )
    store = claims_store_manifest.lambda_handler(
        {
            "session_id": session_id,
            "bucket": clean.get("bucket", BUCKET),
            "key": clean.get("key"),
        },
        None,
    )
    forecast = claims_forecast.lambda_handler(
        {
            "session_id": session_id,
            "bucket": clean.get("bucket", BUCKET),
            "key": clean.get("key"),
        },
        None,
    )
    return {
        "session_id": session_id,
        "generate": gen,
        "clean": clean,
        "store": store,
        "forecast": forecast,
    }


@claims_pipeline_bp.post("/claims/pipeline/start")
@jwt_required
def start_pipeline():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id") or _safe_session_id()

    if STATE_MACHINE_ARN:
        exec_name = f"claims-{session_id}".replace("_", "-")[:80]
        payload = {"session_id": session_id}
        resp = _sfn().start_execution(
            stateMachineArn=STATE_MACHINE_ARN,
            name=exec_name,
            input=json.dumps(payload),
        )
        execution_arn = resp.get("executionArn")
        _session_execution_map[session_id] = execution_arn
        return jsonify(
            {
                "status": "started",
                "session_id": session_id,
                "executionArn": execution_arn,
                "stateMachineArn": STATE_MACHINE_ARN,
            }
        )

    local = _run_local_pipeline(session_id)
    return jsonify(
        {
            "status": "completed_local",
            "session_id": session_id,
            "executionArn": None,
            "local_result": local,
        }
    )


@claims_pipeline_bp.get("/claims/pipeline/status")
@jwt_required
def pipeline_status():
    execution_arn = request.args.get("executionArn", "").strip()
    if not execution_arn:
        return jsonify({"status": "error", "message": "executionArn is required"}), 400

    resp = _sfn().describe_execution(executionArn=execution_arn)
    output = _parse_maybe_json(resp.get("output"))
    in_data = _parse_maybe_json(resp.get("input"))
    return jsonify(
        {
            "executionArn": execution_arn,
            "status": resp.get("status"),
            "startDate": resp.get("startDate").isoformat() if resp.get("startDate") else None,
            "stopDate": resp.get("stopDate").isoformat() if resp.get("stopDate") else None,
            "input": in_data,
            "output": output,
        }
    )


@claims_pipeline_bp.get("/claims/pipeline/session-status")
@jwt_required
def session_status():
    session_id = request.args.get("sessionId", "").strip()
    if not session_id:
        return jsonify({"status": "error", "message": "sessionId is required"}), 400

    execution_arn = _session_execution_map.get(session_id)
    if not execution_arn:
        return jsonify(
            {
                "session_id": session_id,
                "executionArn": None,
                "steps": {
                    "generate_synthetic_claims": "PENDING",
                    "clean_claims": "PENDING",
                    "store_claims_manifest": "PENDING",
                    "forecast_claims": "PENDING",
                },
                "events": [],
            }
        )

    steps, events = _summarize_execution_steps(execution_arn)
    return jsonify(
        {
            "session_id": session_id,
            "executionArn": execution_arn,
            "steps": steps,
            "events": events,
        }
    )


@claims_pipeline_bp.get("/claims/pipeline/executions")
@jwt_required
def list_executions():
    if not STATE_MACHINE_ARN:
        return jsonify({"executions": [], "message": "STATE_MACHINE_ARN not configured"})

    resp = _sfn().list_executions(stateMachineArn=STATE_MACHINE_ARN, maxResults=50)
    executions = []
    for e in resp.get("executions", []):
        executions.append(
            {
                "name": e.get("name"),
                "executionArn": e.get("executionArn"),
                "status": e.get("status"),
                "startDate": e.get("startDate").isoformat() if e.get("startDate") else None,
                "stopDate": e.get("stopDate").isoformat() if e.get("stopDate") else None,
            }
        )
    return jsonify({"executions": executions})


@claims_pipeline_bp.get("/claims/pipeline/history")
@jwt_required
def execution_history():
    execution_arn = request.args.get("executionArn", "").strip()
    if not execution_arn:
        return jsonify({"status": "error", "message": "executionArn is required"}), 400

    resp = _sfn().get_execution_history(executionArn=execution_arn, reverseOrder=False)
    history = []
    for evt in resp.get("events", []):
        history.append(
            {
                "id": evt.get("id"),
                "type": evt.get("type"),
                "timestamp": evt.get("timestamp").isoformat() if evt.get("timestamp") else None,
            }
        )
    return jsonify({"executionArn": execution_arn, "events": history})


@claims_pipeline_bp.get("/claims/pipeline/cloudwatch")
@jwt_required
def cloudwatch_placeholder():
    return jsonify(
        {
            "status": "ok",
            "message": "Use Step Functions execution history and lambda logs in CloudWatch for step-level details.",
        }
    )


@claims_pipeline_bp.post("/claims/pipeline/run-local")
@jwt_required
def run_local_pipeline():
    body = request.get_json(silent=True) or {}
    session_id = body.get("session_id") or _safe_session_id()
    result = _run_local_pipeline(session_id)
    return jsonify({"status": "ok", "result": result})


@claims_pipeline_bp.get("/claims/pipeline/forecast")
@jwt_required
def get_forecast():
    key = request.args.get("key", "").strip()
    session_id = request.args.get("sessionId", "").strip()

    if not key:
        prefix = FORECAST_PREFIX.rstrip("/") + "/"
        if session_id:
            prefix = f"{prefix}{session_id}/"
        resp = _s3().list_objects_v2(Bucket=BUCKET, Prefix=prefix)
        objects = sorted(resp.get("Contents", []), key=lambda o: o["LastModified"], reverse=True)
        if not objects:
            return jsonify({"status": "error", "message": "No forecast files found"}), 404
        key = objects[0]["Key"]

    obj = _s3().get_object(Bucket=BUCKET, Key=key)
    payload = json.loads(obj["Body"].read().decode("utf-8"))
    return jsonify({"status": "ok", "key": key, "result": payload})
