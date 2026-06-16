const { getLeads } = require('./linkedin-leads');

const TABLE_NAME = 'inscricoes_vendas';

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const baseUrl = 'https://' + req.headers.host;
    const result = await runSync(baseUrl, false);

    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[linkedin-lead-sync] Erro fatal:', error.message);
    return res.status(500).json({
      ok: false,
      error: 'sync_failed',
      message: error.message,
    });
  }
};

async function runSync(baseUrl, verbose) {
  const supabaseUrl = cleanString(getEnvValue('SUPABASE_URL')).replace(/\/+$/, '');
  const supabaseKey = getEnvValue('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sao obrigatorios');
  }

  console.log('[linkedin-lead-sync] Buscando leads do LinkedIn...');
  const elements = await getLeads();
  console.log('[linkedin-lead-sync] ' + elements.length + ' lead(s) retornado(s) pela API');

  const result = { synced: 0, skipped: 0, errors: [] };
  if (verbose) result.leads = [];

  for (const element of elements) {
    const lead = parseLinkedInLead(element);

    if (!lead.email) {
      console.log('[linkedin-lead-sync] Lead sem email ignorado: ' + lead.leadId);
      result.skipped += 1;
      if (verbose) {
        result.leads.push({ leadId: lead.leadId, status: 'skipped', reason: 'no_email' });
      }
      continue;
    }

    console.log('[linkedin-lead-sync] Processando: ' + lead.email);

    try {
      const isDuplicate = await checkDuplicate(supabaseUrl, supabaseKey, lead.leadId);
      if (isDuplicate) {
        console.log('[linkedin-lead-sync] Ja existe, pulando: ' + lead.email);
        result.skipped += 1;
        if (verbose) {
          result.leads.push({ email: lead.email, leadId: lead.leadId, status: 'skipped', reason: 'duplicate' });
        }
        continue;
      }

      const utms = buildUtms(lead);

      console.log('[linkedin-lead-sync] Inserindo no Supabase: ' + lead.email);
      await insertLead(supabaseUrl, supabaseKey, lead, utms);
      console.log('[linkedin-lead-sync] Supabase ok: ' + lead.email);

      const leadStatus = verbose
        ? {
            email: lead.email,
            leadId: lead.leadId,
            nome: buildFullName(lead),
            status: 'synced',
            supabase: 'ok',
          }
        : null;

      const acPayload = buildIntegrationPayload(lead, utms);

      console.log('[linkedin-lead-sync] Enviando para ActiveCampaign: ' + lead.email);
      await sendToEndpoint(baseUrl + '/api/active-campaign', acPayload)
        .then(function () {
          console.log('[linkedin-lead-sync] ActiveCampaign ok: ' + lead.email);
          if (leadStatus) leadStatus.activeCampaign = 'ok';
        })
        .catch(function (error) {
          console.error('[linkedin-lead-sync] ActiveCampaign erro para ' + lead.email + ':', error.message);
          if (leadStatus) leadStatus.activeCampaign = 'error: ' + error.message;
        });

      console.log('[linkedin-lead-sync] Enviando para Ploomes: ' + lead.email);
      await sendToEndpoint(baseUrl + '/api/ploomes-crm', acPayload)
        .then(function () {
          console.log('[linkedin-lead-sync] Ploomes ok: ' + lead.email);
          if (leadStatus) leadStatus.ploomes = 'ok';
        })
        .catch(function (error) {
          console.error('[linkedin-lead-sync] Ploomes erro para ' + lead.email + ':', error.message);
          if (leadStatus) leadStatus.ploomes = 'error: ' + error.message;
        });

      console.log('[linkedin-lead-sync] Enviando para Google CAPI: ' + lead.email);
      await sendToEndpoint(baseUrl + '/api/google-capi', {
        user_data: {
          nome: buildFullName(lead),
          email: lead.email,
          telefone: lead.phone || null,
        },
      })
        .then(function () {
          console.log('[linkedin-lead-sync] Google CAPI ok: ' + lead.email);
          if (leadStatus) leadStatus.googleCapi = 'ok';
        })
        .catch(function (error) {
          console.error('[linkedin-lead-sync] Google CAPI erro para ' + lead.email + ':', error.message);
          if (leadStatus) leadStatus.googleCapi = 'error: ' + error.message;
        });

      result.synced += 1;
      if (verbose) result.leads.push(leadStatus);
    } catch (error) {
      console.error('[linkedin-lead-sync] Erro ao processar ' + lead.email + ':', error.message);
      result.errors.push({ email: lead.email, leadId: lead.leadId, error: error.message });
      if (verbose) {
        result.leads.push({
          email: lead.email,
          leadId: lead.leadId,
          status: 'error',
          supabase: 'error: ' + error.message,
        });
      }
    }
  }

  console.log(
    '[linkedin-lead-sync] Concluido: synced=' + result.synced +
    ' skipped=' + result.skipped +
    ' errors=' + result.errors.length
  );

  return result;
}

