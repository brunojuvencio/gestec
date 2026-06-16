const DEFAULT_API_VERSION = '202401';
const DEFAULT_COUNT = 50;

async function getLeads() {
  const accessToken = getEnvValue('LINKEDIN_ACCESS_TOKEN');
  const formId = getEnvValue('LINKEDIN_FORM_ID');

  if (!accessToken || !formId) {
    throw new Error('LINKEDIN_ACCESS_TOKEN e LINKEDIN_FORM_ID sao obrigatorios');
  }

  const url =
    'https://api.linkedin.com/v2/leadFormResponses?q=owner&owner=' +
    encodeURIComponent(formId) +
    '&start=0&count=' +
    DEFAULT_COUNT;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'LinkedIn-Version': DEFAULT_API_VERSION,
    },
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    const message =
      (body && (body.message || body.error || body.serviceErrorCode)) ||
      'LinkedIn Lead Retrieval API retornou HTTP ' + response.status;
    console.error('[linkedin-leads] API error ' + response.status + ':', JSON.stringify(body));
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return Array.isArray(body && body.elements) ? body.elements : [];
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

module.exports = { getLeads };
