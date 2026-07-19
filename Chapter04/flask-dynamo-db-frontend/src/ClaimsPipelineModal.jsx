import React, { useEffect, useMemo, useState } from 'react';

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

function statusColor(status) {
  if (status === 'SUCCEEDED') return '#16a34a';
  if (status === 'FAILED') return '#dc2626';
  if (status === 'RUNNING' || status === 'entered') return '#2563eb';
  return '#64748b';
}

function makeSeries(provider) {
  const hist = Array.isArray(provider?.history) ? provider.history : [];
  const fc = Array.isArray(provider?.forecast) ? provider.forecast : [];
  const historySeries = hist.map((p) => ({
    x: p.month,
    y: Number(p.claim_count || 0),
    type: 'history',
  }));
  const forecastSeries = fc.map((p) => ({
    x: p.month,
    y: Number(p.predicted_claims || 0),
    type: 'forecast',
  }));
  return [...historySeries, ...forecastSeries];
}

function ProviderLineChart({ provider }) {
  const points = useMemo(() => makeSeries(provider), [provider]);
  if (points.length === 0) {
    return <div style={{ color: '#64748b', fontSize: '12px' }}>No chart data</div>;
  }

  const width = 680;
  const height = 220;
  const pad = { top: 16, right: 16, bottom: 26, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;

  const ys = points.map((p) => p.y);
  const minY = 0;
  const maxY = Math.max(1, ...ys);

  const xStep = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const xOf = (i) => pad.left + xStep * i;
  const yOf = (v) => pad.top + innerH - ((v - minY) / (maxY - minY)) * innerH;

  const histCount = (provider.history || []).length;
  const pathHistory = points
    .slice(0, histCount)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(2)} ${yOf(p.y).toFixed(2)}`)
    .join(' ');
  const pathForecast = points
    .slice(histCount)
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xOf(histCount - 1 + i).toFixed(2)} ${yOf(p.y).toFixed(2)}`)
    .join(' ');

  const splitX = histCount > 0 ? xOf(histCount - 1) : null;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: '220px', background: '#fff' }}>
      <line x1={pad.left} y1={pad.top + innerH} x2={pad.left + innerW} y2={pad.top + innerH} stroke="#cbd5e1" />
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + innerH} stroke="#cbd5e1" />

      {[0.25, 0.5, 0.75].map((r) => {
        const y = pad.top + innerH * (1 - r);
        const v = Math.round(maxY * r);
        return (
          <g key={r}>
            <line x1={pad.left} y1={y} x2={pad.left + innerW} y2={y} stroke="#f1f5f9" />
            <text x={6} y={y + 4} fill="#94a3b8" fontSize="10">{v}</text>
          </g>
        );
      })}

      {splitX !== null && splitX < pad.left + innerW && (
        <line x1={splitX} y1={pad.top} x2={splitX} y2={pad.top + innerH} stroke="#e2e8f0" strokeDasharray="4 4" />
      )}

      {pathHistory && <path d={pathHistory} fill="none" stroke="#0ea5e9" strokeWidth="2.2" />}
      {pathForecast && <path d={pathForecast} fill="none" stroke="#f97316" strokeWidth="2.2" />}

      {points.map((p, i) => (
        <circle
          key={`${p.x}-${i}`}
          cx={xOf(i)}
          cy={yOf(p.y)}
          r="2.8"
          fill={p.type === 'history' ? '#0284c7' : '#ea580c'}
        />
      ))}

      <text x={pad.left} y={height - 6} fill="#64748b" fontSize="10">History (blue) and Forecast (orange)</text>
    </svg>
  );
}

