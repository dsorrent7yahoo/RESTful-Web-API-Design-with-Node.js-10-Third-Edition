import hashlib
import hmac
import os
import secrets
import smtplib
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

import jwt
from boto3.dynamodb.conditions import Attr
from botocore.exceptions import ClientError

from model import medication as medication_model


USERS_TABLE_NAME = "health-care-users"
PENDING_USERS_TABLE_NAME = "pending-users"
DEFAULT_USERNAME = "react"
DEFAULT_EMAIL = "react-dgs@yahoo.com"
DEFAULT_PASSWORD = "python"
PBKDF2_ITERATIONS = 120000
JWT_ALGORITHM = "HS256"


def get_jwt_secret():
    return os.getenv("JWT_SECRET", "health-care-dev-secret")


def get_jwt_exp_minutes():
    return int(os.getenv("JWT_EXP_MINUTES", "60"))


def get_approver_email():
    return os.getenv("APPROVER_EMAIL", "dsorrent7@gmail.com")


def get_approval_token_ttl_hours():
    return int(os.getenv("APPROVAL_TOKEN_TTL_HOURS", "48"))


def _default_smtp_host(smtp_user: str) -> str:
    """Infer a sensible SMTP host from the sender address when not configured."""
    if "@gmail.com" in smtp_user.lower():
        return "smtp.gmail.com"
    if "@outlook.com" in smtp_user.lower() or "@hotmail.com" in smtp_user.lower():
        return "smtp.office365.com"
    if "@yahoo.com" in smtp_user.lower():
        return "smtp.mail.yahoo.com"
    return ""


def get_smtp_config():
    approver_email = get_approver_email()
    smtp_user = os.getenv("SMTP_USER", "")
    explicit_host = os.getenv("SMTP_HOST", "")
    host = explicit_host or _default_smtp_host(smtp_user)
    return {
        "host": host,
        "port": int(os.getenv("SMTP_PORT", "587")),
        "user": smtp_user,
        "password": os.getenv("SMTP_PASSWORD", ""),
        "use_tls": os.getenv("SMTP_USE_TLS", "true").lower() != "false",
        "from_email": os.getenv(
            "SMTP_FROM_EMAIL",
            smtp_user or approver_email,
        ),
    }


class ApiError(Exception):
    def __init__(self, status_code, payload):
        super().__init__(payload.get("message", "Request failed"))
        self.status_code = status_code
        self.payload = payload


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def utc_now():
    return datetime.now(timezone.utc)


def normalize_email(email):
    return str(email or "").strip().lower()


def ensure_users_table_exists():
    try:
        medication_model.dynamodb_client.describe_table(
            TableName=USERS_TABLE_NAME
        )
        return
    except ClientError as error:
        if (
            error.response.get("Error", {}).get("Code")
            != "ResourceNotFoundException"
        ):
            raise

    medication_model.dynamodb.create_table(
        TableName=USERS_TABLE_NAME,
        AttributeDefinitions=[
            {"AttributeName": "email", "AttributeType": "S"}
        ],
        KeySchema=[{"AttributeName": "email", "KeyType": "HASH"}],
        BillingMode="PAY_PER_REQUEST",
    )
    waiter = medication_model.dynamodb_client.get_waiter("table_exists")
    waiter.wait(TableName=USERS_TABLE_NAME)


def ensure_pending_users_table_exists():
    try:
        medication_model.dynamodb_client.describe_table(
            TableName=PENDING_USERS_TABLE_NAME
        )
        return
    except ClientError as error:
        if (
            error.response.get("Error", {}).get("Code")
            != "ResourceNotFoundException"
        ):
            raise

    medication_model.dynamodb.create_table(
        TableName=PENDING_USERS_TABLE_NAME,
        AttributeDefinitions=[
            {"AttributeName": "email", "AttributeType": "S"}
        ],
        KeySchema=[{"AttributeName": "email", "KeyType": "HASH"}],
        BillingMode="PAY_PER_REQUEST",
    )
    waiter = medication_model.dynamodb_client.get_waiter("table_exists")
    waiter.wait(TableName=PENDING_USERS_TABLE_NAME)


def users_table():
    return medication_model.get_table(USERS_TABLE_NAME)


def pending_users_table():
    return medication_model.get_table(PENDING_USERS_TABLE_NAME)


