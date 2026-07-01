"""
lambda_logger.py
Shared structured JSON logger for all lambdas.
Each log line is a valid JSON object so CloudWatch Insights can query fields directly:
  fields @timestamp, level, lambda_name, message, duration_ms, request_id
"""

import json
import logging
import os
import time


class _JsonFormatter(logging.Formatter):
    """Emit each record as a single JSON line."""
    def format(self, record):
        entry = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level":     record.levelname,
            "logger":    record.name,
            "message":   record.getMessage(),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        # forward any extra= kwargs passed to log calls
        _reserved = {
            "name", "msg", "args", "created", "filename", "funcName",
            "levelname", "levelno", "lineno", "module", "msecs",
            "message", "pathname", "process", "processName",
            "relativeCreated", "stack_info", "thread", "threadName",
            "exc_info", "exc_text", "taskName",
        }
        for k, v in record.__dict__.items():
            if k not in _reserved:
                try:
                    json.dumps(v)   # only include JSON-serialisable extras
                    entry[k] = v
                except (TypeError, ValueError):
                    entry[k] = str(v)
        return json.dumps(entry, default=str)


def get_logger(name: str) -> logging.Logger:
    """Return a logger that writes structured JSON to stdout."""
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(_JsonFormatter())
        logger.addHandler(handler)
        logger.propagate = False
    level = os.getenv("LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))
    return logger


class LambdaTimer:
    """Context manager that logs duration and result on exit."""

    def __init__(self, log, lambda_name: str, request_id: str):
        self._log    = log
        self._name   = lambda_name
        self._rid    = request_id
        self._start  = None

    def __enter__(self):
        self._start = time.perf_counter()
        self._log.info(
            "invocation start",
            extra={"lambda_name": self._name, "request_id": self._rid},
        )
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        elapsed_ms = round((time.perf_counter() - self._start) * 1000, 1)
        if exc_type:
            self._log.error(
                "invocation failed",
                exc_info=(exc_type, exc_val, exc_tb),
                extra={
                    "lambda_name": self._name,
                    "request_id":  self._rid,
                    "duration_ms": elapsed_ms,
                    "status":      "ERROR",
                },
            )
        else:
            self._log.info(
                "invocation complete",
                extra={
                    "lambda_name": self._name,
                    "request_id":  self._rid,
                    "duration_ms": elapsed_ms,
                    "status":      "OK",
                },
            )
        return False   # do not suppress exceptions


_COLD_START = True   # module-level flag; flips to False after first invocation

def mark_warm():
    """Call once per lambda_handler to track cold vs warm starts."""
    global _COLD_START
    was_cold  = _COLD_START
    _COLD_START = False
    return was_cold
