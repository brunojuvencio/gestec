const DEFAULT_BASE_URL = 'https://public-api2.ploomes.com';
const DEFAULT_DEAL_PIPELINE_ID = '50003849';
const DEFAULT_DEAL_STAGE_ID = '50018646';

const DEFAULT_DEAL_FIELDS = {
  empresaParceiraBool: 'deal_A16F671F-24DA-464F-96E3-E2EB61F3CEFD',
  empresaParceira: 'deal_EB1DC267-3055-4B48-A511-B431F20827C2',
  empresa: 'deal_8F7621D9-E74F-4402-BB88-D62EF9393394',
  cidade: 'deal_0FF41F39-ED90-4803-8B2F-DFD455D57F20',
  cargo: 'deal_DAF0E02D-E986-43E3-A98E-2BC89614BB43',
  areaFormacao: 'deal_50A4D1E5-2D70-4C33-9723-CEA009E25F26',
  graduacao: 'deal_C4A0DCDB-A9E7-4CD3-A52A-4BF2D093072A',
  pretendeMbaBool: 'deal_D78C31F7-513B-4AF0-9987-62E450A9A919',
  quandoIniciarMba: 'deal_1EFEF33D-8A73-451F-97F6-F91ADBDCD3A2',
  interesseCliente: 'deal_137A27CD-8B03-4F38-9346-B3A1C48BC8D0',
  utmSource: 'deal_7A169C7F-9F22-46B5-B819-A72A8BD65417',
  utmSourceLegacy: 'deal_266CBA68-5C53-4B9A-82C1-498C62CAC754',
  utmMedium: 'deal_2C195DB6-D4F7-4626-A6B0-5451CFDAD0E3',
  utmCampaign: 'deal_812DEE6E-A61E-4987-B09B-57365A8C6437',
  utmCampaignLegacy: 'deal_D2CE4181-14B7-414C-85F8-D522DC12BD2E',
  utmContent: 'deal_983E5B92-501D-4074-840B-0B22BDD5A987',
  utmSummary: 'deal_1B9FDED4-84A6-4617-A860-6919EBC920D7',
}

const DEFAULT_DEAL_OPTIONS = {
  iniciarMbaAgora: '28150',
  iniciarMbaDepois: '28148',
  iniciarMbaNao: '28145',
  interesseMba: '389099',
};
const DEFAULT_CONTACT_TYPE_ID = '2';
const EXISTING_CONTACT_DEAL_LIMIT = 1;

const DEAL_FIELD_ENV_MAP = [
  ['nome', 'PLOOMES_DEAL_FIELD_NOME_KEY'],
  ['email', 'PLOOMES_DEAL_FIELD_EMAIL_KEY'],
  ['telefone', 'PLOOMES_DEAL_FIELD_TELEFONE_KEY'],
  ['cidade', 'PLOOMES_DEAL_FIELD_CIDADE_KEY'],
  ['area_formacao', 'PLOOMES_DEAL_FIELD_AREA_FORMACAO_KEY'],
  ['empresa', 'PLOOMES_DEAL_FIELD_EMPRESA_KEY'],
  ['cargo', 'PLOOMES_DEAL_FIELD_CARGO_KEY'],
  ['formacao_superior', 'PLOOMES_DEAL_FIELD_FORMACAO_SUPERIOR_KEY'],
  ['pretende_pos', 'PLOOMES_DEAL_FIELD_PRETENDE_POS_KEY'],
  ['origem', 'PLOOMES_DEAL_FIELD_ORIGEM_KEY'],
  ['url_origem', 'PLOOMES_DEAL_FIELD_URL_ORIGEM_KEY'],
  ['utm_source', 'PLOOMES_DEAL_FIELD_UTM_SOURCE_KEY'],
  ['utm_medium', 'PLOOMES_DEAL_FIELD_UTM_MEDIUM_KEY'],
  ['utm_campaign', 'PLOOMES_DEAL_FIELD_UTM_CAMPAIGN_KEY'],
  ['utm_term', 'PLOOMES_DEAL_FIELD_UTM_TERM_KEY'],
  ['utm_content', 'PLOOMES_DEAL_FIELD_UTM_CONTENT_KEY'],
];

