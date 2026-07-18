import React, { useEffect, useMemo, useState } from 'react';

const API_OPTIONS = [
  { id: 'getAll', label: 'GET /catalog/', method: 'GET', path: '/catalog/', needsBody: false, needsItemId: false, needsCategory: false },
  { id: 'getById', label: 'GET /catalog/item/:itemId', method: 'GET', path: '/catalog/item/{itemId}', needsBody: false, needsItemId: true, needsCategory: false },
  { id: 'getByCategory', label: 'GET /catalog/:categoryId', method: 'GET', path: '/catalog/{categoryId}', needsBody: false, needsItemId: false, needsCategory: true },
  { id: 'postItem', label: 'POST /catalog/', method: 'POST', path: '/catalog/', needsBody: true, needsItemId: false, needsCategory: false },
  { id: 'putItem', label: 'PUT /catalog/', method: 'PUT', path: '/catalog/', needsBody: true, needsItemId: false, needsCategory: false },
  { id: 'deleteById', label: 'DELETE /catalog/item/:itemId', method: 'DELETE', path: '/catalog/item/{itemId}', needsBody: false, needsItemId: true, needsCategory: false }
];

const DEFAULT_BODY = {
  itemId: '11',
  itemName: 'Trail Camera',
  price: 220,
  currency: 'USD',
  categories: ['Electronics', 'Outdoor']
};

function prettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
}

