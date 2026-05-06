const SUPABASE_URL = 'https://hasptpxcyavfdzxtwpws.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhhc3B0cHhjeWF2ZmR6eHR3cHdzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDA2MTYsImV4cCI6MjA5MTY3NjYxNn0.5TTFlqGtVl9AqWDzPTylquWRB1QdP1YXxPQRGfu5B68';
const TABLE_NAME = 'inscricoes_vendas';

const hasPlaceholder =
  SUPABASE_URL === 'https://seu-projeto.supabase.co' ||
  SUPABASE_ANON_KEY === 'sua_chave_anonima_aqui';

const isConfigured = !hasPlaceholder;
const isPublishableKey = SUPABASE_ANON_KEY.indexOf('sb_publishable_') === 0;

document.addEventListener('DOMContentLoaded', function () {
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

  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name) || null;
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
      origem: 'pre-mba-salestech',
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
      const response = await fetch(SUPABASE_URL + '/rest/v1/' + TABLE_NAME, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          ...(isPublishableKey ? {} : { Authorization: 'Bearer ' + SUPABASE_ANON_KEY }),
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(getFormData()),
      });

      if (!response.ok) {
        const details = await response.text();
        throw new Error(details || 'Erro HTTP ' + response.status);
      }

      setMsg('success', 'Inscricao confirmada! Verifique seu email para os proximos passos.');
      btn.disabled = true;
      btn.innerHTML = 'Inscricao realizada';
      form.reset();
    } catch (error) {
      console.error('Erro ao salvar inscricao no Supabase:', error);
      setMsg('error', 'Erro ao processar sua inscricao. Tente novamente.');
      setButtonLoading(false);
    }
  });
});
