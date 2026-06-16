const { runSync } = require('./linkedin-lead-sync');

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const baseUrl = 'https://' + req.headers.host;
    const result = await runSync(baseUrl, true);

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[linkedin-lead-sync-test] Erro fatal:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message,
    });
  }
};

function isAuthorized(req) {
  const cronSecret = getEnvValue('CRON_SECRET');
  if (!cronSecret) return false;

  const headerSecret = cleanString(req.headers['x-cron-secret']);
  if (headerSecret === cronSecret) return true;

  const authHeader = cleanString(req.headers.authorization);
  if (authHeader === 'Bearer ' + cronSecret) return true;

  return false;
}

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function getEnvValue(key) {
  const value = cleanString(process.env[key]);
  if (value.length < 2) return value;

  const firstChar = value[0];
  const lastChar = value[value.length - 1];
  if ((firstChar === '"' && lastChar === '"') || (firstChar === "'" && lastChar === "'")) {
    return value.slice(1, -1).trim();
  }

  return value;
}