const CONTACT_FIELD_ENV_MAP = [
  ['cidade', 'PLOOMES_CONTACT_FIELD_CIDADE_KEY'],
  ['area_formacao', 'PLOOMES_CONTACT_FIELD_AREA_FORMACAO_KEY'],
  ['empresa', 'PLOOMES_CONTACT_FIELD_EMPRESA_KEY'],
  ['cargo', 'PLOOMES_CONTACT_FIELD_CARGO_KEY'],
  ['formacao_superior', 'PLOOMES_CONTACT_FIELD_FORMACAO_SUPERIOR_KEY'],
  ['pretende_pos', 'PLOOMES_CONTACT_FIELD_PRETENDE_POS_KEY'],
  ['origem', 'PLOOMES_CONTACT_FIELD_ORIGEM_KEY'],
  ['url_origem', 'PLOOMES_CONTACT_FIELD_URL_ORIGEM_KEY'],
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
    if (!config.apiKey || !config.pipelineId) {
      return res.status(500).json({
        ok: false,
        error: 'missing_ploomes_config',
        message: 'Configuracao do Ploomes ausente.',
      });
    }

    const body = await readJsonBody(req);
    const lead = normalizeLead(body);

    if (!lead.email || !lead.nome) {
      return res.status(400).json({ ok: false, error: 'missing_required_lead_data' });
    }

    const contactResult = await ensureContact(config, lead);
    const stageId = config.stageId || (await findFirstStageId(config, config.pipelineId));
    const deal = await createDeal(config, lead, contactResult.contact, stageId);

    let history = null;
    let existingContactNote = null;

    if (contactResult.created) {
      history = await createHistoryRecord(config, lead, contactResult.contact, deal);
    } else {
      existingContactNote = await createExistingContactNote(config, contactResult.contact, deal);
    }

    return res.status(200).json({
      ok: true,
      contact: {
        id: contactResult.contact.id || contactResult.contact.Id,
        email: contactResult.contact.email || contactResult.contact.Email,
        created: contactResult.created,
        matchedBy: contactResult.matchedBy,
      },
      deal: {
        id: deal.id || deal.Id,
        title: deal.title || deal.Title,
        pipelineId: String(config.pipelineId),
        stageId: String(stageId),
      },
      history: history ? { id: history.id || history.Id } : null,
      existingContactNote: existingContactNote
        ? { id: existingContactNote.id || existingContactNote.Id }
        : null,
    });
  } catch (error) {
    console.error('Ploomes CRM sync error:', error);
    return res.status(error.status && error.status < 500 ? error.status : 502).json({
      ok: false,
      error: 'ploomes_crm_sync_error',
      message: error.publicMessage || 'Erro ao sincronizar lead no Ploomes.',
    });
  }
};

function getConfig() {
  return {
    baseUrl: normalizeBaseUrl(getEnvValue('PLOOMES_BASE_URL') || DEFAULT_BASE_URL),
    apiKey: getEnvValue('PLOOMES_USER_KEY') || getEnvValue('PLOOMES_API_KEY'),
    pipelineId: getEnvValue('PLOOMES_DEAL_PIPELINE_ID') || DEFAULT_DEAL_PIPELINE_ID,
    stageId: getEnvValue('PLOOMES_DEAL_STAGE_ID') || DEFAULT_DEAL_STAGE_ID,
    dealStatusId: getEnvValue('PLOOMES_DEAL_STATUS_ID'),
    dealAmount: getEnvValue('PLOOMES_DEAL_AMOUNT') || '0',
    ownerId: getEnvValue('PLOOMES_OWNER_ID'),
    dealOriginId: getEnvValue('PLOOMES_DEAL_ORIGIN_ID'),
    contactOriginId: getEnvValue('PLOOMES_CONTACT_ORIGIN_ID'),
    contactTypeId: getContactPersonTypeId(),
    phoneTypeId: getEnvValue('PLOOMES_PHONE_TYPE_ID'),
    currencyId: getEnvValue('PLOOMES_CURRENCY_ID'),
    interactionTypeId: getEnvValue('PLOOMES_INTERACTION_TYPE_ID'),
  };
}

async function ensureContact(config, lead) {
  const existingByPhone = await findContactByPhone(config, lead.telefone);
  if (existingByPhone) {
    return { contact: existingByPhone, created: false, matchedBy: 'phone' };
  }

  const existingByEmail = await findContactByEmail(config, lead.email);
  if (existingByEmail) {
    return { contact: existingByEmail, created: false, matchedBy: 'email' };
  }

  const contact = await createContact(config, lead);
  return { contact, created: true, matchedBy: null };
}

