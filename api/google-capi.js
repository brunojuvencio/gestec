const crypto = require('crypto');

const DEFAULT_MEASUREMENT_ID = 'G-EZW8F7QZB0';
const MP_ENDPOINT = 'https://www.google-analytics.com/mp/collect';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const measurementId = getEnvValue('GA4_MEASUREMENT_ID') || DEFAULT_MEASUREMENT_ID;
    const apiSecret = getEnvValue('GA4_API_SECRET');

    if (!apiSecret) {
      return res.status(200).json({
        ok: false,
        skipped: true,
        reason: 'missing_ga4_config',
      });
    }

    const body = await readJsonBody(req);
    const userData = body.user_data || body.user || {};
    const eventId = cleanString(body.event_id) || createEventId();
    const clientId = resolveClientId(userData, body.client_id);
    const sessionId = cleanString(body.session_id);
    const origem = cleanString(body.origem);
    const utmSource = cleanString(body.utm_source);
    const utmMedium = cleanString(body.utm_medium);
    const utmCampaign = cleanString(body.utm_campaign);
    const utmContent = cleanString(body.utm_content);
    const utmTerm = cleanString(body.utm_term);

    const eventParams = removeEmpty({
      currency: 'BRL',
      value: 0,
      event_id: eventId,
      session_id: sessionId,
      engagement_time_msec: 1,
      origem: origem,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
    });

    const payload = removeEmpty({
      client_id: clientId,
      user_data: buildUserData(userData),
      events: [
        {
          name: 'generate_lead',
          params: eventParams,
        },
      ],
    });

    const url =
      MP_ENDPOINT +
      '?measurement_id=' +
      encodeURIComponent(measurementId) +
      '&api_secret=' +
      encodeURIComponent(apiSecret);

    const gaResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const gaBody = await parseResponse(gaResponse);

    return res.status(gaResponse.ok ? 200 : 502).json({
      ok: gaResponse.ok,
      event_id: eventId,
      client_id: clientId,
      ga: gaBody,
    });
  } catch (error) {
    console.error('Google CAPI error:', error);
    return res.status(500).json({ ok: false, error: 'google_capi_error' });
  }
};

function buildUserData(data) {
  const email = normalizeEmail(data.email || data.em || '');
  const phone = normalizePhone(data.telefone || data.phone || data.ph || '');
  const nameParts = splitName(data.nome || data.name || '');

  const userData = removeEmpty({
    sha256_email_address: hashIfPresent(email) ? [hashIfPresent(email)] : undefined,
    sha256_phone_number: hashIfPresent(phone) ? [hashIfPresent(phone)] : undefined,
  });

  const address = removeEmpty({
    sha256_first_name: hashIfPresent(nameParts.first),
    sha256_last_name: hashIfPresent(nameParts.last),
    country: 'BR',
  });

  if (address.sha256_first_name || address.sha256_last_name) {
    userData.address = [address];
  }

  return Object.keys(userData).length ? userData : undefined;
}

function resolveClientId(userData, explicitClientId) {
  const fromBody = cleanString(explicitClientId);
  if (fromBody) return fromBody;

  const gaClientId = extractGaClientId(cleanString(userData.ga_client_id || userData._ga || ''));
  if (gaClientId) return gaClientId;

  const email = normalizeEmail(userData.email || userData.em || '');
  if (email) {
    const hash = crypto.createHash('sha256').update(email).digest('hex');
    return hash.slice(0, 10) + '.' + Math.floor(Date.now() / 1000);
  }

  return crypto.randomBytes(8).toString('hex') + '.' + Math.floor(Date.now() / 1000);
}

function extractGaClientId(gaCookie) {
  if (!gaCookie) return '';
  const parts = gaCookie.split('.');
  if (parts.length >= 4) return parts[2] + '.' + parts[3];
  return gaCookie;
}

function splitName(value) {
  const parts = normalizeText(value).split(' ').filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.length > 1 ? parts.slice(1).join(' ') : '',
  };
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase().replace(/\s+/g, '');
}

function normalizePhone(value) {
  let digits = cleanString(value).replace(/\D/g, '');
  if (!digits) return '';
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return '+' + digits;
}

function normalizeText(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashIfPresent(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';
  if (/^[a-f0-9]{64}$/i.test(cleanValue)) return cleanValue.toLowerCase();
  return crypto.createHash('sha256').update(cleanValue).digest('hex');
}

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const rawBody = req.body.toString('utf8');
    return rawBody ? JSON.parse(rawBody) : {};
  }

  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (req.body && typeof req.body === 'object') return req.body;

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {
    return { raw: text };
  }
}

function createEventId() {
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
  return 'lead-' + id;
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

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  );
}
