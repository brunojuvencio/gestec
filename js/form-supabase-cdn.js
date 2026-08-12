const SUPABASE_URL = 'https://hasptpxcyavfdzxtwpws.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhc3B0cHhjeWF2ZmR6eHR3cHdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDA2MTYsImV4cCI6MjA5MTY3NjYxNn0.5TTFlqGtVl9AqWDzPTylquWRB1QdP1YXxPQRGfu5B68';
const TABLE_NAME = 'inscricoes_vendas';
const META_CAPI_ENDPOINT = '/api/meta-capi';
const LINKEDIN_CAPI_ENDPOINT = '/api/linkedin-capi';
const GOOGLE_CAPI_ENDPOINT = '/api/google-capi';
const ACTIVE_CAMPAIGN_ENDPOINT = '/api/active-campaign';
const PLOOMES_CRM_ENDPOINT = '/api/ploomes-crm';
const GOOGLE_ADS_SEND_TO = 'AW-11029855018/nAueCJfnm6kcELC-ntED';
const GA4_MEASUREMENT_ID = 'G-EZW8F7QZB0';

const hasPlaceholder =
  SUPABASE_URL === 'https://seu-projeto.supabase.co' ||
  SUPABASE_ANON_KEY === 'sua_chave_anonima_aqui';

const isConfigured = !hasPlaceholder;
const isPublishableKey = SUPABASE_ANON_KEY.indexOf('sb_publishable_') === 0;

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || null;
}

function getCookie(name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = document.cookie.match(new RegExp('(?:^|; )' + escapedName + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setCookie(name, value, days) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + expires + '; path=/; SameSite=Lax' + secure;
}

function randomInt() {
  if (window.crypto && window.crypto.getRandomValues) {
    const values = new Uint32Array(1);
    window.crypto.getRandomValues(values);
    return values[0];
  }

  return Math.floor(Math.random() * 2147483647);
}

function ensureFbp() {
  const existingFbp = getCookie('_fbp');
  if (existingFbp) return existingFbp;

  const fbp = 'fb.1.' + Date.now() + '.' + randomInt();
  setCookie('_fbp', fbp, 90);
  return fbp;
}

function ensureFbc() {
  const existingFbc = getCookie('_fbc');
  if (existingFbc) return existingFbc;

  const fbclid = getQueryParam('fbclid');
  if (!fbclid) return null;

  const fbc = 'fb.1.' + Date.now() + '.' + fbclid;
  setCookie('_fbc', fbc, 90);
  return fbc;
}

function createMetaEventId(eventName) {
  const randomPart =
    window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now() + '-' + randomInt();
  return eventName.toLowerCase() + '-' + randomPart;
}

function createLinkedInEventId(eventName) {
  const randomPart =
    window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : Date.now() + '-' + randomInt();
  return 'linkedin-' + eventName.toLowerCase() + '-' + randomPart;
}

function extractGa4SessionId(cookieValue) {
  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length >= 3) return parts[2];
  return cookieValue;
}

function ensureLinkedInClickId() {
  const urlClickId = getQueryParam('li_fat_id');
  if (urlClickId) {
    setCookie('li_fat_id', urlClickId, 30);
    return urlClickId;
  }

  return getCookie('li_fat_id');
}

function getLeadAnswerData(formData) {
  if (!formData) return {};

  const pretendePos = formData ? formData.pretende_pos : null;
  const formacaoSuperior = formData ? formData.formacao_superior : null;

  return {
    formacao_superior: formacaoSuperior || 'nao_informado',
    pretende_pos: pretendePos || 'nao_informado',
  };
}

async function trackMetaEvent(eventName, formData) {
  try {
    const response = await fetch(META_CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: eventName === 'PageView',
      body: JSON.stringify({
        event_name: eventName,
        event_id: createMetaEventId(eventName),
        event_source_url: window.location.href,
        user_data: {
          fbp: ensureFbp(),
          fbc: ensureFbc(),
          nome: formData ? formData.nome : null,
          email: formData ? formData.email : null,
          telefone: formData ? formData.telefone : null,
          cidade: formData ? formData.cidade : null,
        },
        custom_data: getLeadAnswerData(formData),
      }),
    });

    const result = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || (result && result.ok === false && !result.skipped)) {
      console.warn('Meta CAPI tracking nao confirmado:', result || response.status);
    }

    return result;
  } catch (error) {
    console.warn('Meta CAPI tracking indisponivel:', error);
    return null;
  }
}

