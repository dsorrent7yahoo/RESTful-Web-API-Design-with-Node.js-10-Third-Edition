from django.urls import path, include

urlpatterns = [
    path("", include("core.urls")),
    path("medications/", include("medications.urls")),
    path("auth/", include("auth_app.urls")),
]
