const TABLE_NAME = 'inscricoes_vendas';

const COLUMN_ALIASES = {
  email: ['email', 'email address', 'endereço de e-mail', 'endereço de email', 'e-mail'],
  firstName: ['first name', 'primeiro nome', 'firstname', 'nome'],
  lastName: ['last name', 'último nome', 'sobrenome', 'lastname'],
  fullName: ['full name', 'nome completo'],
  phone: ['phone', 'phone number', 'número de telefone', 'telefone', 'mobile', 'mobile phone'],
  company: ['company', 'company name', 'empresa', 'nome da empresa'],
  jobTitle: ['job title', 'cargo', 'title', 'função', 'jobtitle'],
  linkedinLeadId: ['lead_id', 'lead id', 'leadid', 'id do lead'],
  campaignName: ['form_name', 'form name', 'campaign name', 'nome da campanha', 'campaign'],
  cidade: ['cidade', 'city', 'location', 'localização'],
  formacaoSuperior: ['possui formação superior?', 'possui formacao superior?', 'formação superior', 'formacao superior', 'higher education'],
  pretendePos: ['pretende fazer uma pós-graduação ou mba?', 'pretende fazer uma pos-graduacao ou mba?', 'pretende pos', 'intends postgrad'],
};

function mapFormacaoSuperior(raw) {
  const v = cleanString(raw).toLowerCase();
  if (v === 'sim' || v === 'yes' || v === 'true') return 'sim';
  if (v === 'não' || v === 'nao' || v === 'no' || v === 'false') return 'nao';
  return 'nao_informado';
}

function mapPretendePos(raw) {
  const v = cleanString(raw).toLowerCase();
  if (v.includes('imediatamente') || v.includes('immediately') || v === 'sim_agora') return 'sim_agora';
  if (v.includes('não agora') || v.includes('nao agora') || v.includes('not now') || v === 'sim_depois') return 'sim_depois';
  if (v === 'não' || v === 'nao' || v === 'no') return 'nao';
  return 'nao_informado';
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const rawLeads = body.leads;

    if (!Array.isArray(rawLeads) || rawLeads.length === 0) {
      return res.status(400).json({ ok: false, error: 'leads array is required and must not be empty' });
    }

    const supabaseUrl = cleanString(getEnvValue('SUPABASE_URL')).replace(/\/+$/, '');
    const supabaseKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios');
    }

    const baseUrl = 'https://' + req.headers.host;
    const result = { synced: 0, skipped: 0, errors: [], leads: [] };

    for (const rawLead of rawLeads) {
      const lead = normalizeLead(rawLead);

      if (!lead.email) {
        result.skipped += 1;
        result.leads.push({ status: 'skipped', reason: 'no_email' });
        continue;
      }

      try {
        const isDuplicate = lead.linkedinLeadId
          ? await checkDuplicateByLeadId(supabaseUrl, supabaseKey, lead.linkedinLeadId)
          : await checkDuplicateByEmail(supabaseUrl, supabaseKey, lead.email);

        if (isDuplicate) {
          await updateLeadFields(supabaseUrl, supabaseKey, lead);
          result.skipped += 1;
          result.leads.push({
            email: lead.email,
            status: 'updated',
            formacao_superior: lead.formacaoSuperior,
            pretende_pos: lead.pretendePos,
          });
          continue;
        }

        await insertLead(supabaseUrl, supabaseKey, lead);

        const payload = buildIntegrationPayload(lead);
        const leadStatus = { email: lead.email, nome: lead.nome, status: 'synced', supabase: 'ok' };

        await sendToEndpoint(baseUrl + '/api/active-campaign', payload)
          .then(function () { leadStatus.activeCampaign = 'ok'; })
          .catch(function (e) { leadStatus.activeCampaign = 'error: ' + e.message; });

        await sendToEndpoint(baseUrl + '/api/ploomes-crm', payload)
          .then(function () { leadStatus.ploomes = 'ok'; })
          .catch(function (e) { leadStatus.ploomes = 'error: ' + e.message; });

        result.synced += 1;
        result.leads.push(leadStatus);
      } catch (error) {
        console.error('[linkedin-leads-import] Erro ao processar ' + lead.email + ':', error.message);
        result.errors.push({ email: lead.email, error: error.message });
        result.leads.push({ email: lead.email, status: 'error', error: error.message });
      }
    }

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[linkedin-leads-import] Erro fatal:', error.message);
    return res.status(500).json({ ok: false, error: error.message });
  }
};

