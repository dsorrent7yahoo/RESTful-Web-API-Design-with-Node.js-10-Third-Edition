from django.urls import path
from . import views
urlpatterns = [
    path("upload/file", views.upload_csv_file),
    path("upload",      views.upload_csv),
]
