from rest_framework.views import exception_handler
from rest_framework.response import Response


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is not None:
        return response
    # Unhandled exceptions
    return Response({"message": str(exc), "error": {}}, status=500)
