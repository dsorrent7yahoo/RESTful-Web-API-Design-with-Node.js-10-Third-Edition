import { useState, useMemo } from 'preact/hooks';

export interface PickerColumn {
  key: string;
  label: string;
  mono?: boolean;
  maxWidth?: string;
}

interface PickerModalProps {
  show: boolean;
  onClose: () => void;
  title: string;
  columns: PickerColumn[];
  rows: Record<string, string>[];
  onSelect: (row: Record<string, string>) => void;
}

export function PickerModal({ show, onClose, title, columns, rows, onSelect }: PickerModalProps) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(row =>
      columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(q))
    );
  }, [rows, query, columns]);

  if (!show) return null;

  function pick(row: Record<string, string>) {
    onSelect(row);
    onClose();
    setQuery('');
  }

  return (
    <div
      onClick={() => { onClose(); setQuery(''); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
               zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: '10px', boxShadow: '0 8px 40px rgba(0,0,0,0.28)',
                 width: '740px', maxWidth: '96vw', maxHeight: '78vh',
                 display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px',
                      borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
          <span style={{ fontWeight: 700, fontSize: '14px', color: '#1e293b', flex: 1 }}>{title}</span>
          <input
            type="text"
            value={query}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            onInput={e => setQuery((e.target as HTMLInputElement).value)}
            placeholder="Search…"
            style={{ padding: '6px 11px', border: '1.5px solid #cbd5e1', borderRadius: '6px',
                     fontSize: '13px', width: '200px', outline: 'none' }}
          />
          <button
            type="button"
            onClick={() => { onClose(); setQuery(''); }}
            style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer',
                     color: '#64748b', lineHeight: 1, padding: '2px 6px' }}
          >✕</button>
        </div>

        {/* Table */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ position: 'sticky', top: 0 }}>
                {columns.map(col => (
                  <th key={col.key}
                    style={{ padding: '9px 14px', textAlign: 'left', fontWeight: 600,
                             color: '#475569', background: '#f1f5f9',
                             borderBottom: '2px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={columns.length}
                    style={{ padding: '28px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic' }}>
                    No matching records
                  </td>
                </tr>
              ) : filtered.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => pick(row)}
                  style={{ cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                           background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLTableRowElement).style.background = '#f0fdf4'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = i % 2 === 0 ? '#fff' : '#fafafa'; }}
                >
                  {columns.map(col => (
                    <td key={col.key}
                      style={{ padding: '8px 14px', color: '#334155',
                               fontFamily: col.mono ? 'monospace' : 'inherit',
                               fontSize: col.mono ? '11px' : '13px',
                               maxWidth: col.maxWidth ?? '300px',
                               overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row[col.key] ?? '—'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: '9px 18px', borderTop: '1px solid #e2e8f0',
                      background: '#f8fafc', fontSize: '12px', color: '#64748b' }}>
          {filtered.length} of {rows.length} — click a row to select
        </div>
      </div>
    </div>
  );
}
