

interface SwaggerDocsButtonProps {
  normalizedBaseUrl: string;
}

export default function SwaggerDocsButton({ normalizedBaseUrl }: SwaggerDocsButtonProps) {
  return (
    <a
      href={`${normalizedBaseUrl}/api-docs`}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        background: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
        color: '#fff',
        borderRadius: '6px',
        padding: '5px 14px',
        fontWeight: 700,
        fontSize: '13px',
        textDecoration: 'none',
        display: 'inline-block',
      }}
    >
      📋 Swagger Docs
    </a>
  );
}
