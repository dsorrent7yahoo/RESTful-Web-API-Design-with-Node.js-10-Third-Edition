import { useEffect, useRef, useState } from 'preact/hooks';

interface SQSStats {
  available: number;
  inFlight: number;
}

interface EmailEntry {
  sentAt?: string;
  body?: {
    filename?: string;
    key?: string;
    size_bytes?: number;
    rows_written?: number;
    rows_missing_date?: number;
    bucket?: string;
    lambda?: string;
    timestamp?: string;
  };
}

interface DlqMessage {
  messageId?: string;
  body?: Record<string, unknown>;
  sentAt?: string;
  receiveCount?: number;
}

interface SQSMonitorProps {
  show: boolean;
  onClose: () => void;
  baseUrl: string;
  authToken: string;
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '-';
  const v = parseInt(String(n), 10);
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(2)} MB`;
}

function Stat({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ fontSize: 13 }}>
      <span style={{ color: '#555' }}>{label}: </span>
      <strong>{String(value ?? '-')}</strong>
    </div>
  );
}

function EmailCard({ entry }: { entry: EmailEntry }) {
  const [open, setOpen] = useState(false);
  const b  = entry.body ?? {};
  const ts = entry.sentAt ? new Date(entry.sentAt).toLocaleString() : '-';
  const filename = b.filename ?? (b.key ?? '').split('/').pop() ?? '-';
  const size     = fmtBytes(b.size_bytes);

  return (
    <div style={{ border: '1px solid #d0e4f7', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
      <div onClick={() => setOpen((o) => !o)} style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr auto auto auto',
        gap: 12, alignItems: 'center', padding: '12px 16px', cursor: 'pointer',
        background: open ? '#e8f0fe' : '#f7fbff',
      }}>
        <span style={{ background: '#0f4c81', color: '#fff', borderRadius: 4,
          padding: '2px 9px', fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
          {b.lambda ?? 'lambda'}
        </span>
        <span style={{ fontWeight: 600, fontSize: 14, color: '#1a1a2e',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {filename}
        </span>
        <span style={{ fontSize: 12, color: '#555', whiteSpace: 'nowrap' }}>
          {b.rows_written ?? '-'} rows · {size}
        </span>
        <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap' }}>{ts}</span>
        <span style={{ fontSize: 12, color: '#1a73e8', whiteSpace: 'nowrap' }}>{open ? 'Hide' : 'Details'}</span>
      </div>

      <div style={{ padding: '5px 16px', fontSize: 12, background: '#e6f4ea',
        color: '#2d6a4f', borderTop: '1px solid #d0e4f7' }}>
        Email sent to <strong>Dan Sorrentino</strong> (dsorrent7@gmail.com) via AWS SES
      </div>

      {open && (
        <div style={{ padding: '14px 18px', background: '#fff',
          borderTop: '1px solid #d0e4f7', fontSize: 13 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {[
                ['File name', filename],
                ['File size', size],
                ['Rows written', b.rows_written],
                ['Rows missing date', b.rows_missing_date],
                ['S3 location', `s3://${b.bucket}/${b.key}`],
                ['Lambda', b.lambda],
                ['Date', b.timestamp],
                ['Notified', 'Dan Sorrentino <dsorrent7@gmail.com>'],
                ['Sent at', ts],
              ].map(([label, value]) => (
                <tr key={String(label)}>
                  <td style={{ padding: '5px 14px 5px 0', color: '#555', fontWeight: 600,
                    whiteSpace: 'nowrap', verticalAlign: 'top' }}>{label}</td>
                  <td style={{ padding: '5px 0', color: '#1a1a2e', wordBreak: 'break-all' }}>
                    {String(value ?? '-')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DlqCard({ msg }: { msg: DlqMessage }) {
  const [open, setOpen] = useState(false);
  const b  = msg.body && typeof msg.body === 'object' ? msg.body : {};
  const ts = msg.sentAt ? new Date(parseInt(msg.sentAt, 10)).toLocaleString() : '-';
  const name = (b as { filename?: string; key?: string }).filename
    ?? ((b as { key?: string }).key ?? '').split('/').pop()
    ?? msg.messageId;

  return (
    <div style={{ border: '1px solid #fca5a5', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div onClick={() => setOpen((o) => !o)} style={{
        display: 'flex', gap: 12, alignItems: 'center', padding: '10px 14px',
        cursor: 'pointer', background: open ? '#fef2f2' : '#fff5f5',
      }}>
        <span style={{ background: '#dc2626', color: '#fff', borderRadius: 4,
          padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>DLQ</span>
        <span style={{ flex: 1, fontSize: 13, color: '#7f1d1d', fontWeight: 600,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>Attempts: {msg.receiveCount ?? '-'}</span>
        <span style={{ fontSize: 11, color: '#888', whiteSpace: 'nowrap' }}>{ts}</span>
        <span style={{ fontSize: 12, color: '#dc2626' }}>{open ? 'Hide' : 'Details'}</span>
      </div>
      {open && (
        <div style={{ padding: '12px 16px', background: '#fff',
          borderTop: '1px solid #fca5a5', fontSize: 12 }}>
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: '#374151' }}>
            {JSON.stringify(msg.body, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function SQSMonitor({ show, onClose, baseUrl, authToken }: SQSMonitorProps) {
  const [emails,   setEmails]   = useState<EmailEntry[]>([]);
  const [stats,    setStats]    = useState<SQSStats | null>(null);
  const [dlqMsgs,  setDlqMsgs]  = useState<DlqMessage[]>([]);
  const [dlqStats, setDlqStats] = useState<SQSStats | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tokenRef    = useRef(authToken);
  useEffect(() => { tokenRef.current = authToken; }, [authToken]);

  function authHeaders(): Record<string, string> {
    return tokenRef.current ? { Authorization: `Bearer ${tokenRef.current}` } : {};
  }

  async function fetchLog() {
    if (!tokenRef.current) return;
    try {
      const [logRes, statsRes, dlqRes, dlqStatsRes] = await Promise.all([
        fetch(`${baseUrl}/sqs/email-log`,  { headers: authHeaders() }),
        fetch(`${baseUrl}/sqs/stats`,      { headers: authHeaders() }),
        fetch(`${baseUrl}/sqs/dlq`,        { headers: authHeaders() }),
        fetch(`${baseUrl}/sqs/dlq/stats`,  { headers: authHeaders() }),
      ]);
      if (logRes.ok)      setEmails((await logRes.json()).emails ?? []);
      if (statsRes.ok)    setStats(await statsRes.json());
      if (dlqRes.ok)      setDlqMsgs((await dlqRes.json()).messages ?? []);
      if (dlqStatsRes.ok) setDlqStats(await dlqStatsRes.json());
      setError('');
    } catch {
      setError('Failed to reach server');
    }
  }

  async function handlePurge() {
    if (!window.confirm('Purge ALL messages from the SQS queue?')) return;
    await fetch(`${baseUrl}/sqs/messages`, { method: 'DELETE', headers: authHeaders() });
    fetchLog();
  }

  useEffect(() => {
    if (!show) { if (intervalRef.current) clearInterval(intervalRef.current); return; }
    setLoading(true);
    fetchLog().finally(() => setLoading(false));
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchLog, 5000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [show, authToken]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 10, width: 820, maxWidth: '96vw',
        maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 8px 32px rgba(0,0,0,0.28)', overflow: 'hidden',
      }} onClick={(e) => e.stopPropagation()}>

        <div style={{
          background: 'linear-gradient(135deg,#0f4c81,#1a73e8)',
          color: '#fff', padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>SQS Lambda Monitor</div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              Each lambda result is auto-emailed to Dan Sorrentino (dsorrent7@gmail.com)
            </div>
          </div>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer' }}>
            ✕
          </button>
        </div>

        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          {stats && (
            <div style={{
              display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap',
              background: '#f0f6ff', border: '1px solid #c5d8f5',
              borderRadius: 8, padding: '10px 16px', alignItems: 'center',
            }}>
              <Stat label="Queue depth" value={stats.available} />
              <Stat label="In-flight"   value={stats.inFlight} />
              <Stat label="From"        value="dgsaws@yahoo.com" />
              <Stat label="To"          value="Dan Sorrentino" />
              <div style={{ marginLeft: 'auto' }}>
                <button onClick={handlePurge} style={{
                  background: '#dc3545', color: '#fff', border: 'none',
                  borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 13,
                }}>Purge Queue</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <button onClick={() => { setLoading(true); fetchLog().finally(() => setLoading(false)); }}
              disabled={loading} style={{
                background: '#1a73e8', color: '#fff', border: 'none',
                borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
              }}>
              {loading ? 'Loading...' : 'Refresh'}
            </button>
            <span style={{ color: '#888', fontSize: 12 }}>
              Auto-refreshes every 5s · {emails.length} notification{emails.length !== 1 ? 's' : ''} sent
            </span>
            {error && <span style={{ color: '#dc3545', fontSize: 12 }}>{error}</span>}
          </div>

          {emails.length === 0 && !loading && (
            <div style={{
              textAlign: 'center', color: '#888', padding: '48px 0',
              border: '2px dashed #ddd', borderRadius: 8, fontSize: 14,
            }}>
              No notifications yet. Generate claims — the lambda result will appear here
              and an email will be sent automatically.
            </div>
          )}

          {emails.map((e, i) => <EmailCard key={i} entry={e} />)}

          <div style={{ marginTop: 24, borderTop: '2px solid #fee2e2', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#b91c1c' }}>⚠ Dead Letter Queue</div>
              {dlqStats && (
                <span style={{
                  fontSize: 12, color: dlqStats.available > 0 ? '#dc2626' : '#16a34a',
                  background: dlqStats.available > 0 ? '#fef2f2' : '#f0fdf4',
                  border: `1px solid ${dlqStats.available > 0 ? '#fca5a5' : '#86efac'}`,
                  borderRadius: 12, padding: '2px 10px',
                }}>
                  {dlqStats.available} message{dlqStats.available !== 1 ? 's' : ''}
                </span>
              )}
            </div>
            {dlqMsgs.length === 0 ? (
              <div style={{ color: '#888', fontSize: 13, padding: '8px 0' }}>✅ DLQ is empty — no failed messages</div>
            ) : (
              dlqMsgs.map((m, i) => <DlqCard key={i} msg={m} />)
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