export default function ClaimsPipelineModal({ show, onClose, baseUrl, authToken }) {
  const [sessionId, setSessionId] = useState('');
  const [executionArn, setExecutionArn] = useState('');
  const [pipelineStatus, setPipelineStatus] = useState('IDLE');
  const [steps, setSteps] = useState({
    generate_synthetic_claims: 'PENDING',
    clean_claims: 'PENDING',
    store_claims_manifest: 'PENDING',
    forecast_claims: 'PENDING',
  });
  const [events, setEvents] = useState([]);
  const [forecast, setForecast] = useState(null);
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isPolling, setIsPolling] = useState(false);

  const base = normalizeBaseUrl(baseUrl);
  const authHeaders = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  useEffect(() => {
    if (!show || !sessionId) return;

    let active = true;
    setIsPolling(true);

    const tick = async () => {
      if (!active) return;
      try {
        const statusUrl = `${base}/claims/pipeline/session-status?sessionId=${encodeURIComponent(sessionId)}`;
        const sessRes = await fetch(statusUrl, { headers: authHeaders });
        const sessData = await sessRes.json();
        if (active && sessRes.ok) {
          setSteps(sessData.steps || {});
          setEvents(sessData.events || []);
        }

        if (executionArn) {
          const exRes = await fetch(
            `${base}/claims/pipeline/status?executionArn=${encodeURIComponent(executionArn)}`,
            { headers: authHeaders }
          );
          const exData = await exRes.json();
          if (active && exRes.ok) {
            setPipelineStatus(exData.status || 'UNKNOWN');
            if ((exData.status === 'SUCCEEDED' || exData.status === 'FAILED' || exData.status === 'TIMED_OUT' || exData.status === 'ABORTED') && !forecast) {
              const key = exData?.output?.forecast_key;
              const forecastUrl = key
                ? `${base}/claims/pipeline/forecast?key=${encodeURIComponent(key)}`
                : `${base}/claims/pipeline/forecast`;
              const fr = await fetch(forecastUrl, { headers: authHeaders });
              const fdata = await fr.json();
              if (active && fr.ok) {
                setForecast(fdata.result || null);
              }
            }
          }
        }
      } catch (e) {
        if (active) setError(String(e));
      }
    };

    tick();
    const id = setInterval(tick, 5000);
    return () => {
      active = false;
      clearInterval(id);
      setIsPolling(false);
    };
  }, [show, sessionId, executionArn, base, authToken, forecast]);

  function resetSessionView() {
    setSessionId('');
    setExecutionArn('');
    setPipelineStatus('IDLE');
    setSteps({
      generate_synthetic_claims: 'PENDING',
      clean_claims: 'PENDING',
      store_claims_manifest: 'PENDING',
      forecast_claims: 'PENDING',
    });
    setEvents([]);
    setForecast(null);
    setError('');
  }

  async function startSession() {
    setIsStarting(true);
    setError('');
    setForecast(null);
    try {
      const res = await fetch(`${base}/claims/pipeline/start`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);

      setSessionId(data.session_id || '');
      setExecutionArn(data.executionArn || '');
      setPipelineStatus('RUNNING');
    } catch (e) {
      setError(String(e));
    } finally {
      setIsStarting(false);
    }
  }

  if (!show) return null;

  const providers = Array.isArray(forecast?.providers) ? forecast.providers : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: '96vw', maxWidth: '1180px', maxHeight: '92vh', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div className="modal-header">
          <h3>Claims Pipeline Session</h3>
          <button className="modal-close" onClick={onClose}>x</button>
        </div>

        <div style={{ padding: '14px 18px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0' }}>
          <button
            type="button"
            onClick={startSession}
            disabled={isStarting || isPolling}
            style={{
              background: isStarting ? '#94a3b8' : 'linear-gradient(135deg,#0f766e,#0e7490)',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              padding: '7px 14px',
              fontWeight: 700,
              fontSize: '13px',
              cursor: isStarting ? 'default' : 'pointer',
            }}
          >
            {isStarting ? 'Starting...' : 'Run Step Function Session'}
          </button>
          <button
            type="button"
            onClick={resetSessionView}
            style={{ background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '7px 14px', fontWeight: 600, fontSize: '13px', cursor: 'pointer' }}
          >
            Clear
          </button>
          <span style={{ fontSize: '12px', color: '#475569' }}>
            Status: <strong style={{ color: statusColor(pipelineStatus) }}>{pipelineStatus}</strong>
          </span>
          {sessionId && <span style={{ fontSize: '12px', color: '#475569' }}>Session: <code>{sessionId}</code></span>}
        </div>

        <div style={{ overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {error && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#b91c1c', fontSize: '13px', padding: '10px 12px' }}>
              {error}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(170px,1fr))', gap: '10px' }}>
            {[
              ['generate_synthetic_claims', '1. Generate Claims'],
              ['clean_claims', '2. Clean Claims'],
              ['store_claims_manifest', '3. Store Manifest'],
              ['forecast_claims', '4. Forecast Claims'],
            ].map(([key, label]) => (
              <div key={key} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', background: '#fff' }}>
                <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '6px' }}>{label}</div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: statusColor(steps[key]) }}>{steps[key] || 'PENDING'}</div>
              </div>
            ))}
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px 12px', background: '#fff' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>Session Events</div>
            {events.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#64748b' }}>No events yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '190px', overflowY: 'auto' }}>
                {events.map((evt, idx) => (
                  <div key={`${evt.sentAt || idx}-${idx}`} style={{ fontSize: '12px', color: '#334155', borderBottom: '1px dashed #e2e8f0', paddingBottom: '4px' }}>
                    <strong style={{ color: '#0f766e' }}>{evt.step || evt.lambda || 'event'}</strong>
                    {' - '}
                    <span style={{ color: statusColor(evt.step_status) }}>{evt.step_status || 'UNKNOWN'}</span>
                    {evt.sentAt ? ` - ${new Date(evt.sentAt).toLocaleString()}` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', background: '#fff' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: '#334155', marginBottom: '10px' }}>
              Provider Forecast Charts
            </div>
            {providers.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#64748b' }}>Run a pipeline session to load forecast results.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {providers.map((provider) => (
                  <div key={provider.provider_id} style={{ border: '1px solid #e2e8f0', borderRadius: '8px', padding: '10px' }}>
                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#0f172a', marginBottom: '6px' }}>
                      {provider.provider_name} ({provider.provider_id})
                    </div>
                    <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '6px' }}>
                      R²: {provider?.regression?.r2 ?? '-'}
                    </div>
                    <ProviderLineChart provider={provider} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
