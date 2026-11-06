// Check every request before dispatch, including restart and model management.
function trustedRequest(req, port) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const host = String(req.headers.host || '').toLowerCase();
  if (!hosts.has(host)) return false;
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  return !origin || origin === `http://${host}`;
}

module.exports = { trustedRequest };
