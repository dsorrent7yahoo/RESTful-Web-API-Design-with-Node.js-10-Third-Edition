from rest_framework.renderers import JSONRenderer


class IndentedJSONRenderer(JSONRenderer):
    """Renders all API responses as pretty-printed JSON with 2-space indentation."""

    def get_indent(self, accepted_media_type, renderer_context):
        # Honor any explicit indent= in the Accept header, otherwise default to 2.
        indent = super().get_indent(accepted_media_type, renderer_context)
        return indent if indent is not None else 2
