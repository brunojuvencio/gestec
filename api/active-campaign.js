const DEFAULT_TAG_NAME = 'palestra-gestec';

const FIELD_ENV_MAP = [
  ['cidade', 'ACTIVE_CAMPAIGN_FIELD_CIDADE_ID'],
  ['area_formacao', 'ACTIVE_CAMPAIGN_FIELD_AREA_FORMACAO_ID'],
  ['empresa', 'ACTIVE_CAMPAIGN_FIELD_EMPRESA_ID'],
  ['cargo', 'ACTIVE_CAMPAIGN_FIELD_CARGO_ID'],
  ['formacao_superior', 'ACTIVE_CAMPAIGN_FIELD_FORMACAO_SUPERIOR_ID'],
  ['pretende_pos', 'ACTIVE_CAMPAIGN_FIELD_PRETENDE_POS_ID'],
  ['origem', 'ACTIVE_CAMPAIGN_FIELD_ORIGEM_ID'],
  ['url_origem', 'ACTIVE_CAMPAIGN_FIELD_URL_ORIGEM_ID'],
];

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

    if (!config.baseUrl || !config.apiKey) {
      return res.status(200).json({
        ok: false,
        skipped: true,
        reason: 'missing_active_campaign_config',
      });
    }

    const body = await readJsonBody(req);
    const lead = normalizeLead(body);

    if (!lead.email || !lead.nome) {
      return res.status(400).json({ ok: false, error: 'missing_required_lead_data' });
    }

    const contact = await syncContact(config, lead);
    const tag = await ensureTag(config, config.tagName);
    const contactTag = await ensureContactTag(config, contact.id, tag.id);
    const list = config.listId
      ? await subscribeContactToList(config, contact.id, config.listId)
      : { ok: false, skipped: true, reason: 'missing_active_campaign_list_id' };

    return res.status(200).json({
      ok: true,
      contact: {
        id: contact.id,
        email: contact.email,
      },
      tag: {
        id: tag.id,
        name: tag.tag,
      },
      contactTag,
      list,
    });
  } catch (error) {
    console.error('ActiveCampaign sync error:', error);
    return res.status(502).json({
      ok: false,
      error: 'active_campaign_sync_error',
      message: error.publicMessage || 'Erro ao sincronizar contato no ActiveCampaign.',
    });
  }
};

function getConfig() {
  return {
    baseUrl: normalizeBaseUrl(process.env.ACTIVE_CAMPAIGN_BASE_URL || process.env.ACTIVE_CAMPAIGN_URL),
    apiKey: cleanString(process.env.ACTIVE_CAMPAIGN_API_KEY),
    listId: cleanString(process.env.ACTIVE_CAMPAIGN_LIST_ID),
    tagName: cleanString(process.env.ACTIVE_CAMPAIGN_TAG_NAME) || DEFAULT_TAG_NAME,
    tagDescription:
      cleanString(process.env.ACTIVE_CAMPAIGN_TAG_DESCRIPTION) ||
      'Inscritos na palestra do Pre-MBA Gestao Comercial e Salestech.',
  };
}

async function syncContact(config, lead) {
  const name = splitName(lead.nome);
  const fieldValues = buildFieldValues(lead);
  const contactPayload = removeEmpty({
    email: lead.email,
    firstName: name.first,
    lastName: name.last,
    phone: lead.telefone,
  });

  if (fieldValues.length) {
    contactPayload.fieldValues = fieldValues;
  }

  const result = await activeCampaignRequest(config, '/contact/sync', {
    method: 'POST',
    body: { contact: contactPayload },
  });

  if (!result.body || !result.body.contact || !result.body.contact.id) {
    throw createPublicError('ActiveCampaign nao retornou o contato sincronizado.');
  }

  return result.body.contact;
}

async function ensureTag(config, tagName) {
  const existing = await findTagByName(config, tagName);
  if (existing) return existing;

  try {
    const result = await activeCampaignRequest(config, '/tags', {
      method: 'POST',
      body: {
        tag: {
          tag: tagName,
          tagType: 'contact',
          description: config.tagDescription,
        },
      },
    });

    if (result.body && result.body.tag && result.body.tag.id) {
      return result.body.tag;
    }
  } catch (error) {
    const retryTag = await findTagByName(config, tagName);
    if (retryTag) return retryTag;
    throw error;
  }

  throw createPublicError('ActiveCampaign nao retornou a tag criada.');
}

