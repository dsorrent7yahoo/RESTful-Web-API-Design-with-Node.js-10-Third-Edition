# django-back-end

A Django REST Framework backend equivalent to `flask-dynamo-db-backend`, using DynamoDB for storage and JWT for authentication.

## Stack

- **Django 5.1** + **Django REST Framework 3.15**
- **django-cors-headers** for CORS
- **boto3** for DynamoDB
- **PyJWT** for authentication
- **gunicorn** for production serving

## Project Structure

```
django-back-end/
├── config/           # Django project settings, URLs, WSGI/ASGI
├── medications/      # Medication CRUD views and URLs
├── auth_app/         # Auth views and URLs (register, login, approve, etc.)
├── core/             # Health check, table listing, OpenAPI, Swagger UI
├── model/            # DynamoDB model (medication.py)
├── modules/          # Business logic (medications.py, auth.py)
├── utils/            # JWT decorator (jwt_utils.py)
├── manage.py
├── requirements.txt
├── Dockerfile
└── openapi.json
```

## Routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/tables` | List DynamoDB tables (JWT) |
| GET | `/openapi.json` | OpenAPI spec |
| GET | `/api-docs` | Swagger UI |
| GET | `/medications` | List medications (JWT) |
| POST | `/medications` | Create medication (JWT) |
| GET | `/medications/id/<id>` | Get by ID (JWT) |
| PUT | `/medications/<id>` | Update (JWT) |
| DELETE | `/medications/<id>` | Delete (JWT) |
| GET | `/medications/patient/<patient>` | By patient (JWT) |
| GET | `/medications/code/<code>` | By code (JWT) |
| GET | `/medications/patients/multiple-medications` | Patients with multiple meds (JWT) |
| POST | `/medications/upload` | Bulk CSV upload (JWT) |
| POST | `/auth/register` | Register user |
| POST | `/auth/login` | Login |
| POST | `/auth/forgot-password` | Reset password |
| GET/POST | `/auth/approve` | Approve registration |
| POST | `/auth/resend-approval` | Resend approval email |
| GET | `/auth/me` | Current user (JWT) |
| POST | `/auth/logout` | Logout (JWT) |

## Running locally

```bash
# Install dependencies
pip install -r requirements.txt

# Configure .env (copy and edit)
cp .env .env.local

# Run development server
python manage.py runserver 0.0.0.0:4002
```

## Running with Docker

```bash
docker build -t django-back-end .
docker run -p 4002:4002 --env-file .env django-back-end
```