async function findContactByPhone(config, phone) {
  const phoneVariants = getPhoneSearchVariants(phone);
  if (!phoneVariants.length) return null;

  for (const phoneVariant of phoneVariants) {
    const filter =
      'Phones/any(phone: phone/SearchPhoneNumber eq ' +
      phoneVariant +
      " or phone/PhoneNumber eq '" +
      escapeODataString(phoneVariant) +
      "')";
    const result = await ploomesRequest(
      config,
      '/Contacts?$select=Id,Name,Email&$filter=' +
        encodeURIComponent(filter) +
        '&$orderby=Id asc&$top=1',
      { method: 'GET' }
    );
    const contact = getCollection(result.body)[0];

    if (contact) return contact;
  }

  return null;
}

async function findContactByEmail(config, email) {
  const filter = "Email eq '" + escapeODataString(email) + "'";
  const result = await ploomesRequest(
    config,
    '/Contacts?$select=Id,Name,Email&$filter=' + encodeURIComponent(filter) + '&$top=1',
    { method: 'GET' }
  );
  const contacts = getCollection(result.body);
  return contacts[0] || null;
}

async function createContact(config, lead) {
  const payload = removeEmpty({
    Name: lead.nome,
    Email: lead.email,
    TypeId: toNumberOrEmpty(config.contactTypeId),
    OriginId: toNumberOrEmpty(config.contactOriginId),
    OwnerId: toNumberOrEmpty(config.ownerId),
    Note: buildLeadHistory(lead),
  });

  const phone = buildPhone(config, lead.telefone);
  if (phone) {
    payload.Phones = [phone];
  }

  const otherProperties = buildOtherProperties(lead, CONTACT_FIELD_ENV_MAP);
  if (otherProperties.length) {
    payload.OtherProperties = otherProperties;
  }

  const result = await ploomesRequest(config, '/Contacts', {
    method: 'POST',
    body: payload,
  });
  const contact = getSingleRecord(result.body);

  if (!contact || !contact.Id) {
    const createdContact = await findContactByEmail(config, lead.email);
    if (createdContact) return createdContact;

    throw createPublicError('Ploomes nao confirmou o contato criado.');
  }

  return contact;
}

async function findFirstStageId(config, pipelineId) {
  const filter = 'PipelineId eq ' + Number(pipelineId);
  const result = await ploomesRequest(
    config,
    '/Deals@Stages?$select=Id,Name,PipelineId,Ordination&$filter=' +
      encodeURIComponent(filter) +
      '&$orderby=Ordination asc&$top=1',
    { method: 'GET' }
  );
  const stage = getCollection(result.body)[0];

  if (!stage || !stage.Id) {
    throw createPublicError('Ploomes nao retornou um estagio para o funil informado.');
  }

  return String(stage.Id);
}

async function createDeal(config, lead, contact, stageId) {
  const contactId = contact.Id || contact.id;
  const otherProperties = buildDealOtherProperties(lead);
  const title = buildDealTitle(lead);
  const payload = removeEmpty({
    Title: title,
    ContactId: contactId,
    PipelineId: toNumberOrEmpty(config.pipelineId),
    StageId: toNumberOrEmpty(stageId),
    StatusId: toNumberOrEmpty(config.dealStatusId),
    Amount: toNumberOrEmpty(config.dealAmount),
    StartAmount: toNumberOrEmpty(config.dealAmount),
    StartDate: new Date().toISOString(),
    OwnerId: toNumberOrEmpty(config.ownerId),
    OriginId: toNumberOrEmpty(config.dealOriginId || config.contactOriginId),
    CurrencyId: toNumberOrEmpty(config.currencyId),
  });

  if (otherProperties.length) {
    payload.OtherProperties = otherProperties;
  }

  const result = await ploomesRequest(config, '/Deals', {
    method: 'POST',
    body: payload,
  });
  const deal = getSingleRecord(result.body);

  if (!deal || !deal.Id) {
    const createdDeal = await findLatestDealByTitle(config, title);
    if (createdDeal) return createdDeal;

    throw createPublicError('Ploomes nao confirmou o negocio criado.');
  }

  return deal;
}