function normalizeLead(raw) {
  function get(aliases) {
    for (const alias of aliases) {
      for (const k of Object.keys(raw)) {
        if (k.toLowerCase().trim() === alias.toLowerCase()) {
          return cleanString(String(raw[k] || ''));
        }
      }
    }
    return '';
  }

  const firstName = get(COLUMN_ALIASES.firstName);
  const lastName = get(COLUMN_ALIASES.lastName);
  const fullName = get(COLUMN_ALIASES.fullName);

  let nome;
  if (fullName) {
    nome = fullName;
  } else {
    nome = cleanString((firstName + ' ' + lastName).replace(/\s+/g, ' '));
  }

  return {
    nome: nome || firstName || lastName || '',
    email: get(COLUMN_ALIASES.email).toLowerCase(),
    telefone: get(COLUMN_ALIASES.phone),
    empresa: get(COLUMN_ALIASES.company),
    cargo: get(COLUMN_ALIASES.jobTitle),
    cidade: get(COLUMN_ALIASES.cidade),
    linkedinLeadId: get(COLUMN_ALIASES.linkedinLeadId),
    campaignName: get(COLUMN_ALIASES.campaignName),
    formacaoSuperior: mapFormacaoSuperior(get(COLUMN_ALIASES.formacaoSuperior)),
    pretendePos: mapPretendePos(get(COLUMN_ALIASES.pretendePos)),
  };
}

function buildIntegrationPayload(lead) {
  return removeEmpty({
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone || null,
    empresa: lead.empresa || null,
    cargo: lead.cargo || null,
    origem: 'forms-linkedin-pipeline',
    source: 'LinkedIn',
    utm_source: 'linkedin',
    utm_medium: 'forms',
    utm_campaign: lead.campaignName || null,
    utm_content: 'mensagem',
    utm_term: null,
  });
}

async function checkDuplicateByLeadId(supabaseUrl, supabaseKey, leadId) {
  const url =
    getSupabaseRestBase(supabaseUrl) + '/' + TABLE_NAME +
    '?select=id&linkedin_lead_id=eq.' + encodeURIComponent(leadId) + '&limit=1';
  const response = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Supabase dedup error ' + response.status);
  const data = await response.json();
  return Array.isArray(data) && data.length > 0;
}

async function checkDuplicateByEmail(supabaseUrl, supabaseKey, email) {
  const url =
    getSupabaseRestBase(supabaseUrl) + '/' + TABLE_NAME +
    '?select=id&email=eq.' + encodeURIComponent(email) +
    '&origem=eq.forms-linkedin-pipeline&limit=1';
  const response = await fetch(url, {
    headers: { apikey: supabaseKey, Authorization: 'Bearer ' + supabaseKey, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error('Supabase dedup error ' + response.status);
  const data = await response.json();
  return Array.isArray(data) && data.length > 0;
}

async function insertLead(supabaseUrl, supabaseKey, lead) {
  const payload = removeEmpty({
    nome: lead.nome,
    email: lead.email,
    telefone: lead.telefone || '',
    empresa: lead.empresa || '',
    cargo: lead.cargo || '',
    cidade: lead.cidade || '',
    area_formacao: '',
    formacao_superior: lead.formacaoSuperior || 'nao_informado',
    pretende_pos: lead.pretendePos || 'nao_informado',
    origem: 'forms-linkedin-pipeline',
    url_origem: null,
    utm_source: 'linkedin',
    utm_medium: 'forms',
    utm_campaign: lead.campaignName || null,
    utm_content: 'mensagem',
    utm_term: null,
    linkedin_lead_id: lead.linkedinLeadId || null,
  });

  const response = await fetch(getSupabaseRestBase(supabaseUrl) + '/' + TABLE_NAME, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase insert error ' + response.status + ': ' + text);
  }
}

async function updateLeadFields(supabaseUrl, supabaseKey, lead) {
  const filter = lead.linkedinLeadId
    ? '?linkedin_lead_id=eq.' + encodeURIComponent(lead.linkedinLeadId)
    : '?email=eq.' + encodeURIComponent(lead.email) + '&origem=eq.forms-linkedin-pipeline';

  const response = await fetch(getSupabaseRestBase(supabaseUrl) + '/' + TABLE_NAME + filter, {
    method: 'PATCH',
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      formacao_superior: lead.formacaoSuperior,
      pretende_pos: lead.pretendePos,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase update error ' + response.status + ': ' + text);
  }
}

async function sendToEndpoint(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(function () { return null; });
  if (!response.ok || !result || result.ok !== true) {
    const message = (result && (result.message || result.error)) || 'HTTP ' + response.status;
    throw new Error(message);
  }
  return result;
}

function getSupabaseRestBase(supabaseUrl) {
  return supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '') + '/rest/v1';
}

function isAuthorized(req) {
  const cronSecret = getEnvValue('CRON_SECRET');
  if (!cronSecret) return false;
  const headerSecret = cleanString(req.headers['x-cron-secret']);
  if (headerSecret === cronSecret) return true;
  const authHeader = cleanString(req.headers.authorization);
  if (authHeader === 'Bearer ' + cronSecret) return true;
  return false;
}

async function readJsonBody(req) {
  if (Buffer.isBuffer(req.body)) {
    const raw = req.body.toString('utf8');
    return raw ? JSON.parse(raw) : {};
  }
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

function removeEmpty(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined)
  );
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
