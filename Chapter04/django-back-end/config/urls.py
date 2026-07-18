# Databricks notebook source
from django.urls import path, include

urlpatterns = [
    path("", include("core.urls")),
    path("", include("medications.urls")),
    path("auth/", include("auth_app.urls")),
    path("", include("claims_app.urls")),
    path("", include("athena_app.urls")),
    path("", include("export_app.urls")),
    path("", include("upload_app.urls")),
    path("", include("sqs_app.urls")),
    path("", include("source_app.urls")),
]
