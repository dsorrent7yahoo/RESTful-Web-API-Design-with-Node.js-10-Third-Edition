import type { ComponentChildren } from 'preact';
import FileContentViewer from './FileContentViewer';
import { SrcTreeNode, SourceFile } from './types';

interface DocsSourceModalProps {
  show: boolean;
  onClose: () => void;
  docsMode: string;
  switchDocsMode: (mode: string) => void;
  srcError: string;
  srcContent: string;
  srcSelectedPath: string;
  srcLoading: boolean;
  srcTree: SrcTreeNode[];
  renderSrcTree: (nodes: SrcTreeNode[], depth?: number) => ComponentChildren;
  setSrcFullscreen: (v: boolean) => void;
  loadSourceFile: (path: string) => void;
  TERRAFORM_FILES: SourceFile[];
  DOCKER_FILES: SourceFile[];
  YAML_FILES: SourceFile[];
  LAMBDA_FILES: SourceFile[];
}

const TABS: { mode: string; label: string; color: string }[] = [
  { mode: 'deploy',      label: '🚀 Deploy Guide',      color: '#be123c' },
  { mode: 'readme',      label: '📖 README',            color: '#7c3aed' },
  { mode: 'terraform',   label: '🏗️ Terraform',         color: '#0f766e' },
  { mode: 'docker',      label: '🐳 Docker',            color: '#0369a1' },
  { mode: 'yaml',        label: '⚙️ GitHub Actions',    color: '#b45309' },
  { mode: 'lambdas',     label: '🐍 Lambda Functions',  color: '#7c3aed' },
  { mode: 'permissions', label: '🔐 AWS Permissions',   color: '#b45309' },
  { mode: 'browse',      label: '📂 Browse Files',      color: '#475569' },
];

export default function DocsSourceModal({
  show, onClose,
  docsMode, switchDocsMode,
  srcError, srcContent, srcSelectedPath, srcLoading, srcTree,
  renderSrcTree, setSrcFullscreen, loadSourceFile,
  TERRAFORM_FILES, DOCKER_FILES, YAML_FILES, LAMBDA_FILES,
}: DocsSourceModalProps) {
  if (!show) return null;

  const fileListFor = (mode: string): SourceFile[] => {
    if (mode === 'terraform') return TERRAFORM_FILES;
    if (mode === 'docker')    return DOCKER_FILES;
    if (mode === 'yaml')      return YAML_FILES;
    if (mode === 'lambdas')   return LAMBDA_FILES;
    return [];
  };

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
          {TABS.map(({ mode, label, color }) => (
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

          {/* Left panel — file list */}
          {!['readme', 'deploy'].includes(docsMode) && (
            <div style={{ width: '230px', flexShrink: 0, overflowY: 'auto',
              borderRight: '1px solid #e2e8f0', paddingRight: '10px', fontSize: '12.5px', lineHeight: '1.6' }}>
              {docsMode === 'browse' ? (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#475569', marginBottom: '8px' }}>Project Files</div>
                  {srcLoading && srcTree.length === 0
                    ? <div style={{ color: '#94a3b8', fontSize: '12px' }}>Loading tree…</div>
                    : renderSrcTree(srcTree)}
                </>
              ) : (
                <>
                  <div style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.1em', color: '#475569', marginBottom: '8px' }}>Files</div>
                  {fileListFor(docsMode).map((f) => (
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
            </div>
          )}

          {/* Right panel — file content */}
          <FileContentViewer
            content={srcContent}
            filePath={srcSelectedPath}
            isLoading={srcLoading}
            emptyMessage="Select a file on the left to view its contents."
            onFullScreen={() => setSrcFullscreen(true)}
            onClose={() => loadSourceFile('')}
          />
        </div>
      </div>
    </div>
  );
}