export default function App() {
  const [baseUrl, setBaseUrl] = useState('http://localhost:3000');
  const [selectedId, setSelectedId] = useState('getAll');
  const [itemId, setItemId] = useState('1');
  const [itemOptions, setItemOptions] = useState([]);
  const [categoryOptions, setCategoryOptions] = useState([]);
  const [categoryId, setCategoryId] = useState('Watches');
  const [bodyText, setBodyText] = useState(prettyJson(DEFAULT_BODY));
  const [result, setResult] = useState('Run a request to see results here.');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResponseModal, setShowResponseModal] = useState(false);
  const [tableRows, setTableRows] = useState([]);

  function normalizeRowsFromResponse(payload) {
    if (Array.isArray(payload)) {
      return payload.filter((row) => row && typeof row === 'object');
    }

    if (payload && typeof payload === 'object') {
      return [payload];
    }

    return [];
  }

  async function loadOptions(currentBaseUrl) {
    try {
      const normalizedBase = currentBaseUrl.trim().replace(/\/$/, '');
      const response = await fetch(`${normalizedBase}/catalog/`);
      if (!response.ok) {
        return;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        return;
      }

      const options = data
        .filter((item) => item && item.itemId)
        .map((item) => ({
          value: String(item.itemId),
          label: `${item.itemId} - ${item.itemName || 'Unnamed Item'}`
        }));

      const categories = Array.from(
        new Set(
          data
            .flatMap((item) => (Array.isArray(item.categories) ? item.categories : []))
            .filter((category) => Boolean(category))
        )
      ).sort((a, b) => a.localeCompare(b));

      setItemOptions(options);
      setCategoryOptions(categories);

      if (options.length === 0) {
        setItemId('');
      } else if (!options.some((option) => option.value === itemId)) {
        setItemId(options[0].value);
      }

      if (categories.length === 0) {
        setCategoryId('');
      } else if (!categories.includes(categoryId)) {
        setCategoryId(categories[0]);
      }
    } catch (error) {
    }
  }

  const selected = useMemo(
    () => API_OPTIONS.find((option) => option.id === selectedId) || API_OPTIONS[0],
    [selectedId]
  );

  useEffect(() => {
    loadOptions(baseUrl);
  }, [baseUrl]);

  function restartExplorer() {
    setBaseUrl('http://localhost:3000');
    setSelectedId('getAll');
    setItemId('1');
    setCategoryId(categoryOptions[0] || 'Watches');
    setBodyText(prettyJson(DEFAULT_BODY));
    setResult('Run a request to see results here.');
    setStatus('Explorer reset');
  }

  function quitExplorer() {
    window.close();
    setStatus('Quit requested');
    setResult('If the tab did not close (browser policy), you can close it manually.');
  }

  const resolvedPath = useMemo(() => {
    if (selected.needsItemId) {
      return selected.path.replace('{itemId}', encodeURIComponent(itemId.trim()));
    }
    if (selected.needsCategory) {
      return selected.path.replace('{categoryId}', encodeURIComponent(categoryId.trim()));
    }
    return selected.path;
  }, [selected, itemId, categoryId]);

  async function runRequest(event) {
    event.preventDefault();

    if (selected.needsItemId && !itemId.trim()) {
      setStatus('Item ID is required.');
      return;
    }

    if (selected.needsCategory && !categoryId.trim()) {
      setStatus('Category is required.');
      return;
    }

    const normalizedBase = baseUrl.trim().replace(/\/$/, '');
    const url = normalizedBase + resolvedPath;
    const options = { method: selected.method, headers: {} };

    if (selected.needsBody) {
      try {
        const parsed = JSON.parse(bodyText);
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(parsed);
      } catch (error) {
        setStatus('Invalid JSON body. Fix it and try again.');
        return;
      }
    }

    setIsLoading(true);
    setStatus('Sending request...');

    try {
      const response = await fetch(url, options);
      const responseText = await response.text();
      let parsedBody = responseText;

      try {
        parsedBody = JSON.parse(responseText);
      } catch (error) {
      }

      setStatus(`${response.status} ${response.statusText}`);
      setResult(prettyJson(parsedBody));

      const rows = normalizeRowsFromResponse(parsedBody);
      if (rows.length > 0) {
        setTableRows(rows);
        setShowResponseModal(true);
      }

      if (selected.method === 'POST' || selected.method === 'PUT' || selected.method === 'DELETE') {
        loadOptions(baseUrl);
      }
    } catch (error) {
      setStatus('Request failed');
      setResult(error.message || String(error));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="page">
      <section className="panel">
        <h1>Catalog API Explorer</h1>
        <p>Pick an endpoint from the menu and run it against your Chapter04 server.</p>

        <form onSubmit={runRequest} className="form">
          <label>
            Server URL
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>

          <label>
            API Call
            <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
              {API_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {selected.needsItemId && (
            <label>
              Item ID
              <select value={itemId} onChange={(event) => setItemId(event.target.value)}>
                {itemOptions.length === 0 && <option value="">No items loaded</option>}
                {itemOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected.needsCategory && (
            <label>
              Category
              <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
                {categoryOptions.length === 0 && <option value="">No categories loaded</option>}
                {categoryOptions.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected.needsBody && (
            <label>
              JSON Body
              <textarea
                rows={10}
                value={bodyText}
                onChange={(event) => setBodyText(event.target.value)}
              />
            </label>
          )}

          <div className="meta">Request URL: {baseUrl.trim().replace(/\/$/, '') + resolvedPath}</div>

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Running...' : `Run ${selected.method}`}
          </button>

          <div className="actions">
            <button type="button" onClick={() => loadOptions(baseUrl)}>
              Refresh Options
            </button>
            <button type="button" onClick={restartExplorer}>
              Restart
            </button>
            <button type="button" onClick={quitExplorer}>
              Quit
            </button>
          </div>
        </form>
      </section>

      <section className="panel result">
        <h2>Response</h2>
        <div className="status">Status: {status || 'No request yet'}</div>
        <pre>{result}</pre>
      </section>

      {showResponseModal && (
        <div className="modal-backdrop" onClick={() => setShowResponseModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Response Items</h3>
              <button type="button" onClick={() => setShowResponseModal(false)}>
                Close
              </button>
            </div>

            <div className="modal-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item ID</th>
                    <th>Item Name</th>
                    <th>Price</th>
                    <th>Currency</th>
                    <th>Categories</th>
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, index) => (
                    <tr key={`${row.itemId || 'row'}-${index}`}>
                      <td>{row.itemId || '-'}</td>
                      <td>{row.itemName || '-'}</td>
                      <td>{row.price != null ? row.price : '-'}</td>
                      <td>{row.currency || '-'}</td>
                      <td>{Array.isArray(row.categories) ? row.categories.join(', ') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