async function trackLinkedInLead(formData) {
  try {
    const response = await fetch(LINKEDIN_CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: createLinkedInEventId('Lead'),
        event_source_url: window.location.href,
        user_data: {
          li_fat_id: ensureLinkedInClickId(),
          nome: formData ? formData.nome : null,
          email: formData ? formData.email : null,
          cargo: formData ? formData.cargo : null,
          empresa: formData ? formData.empresa : null,
          country_code: 'BR',
        },
      }),
    });

    const result = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || (result && result.ok === false && !result.skipped)) {
      console.warn('LinkedIn CAPI tracking nao confirmado:', result || response.status);
    }

    return result;
  } catch (error) {
    console.warn('LinkedIn CAPI tracking indisponivel:', error);
    return null;
  }
}

async function trackGoogleCapiLead(formData) {
  try {
    const response = await fetch(GOOGLE_CAPI_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_data: {
          nome: formData ? formData.nome : null,
          email: formData ? formData.email : null,
          telefone: formData ? formData.telefone : null,
          ga_client_id: getCookie('_ga'),
        },
        session_id: extractGa4SessionId(getCookie('_ga_' + GA4_MEASUREMENT_ID.replace('G-', ''))),
        origem: formData ? formData.origem : null,
        utm_source: formData ? formData.utm_source : null,
        utm_medium: formData ? formData.utm_medium : null,
        utm_campaign: formData ? formData.utm_campaign : null,
        utm_content: formData ? formData.utm_content : null,
        utm_term: formData ? formData.utm_term : null,
      }),
    });

    const result = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || (result && result.ok === false && !result.skipped)) {
      console.warn('Google CAPI tracking nao confirmado:', result || response.status);
    }

    return result;
  } catch (error) {
    console.warn('Google CAPI tracking indisponivel:', error);
    return null;
  }
}

async function syncActiveCampaign(formData) {
  try {
    const response = await fetch(ACTIVE_CAMPAIGN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    const result = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || !result || result.ok !== true) {
      console.warn('ActiveCampaign sync nao confirmado:', result || response.status);
      throw new Error(getActiveCampaignErrorMessage(result, response.status));
    }

    return result;
  } catch (error) {
    console.warn('ActiveCampaign sync indisponivel:', error);
    throw error;
  }
}

function getActiveCampaignErrorMessage(result, status) {
  if (result && result.message) return result.message;
  if (result && result.error) return result.error;
  if (result && result.reason) return result.reason;
  return 'ActiveCampaign sync failed with status ' + status;
}

async function syncPloomesCRM(formData) {
  try {
    const response = await fetch(PLOOMES_CRM_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(formData),
    });

    const result = await response.json().catch(function () {
      return null;
    });

    if (!response.ok || !result || result.ok !== true) {
      console.warn('Ploomes CRM sync nao confirmado:', result || response.status);
      throw new Error(getPloomesCRMErrorMessage(result, response.status));
    }

    return result;
  } catch (error) {
    console.warn('Ploomes CRM sync indisponivel:', error);
    throw error;
  }
}

function getPloomesCRMErrorMessage(result, status) {
  if (result && result.message) return result.message;
  if (result && result.error) return result.error;
  if (result && result.reason) return result.reason;
  return 'Ploomes CRM sync failed with status ' + status;
}

function trackGoogleLead(formData) {
  if (typeof window.gtag !== 'function') {
    console.warn('Google Ads tracking indisponivel: gtag nao carregou.');
    return;
  }

  const customData = getLeadAnswerData(formData);

  window.gtag('event', 'conversion', {
    send_to: GOOGLE_ADS_SEND_TO,
    formacao_superior: customData.formacao_superior,
    pretende_pos: customData.pretende_pos,
  });

  window.gtag('event', 'generate_lead', {
    send_to: GA4_MEASUREMENT_ID,
    formacao_superior: customData.formacao_superior,
    pretende_pos: customData.pretende_pos,
  });
}

