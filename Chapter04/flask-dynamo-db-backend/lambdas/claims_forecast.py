"""
claims_forecast.py
Runs per-provider monthly linear regression and forecasts claim counts
through 2027-12, then stores result JSON in S3.
"""

import io
import json
import os
from datetime import datetime, timezone

import boto3
import pandas as pd

from lambda_logger import LambdaTimer, get_logger, mark_warm

log = get_logger("claims_forecast")

BUCKET = os.getenv("STAGING_BUCKET", "dgs-glue-staging")
FORECAST_PREFIX = os.getenv("CLAIMS_FORECAST_PREFIX", "claims-forecast/")
REGION = os.getenv("AWS_REGION", "us-east-1")
SQS_QUEUE_URL = os.getenv(
    "SQS_QUEUE_URL",
    "https://sqs.us-east-1.amazonaws.com/005905648819/dgs-fhir-lambda-results",
)
FORECAST_END_MONTH = "2027-12"


def _s3():
    return boto3.client("s3", region_name=REGION)


def _sqs():
    return boto3.client("sqs", region_name=REGION)


def _linear_regression(xs, ys):
    n = len(xs)
    if n == 0:
        return 0.0, 0.0, 0.0
    if n == 1:
        return 0.0, float(ys[0]), 1.0

    x_mean = sum(xs) / n
    y_mean = sum(ys) / n
    s_xy = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys))
    s_xx = sum((x - x_mean) ** 2 for x in xs)
    slope = s_xy / s_xx if s_xx else 0.0
    intercept = y_mean - slope * x_mean

    preds = [slope * x + intercept for x in xs]
    ss_tot = sum((y - y_mean) ** 2 for y in ys)
    ss_res = sum((y - p) ** 2 for y, p in zip(ys, preds))
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot else 1.0
    return float(slope), float(intercept), float(r2)


def _month_range(start_month, end_month):
    start = pd.Period(start_month, freq="M")
    end = pd.Period(end_month, freq="M")
    months = []
    cur = start
    while cur <= end:
        months.append(str(cur))
        cur = cur + 1
    return months


def _forecast_for_provider(provider_df):
    grouped = (
        provider_df.groupby("service_month")
        .size()
        .reset_index(name="claim_count")
        .sort_values("service_month")
    )

    history = [
        {"month": str(row.service_month), "claim_count": int(row.claim_count)}
        for row in grouped.itertuples(index=False)
    ]

    xs = list(range(len(history)))
    ys = [p["claim_count"] for p in history]
    slope, intercept, r2 = _linear_regression(xs, ys)

    if history:
        last_month = history[-1]["month"]
        start_month = str((pd.Period(last_month, freq="M") + 1))
    else:
        start_month = str(pd.Timestamp.utcnow().to_period("M"))

    forecast = []
    if start_month <= FORECAST_END_MONTH:
        future_months = _month_range(start_month, FORECAST_END_MONTH)
        offset = len(history)
        for i, month in enumerate(future_months):
            x = offset + i
            y = max(0, round(slope * x + intercept))
            forecast.append({"month": month, "predicted_claims": int(y)})

    return history, forecast, slope, intercept, r2


def lambda_handler(event, context):
    event = event or {}
    request_id = getattr(context, "aws_request_id", "local")
    cold_start = mark_warm()

    session_id = event.get("session_id")
    bucket = event.get("bucket", BUCKET)
    parquet_key = (event.get("key") or "").strip()
    if not parquet_key:
        raise ValueError("claims_forecast requires 'key' (clean parquet key)")

    with LambdaTimer(log, "claims_forecast", request_id):
        log.info(
            "running claims forecast",
            extra={
                "bucket": bucket,
                "parquet_key": parquet_key,
                "session_id": session_id,
                "cold_start": cold_start,
            },
        )

        parquet_bytes = _s3().get_object(Bucket=bucket, Key=parquet_key)["Body"].read()
        df = pd.read_parquet(io.BytesIO(parquet_bytes))

        if "service_date" not in df.columns:
            raise ValueError("Input parquet missing required column: service_date")
        if "provider_id" not in df.columns:
            raise ValueError("Input parquet missing required column: provider_id")

        df["service_date"] = pd.to_datetime(df["service_date"], errors="coerce")
        df = df[df["service_date"].notna()].copy()
        df["service_month"] = df["service_date"].dt.to_period("M").astype(str)
        if "provider_name" not in df.columns:
            df["provider_name"] = df["provider_id"]

        providers = []
        for provider_id, p_df in df.groupby("provider_id"):
            provider_name = str(p_df["provider_name"].dropna().iloc[0]) if not p_df.empty else str(provider_id)
            history, forecast, slope, intercept, r2 = _forecast_for_provider(p_df)
            providers.append(
                {
                    "provider_id": str(provider_id),
                    "provider_name": provider_name,
                    "history": history,
                    "forecast": forecast,
                    "regression": {
                        "slope": round(slope, 6),
                        "intercept": round(intercept, 6),
                        "r2": round(r2, 6),
                    },
                }
            )

        providers.sort(key=lambda p: p["provider_id"])

        now = datetime.now(timezone.utc)
        date_stamp = now.strftime("%Y-%m-%d")
        session_part = session_id or "no-session"
        forecast_key = f"{FORECAST_PREFIX.rstrip('/')}/{session_part}/forecast-{date_stamp}.json"

        payload = {
            "session_id": session_id,
            "source_bucket": bucket,
            "source_key": parquet_key,
            "generated_at": now.isoformat(),
            "forecast_end_month": FORECAST_END_MONTH,
            "providers": providers,
        }
        _s3().put_object(
            Bucket=bucket,
            Key=forecast_key,
            Body=json.dumps(payload, indent=2).encode("utf-8"),
            ContentType="application/json",
        )

        result = {
            "statusCode": 200,
            "lambda": "claims_forecast",
            "step": "forecast_claims",
            "step_status": "SUCCEEDED",
            "session_id": session_id,
            "bucket": bucket,
            "source_key": parquet_key,
            "forecast_key": forecast_key,
            "provider_count": len(providers),
            "forecast_end_month": FORECAST_END_MONTH,
            "timestamp": now.isoformat(),
        }

        try:
            _sqs().send_message(
                QueueUrl=SQS_QUEUE_URL,
                MessageBody=json.dumps(result),
                MessageAttributes={
                    "lambda": {"StringValue": "claims_forecast", "DataType": "String"},
                },
            )
        except Exception:
            log.warning("SQS publish failed", exc_info=True)

        return result


if __name__ == "__main__":
    lambda_handler(
        {
            "session_id": "local-session",
            "bucket": BUCKET,
            "key": "claims-parquet/claims-sample.parquet",
        },
        None,
    )
