const crypto = require('crypto');

const DEFAULT_API_VERSION = '202604';
const DEFAULT_CONVERSION_TYPE = 'LEAD';
const DEFAULT_POST_CLICK_WINDOW = 30;
const DEFAULT_VIEW_THROUGH_WINDOW = 7;
const DEFAULT_ATTRIBUTION_TYPE = 'LAST_TOUCH_BY_CAMPAIGN';

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
    const config = getConfig();
    const body = await readJsonBody(req);

    if (body.action === 'create_conversion') {
      return createConversionRuleResponse(req, res, config, body);
    }

    return streamConversionEventResponse(req, res, config, body);
  } catch (error) {
    console.error('LinkedIn CAPI error:', error);
    return res.status(error.status && error.status < 500 ? error.status : 502).json({
      ok: false,
      error: 'linkedin_capi_error',
      message: error.publicMessage || 'Erro ao enviar conversao para o LinkedIn.',
    });
  }
};

function getConfig() {
  return {
    accessToken: getEnvValue('LINKEDIN_ACCESS_TOKEN'),
    apiVersion: getEnvValue('LINKEDIN_API_VERSION') || DEFAULT_API_VERSION,
    conversionId: getEnvValue('LINKEDIN_CONVERSION_ID'),
    adAccountId: getEnvValue('LINKEDIN_AD_ACCOUNT_ID'),
    conversionName: getEnvValue('LINKEDIN_CONVERSION_NAME') || 'Pre-MBA Lead',
    adminSecret: getEnvValue('LINKEDIN_ADMIN_SECRET'),
    autoAssociationType: getEnvValue('LINKEDIN_AUTO_ASSOCIATION_TYPE') || 'ALL_CAMPAIGNS',
  };
}

async function createConversionRuleResponse(req, res, config, body) {
  if (!config.accessToken || !getAdAccountUrn(body.account || body.account_id || config.adAccountId)) {
    return res.status(400).json({
      ok: false,
      error: 'missing_linkedin_create_config',
      message: 'Configure LINKEDIN_ACCESS_TOKEN e LINKEDIN_AD_ACCOUNT_ID para criar a conversao.',
    });
  }

  const secret = cleanString(body.secret || req.headers['x-linkedin-admin-secret']);
  if (!config.adminSecret) {
    return res.status(500).json({
      ok: false,
      error: 'missing_linkedin_admin_secret',
      message: 'Defina LINKEDIN_ADMIN_SECRET para permitir a criacao de conversoes.',
    });
  }

  if (secret !== config.adminSecret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const conversion = await createConversionRule(config, body);
  return res.status(conversion.status).json(conversion.body);
}

async function streamConversionEventResponse(req, res, config, body) {
  const conversionUrn = getConversionUrn(body.conversion || body.conversion_id || config.conversionId);
  if (!config.accessToken || !conversionUrn) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'missing_linkedin_config',
    });
  }

  const user = buildUser(body.user_data || body.user || {});
  if (!user.userIds.length && !hasNameMatch(user.userInfo)) {
    return res.status(200).json({
      ok: false,
      skipped: true,
      reason: 'missing_linkedin_user_match_id',
    });
  }

  const eventId = cleanString(body.event_id) || createEventId();
  const payload = removeEmpty({
    conversion: conversionUrn,
    conversionHappenedAt: getConversionTime(body.conversion_happened_at || body.conversionHappenedAt),
    conversionValue: buildConversionValue(body.conversion_value || body.conversionValue),
    user,
    eventId,
  });

  const linkedinResponse = await linkedinRequest(config, '/conversionEvents', {
    method: 'POST',
    body: payload,
  });

  return res.status(linkedinResponse.response.ok ? 200 : 502).json({
    ok: linkedinResponse.response.ok,
    event_id: eventId,
    conversion: conversionUrn,
    linkedin: linkedinResponse.body,
  });
}