function parseLinkedInLead(element) {
  const leadId = cleanString(element.id);
  const formId = cleanString(element.owner || '');
  const campaignName = cleanString(element.campaignName || element.associatedCampaignName || '');

  const fields = extractFormFields(element);

  const firstName =
    fields['FIRST_NAME'] || fields['firstName'] || cleanString(element.firstName || '');
  const lastName =
    fields['LAST_NAME'] || fields['lastName'] || cleanString(element.lastName || '');
  const email = (
    fields['EMAIL'] || fields['emailAddress'] || fields['WORK_EMAIL'] ||
    cleanString(element.email || element.emailAddress || '')
  ).toLowerCase();
  const phone =
    fields['PHONE'] || fields['MOBILE_PHONE'] || fields['phoneNumber'] ||
    cleanString(element.phone || element.phoneNumber || '');
  const company =
    fields['COMPANY'] || fields['companyName'] ||
    cleanString(element.company || element.companyName || '');
  const jobTitle =
    fields['JOB_TITLE'] || fields['jobTitle'] || fields['title'] ||
    cleanString(element.jobTitle || element.title || '');

  return { leadId, formId, campaignName, firstName, lastName, email, phone, company, jobTitle };
}

function extractFormFields(element) {
  const fields = {};
  const formResponse = element.formResponse || {};
  const fieldData = formResponse.formFieldData || formResponse.answers || [];

  if (!Array.isArray(fieldData)) return fields;

  for (const field of fieldData) {
    const name = cleanString(field.name || field.question || field.questionId || '');
    const value = extractFieldValue(field);
    if (name && value) fields[name] = value;
  }

  return fields;
}

function extractFieldValue(field) {
  if (Array.isArray(field.values) && field.values[0]) {
    return cleanString(field.values[0]);
  }

  if (field.answer) {
    return cleanString(field.answer);
  }

  if (field.answerDetails && field.answerDetails.textAnswers) {
    const values = field.answerDetails.textAnswers.values;
    if (Array.isArray(values) && values[0]) {
      return cleanString(values[0]);
    }
  }

  return '';
}

function buildUtms(lead) {
  return {
    utm_source: 'linkedin',
    utm_medium: 'paid_social',
    utm_campaign: lead.campaignName || getEnvValue('LINKEDIN_CAMPAIGN_NAME'),
    utm_content: 'lead_gen_form',
    utm_term: null,
  };
}

function buildIntegrationPayload(lead, utms) {
  return {
    nome: buildFullName(lead),
    email: lead.email,
    telefone: lead.phone || null,
    empresa: lead.company || null,
    cargo: lead.jobTitle || null,
    origem: 'forms-linkedin-pipeline',
    source: 'LinkedIn',
    utm_source: utms.utm_source,
    utm_medium: utms.utm_medium,
    utm_campaign: utms.utm_campaign || null,
    utm_term: utms.utm_term,
    utm_content: utms.utm_content,
  };
}

async function checkDuplicate(supabaseUrl, supabaseKey, linkedinLeadId) {
  const url =
    getSupabaseRestBase(supabaseUrl) +
    '/' + TABLE_NAME +
    '?select=id&linkedin_lead_id=eq.' +
    encodeURIComponent(linkedinLeadId) +
    '&limit=1';

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase dedup error ' + response.status + ': ' + text);
  }

  const data = await response.json();
  return Array.isArray(data) && data.length > 0;
}

async function insertLead(supabaseUrl, supabaseKey, lead, utms) {
  const payload = removeEmpty({
    nome: buildFullName(lead),
    email: lead.email,
    telefone: lead.phone || '',
    empresa: lead.company || '',
    cargo: lead.jobTitle || '',
    cidade: '',
    area_formacao: '',
    formacao_superior: 'nao_informado',
    pretende_pos: 'nao_informado',
    origem: 'forms-linkedin-pipeline',
    url_origem: null,
    utm_source: utms.utm_source,
    utm_medium: utms.utm_medium,
    utm_campaign: utms.utm_campaign || null,
    utm_content: utms.utm_content,
    utm_term: null,
    linkedin_lead_id: lead.leadId,
    linkedin_form_id: lead.formId || null,
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

function buildFullName(lead) {
  return cleanString((lead.firstName + ' ' + lead.lastName).replace(/\s+/g, ' ')) ||
    lead.firstName ||
    lead.lastName ||
    '';
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

module.exports.runSync = runSync;