async function findTagByName(config, tagName) {
  const normalizedTagName = normalizeComparable(tagName);
  const limit = 100;
  let offset = 0;

  for (let page = 0; page < 20; page += 1) {
    const result = await activeCampaignRequest(config, '/tags?limit=' + limit + '&offset=' + offset, {
      method: 'GET',
    });
    const tags = Array.isArray(result.body && result.body.tags) ? result.body.tags : [];
    const match = tags.find((tag) => normalizeComparable(tag.tag) === normalizedTagName);

    if (match) return match;
    if (tags.length < limit) return null;

    offset += limit;
  }

  return null;
}

async function ensureContactTag(config, contactId, tagId) {
  const existing = await findContactTag(config, contactId, tagId);
  if (existing) {
    return { ok: true, existing: true, id: existing.id };
  }

  try {
    const result = await activeCampaignRequest(config, '/contactTags', {
      method: 'POST',
      body: {
        contactTag: {
          contact: String(contactId),
          tag: String(tagId),
        },
      },
    });

    return {
      ok: true,
      existing: false,
      id: result.body && result.body.contactTag ? result.body.contactTag.id : null,
    };
  } catch (error) {
    const retryExisting = await findContactTag(config, contactId, tagId);
    if (retryExisting) {
      return { ok: true, existing: true, id: retryExisting.id };
    }

    throw error;
  }
}

async function findContactTag(config, contactId, tagId) {
  const result = await activeCampaignRequest(config, '/contacts/' + encodeURIComponent(contactId) + '/contactTags', {
    method: 'GET',
  });
  const contactTags = Array.isArray(result.body && result.body.contactTags) ? result.body.contactTags : [];

  return (
    contactTags.find((contactTag) => String(contactTag.tag) === String(tagId)) ||
    contactTags.find((contactTag) => String(contactTag.tagid) === String(tagId)) ||
    null
  );
}

async function subscribeContactToList(config, contactId, listId) {
  const result = await activeCampaignRequest(config, '/contactLists', {
    method: 'POST',
    body: {
      contactList: {
        list: String(listId),
        contact: String(contactId),
        status: 1,
      },
    },
  });

  return {
    ok: true,
    id: result.body && result.body.contactList ? result.body.contactList.id : null,
    listId: String(listId),
  };
}

async function activeCampaignRequest(config, path, options) {
  const method = options.method || 'GET';
  const response = await fetch(config.baseUrl + path, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Api-Token': config.apiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    const message =
      (body && (body.message || body.error || body.errors)) ||
      'ActiveCampaign retornou HTTP ' + response.status + ' em ' + method + ' ' + path;
    throw createPublicError(Array.isArray(message) ? message.join(', ') : String(message), response.status, body);
  }

  return { response, body };
}

function buildFieldValues(lead) {
  return FIELD_ENV_MAP.reduce((fields, [leadKey, envKey]) => {
    const field = cleanString(process.env[envKey]);
    const value = cleanString(lead[leadKey]);

    if (field && value) {
      fields.push({ field, value });
    }

    return fields;
  }, []);
}

function normalizeLead(body) {
  return {
    formacao_superior: cleanString(body.formacao_superior),
    pretende_pos: cleanString(body.pretende_pos),
    nome: cleanString(body.nome || body.name),
    email: cleanString(body.email).toLowerCase(),
    cidade: cleanString(body.cidade),
    telefone: normalizePhone(body.telefone || body.phone),
    area_formacao: cleanString(body.area_formacao),
    empresa: cleanString(body.empresa),
    cargo: cleanString(body.cargo),
    origem: cleanString(body.origem) || 'pre-mba-salestech',
    url_origem: cleanString(body.url_origem),
  };
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

function normalizeBaseUrl(value) {
  const rawUrl = cleanString(value).replace(/\/+$/, '');
  if (!rawUrl) return '';

  try {
    const url = new URL(rawUrl);
    return url.pathname.replace(/\/+$/, '') === '/api/3' ? url.toString().replace(/\/+$/, '') : rawUrl + '/api/3';
  } catch (error) {
    return '';
  }
}

function normalizePhone(value) {
  let digits = cleanString(value).replace(/\D/g, '');
  if (!digits) return '';

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }

  return '+' + digits;
}

function splitName(value) {
  const parts = cleanString(value).split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || '',
    last: parts.length > 1 ? parts.slice(1).join(' ') : '',
  };
}

function cleanString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeComparable(value) {
  return cleanString(value).toLowerCase();
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== '' && value !== null && value !== undefined)
  );
}

function createPublicError(publicMessage, status, details) {
  const error = new Error(publicMessage);
  error.publicMessage = publicMessage;
  error.status = status;
  error.details = details;
  return error;
}
