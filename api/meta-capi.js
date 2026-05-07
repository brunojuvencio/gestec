const crypto = require('crypto');

const ALLOWED_EVENTS = new Set(['PageView', 'Lead']);
const DEFAULT_GRAPH_VERSION = 'v23.0';

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
    const body = await readJsonBody(req);
    const eventName = String(body.event_name || '');

    if (!ALLOWED_EVENTS.has(eventName)) {
      return res.status(400).json({ ok: false, error: 'invalid_event_name' });
    }

    const pixelId = process.env.META_PIXEL_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!pixelId || !accessToken) {
      return res.status(200).json({
        ok: false,
        skipped: true,
        event_name: eventName,
        reason: 'missing_meta_config',
      });
    }

    const eventId = cleanString(body.event_id) || createEventId(eventName);
    const customData = buildCustomData(body.custom_data || {});
    const userData = buildUserData(body.user_data || {}, req);
    const eventSourceUrl = cleanUrl(body.event_source_url);

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: 'website',
          event_source_url: eventSourceUrl,
          user_data: userData,
          custom_data: customData,
        },
      ],
    };

    if (process.env.META_TEST_EVENT_CODE) {
      payload.test_event_code = process.env.META_TEST_EVENT_CODE;
    }

    const graphVersion = process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;
    const graphUrl =
      'https://graph.facebook.com/' +
      encodeURIComponent(graphVersion) +
      '/' +
      encodeURIComponent(pixelId) +
      '/events?access_token=' +
      encodeURIComponent(accessToken);

    const metaResponse = await fetch(graphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const metaBody = await parseMetaResponse(metaResponse);

    return res.status(metaResponse.ok ? 200 : 502).json({
      ok: metaResponse.ok,
      event_name: eventName,
      event_id: eventId,
      meta: metaBody,
    });
  } catch (error) {
    console.error('Meta CAPI error:', error);
    return res.status(500).json({ ok: false, error: 'meta_capi_error' });
  }
};

function buildCustomData(data) {
  const formacaoSuperior = normalizeChoice(data.formacao_superior);
  const pretendePos = normalizeChoice(data.pretende_pos);

  return removeEmpty({
    formacao_superior: formacaoSuperior,
    pretende_pos: pretendePos,
  });
}

function buildUserData(data, req) {
  const nameParts = splitName(data.nome || data.name);
  const email = normalizeEmail(data.email || data.em);
  const phone = normalizePhone(data.telefone || data.phone || data.ph);
  const city = normalizeText(data.cidade || data.city || data.ct);
  const country = normalizeText(data.country || 'br');
  const ip = getClientIp(req);
  const userAgent = cleanString(req.headers['user-agent'] || data.client_user_agent);

  return removeEmpty({
    client_ip_address: ip,
    client_user_agent: userAgent,
    fbp: cleanString(data.fbp),
    fbc: cleanString(data.fbc),
    em: hashIfPresent(email),
    ph: hashIfPresent(phone),
    fn: hashIfPresent(nameParts.first),
    ln: hashIfPresent(nameParts.last),
    ct: hashIfPresent(city),
    country: hashIfPresent(country),
    external_id: hashIfPresent(email || phone),
  });
}

function normalizeChoice(value) {
  const normalized = normalizeText(value).replace(/\s+/g, '_');
  if (!normalized) return '';

  if (normalized === 'sim' || normalized === 'nao') return normalized;
  if (normalized === 'sim_agora' || normalized === 'sim_imediatamente') return 'sim_agora';
  if (normalized === 'sim_depois' || normalized === 'sim_mas_nao_agora') return 'sim_depois';
  return normalized.slice(0, 100);
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

async function parseMetaResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  const firstForwardedIp = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : String(valueOrEmpty(forwardedFor)).split(',')[0];

  return cleanString(
    firstForwardedIp ||
      req.headers['x-real-ip'] ||
      req.socket?.remoteAddress ||
      req.connection?.remoteAddress
  );
}

function splitName(value) {
  const parts = normalizeText(value).split(' ').filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.length > 1 ? parts.slice(1).join('') : '',
  };
}

function normalizeEmail(value) {
  return cleanString(value).toLowerCase();
}

function normalizePhone(value) {
  let digits = cleanString(value).replace(/\D/g, '');
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }
  return digits;
}

function normalizeText(value) {
  return cleanString(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashIfPresent(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';
  if (/^[a-f0-9]{64}$/i.test(cleanValue)) return cleanValue.toLowerCase();
  return crypto.createHash('sha256').update(cleanValue).digest('hex');
}

function cleanUrl(value) {
  const stringValue = cleanString(value);
  if (!stringValue) return '';

  try {
    return new URL(stringValue).toString();
  } catch (error) {
    return '';
  }
}

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  );
}

function createEventId(eventName) {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return eventName.toLowerCase() + '-' + id;
}

function valueOrEmpty(value) {
  return value === undefined || value === null ? '' : value;
}
