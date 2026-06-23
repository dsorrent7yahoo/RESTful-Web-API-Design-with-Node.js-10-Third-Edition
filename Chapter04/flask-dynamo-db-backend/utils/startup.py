"""
utils/startup.py
Handles CLI argument parsing, secrets decryption, and CSV table bootstrap.
"""
import argparse
import base64
import json
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parent.parent
CHAPTER_DIR = BASE_DIR.parent
CSV_TABLES_DIR = CHAPTER_DIR / "coherent-11-07-2022" / "csv"
AUTO_CREATE_CSV_TABLES = (
    os.getenv("AUTO_CREATE_CSV_TABLES", "true").lower() != "false"
)


def parse_bool_text(value):
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def to_table_name_from_csv_file(file_name):
    text = Path(str(file_name or "")).stem.lower()
    cleaned = "".join(
        character if character.isalnum() else "_" for character in text
    )
    return cleaned.strip("_")


def ensure_default_csv_tables_exist():
    from model import medication as medication_model

    if not AUTO_CREATE_CSV_TABLES or not CSV_TABLES_DIR.exists():
        return

    table_names = {
        to_table_name_from_csv_file(path.name)
        for path in CSV_TABLES_DIR.iterdir()
        if path.suffix.lower() == ".csv"
    }

    for table_name in sorted(name for name in table_names if name):
        medication_model.ensure_table_exists(table_name)


def decrypt_startup_secrets_file(file_path, passphrase):
    from cryptography.fernet import Fernet
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

    raw = Path(file_path).read_text(encoding="utf-8")
    payload = json.loads(raw)
    salt = base64.urlsafe_b64decode(payload["salt"].encode("utf-8"))
    ciphertext = payload["ciphertext"].encode("utf-8")

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000,
    )
    key = base64.urlsafe_b64encode(
        kdf.derive(str(passphrase).encode("utf-8"))
    )
    plaintext = Fernet(key).decrypt(ciphertext)
    decoded = json.loads(plaintext.decode("utf-8"))

    if not isinstance(decoded, dict):
        raise ValueError("Decrypted secrets payload must be a JSON object")
    return decoded


def apply_startup_overrides_from_args():
    parser = argparse.ArgumentParser(add_help=True)
    parser.add_argument("--port", type=int)
    parser.add_argument("--approver-email")
    parser.add_argument("--jwt-secret")
    parser.add_argument("--jwt-exp-minutes", type=int)
    parser.add_argument("--approval-token-ttl-hours", type=int)
    parser.add_argument("--smtp-host")
    parser.add_argument("--smtp-port", type=int)
    parser.add_argument("--smtp-user")
    parser.add_argument("--smtp-password")
    parser.add_argument("--smtp-use-tls")
    parser.add_argument("--smtp-from-email")
    parser.add_argument("--secrets-file")
    parser.add_argument("--secrets-passphrase")

    args, _ = parser.parse_known_args()

    if args.secrets_file:
        if not args.secrets_passphrase:
            raise ValueError(
                "--secrets-passphrase is required with --secrets-file"
            )
        secrets_map = decrypt_startup_secrets_file(
            args.secrets_file,
            args.secrets_passphrase,
        )
        for key, value in secrets_map.items():
            os.environ[str(key)] = str(value)

    cli_env_map = {
        "PORT": args.port,
        "APPROVER_EMAIL": args.approver_email,
        "JWT_SECRET": args.jwt_secret,
        "JWT_EXP_MINUTES": args.jwt_exp_minutes,
        "APPROVAL_TOKEN_TTL_HOURS": args.approval_token_ttl_hours,
        "SMTP_HOST": args.smtp_host,
        "SMTP_PORT": args.smtp_port,
        "SMTP_USER": args.smtp_user,
        "SMTP_PASSWORD": args.smtp_password,
        "SMTP_FROM_EMAIL": args.smtp_from_email,
    }

    for key, value in cli_env_map.items():
        if value is not None:
            os.environ[key] = str(value)

    if args.smtp_use_tls is not None:
        os.environ["SMTP_USE_TLS"] = (
            "true" if parse_bool_text(args.smtp_use_tls) else "false"
        )
