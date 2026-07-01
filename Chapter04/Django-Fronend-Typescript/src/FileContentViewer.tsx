import { useState } from 'preact/hooks';

interface FileContentViewerProps {
  content: string;
  filePath: string;
  isLoading?: boolean;
  emptyMessage?: string;
  onFullScreen: () => void;
  onClose: () => void;
}

export default function FileContentViewer({
  content,
  filePath,
  isLoading = false,
  emptyMessage = 'Select a file to view its contents.',
  onFullScreen,
  onClose,
}: FileContentViewerProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0 }}>

      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '6px',
        marginBottom: '6px', minHeight: '28px', flexShrink: 0,
      }}>
        {filePath && (
          <span style={{
            fontSize: '11px', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: '#64748b', fontFamily: 'monospace',
            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {filePath}
          </span>
        )}

        {content && (
          <>
            <button
              type="button"
              title={collapsed ? 'Expand' : 'Collapse'}
              onClick={() => setCollapsed((c) => !c)}
              style={{
                padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1',
                borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              {collapsed ? '⊞ Expand' : '⊟ Collapse'}
            </button>

            <button
              type="button"
              title="Full Screen"
              onClick={onFullScreen}
              style={{
                padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                background: '#1e293b', color: '#94a3b8', border: '1px solid #334155',
                borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ⛶ Full Screen
            </button>

            <button
              type="button"
              title="Close file"
              onClick={onClose}
              style={{
                padding: '3px 10px', fontSize: '12px', fontWeight: 600,
                background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca',
                borderRadius: '5px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
              }}
            >
              ✕ Close
            </button>
          </>
        )}
      </div>

      {/* Content */}
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'auto', background: '#0f172a', borderRadius: '8px', padding: '12px' }}>
          {isLoading && !content ? (
            <div style={{ color: '#94a3b8', fontSize: '13px' }}>Loading…</div>
          ) : content ? (
            <pre style={{
              margin: 0, fontSize: '12px', color: '#e2e8f0',
              fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {content}
            </pre>
          ) : (
            <div style={{ color: '#64748b', fontSize: '13px', fontStyle: 'italic' }}>{emptyMessage}</div>
          )}
        </div>
      )}
    </div>
  );
}
