from django.urls import path
from . import views
urlpatterns = [
    path("athena/query",        views.run_query),
    path("athena/databases",    views.list_databases),
    path("athena/tables",       views.list_tables),
    path("athena/schema",       views.get_schema),
    path("athena/generate-sql", views.generate_sql),
]
