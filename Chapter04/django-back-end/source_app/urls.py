from django.urls import path
from . import views

urlpatterns = [
    path("source/tree", views.get_tree),
    path("source/file", views.get_file),
]