async function createConversionRule(config, body) {
  const accountUrn = getAdAccountUrn(body.account || body.account_id || config.adAccountId);
  const payload = {
    name: cleanString(body.name || config.conversionName),
    account: accountUrn,
    conversionMethod: 'CONVERSIONS_API',
    postClickAttributionWindowSize:
      toNumberOrDefault(body.postClickAttributionWindowSize || body.post_click_attribution_window, DEFAULT_POST_CLICK_WINDOW),
    viewThroughAttributionWindowSize:
      toNumberOrDefault(body.viewThroughAttributionWindowSize || body.view_through_attribution_window, DEFAULT_VIEW_THROUGH_WINDOW),
    attributionType: cleanString(body.attributionType || body.attribution_type) || DEFAULT_ATTRIBUTION_TYPE,
    type: cleanString(body.type || body.conversion_type).toUpperCase() || DEFAULT_CONVERSION_TYPE,
  };

  const autoAssociationType = cleanString(body.autoAssociationType || config.autoAssociationType);
  const query = autoAssociationType ? '?autoAssociationType=' + encodeURIComponent(autoAssociationType) : '';
  const result = await linkedinRequest(config, '/conversions' + query, {
    method: 'POST',
    body: payload,
  });

  const id = cleanString(result.response.headers.get('x-restli-id')) || cleanString(result.body && result.body.id);
  return {
    status: result.response.ok ? 200 : 502,
    body: {
      ok: result.response.ok,
      id,
      conversion: id ? getConversionUrn(id) : '',
      linkedin: result.body,
    },
  };
}

async function linkedinRequest(config, path, options) {
  const response = await fetch('https://api.linkedin.com/rest' + path, {
    method: options.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + config.accessToken,
      'Content-Type': 'application/json',
      'Linkedin-Version': config.apiVersion,
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = await parseResponse(response);
  if (!response.ok) {
    const message =
      (body && (body.message || body.error || body.serviceErrorCode || body.status)) ||
      'LinkedIn retornou HTTP ' + response.status + ' em ' + path;
    throw createPublicError(formatLinkedInErrorMessage(message), response.status, body);
  }

  return { response, body };
}

function buildUser(data) {
  const nameParts = splitName(data.nome || data.name);
  const email = normalizeEmail(data.email || data.em);
  const linkedInClickId = cleanString(data.li_fat_id || data.linkedin_click_id);
  const userIds = [];
  const userInfo = removeEmpty({
    firstName: cleanString(data.first_name || data.firstName || nameParts.first),
    lastName: cleanString(data.last_name || data.lastName || nameParts.last),
    title: cleanString(data.cargo || data.title),
    companyName: cleanString(data.empresa || data.companyName),
    countryCode: cleanString(data.country_code || data.countryCode || 'BR').toUpperCase(),
  });

  pushUserId(userIds, 'SHA256_EMAIL', hashIfPresent(email));
  pushUserId(userIds, 'LINKEDIN_FIRST_PARTY_ADS_TRACKING_UUID', linkedInClickId);

  return {
    userIds,
    userInfo: hasNameMatch(userInfo) ? userInfo : {},
  };
}

function buildConversionValue(value) {
  if (!value || typeof value !== 'object') return null;

  const amount = cleanString(value.amount);
  const currencyCode = cleanString(value.currencyCode || value.currency_code).toUpperCase();
  if (!amount || !currencyCode) return null;

  return { amount, currencyCode };
}

function getConversionUrn(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';
  if (cleanValue.indexOf('urn:') === 0) return cleanValue;
  return 'urn:lla:llaPartnerConversion:' + cleanValue;
}

function getAdAccountUrn(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';
  if (cleanValue.indexOf('urn:') === 0) return cleanValue;
  return 'urn:li:sponsoredAccount:' + cleanValue;
}

function getConversionTime(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return Date.now();
  return numericValue < 1000000000000 ? numericValue * 1000 : numericValue;
}

function hasNameMatch(userInfo) {
  return Boolean(cleanString(userInfo.firstName) && cleanString(userInfo.lastName));
}

function pushUserId(userIds, idType, idValue) {
  if (!idValue) return;
  userIds.push({ idType, idValue });
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
  } catch (error) {
    return { raw: text };
  }
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

function normalizeText(value) {
  return cleanString(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashIfPresent(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';
  if (/^[a-f0-9]{64}$/i.test(cleanValue)) return cleanValue.toLowerCase();
  return crypto.createHash('sha256').update(cleanValue).digest('hex');
}

function toNumberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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
    Object.entries(object).filter(([, value]) => {
      if (value === '' || value === null || value === undefined) return false;
      if (Array.isArray(value) && !value.length) return false;
      if (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length) return false;
      return true;
    })
  );
}

function createEventId() {
  const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return 'linkedin-lead-' + id;
}

function formatLinkedInErrorMessage(message) {
  if (message && typeof message === 'object') {
    return message.message || message.error || JSON.stringify(message);
  }
  return String(message);
}

function createPublicError(publicMessage, status, details) {
  const error = new Error(publicMessage);
  error.publicMessage = publicMessage;
  error.status = status;
  error.details = details;
  return error;
}
