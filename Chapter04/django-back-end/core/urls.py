from django.urls import path
from . import views

urlpatterns = [
    path("", views.index, name="index"),
    path("health", views.health, name="health"),
    path("tables", views.list_tables, name="list-tables"),
    path("openapi.json", views.serve_openapi, name="openapi"),
    path("api-docs", views.api_docs, name="api-docs"),
]
