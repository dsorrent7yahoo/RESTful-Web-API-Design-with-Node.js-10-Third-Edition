import argparse
import base64
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


def derive_key(passphrase, salt):
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390000,
    )
    return base64.urlsafe_b64encode(kdf.derive(passphrase.encode("utf-8")))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--passphrase", required=True)
    parser.add_argument("--json", help="Inline JSON object")
    parser.add_argument("--json-file", help="Path to JSON file")
    args = parser.parse_args()

    if not args.json and not args.json_file:
        raise ValueError("Provide --json or --json-file")

    if args.json_file:
        source = Path(args.json_file).read_text(encoding="utf-8")
    else:
        source = args.json

    data = json.loads(source)
    if not isinstance(data, dict):
        raise ValueError("Source secrets must be a JSON object")

    salt = os.urandom(16)
    key = derive_key(args.passphrase, salt)
    ciphertext = Fernet(key).encrypt(
        json.dumps(data).encode("utf-8")
    ).decode("utf-8")

    payload = {
        "kdf": "pbkdf2_sha256",
        "iterations": 390000,
        "salt": base64.urlsafe_b64encode(salt).decode("utf-8"),
        "ciphertext": ciphertext,
    }

    Path(args.output).write_text(
        json.dumps(payload, indent=2),
        encoding="utf-8",
    )
    print(f"Wrote encrypted secrets file: {args.output}")


if __name__ == "__main__":
    main()
