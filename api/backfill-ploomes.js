const PAGE_SIZE = 50;
const DELAY_MS = 300;

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const secret = req.query.secret;
  const expectedSecret = process.env.BACKFILL_SECRET;

  if (!expectedSecret || !secret || secret !== expectedSecret) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ ok: false, error: 'missing_supabase_config' });
  }

  const baseUrl = 'https://' + req.headers.host;

  try {
    const leads = await fetchAllLeads(supabaseUrl, supabaseKey);
    const summary = await processLeads(leads, baseUrl);

    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'backfill_failed', message: error.message });
  }
};

async function fetchAllLeads(supabaseUrl, supabaseKey) {
  const leads = [];
  let offset = 0;

  while (true) {
    const page = await fetchLeadsPage(supabaseUrl, supabaseKey, offset, PAGE_SIZE);
    leads.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return leads;
}

async function fetchLeadsPage(supabaseUrl, supabaseKey, offset, limit) {
  const fields = [
    'nome', 'email', 'telefone', 'cidade', 'area_formacao',
    'empresa', 'cargo', 'formacao_superior', 'pretende_pos',
    'origem', 'url_origem', 'utm_source', 'utm_medium',
    'utm_campaign', 'utm_term', 'utm_content',
  ].join(',');

  const url =
    supabaseUrl +
    '/rest/v1/inscricoes_vendas?select=' +
    fields +
    '&order=id.asc&limit=' +
    limit +
    '&offset=' +
    offset;

  const response = await fetch(url, {
    headers: {
      apikey: supabaseKey,
      Authorization: 'Bearer ' + supabaseKey,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Supabase error ' + response.status + ': ' + text);
  }

  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function processLeads(leads, baseUrl) {
  const summary = {
    total: leads.length,
    success: 0,
    errors: 0,
    errorList: [],
  };

  for (const lead of leads) {
    await sleep(DELAY_MS);

    try {
      await sendToPlomes(lead, baseUrl);
      summary.success += 1;
    } catch (error) {
      summary.errors += 1;
      summary.errorList.push({
        email: lead.email || null,
        nome: lead.nome || null,
        error: error.message,
      });
    }
  }

  return summary;
}

async function sendToPlomes(lead, baseUrl) {
  const response = await fetch(baseUrl + '/api/ploomes-crm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(lead),
  });

  const result = await response.json().catch(function () {
    return null;
  });

  if (!response.ok || !result || result.ok !== true) {
    const message =
      (result && (result.message || result.error)) ||
      'HTTP ' + response.status;
    throw new Error(message);
  }

  return result;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}