async function findLatestDealByTitle(config, title) {
  const filter = "Title eq '" + escapeODataString(title) + "'";
  const result = await ploomesRequest(
    config,
    '/Deals?$select=Id,Title,ContactId,PipelineId,StageId&$filter=' +
      encodeURIComponent(filter) +
      '&$orderby=Id desc&$top=1',
    { method: 'GET' }
  );

  return getCollection(result.body)[0] || null;
}

async function createExistingContactNote(config, contact, deal) {
  const contactId = contact.Id || contact.id;
  if (!contactId) {
    throw createPublicError('Ploomes nao retornou o contato existente.');
  }

  const dealId = deal ? (deal.Id || deal.id) : null;
  const dealContexts = await findRecentDealContexts(config, contactId);
  const payload = removeEmpty({
    ContactId: contactId,
    DealId: toNumberOrEmpty(dealId),
    TypeId: toNumberOrEmpty(config.interactionTypeId),
    Content: buildExistingContactNote(dealContexts),
  });

  const result = await ploomesRequest(config, '/InteractionRecords', {
    method: 'POST',
    body: payload,
  });
  const note = getSingleRecord(result.body);

  if (!note || !note.Id) {
    return findLatestContactInteractionRecord(config, contactId);
  }

  return note;
}

async function findRecentDealContexts(config, contactId) {
  const filter = 'ContactId eq ' + Number(contactId);
  const path =
    '/Deals?$select=Id,Title,PipelineId,StageId&$expand=' +
    encodeURIComponent('Pipeline($select=Id,Name),Stage($select=Id,Name)') +
    '&$filter=' +
    encodeURIComponent(filter) +
    '&$orderby=Id desc&$top=' +
    EXISTING_CONTACT_DEAL_LIMIT;

  try {
    const result = await ploomesRequest(config, path, { method: 'GET' });
    return enrichDealContextNames(config, getCollection(result.body).map(normalizeDealContext));
  } catch (error) {
    if (!error.status || error.status === 401 || error.status === 403 || error.status >= 500) {
      throw error;
    }
  }

  const fallbackResult = await ploomesRequest(
    config,
    '/Deals?$select=Id,Title,PipelineId,StageId&$filter=' +
      encodeURIComponent(filter) +
      '&$orderby=Id desc&$top=' +
      EXISTING_CONTACT_DEAL_LIMIT,
    { method: 'GET' }
  );

  return enrichDealContextNames(config, getCollection(fallbackResult.body).map(normalizeDealContext));
}

async function enrichDealContextNames(config, dealContexts) {
  for (const deal of dealContexts) {
    if (!deal.pipelineName && deal.pipelineId) {
      deal.pipelineName = await findDealPipelineName(config, deal.pipelineId);
    }

    if (!deal.stageName && deal.stageId) {
      deal.stageName = await findDealStageName(config, deal.stageId);
    }
  }

  return dealContexts;
}

function findDealPipelineName(config, pipelineId) {
  return findPloomesEntityName(config, '/Deals@Pipelines', pipelineId);
}

function findDealStageName(config, stageId) {
  return findPloomesEntityName(config, '/Deals@Stages', stageId);
}

async function findPloomesEntityName(config, path, id) {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) return '';

  try {
    const result = await ploomesRequest(
      config,
      path +
        '?$select=Id,Name&$filter=' +
        encodeURIComponent('Id eq ' + numericId) +
        '&$top=1',
      { method: 'GET' }
    );
    const entity = getCollection(result.body)[0];
    return entity ? cleanString(entity.Name || entity.name) : '';
  } catch (error) {
    if (!error.status || error.status === 401 || error.status === 403 || error.status >= 500) {
      throw error;
    }

    return '';
  }
}

async function findLatestContactInteractionRecord(config, contactId) {
  const filter = 'ContactId eq ' + Number(contactId);
  const result = await ploomesRequest(
    config,
    '/InteractionRecords?$select=Id,ContactId,DealId&$filter=' +
      encodeURIComponent(filter) +
      '&$orderby=Id desc&$top=1',
    { method: 'GET' }
  );
  const note = getCollection(result.body)[0];

  if (!note || !note.Id) {
    throw createPublicError('Ploomes nao confirmou a nota do contato existente.');
  }

  return note;
}

