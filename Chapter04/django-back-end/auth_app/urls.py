from django.urls import path
from . import views

urlpatterns = [
    path("register", views.register_user, name="auth-register"),
    path("login", views.login_user, name="auth-login"),
    path("forgot-password", views.forgot_password, name="auth-forgot-password"),
    path("approve", views.approve_user_registration, name="auth-approve"),
    path("resend-approval", views.resend_pending_approval, name="auth-resend-approval"),
    path("me", views.auth_me, name="auth-me"),
    path("logout", views.auth_logout, name="auth-logout"),
]
