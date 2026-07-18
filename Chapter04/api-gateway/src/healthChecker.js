/**
 * Health Checker
 * Polls every registered service and returns its status.
 */

const fetch = require('node-fetch');
const { SERVICES } = require('./registry');

const TIMEOUT_MS = 3000;

/**
 * Check a single service.
 * @param {string} key   - service key from registry
 * @returns {{ key, label, category, icon, target, status, latencyMs, error }}
 */
async function checkService(key) {
  const svc = SERVICES[key];
  const url = `${svc.target}${svc.healthPath}`;
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    return {
      key,
      label:     svc.label,
      icon:      svc.icon,
      category:  svc.category,
      target:    svc.target,
      proxyPath: `/proxy/${key}`,
      launchUrl: svc.launchUrl || null,
      swaggerPath: svc.swaggerPath ? `${svc.target}${svc.swaggerPath}` : null,
      description: svc.description,
      status:    res.ok ? 'up' : 'degraded',
      httpStatus: res.status,
      latencyMs,
      error:     null,
    };
  } catch (err) {
    return {
      key,
      label:     svc.label,
      icon:      svc.icon,
      category:  svc.category,
      target:    svc.target,
      proxyPath: `/proxy/${key}`,
      launchUrl: svc.launchUrl || null,
      swaggerPath: svc.swaggerPath ? `${svc.target}${svc.swaggerPath}` : null,
      description: svc.description,
      status:    'down',
      httpStatus: null,
      latencyMs:  Date.now() - start,
      error:      err.name === 'AbortError' ? 'timeout' : err.message,
    };
  }
}

/**
 * Check all services in parallel.
 * @returns {Promise<{ services: object[], summary: object }>}
 */
async function checkAll() {
  const results = await Promise.all(Object.keys(SERVICES).map(checkService));

  const summary = {
    total:    results.length,
    up:       results.filter((r) => r.status === 'up').length,
    degraded: results.filter((r) => r.status === 'degraded').length,
    down:     results.filter((r) => r.status === 'down').length,
    checkedAt: new Date().toISOString(),
  };

  return { services: results, summary };
}

module.exports = { checkAll, checkService };