async function createHistoryRecord(config, lead, contact, deal) {
  const dealId = deal.Id || deal.id;
  const contactId = deal.ContactId || deal.contactId || contact.Id || contact.id;
  const payload = removeEmpty({
    ContactId: contactId,
    DealId: dealId,
    TypeId: toNumberOrEmpty(config.interactionTypeId),
    Content: buildLeadHistory(lead),
  });

  const result = await ploomesRequest(config, '/InteractionRecords', {
    method: 'POST',
    body: payload,
  });
  const history = getSingleRecord(result.body);

  if (!history || !history.Id) {
    return findLatestHistoryRecord(config, dealId);
  }

  return history;
}

async function findLatestHistoryRecord(config, dealId) {
  const filter = 'DealId eq ' + Number(dealId);
  const result = await ploomesRequest(
    config,
    '/InteractionRecords?$select=Id,ContactId,DealId&$filter=' +
      encodeURIComponent(filter) +
      '&$orderby=Id desc&$top=1',
    { method: 'GET' }
  );
  const history = getCollection(result.body)[0];

  if (!history || !history.Id) {
    throw createPublicError('Ploomes nao confirmou o historico criado.');
  }

  return history;
}

async function ploomesRequest(config, path, options) {
  const method = options.method || 'GET';
  const response = await fetch(config.baseUrl + path, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Key': config.apiKey,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const body = await parseResponse(response);

  if (!response.ok) {
    const message =
      (body && (body.message || body.Message || body.error || body.Error || body.errors || body.value)) ||
      'Ploomes retornou HTTP ' + response.status + ' em ' + method + ' ' + path;
    throw createPublicError(formatPloomesErrorMessage(message), response.status, body);
  }

  return { response, body };
}

function buildPhone(config, phone) {
  const digits = cleanString(phone).replace(/\D/g, '');
  if (!digits) return null;

  return removeEmpty({
    PhoneNumber: digits,
    TypeId: toNumberOrEmpty(config.phoneTypeId),
  });
}

function buildDealOtherProperties(lead) {
  const properties = [];
  addDefaultDealProperties(properties, lead);
  addMappedStringProperties(properties, lead, DEAL_FIELD_ENV_MAP);
  return properties;
}

function addDefaultDealProperties(properties, lead) {
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_EMPRESA_PARCEIRA_BOOL_KEY') || DEFAULT_DEAL_FIELDS.empresaParceiraBool,
    BoolValue: false,
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_EMPRESA_PARCEIRA_KEY') || DEFAULT_DEAL_FIELDS.empresaParceira,
    StringValue: lead.empresa || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_EMPRESA_KEY') || DEFAULT_DEAL_FIELDS.empresa,
    StringValue: lead.empresa || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_CIDADE_KEY') || DEFAULT_DEAL_FIELDS.cidade,
    StringValue: lead.cidade || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_CARGO_KEY') || DEFAULT_DEAL_FIELDS.cargo,
    StringValue: lead.cargo || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_AREA_FORMACAO_KEY') || DEFAULT_DEAL_FIELDS.areaFormacao,
    StringValue: lead.area_formacao || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_GRADUACAO_KEY') || DEFAULT_DEAL_FIELDS.graduacao,
    StringValue: formatLeadValue('formacao_superior', lead.formacao_superior) || 'Nao informado',
  });
  pushOtherProperty(properties, {
    FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_PRETENDE_MBA_BOOL_KEY') || DEFAULT_DEAL_FIELDS.pretendeMbaBool,
    BoolValue: lead.pretende_pos !== 'nao',
  });

  const quandoIniciarMba = getQuandoIniciarMbaOptionId(lead.pretende_pos);
  if (quandoIniciarMba) {
    pushOtherProperty(properties, {
      FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_QUANDO_INICIAR_MBA_KEY') || DEFAULT_DEAL_FIELDS.quandoIniciarMba,
      IntegerValue: quandoIniciarMba,
    });
  }

  if (lead.pretende_pos && lead.pretende_pos !== 'nao') {
    pushOtherProperty(properties, {
      FieldKey: getEnvValue('PLOOMES_DEAL_FIELD_INTERESSE_CLIENTE_KEY') || DEFAULT_DEAL_FIELDS.interesseCliente,
      IntegerValue:
        toNumberOrEmpty(getEnvValue('PLOOMES_DEAL_OPTION_INTERESSE_MBA_ID')) ||
        toNumberOrEmpty(DEFAULT_DEAL_OPTIONS.interesseMba),
    });
  }

  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_SOURCE_KEY') || DEFAULT_DEAL_FIELDS.utmSource,
    lead.utm_source
  );
  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_SOURCE_LEGACY_KEY') || DEFAULT_DEAL_FIELDS.utmSourceLegacy,
    lead.utm_source
  );
  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_MEDIUM_KEY') || DEFAULT_DEAL_FIELDS.utmMedium,
    lead.utm_medium
  );
  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_CAMPAIGN_KEY') || DEFAULT_DEAL_FIELDS.utmCampaign,
    lead.utm_campaign
  );
  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_CAMPAIGN_LEGACY_KEY') || DEFAULT_DEAL_FIELDS.utmCampaignLegacy,
    lead.utm_campaign
  );
  addOptionalStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_CONTENT_KEY') || DEFAULT_DEAL_FIELDS.utmContent,
    lead.utm_content
  );
  addOptionalBigStringProperty(
    properties,
    getEnvValue('PLOOMES_DEAL_FIELD_UTM_SUMMARY_KEY') || DEFAULT_DEAL_FIELDS.utmSummary,
    buildUtmSummary(lead)
  );
}

