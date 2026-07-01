# Databricks notebook source
from django.urls import path
from . import views

urlpatterns = [
    # Static sub-paths must come before the <item_id> wildcard
    path("medications/patients/multiple-medications", views.get_patients_with_multiple_medications, name="patients-multiple-medications"),
    path("medications/patients/multiple-medications/", views.get_patients_with_multiple_medications, name="patients-multiple-medications-slash"),
    path("medications/upload", views.upload_medications, name="medications-upload"),
    path("medications/upload/", views.upload_medications, name="medications-upload-slash"),
    path("medications/id/<str:item_id>", views.get_medication_by_id, name="medication-by-id"),
    path("medications/id/<str:item_id>/", views.get_medication_by_id, name="medication-by-id-slash"),
    path("medications/patient/<str:patient>", views.get_medications_by_patient, name="medications-by-patient"),
    path("medications/patient/<str:patient>/", views.get_medications_by_patient, name="medications-by-patient-slash"),
    path("medications/code/<str:code>", views.get_medications_by_code, name="medications-by-code"),
    path("medications/code/<str:code>/", views.get_medications_by_code, name="medications-by-code-slash"),
    path("medications/medication/<str:medication_id>", views.get_medications_by_medication_id, name="medications-by-medication-id"),
    path("medications/medication/<str:medication_id>/", views.get_medications_by_medication_id, name="medications-by-medication-id-slash"),
    # GET list + POST create share the same path
    path("medications", views.medications_list_or_create, name="medications-list-create"),
    path("medications/", views.medications_list_or_create, name="medications-list-create-slash"),
    # PUT update + DELETE remove share the same path
    path("medications/<str:item_id>", views.medication_detail, name="medication-detail"),
    path("medications/<str:item_id>/", views.medication_detail, name="medication-detail-slash"),
]
