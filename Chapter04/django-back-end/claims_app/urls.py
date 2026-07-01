from django.urls import path
from . import views
urlpatterns = [
    path("claims/generate",      views.generate_claims),
    path("claims/clean",         views.clean_claims),
    path("claims/process-all",   views.process_all_claims),
    path("claims/files",         views.list_claims_files),
    path("claims/parquet-files", views.list_parquet_files),
    path("claims/file",          views.get_claims_file),
]