def hash_password(password):
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        str(password).encode("utf-8"),
        salt,
        PBKDF2_ITERATIONS,
    )
    return (
        f"pbkdf2_sha256${PBKDF2_ITERATIONS}$"
        f"{salt.hex()}${digest.hex()}"
    )


def sha256_text(value):
    return hashlib.sha256(str(value).encode("utf-8")).hexdigest()


def verify_password(password, stored_hash):
    try:
        algorithm, iterations, salt_hex, digest_hex = str(
            stored_hash
        ).split("$")
        if algorithm != "pbkdf2_sha256":
            return False

        digest = hashlib.pbkdf2_hmac(
            "sha256",
            str(password).encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iterations),
        ).hex()
        return hmac.compare_digest(digest, digest_hex)
    except (ValueError, TypeError):
        return False


def get_user(email):
    result = users_table().get_item(Key={"email": normalize_email(email)})
    return result.get("Item")


def get_pending_user(email):
    result = pending_users_table().get_item(
        Key={"email": normalize_email(email)}
    )
    return result.get("Item")


def find_pending_user_by_token(token):
    token_hash = sha256_text(token)
    result = pending_users_table().scan(
        FilterExpression=Attr("approvalTokenHash").eq(token_hash)
    )
    items = result.get("Items", [])
    return items[0] if items else None


def user_response(user_item):
    return {
        "email": user_item.get("email"),
        "username": user_item.get("username"),
        "createdAt": user_item.get("createdAt"),
    }


def pending_user_response(pending_item):
    return {
        "email": pending_item.get("email"),
        "username": pending_item.get("username"),
        "requestedAt": pending_item.get("requestedAt"),
        "approvalExpiresAt": pending_item.get("approvalExpiresAt"),
    }


