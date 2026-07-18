from django.urls import path
from . import views

urlpatterns = [
    path("sqs/messages",  views.messages),
    path("sqs/stats",     views.queue_stats),
    path("sqs/email-log", views.email_log),
    path("sqs/dlq",       views.dlq_messages),
    path("sqs/dlq/stats", views.dlq_stats),
]