function addOptionalStringProperty(properties, fieldKey, value) {
  const cleanValue = cleanString(value);
  if (!fieldKey || !cleanValue) return;
  pushOtherProperty(properties, {
    FieldKey: fieldKey,
    StringValue: cleanValue,
  });
}

function addOptionalBigStringProperty(properties, fieldKey, value) {
  const cleanValue = cleanString(value);
  if (!fieldKey || !cleanValue) return;
  pushOtherProperty(properties, {
    FieldKey: fieldKey,
    BigStringValue: cleanValue,
  });
}

function buildUtmSummary(lead) {
  const rows = [
    ['utm_source', lead.utm_source],
    ['utm_medium', lead.utm_medium],
    ['utm_campaign', lead.utm_campaign],
    ['utm_term', lead.utm_term],
    ['utm_content', lead.utm_content],
  ];

  return rows
    .filter(([, value]) => cleanString(value))
    .map(([label, value]) => label + ': ' + value)
    .join('\n');
}

function buildOtherProperties(lead, fieldMap) {
  const properties = [];
  addMappedStringProperties(properties, lead, fieldMap);
  return properties;
}

function addMappedStringProperties(properties, lead, fieldMap) {
  return fieldMap.reduce((properties, [leadKey, envKey]) => {
    const fieldKey = getEnvValue(envKey);
    const value = cleanString(lead[leadKey]);

    if (fieldKey && value) {
      pushOtherProperty(properties, {
        FieldKey: fieldKey,
        StringValue: formatLeadValue(leadKey, value),
      });
    }

    return properties;
  }, properties);
}

function pushOtherProperty(properties, property) {
  if (!property.FieldKey || properties.some((item) => item.FieldKey === property.FieldKey)) {
    return;
  }

  properties.push(property);
}

function getQuandoIniciarMbaOptionId(value) {
  const options = {
    sim_agora: getEnvValue('PLOOMES_DEAL_OPTION_MBA_IMEDIATAMENTE_ID') || DEFAULT_DEAL_OPTIONS.iniciarMbaAgora,
    sim_depois: getEnvValue('PLOOMES_DEAL_OPTION_MBA_DEPOIS_ID') || DEFAULT_DEAL_OPTIONS.iniciarMbaDepois,
    nao: getEnvValue('PLOOMES_DEAL_OPTION_MBA_NAO_ID') || DEFAULT_DEAL_OPTIONS.iniciarMbaNao,
  };

  return toNumberOrEmpty(options[value]);
}

function buildDealTitle(lead) {
  const name = lead.nome || 'Lead';
  return 'Pre-MBA Gestao de Pipeline: Metricas e Indicadores Criticos - ' + name;
}

function buildExistingContactNote(dealContexts) {
  const rows = [
    'Este contato ja possui historico no CRM.',
    'Antes de iniciar uma nova abordagem, vale revisar o contexto mais recente:',
  ];

  if (dealContexts.length) {
    dealContexts.forEach(function (deal, index) {
      const pipelineName = deal.pipelineName || formatFallbackEntityName('ID', deal.pipelineId);
      const stageName = deal.stageName || formatFallbackEntityName('ID', deal.stageId);

      rows.push(
        index +
          1 +
          '. ' +
          deal.title +
          ' | Funil: ' +
          pipelineName +
          ' | Etapa: ' +
          stageName
      );
    });
  } else {
    rows.push('Nenhum negocio anterior encontrado para este contato.');
  }

  return rows.join('\n');
}

