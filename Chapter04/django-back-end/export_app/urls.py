from django.urls import path
from . import views
urlpatterns = [
    path("export/s3/buckets",                        views.list_s3_buckets),
    path("export/s3/<str:bucket>/objects",           views.list_bucket_objects),
    path("export/s3/<str:bucket>/download",          views.download_object),
    path("export/s3/<str:bucket>",                   views.delete_bucket),
    path("export/s3",                                views.export_to_s3),
    path("export/glue/databases/<str:database>/tables", views.list_glue_tables),
    path("export/glue/databases",                    views.list_glue_databases),
    path("export/glue",                              views.register_glue_table),
    path("export/pipeline/all",                      views.export_pipeline_all),
    path("export/pipeline/from-csv",                 views.export_pipeline_from_csv),
]
