import React from 'react';
import FileContentViewer from './FileContentViewer';

export default function DocsSourceModal({
  show, onClose,
  docsMode, switchDocsMode,
  srcError, srcContent, srcSelectedPath, srcLoading, srcTree,
  renderSrcTree, setSrcFullscreen, loadSourceFile,
  TERRAFORM_FILES, DOCKER_FILES, YAML_FILES,
}) {
  if (!show) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: '980px', width: '95vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div className="modal-header">
          <h3>📖 Project Documentation &amp; Source Files</h3>
          <button type="button" onClick={onClose}>Close</button>
        </div>

        {/* Mode selector tabs */}
        <div style={{ display: 'flex', gap: '6px', padding: '10px 0 12px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
          {[
            { mode: 'readme',    label: '📖 README',          color: '#7c3aed' },
            { mode: 'terraform', label: '🏗️ Terraform',       color: '#0f766e' },
            { mode: 'docker',    label: '🐳 Docker / Fargate', color: '#0369a1' },
            { mode: 'yaml',      label: '⚙️ GitHub Actions',   color: '#b45309' },
            { mode: 'browse',    label: '📂 Browse Files',     color: '#475569' },
          ].map(({ mode, label, color }) => (
            <button key={mode} type="button" onClick={() => switchDocsMode(mode)}
              style={{ padding: '6px 15px', fontSize: '13px', fontWeight: 600, borderRadius: '20px',
                border: `2px solid ${docsMode === mode ? color : '#e2e8f0'}`,
                background: docsMode === mode ? color : '#fff',
                color: docsMode === mode ? '#fff' : '#374151', cursor: 'pointer' }}>
              {label}
            </button>
          ))}
        </div>

        {srcError && (
          <div style={{ color: '#b91c1c', fontSize: '13px', margin: '8px 0', padding: '8px 12px',
            background: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
            Error: {srcError}
          </div>
        )}

        {/* Content area */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex', gap: '14px', minHeight: 0, paddingTop: '10px' }}>

          {/* Left panel */}
          {docsMode !== 'readme' && (
            <div style={{ width: '230px', flexShrink: 0, overflowY: 'auto',
              borderRight: '1px solid #e2e8f0', paddingRight: '10px', fontSize: '12.5px', lineHeight: '1.6' }}>
              {docsMode === 'terraform' && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#0f766e', marginBottom: '8px' }}>Terraform .tf files</div>
                  {TERRAFORM_FILES.map(f => (
                    <div key={f.path} onClick={() => loadSourceFile(f.path)}
                      style={{ padding: '5px 8px', borderRadius: '5px', cursor: 'pointer', marginBottom: '3px',
                        fontFamily: 'monospace', fontSize: '12px',
                        background: srcSelectedPath === f.path ? '#ecfdf5' : 'transparent',
                        color: srcSelectedPath === f.path ? '#065f46' : '#374151',
                        border: srcSelectedPath === f.path ? '1px solid #6ee7b7' : '1px solid transparent' }}>
                      {f.label}
                    </div>
                  ))}
                </>
              )}
              {docsMode === 'docker' && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#0369a1', marginBottom: '8px' }}>Docker / Fargate files</div>
                  {DOCKER_FILES.map(f => (
                    <div key={f.path} onClick={() => loadSourceFile(f.path)}
                      style={{ padding: '5px 8px', borderRadius: '5px', cursor: 'pointer', marginBottom: '3px',
                        fontFamily: 'monospace', fontSize: '12px',
                        background: srcSelectedPath === f.path ? '#eff6ff' : 'transparent',
                        color: srcSelectedPath === f.path ? '#1d4ed8' : '#374151',
                        border: srcSelectedPath === f.path ? '1px solid #93c5fd' : '1px solid transparent' }}>
                      {f.label}
                    </div>
                  ))}
                </>
              )}
              {docsMode === 'yaml' && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#b45309', marginBottom: '8px' }}>GitHub Actions YAML</div>
                  {YAML_FILES.map(f => (
                    <div key={f.path} onClick={() => loadSourceFile(f.path)}
                      style={{ padding: '5px 8px', borderRadius: '5px', cursor: 'pointer', marginBottom: '3px',
                        fontFamily: 'monospace', fontSize: '12px',
                        background: srcSelectedPath === f.path ? '#fffbeb' : 'transparent',
                        color: srcSelectedPath === f.path ? '#92400e' : '#374151',
                        border: srcSelectedPath === f.path ? '1px solid #fcd34d' : '1px solid transparent' }}>
                      {f.label}
                    </div>
                  ))}
                </>
              )}
              {docsMode === 'browse' && (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#64748b', marginBottom: '8px' }}>Source Tree</div>
                  {srcTree.length > 0
                    ? renderSrcTree(srcTree)
                    : <div style={{ color: '#94a3b8', fontSize: '12px' }}>{srcLoading ? 'Loading tree…' : 'No files found'}</div>}
                </>
              )}
            </div>
          )}

          {/* Right: file content */}
          <FileContentViewer
            content={srcContent}
            filePath={srcSelectedPath}
            isLoading={srcLoading}
            emptyMessage={docsMode === 'browse' ? 'Click a file in the tree to view it.' : 'Select a file to view its contents.'}
            onFullScreen={() => setSrcFullscreen(true)}
            onClose={onClose}
          />
        </div>
      </div>
    </div>
  );
}
