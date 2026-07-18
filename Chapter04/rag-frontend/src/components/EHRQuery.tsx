import { useState, useEffect } from 'preact/hooks';
import { nlToPartiQL, listTables, executePartiQL, QueryResponse, TableListResponse, ExecuteResponse } from '../api/ehrQuery';

const EXAMPLES = [
  'Find all patients prescribed Warfarin Sodium after 2015',
  'Which patients are on more than 3 different medications?',
  'Show me all Metformin prescriptions with total cost over $50',
  'Find patients who have both diabetes and hypertension conditions',
];

export function EHRQuery() {
  const [question, setQuestion] = useState(EXAMPLES[0]);
  const [result, setResult]     = useState<QueryResponse | null>(null);
  const [tables, setTables]     = useState<TableListResponse | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [execResult, setExecResult] = useState<ExecuteResponse | null>(null);
  const [execLoading, setExecLoading] = useState(false);
  const [execError, setExecError]   = useState('');

  useEffect(() => {
    listTables().then(setTables).catch(() => {});
  }, []);

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!question.trim()) return;
    setLoading(true); setError(''); setResult(null); setExecResult(null); setExecError('');
    try {
      const data = await nlToPartiQL({ question: question.trim(), top_k: 3 });
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleExecute() {
    if (!result?.partiql) return;
    setExecLoading(true); setExecError(''); setExecResult(null);
    try {
      const data = await executePartiQL({ partiql: result.partiql, limit: 20 });
      setExecResult(data);
    } catch (err: unknown) {
      setExecError(err instanceof Error ? err.message : 'Execution failed');
    } finally {
      setExecLoading(false);
    }
  }

  return (
    <div class="use-case ehr">
      <div class="uc-header blue">
        <span class="icon">🔍</span>
        <div>
          <h2>EHR Natural Language Query</h2>
          <p>Convert plain English to DynamoDB PartiQL — no SQL required</p>
        </div>
        <span class="api-badge">RAG :4007</span>
      </div>

      {tables && (
        <div class="tables-banner">
          <strong>Available tables:</strong>{' '}
          {tables.tables.map(t => <span class="table-chip" key={t}>{t}</span>)}
        </div>
      )}

      <div class="examples">
        {EXAMPLES.map(ex => (
          <button key={ex} class="example-chip" onClick={() => setQuestion(ex)}>{ex}</button>
        ))}
      </div>

      <form onSubmit={handleSubmit} class="uc-form">
        <label>
          Ask a question about patient records
          <textarea rows={3} value={question} onInput={(e) => setQuestion((e.target as HTMLTextAreaElement).value)} placeholder="Find all patients prescribed…" />
        </label>
        <button type="submit" class="submit-btn blue-btn" disabled={loading}>
          {loading ? '⏳ Generating…' : '⚡ Generate PartiQL'}
        </button>
      </form>

      {error && <div class="error-box">⚠ {error}</div>}

      {result && (
        <div class="result-box">
          <div class="result-meta">
            <span class="badge">Tables: {result.tables_referenced.join(', ')}</span>
            <span class="badge">{result.latency_ms} ms</span>
            <span class="badge">{result.tokens_total} tokens</span>
          </div>
          <h4>Generated PartiQL</h4>
          <pre class="partiql-block"><code>{result.partiql}</code></pre>
          {result.explanation && result.explanation !== result.partiql && (
            <>
              <h4>Explanation</h4>
              <p class="explanation">{result.explanation}</p>
            </>
          )}
          <div class="execute-row">
            <button class="submit-btn blue-btn" onClick={handleExecute} disabled={execLoading}>
              {execLoading ? '⏳ Executing…' : '▶ Execute on DynamoDB'}
            </button>
          </div>
          {execError && <div class="error-box">⚠ {execError}</div>}
          {execResult && (
            <div class="exec-results">
              <div class="result-meta">
                <span class="badge">{execResult.count} row{execResult.count !== 1 ? 's' : ''}</span>
                <span class="badge">{execResult.latency_ms} ms</span>
                {execResult.truncated && <span class="badge warn">truncated at 20</span>}
              </div>
              {execResult.count === 0 ? (
                <p class="explanation">No rows returned.</p>
              ) : (
                <div class="table-scroll">
                  <table class="exec-table">
                    <thead>
                      <tr>{Object.keys(execResult.rows[0]).map(k => <th key={k}>{k}</th>)}</tr>
                    </thead>
                    <tbody>
                      {execResult.rows.map((row, i) => (
                        <tr key={i}>{Object.values(row).map((v, j) => (
                          <td key={j}>{typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')}</td>
                        ))}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