document.addEventListener('DOMContentLoaded', function () {
  trackMetaEvent('PageView', null);

  const form = document.getElementById('register-form');
  const btn = document.getElementById('submit-btn');
  const msg = document.getElementById('msg-box');

  if (!form || !btn || !msg) return;

  const initialButtonHtml = btn.innerHTML;

  function setMsg(type, text) {
    msg.className = 'msg-box ' + type;
    msg.textContent = text;
  }

  function clearMsg() {
    msg.className = 'msg-box';
    msg.textContent = '';
  }

  function setButtonLoading(isLoading) {
    btn.disabled = isLoading;
    btn.innerHTML = isLoading ? 'Enviando...' : initialButtonHtml;
  }

  function markError(el) {
    el.classList.add('error');
    el.addEventListener(
      'input',
      function () {
        el.classList.remove('error');
      },
      { once: true }
    );
  }

  function validateRequiredFields() {
    let isValid = true;

    form
      .querySelectorAll('input[required]:not([type="radio"]), select[required]')
      .forEach(function (el) {
        if (!el.value.trim()) {
          markError(el);
          isValid = false;
        }
      });

    ['formacao_superior', 'pretende_pos'].forEach(function (name) {
      if (form.querySelector('input[name="' + name + '"]:checked')) return;

      isValid = false;
      form.querySelectorAll('input[name="' + name + '"]').forEach(function (radio) {
        const option = radio.closest('.radio-option');
        if (!option) return;

        option.style.borderColor = 'rgba(239,68,68,0.5)';
        radio.addEventListener(
          'change',
          function () {
            form.querySelectorAll('input[name="' + name + '"]').forEach(function (item) {
              const itemOption = item.closest('.radio-option');
              if (itemOption) itemOption.style.borderColor = '';
            });
          },
          { once: true }
        );
      });
    });

    return isValid;
  }

  function getFieldValue(id) {
    const field = document.getElementById(id);
    return field ? field.value.trim() : '';
  }

  function getFormData() {
    return {
      formacao_superior: form.querySelector('input[name="formacao_superior"]:checked').value,
      nome: getFieldValue('nome'),
      email: getFieldValue('email').toLowerCase(),
      cidade: getFieldValue('cidade') || null,
      telefone: getFieldValue('telefone'),
      area_formacao: getFieldValue('area_formacao'),
      empresa: getFieldValue('empresa'),
      cargo: getFieldValue('cargo'),
      pretende_pos: form.querySelector('input[name="pretende_pos"]:checked').value,
      origem: 'palestra-salestech',
      url_origem: window.location.href,
      utm_source: getQueryParam('utm_source'),
      utm_medium: getQueryParam('utm_medium'),
      utm_campaign: getQueryParam('utm_campaign'),
      utm_term: getQueryParam('utm_term'),
      utm_content: getQueryParam('utm_content'),
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    clearMsg();

    if (!isConfigured) {
      setMsg(
        'error',
        'Supabase ainda nao configurado. Preencha a URL e a anon key no arquivo js/form-supabase-cdn.js.'
      );
      return;
    }

    if (!validateRequiredFields()) {
      setMsg('error', 'Preencha todos os campos obrigatorios antes de continuar.');
      return;
    }

    setButtonLoading(true);

    try {
      const formData = getFormData();
      const response = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE_NAME, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          ...(isPublishableKey ? {} : { Authorization: 'Bearer ' + SUPABASE_ANON_KEY }),
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || 'Erro HTTP ' + response.status);
      }

      await syncActiveCampaign(formData).catch(function (e) {
        console.warn('ActiveCampaign sync skipped:', e);
      });
      await syncPloomesCRM(formData).catch(function (e) {
        console.warn('Ploomes CRM sync skipped:', e);
      });
      trackMetaEvent('Lead', formData);
      trackLinkedInLead(formData);
      trackGoogleCapiLead(formData);
      trackGoogleLead(formData);
      btn.disabled = true;
      btn.innerHTML = 'Inscrição realizada';
      form.reset();
      document.dispatchEvent(new CustomEvent('inscricao-confirmada', { detail: { formacao_superior: formData.formacao_superior } }));
    } catch (error) {
      console.error('Erro ao processar inscricao:', error);
      setMsg('error', 'Nao foi possivel confirmar sua inscricao agora. Tente novamente.');
      setButtonLoading(false);
    }
  });
});
