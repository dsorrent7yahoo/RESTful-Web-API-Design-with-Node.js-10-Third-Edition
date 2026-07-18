import { useState, useEffect } from 'preact/hooks';
import { listConfigFiles, getConfigFile, FileEntry, FileContent } from '../api/configBrowser';

const CATEGORY_LABELS: Record<string, string> = {
  docs:    '📄 Documentation',
  config:  '⚙️ Configuration',
  aws:     '☁️ AWS / IAM',
  swagger: '🔌 OpenAPI Specs',
};

export function ConfigBrowser() {
  const [files, setFiles]     = useState<FileEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    listConfigFiles()
      .then(setFiles)
      .catch(e => setError(e.message));
  }, []);

  async function loadFile(id: string) {
    setSelected(id); setContent(null); setLoading(true); setError('');
    try {
      setContent(await getConfigFile(id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load file');
    } finally {
      setLoading(false);
    }
  }

  const grouped = files.reduce<Record<string, FileEntry[]>>((acc, f) => {
    (acc[f.category] = acc[f.category] || []).push(f);
    return acc;
  }, {});

  function renderContent(fc: FileContent) {
    if (fc.type === 'shell') {
      return <pre class="code-block shell-block"><code>{fc.content}</code></pre>;
    }
    if (fc.type === 'json') {
      try {
        const pretty = JSON.stringify(JSON.parse(fc.content), null, 2);
        return <pre class="code-block json-block"><code>{pretty}</code></pre>;
      } catch { /**/ }
    }
    if (fc.type === 'env') {
      return (
        <pre class="code-block env-block">
          {fc.content.split('\n').map((line, i) => {
            const isComment = line.trim().startsWith('#');
            const hasSecret = line.includes('####');
            return (
              <span key={i} class={isComment ? 'env-comment' : hasSecret ? 'env-secret' : 'env-value'}>
                {line}{'\n'}
              </span>
            );
          })}
        </pre>
      );
    }
    // Markdown — render as plain text (no full MD renderer needed)
    return (
      <div class="md-block">
        {fc.content.split('\n').map((line, i) => {
          if (line.startsWith('# '))   return <h1 key={i}>{line.slice(2)}</h1>;
          if (line.startsWith('## '))  return <h2 key={i}>{line.slice(3)}</h2>;
          if (line.startsWith('### ')) return <h3 key={i}>{line.slice(4)}</h3>;
          if (line.startsWith('```'))  return <hr key={i} class="code-fence" />;
          if (line.startsWith('| '))   return <p key={i} class="md-table-row">{line}</p>;
          if (!line.trim())            return <br key={i} />;
          return <p key={i} class="md-para">{line}</p>;
        })}
      </div>
    );
  }

  return (
    <div class="use-case config-browser">
      <div class="uc-header purple">
        <span class="icon">📁</span>
        <div>
          <h2>Config &amp; Documentation Browser</h2>
          <p>Browse project files — secrets automatically redacted with #### characters</p>
        </div>
        <span class="api-badge">RAG :4009</span>
      </div>

      <div class="browser-layout">
        <aside class="file-tree">
          {error && !files.length && <p class="tree-error">⚠ {error}</p>}
          {Object.entries(CATEGORY_LABELS).map(([cat, label]) =>
            grouped[cat]?.length ? (
              <div key={cat} class="tree-group">
                <div class="tree-category">{label}</div>
                {grouped[cat].map(f => (
                  <button key={f.id}
                    class={`tree-item ${selected === f.id ? 'active' : ''} ${!f.exists ? 'missing' : ''}`}
                    onClick={() => f.exists && loadFile(f.id)}
                    title={f.description}>
                    <span class="tree-icon">{f.type === 'markdown' ? '📝' : f.type === 'json' ? '{}' : f.type === 'shell' ? '🖥' : '⚙'}</span>
                    <span class="tree-label">{f.label}</span>
                    {!f.exists && <span class="tree-missing">missing</span>}
                  </button>
                ))}
              </div>
            ) : null
          )}
        </aside>

        <section class="file-viewer">
          {!selected && (
            <div class="viewer-placeholder">
              <p>← Select a file from the list to view its contents</p>
              <p class="hint">All secret values (JWT tokens, API keys, passwords) are automatically<br/>replaced with <code>####</code> characters before being displayed.</p>
            </div>
          )}
          {loading && <div class="viewer-loading">⏳ Loading…</div>}
          {error && selected && <div class="error-box">⚠ {error}</div>}
          {content && !loading && (
            <>
              <div class="viewer-toolbar">
                <strong>{content.label}</strong>
                <div class="viewer-badges">
                  {content.redacted && <span class="badge badge-warn">🔒 secrets redacted</span>}
                  <span class="badge">{(content.size_bytes / 1024).toFixed(1)} KB</span>
                  <span class="badge">{content.type}</span>
                </div>
              </div>
              {renderContent(content)}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
