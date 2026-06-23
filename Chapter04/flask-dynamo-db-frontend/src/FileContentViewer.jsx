import React, { useState } from 'react';

/**
 * FileContentViewer — partial component for displaying file contents.
 * Provides Full Screen, Collapse, and Close buttons in the same div as the <pre> area.
 *
 * Props:
 *   content       {string}   — file text to display (falsy = empty state)
 *   filePath      {string}   — path label shown in the toolbar
 *   isLoading     {bool}     — show loading text when true and content is empty
 *   emptyMessage  {string}   — placeholder text when no file is selected
 *   onFullScreen  {fn}       — called when ⛶ Full Screen is clicked
 *   onClose       {fn}       — called when ✕ Close is clicked
 */
export default function FileContentViewer({
  content,
  filePath,
  isLoading = false,
  emptyMessage = 'Select a file to view its contents.',
  onFullScreen,
  onClose,
}) {
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
              ✕
            </button>
          </>
        )}
      </div>

      {/* Body */}
      {isLoading && !content && (
        <div style={{ color: '#64748b', fontSize: '13px' }}>Loading…</div>
      )}

      {content && !collapsed && (
        <pre style={{
          background: '#0f172a', color: '#e2e8f0', padding: '16px', borderRadius: '8px',
          fontSize: '12px', lineHeight: '1.65', overflow: 'auto', flex: 1,
          whiteSpace: 'pre', margin: 0,
          fontFamily: '"Fira Mono", "Cascadia Code", "Consolas", monospace',
        }}>
          {content}
        </pre>
      )}

      {!content && !isLoading && (
        <div style={{ color: '#94a3b8', fontSize: '13px' }}>{emptyMessage}</div>
      )}
    </div>
  );
}