def create_access_token(user_item):
    now = utc_now()
    expires_at = now + timedelta(minutes=get_jwt_exp_minutes())
    payload = {
        "sub": user_item.get("email"),
        "email": user_item.get("email"),
        "username": user_item.get("username"),
        "iat": int(now.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(
        payload,
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )
    return {
        "token": token,
        "tokenType": "Bearer",
        "expiresAt": expires_at.isoformat().replace("+00:00", "Z"),
    }


def extract_bearer_token(authorization_header):
    if not authorization_header:
        raise ApiError(
            401,
            {
                "status": "error",
                "message": "Authorization header is required",
            },
        )

    value = str(authorization_header).strip()
    if not value.lower().startswith("bearer "):
        raise ApiError(
            401,
            {
                "status": "error",
                "message": "Authorization must use Bearer token",
            },
        )

    token = value[7:].strip()
    if not token:
        raise ApiError(
            401,
            {"status": "error", "message": "Bearer token is missing"},
        )
    return token


def verify_access_token(token):
    try:
        claims = jwt.decode(
            token,
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            options={"require": ["sub", "exp", "iat"]},
        )
        return claims
    except jwt.ExpiredSignatureError as error:
        raise ApiError(
            401,
            {"status": "error", "message": "Token has expired"},
        ) from error
    except jwt.InvalidTokenError as error:
        raise ApiError(
            401,
            {"status": "error", "message": "Invalid token"},
        ) from error


def ensure_default_user_exists():
    ensure_users_table_exists()
    if get_user(DEFAULT_EMAIL):
        return

    users_table().put_item(
        Item={
            "email": DEFAULT_EMAIL,
            "username": DEFAULT_USERNAME,
            "passwordHash": hash_password(DEFAULT_PASSWORD),
            "createdAt": utc_now_iso(),
        }
    )


def send_approval_email(approval_link, pending_item):
    smtp_config = get_smtp_config()
    email_message = build_approval_email_message(approval_link, pending_item)

    if not smtp_config["host"]:
        return False

    with smtplib.SMTP(
        smtp_config["host"],
        smtp_config["port"],
        timeout=20,
    ) as smtp:
        if smtp_config["use_tls"]:
            smtp.starttls()
        if smtp_config["user"]:
            smtp.login(
                smtp_config["user"],
                smtp_config["password"],
            )
        smtp.send_message(email_message)

    return True


def build_approval_email_message(approval_link, pending_item):
    smtp_config = get_smtp_config()
    approver_email = get_approver_email()
    message = EmailMessage()
    message["Subject"] = "Health Care Access Approval Request"
    message["From"] = smtp_config["from_email"]
    message["To"] = approver_email

    requested_at = pending_item.get("requestedAt")
    email = pending_item.get("email")
    username = pending_item.get("username")

    message.set_content(
        "A new user has requested access.\n\n"
        f"Email: {email}\n"
        f"Username: {username}\n"
        f"Requested At: {requested_at}\n\n"
        "Approve this request with the link below:\n"
        f"{approval_link}\n"
    )
    return message


def approval_email_preview(approval_link, pending_item):
    message = build_approval_email_message(approval_link, pending_item)
    return {
        "subject": message["Subject"],
        "from": message["From"],
        "to": message["To"],
        "body": message.get_content(),
    }


def build_approval_link(base_url, approval_token):
    return (
        f"{str(base_url).rstrip('/')}/auth/approve"
        f"?token={approval_token}"
    )


def new_approval_token_payload(base_url):
    approval_token = secrets.token_urlsafe(32)
    token_hash = sha256_text(approval_token)
    expires_at = utc_now() + timedelta(hours=get_approval_token_ttl_hours())
    approval_link = build_approval_link(base_url, approval_token)
    return {
        "tokenHash": token_hash,
        "expiresAt": expires_at.isoformat().replace("+00:00", "Z"),
        "approvalLink": approval_link,
    }


def register_user(payload, base_url):
    ensure_users_table_exists()
    ensure_pending_users_table_exists()
    ensure_default_user_exists()

    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")
    username = str(payload.get("username") or "").strip()

    if not email:
        raise ApiError(
            400,
            {"status": "error", "message": "email is required"},
        )
    if not password:
        raise ApiError(
            400,
            {"status": "error", "message": "password is required"},
        )

    if get_user(email):
        raise ApiError(
            409,
            {
                "status": "error",
                "message": "User already exists",
            },
        )

    existing_pending = get_pending_user(email)
    if existing_pending:
        # Refresh the token and resend the approval email
        approval_data = new_approval_token_payload(base_url)
        pending_users_table().update_item(
            Key={"email": email},
            UpdateExpression=(
                "SET approvalTokenHash = :tokenHash, "
                "approvalExpiresAt = :expiresAt"
            ),
            ExpressionAttributeValues={
                ":tokenHash": approval_data["tokenHash"],
                ":expiresAt": approval_data["expiresAt"],
            },
        )
        refreshed = get_pending_user(email)
        email_sent = False
        try:
            email_sent = send_approval_email(
                approval_data["approvalLink"],
                refreshed,
            )
        except Exception:
            email_sent = False

        response = {
            "status": "pending_approval",
            "message": "User registration is already pending approval — approval email resent",
            "pendingUser": pending_user_response(refreshed),
            "approvalEmail": get_approver_email(),
            "approvalEmailSent": email_sent,
        }
        if not email_sent:
            response["devApprovalLink"] = approval_data["approvalLink"]
            response["approvalEmailPreview"] = approval_email_preview(
                approval_data["approvalLink"],
                refreshed,
            )
        raise ApiError(409, response)

    now = utc_now()
    approval_data = new_approval_token_payload(base_url)

    pending_item = {
        "email": email,
        "username": username or email,
        "passwordHash": hash_password(password),
        "requestedAt": now.isoformat().replace("+00:00", "Z"),
        "approvalExpiresAt": approval_data["expiresAt"],
        "approvalTokenHash": approval_data["tokenHash"],
    }
    pending_users_table().put_item(Item=pending_item)

    email_sent = False
    try:
        email_sent = send_approval_email(
            approval_data["approvalLink"],
            pending_item,
        )
    except Exception:
        email_sent = False

    response = {
        "status": "pending_approval",
        "message": "Registration submitted and waiting for approval",
        "pendingUser": pending_user_response(pending_item),
        "approvalEmail": get_approver_email(),
        "approvalEmailSent": email_sent,
    }

    if not email_sent:
        # Keep this for local/dev use when SMTP is not configured.
        response["devApprovalLink"] = approval_data["approvalLink"]
        response["approvalEmailPreview"] = approval_email_preview(
            approval_data["approvalLink"],
            pending_item,
        )

    return response


def resend_approval(payload, base_url):
    ensure_pending_users_table_exists()

    email = normalize_email(payload.get("email"))
    if not email:
        raise ApiError(
            400,
            {"status": "error", "message": "email is required"},
        )

    pending_item = get_pending_user(email)
    if not pending_item:
        raise ApiError(
            404,
            {
                "status": "error",
                "message": "No pending registration found for this email",
            },
        )

    approval_data = new_approval_token_payload(base_url)

    pending_users_table().update_item(
        Key={"email": email},
        UpdateExpression=(
            "SET approvalTokenHash = :tokenHash, "
            "approvalExpiresAt = :expiresAt"
        ),
        ExpressionAttributeValues={
            ":tokenHash": approval_data["tokenHash"],
            ":expiresAt": approval_data["expiresAt"],
        },
    )

    refreshed_pending_item = get_pending_user(email)
    email_sent = False
    try:
        email_sent = send_approval_email(
            approval_data["approvalLink"],
            refreshed_pending_item,
        )
    except Exception:
        email_sent = False

    response = {
        "status": "pending_approval",
        "message": "Approval request resent",
        "pendingUser": pending_user_response(refreshed_pending_item),
        "approvalEmail": get_approver_email(),
        "approvalEmailSent": email_sent,
    }
    if not email_sent:
        response["devApprovalLink"] = approval_data["approvalLink"]
        response["approvalEmailPreview"] = approval_email_preview(
            approval_data["approvalLink"],
            refreshed_pending_item,
        )
    return response


def login_user(payload):
    ensure_users_table_exists()
    ensure_default_user_exists()

    email = normalize_email(payload.get("email"))
    password = str(payload.get("password") or "")

    if not email or not password:
        raise ApiError(
            400,
            {
                "status": "error",
                "message": "email and password are required",
            },
        )

    user_item = get_user(email)
    if not user_item or not verify_password(
        password,
        user_item.get("passwordHash"),
    ):
        raise ApiError(
            401,
            {
                "status": "error",
                "message": "Invalid email or password",
            },
        )

    token_data = create_access_token(user_item)
    return {
        "status": "ok",
        "user": user_response(user_item),
        "accessToken": token_data["token"],
        "tokenType": token_data["tokenType"],
        "expiresAt": token_data["expiresAt"],
    }


def reset_password_by_email(payload):
    ensure_users_table_exists()
    ensure_default_user_exists()

    email = normalize_email(payload.get("email"))
    new_password = str(payload.get("newPassword") or "")

    if not email:
        raise ApiError(
            400,
            {"status": "error", "message": "email is required"},
        )

    if not new_password:
        raise ApiError(
            400,
            {
                "status": "error",
                "message": "newPassword is required",
            },
        )

    user_item = get_user(email)
    if not user_item:
        raise ApiError(
            404,
            {
                "status": "error",
                "message": "User not found",
            },
        )

    users_table().update_item(
        Key={"email": email},
        UpdateExpression="SET passwordHash = :passwordHash",
        ExpressionAttributeValues={
            ":passwordHash": hash_password(new_password)
        },
    )

    updated_user = get_user(email)
    return {
        "status": "ok",
        "message": "Password updated",
        "user": user_response(updated_user),
    }


def get_current_user_from_token(token):
    claims = verify_access_token(token)
    user_item = get_user(claims.get("email"))
    if not user_item:
        raise ApiError(
            401,
            {"status": "error", "message": "User does not exist"},
        )
    return user_item


def logout_user(token):
    user_item = get_current_user_from_token(token)
    return {
        "status": "ok",
        "message": "Logged out. Discard token on client side.",
        "user": user_response(user_item),
    }


def approve_user_registration(token):
    ensure_users_table_exists()
    ensure_pending_users_table_exists()

    if not token:
        raise ApiError(
            400,
            {"status": "error", "message": "approval token is required"},
        )

    pending_item = find_pending_user_by_token(token)
    if not pending_item:
        raise ApiError(
            404,
            {"status": "error", "message": "Pending request not found"},
        )

    expires_at = pending_item.get("approvalExpiresAt")
    if expires_at and utc_now() > datetime.fromisoformat(
        str(expires_at).replace("Z", "+00:00")
    ):
        pending_users_table().delete_item(Key={"email": pending_item["email"]})
        raise ApiError(
            410,
            {"status": "error", "message": "Approval token has expired"},
        )

    user_item = {
        "email": pending_item.get("email"),
        "username": pending_item.get("username")
        or pending_item.get("email"),
        "passwordHash": pending_item.get("passwordHash"),
        "createdAt": utc_now_iso(),
    }
    users_table().put_item(Item=user_item)
    pending_users_table().delete_item(Key={"email": pending_item["email"]})

    return {
        "status": "approved",
        "message": "User moved from pending-users to health-care-users",
        "user": user_response(user_item),
    }