function normalizeDealContext(deal) {
  const pipeline = deal.Pipeline || deal.pipeline || {};
  const stage = deal.Stage || deal.stage || {};
  const pipelineId = deal.PipelineId || deal.pipelineId;
  const stageId = deal.StageId || deal.stageId;

  return {
    title: cleanString(deal.Title || deal.title) || 'Negocio sem titulo',
    pipelineId,
    stageId,
    pipelineName: cleanString(pipeline.Name || pipeline.name),
    stageName: cleanString(stage.Name || stage.name),
  };
}

function formatFallbackEntityName(label, value) {
  const cleanValue = cleanString(value);
  return cleanValue ? label + ' ' + cleanValue : 'Nao informado';
}

function buildLeadHistory(lead) {
  const rows = [
    ['Nome', lead.nome],
    ['E-mail', lead.email],
    ['Telefone', lead.telefone],
    ['Cidade', lead.cidade],
    ['Area de formacao', lead.area_formacao],
    ['Empresa', lead.empresa],
    ['Cargo', lead.cargo],
    ['Possui formacao superior', formatLeadValue('formacao_superior', lead.formacao_superior)],
    ['Pretende pos/MBA', formatLeadValue('pretende_pos', lead.pretende_pos)],
    ['Origem', lead.origem],
    ['URL de origem', lead.url_origem],
    ['UTM source', lead.utm_source],
    ['UTM medium', lead.utm_medium],
    ['UTM campaign', lead.utm_campaign],
    ['UTM term', lead.utm_term],
    ['UTM content', lead.utm_content],
  ];

  return rows
    .filter(([, value]) => cleanString(value))
    .map(([label, value]) => label + ': ' + value)
    .join('\n');
}

function formatLeadValue(key, value) {
  const normalized = cleanString(value);
  const maps = {
    formacao_superior: {
      sim: 'Sim',
      nao: 'Nao',
    },
    pretende_pos: {
      sim_agora: 'Sim, imediatamente',
      sim_depois: 'Sim, mas nao agora',
      nao: 'Nao',
    },
  };

  return (maps[key] && maps[key][normalized]) || normalized;
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
    utm_source: cleanString(body.utm_source),
    utm_medium: cleanString(body.utm_medium),
    utm_campaign: cleanString(body.utm_campaign),
    utm_term: cleanString(body.utm_term),
    utm_content: cleanString(body.utm_content),
  };
}

function getContactPersonTypeId() {
  const contactTypeId = getEnvValue('PLOOMES_CONTACT_TYPE_ID');
  const numericTypeId = Number(contactTypeId);
  return contactTypeId && Number.isFinite(numericTypeId) && numericTypeId !== 1
    ? contactTypeId
    : DEFAULT_CONTACT_TYPE_ID;
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
  return cleanString(value).replace(/\/+$/, '') || DEFAULT_BASE_URL;
}

function normalizePhone(value) {
  let digits = cleanString(value).replace(/\D/g, '');
  if (!digits) return '';

  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }

  return '+' + digits;
}

function getPhoneSearchVariants(phone) {
  const digits = cleanString(phone).replace(/\D/g, '');
  if (!digits) return [];

  const variants = [digits];
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    variants.push(digits.slice(2));
  } else if (digits.length === 10 || digits.length === 11) {
    variants.push('55' + digits);
  }

  return Array.from(new Set(variants));
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

function toNumberOrEmpty(value) {
  const cleanValue = cleanString(value);
  if (!cleanValue) return '';

  const number = Number(cleanValue);
  return Number.isFinite(number) ? number : '';
}

function escapeODataString(value) {
  return cleanString(value).replace(/'/g, "''");
}

function getCollection(body) {
  if (!body) return [];
  if (Array.isArray(body.value)) return body.value;
  if (Array.isArray(body)) return body;
  return [];
}

function getSingleRecord(body) {
  if (!body) return null;
  if (Array.isArray(body.value)) return body.value[0] || null;
  if (Array.isArray(body)) return body[0] || null;
  return body;
}

function formatPloomesErrorMessage(message) {
  if (Array.isArray(message)) return message.map(formatPloomesErrorMessage).join(', ');
  if (message && typeof message === 'object') {
    return message.message || message.Message || message.error || message.Error || JSON.stringify(message);
  }
  return String(message);
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
