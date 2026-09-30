import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const rpc = (fn, args) => sb.schema('esg').rpc(fn, args);
const root = document.getElementById('root');
const token = new URLSearchParams(location.search).get('t');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STEPS = ['Dados', 'Ambiental', 'Social', 'Governança', 'Evidências', 'Revisão', 'Envio'];
const DIM = { 1: 'E', 2: 'S', 3: 'G' };
const LABEL = { sim: 'Sim', nao: 'Não', parcial: 'Parcial', nao_aplicavel: 'Não se aplica' };
const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];
const EVST = { pendente: 'Em análise', validada: 'Validada', reprovada: 'Reprovada', correcao: 'Correção solicitada', nao_aplicavel: 'Não aplicável' };
let D = null, step = 0;
const editable = () => D && ['nao_iniciada', 'em_andamento'].includes(D.status);

async function load() {
  const { data, error } = await rpc('portal_get', { p_token: token });
  if (error) { root.innerHTML = `<div class="card err">${esc(error.message.includes('inválido') ? 'Link inválido ou expirado. Solicite um novo link à Unidasul.' : error.message)}</div>`; return false; }
  D = data; document.getElementById('who').textContent = `${D.supplier.company_name} · ${D.campaign.name}`; return true;
}
const answered = () => D.items.filter((i) => i.state !== 'nao_informado').length;
const progress = () => (D.items.length ? Math.round((100 * answered()) / D.items.length) : 0);

function shell(body) {
  root.innerHTML = `<div class="card"><div style="display:flex;justify-content:space-between"><b>Etapa ${step + 1} de ${STEPS.length} — ${STEPS[step]}</b><span>${progress()}% concluído</span></div>
    <div class="bar" style="margin-top:8px"><i style="width:${progress()}%"></i></div><div class="steps">${STEPS.map((s, i) => `<span class="${i === step ? 'on' : ''}">${i + 1}. ${s}</span>`).join('')}</div></div>${body}`;
}
const navBtns = (nextLabel = 'Continuar') => `<div class="nav">${step > 0 ? '<button class="btn ghost" id="back">Voltar</button>' : '<span></span>'}<button class="btn" id="next">${nextLabel}</button></div>`;
function bindNav(beforeNext) {
  const b = document.getElementById('back'); if (b) b.onclick = () => go(step - 1);
  const n = document.getElementById('next'); if (n) n.onclick = async () => { if (!beforeNext || (await beforeNext())) go(step + 1); };
}
function go(i) { step = Math.max(0, Math.min(STEPS.length - 1, i)); render(); scrollTo(0, 0); }

async function save(it, patch) {
  Object.assign(it, patch);
  const { error } = await rpc('portal_save', { p_token: token, p_kpi: it.kpi_id, p_state: it.state, p_note: it.note || null, p_value: it.value ?? null });
  const st = document.getElementById('saved');
  if (st) { st.textContent = error ? 'Erro ao salvar: ' + error.message : 'Progresso salvo ✓'; st.className = error ? 'err' : 'ok'; }
  const pct = document.querySelector('.bar i'); if (pct) pct.style.width = progress() + '%';
}

function itemHTML(it, idx) {
  const bool = it.answer_type === 'sim_nao', ro = editable() ? '' : 'disabled';
  const opts = (bool ? ['sim', 'nao', 'nao_aplicavel'] : ['sim', 'parcial', 'nao', 'nao_aplicavel']).map((s) => `<label class="${it.state === s ? 'sel' : ''}"><input type="radio" name="s${idx}" value="${s}" ${it.state === s ? 'checked' : ''} ${ro}> ${LABEL[s]}</label>`).join('');
  let val = '';
  const t = it.answer_type, v = it.value;
  if (t === 'numero' || t === 'percentual') val = `<label>${t === 'percentual' ? 'Percentual (%)' : 'Valor'}</label><input type="number" step="any" data-v="${idx}" value="${esc(v)}" ${ro}>`;
  else if (t === 'texto') val = `<label>Detalhe</label><input data-v="${idx}" value="${esc(v)}" ${ro}>`;
  else if (t === 'data') val = `<label>Data</label><input type="date" data-v="${idx}" value="${esc(v)}" ${ro}>`;
  else if (t === 'selecao') val = `<label>Selecione</label><select data-v="${idx}" ${ro}><option value=""></option>${(it.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
  else if (t === 'multipla') val = `<label>Selecione</label>${(it.options || []).map((o) => `<label style="font-weight:400"><input type="checkbox" style="width:auto" data-m="${idx}" value="${esc(o)}" ${(v || []).includes(o) ? 'checked' : ''} ${ro}> ${esc(o)}</label>`).join('')}`;
  return `<div class="card"><b>${esc(it.question)}${it.required ? ' *' : ''}</b>${it.category ? `<div class="sub">${esc(it.category)}</div>` : ''}${it.description ? `<p class="sub">${esc(it.description)}</p>` : ''}
    <div class="opts" style="margin-top:8px">${opts}</div>${val}<label>Observação (opcional)</label><textarea rows="2" data-n="${idx}" ${ro}>${esc(it.note)}</textarea></div>`;
}
function bindItems(list) {
  list.forEach(({ it, idx }) => {
    document.querySelectorAll(`input[name="s${idx}"]`).forEach((r) => (r.onchange = () => { document.querySelectorAll(`input[name="s${idx}"]`).forEach((x) => x.parentElement.classList.toggle('sel', x.checked)); save(it, { state: r.value }); }));
    const v = document.querySelector(`[data-v="${idx}"]`); if (v) v.onchange = () => save(it, { value: v.value === '' ? null : it.answer_type === 'numero' || it.answer_type === 'percentual' ? Number(v.value) : v.value });
    document.querySelectorAll(`[data-m="${idx}"]`).forEach((c) => (c.onchange = () => save(it, { value: [...document.querySelectorAll(`[data-m="${idx}"]:checked`)].map((x) => x.value) })));
    const n = document.querySelector(`[data-n="${idx}"]`); if (n) n.onchange = () => save(it, { note: n.value });
  });
}

function render() {
  if (step === 0) {
    shell(`<div class="card"><b>${esc(D.supplier.company_name)}</b><p class="sub">CNPJ ${esc(D.supplier.cnpj || '—')} · Ciclo ${D.campaign.cycle_year}${D.campaign.end_date ? ' · Prazo: ' + new Date(D.campaign.end_date + 'T00:00:00').toLocaleDateString('pt-BR') : ''}</p>
      <p>Este questionário avalia práticas ambientais, sociais e de governança. Você pode salvar e continuar depois pelo mesmo link.</p>
      <p class="sub">Privacidade: usamos as informações e documentos apenas para a avaliação ESG da Unidasul. Eles ficam acessíveis somente à equipe autorizada e nunca a outros fornecedores.</p>
      ${D.consented ? '<p class="ok">✓ Consentimento registrado.</p>' : '<label style="font-weight:400"><input type="checkbox" id="consent" style="width:auto"> Li e concordo com o tratamento dos dados conforme acima.</label>'}</div>${!editable() ? `<div class="card ok">Esta avaliação já foi enviada. Você pode apenas consultar as respostas.</div>` : ''}${navBtns('Começar')}`);
    bindNav(async () => {
      if (D.consented || !editable()) return true;
      if (!document.getElementById('consent').checked) { alert('É necessário concordar para continuar.'); return false; }
      const { error } = await rpc('portal_consent', { p_token: token }); if (error) { alert(error.message); return false; }
      D.consented = true; return true;
    });
  } else if (step >= 1 && step <= 3) {
    const list = D.items.map((it, idx) => ({ it, idx })).filter(({ it }) => it.dimension === DIM[step]);
    shell((list.length ? list.map(({ it, idx }) => itemHTML(it, idx)).join('') : '<div class="card">Nenhuma pergunta nesta dimensão.</div>') + '<p id="saved" class="sub"></p>' + navBtns());
    bindItems(list); bindNav();
  } else if (step === 4) {
    const list = D.items.filter((it) => it.requires_evidence);
    shell((list.length ? list.map((it) => {
      const es = D.evidences.filter((e) => e.kpi_id === it.kpi_id);
      return `<div class="card"><b>${esc(it.question)}</b>${it.evidence_mandatory ? '<div class="sub">Evidência obrigatória se a resposta for Sim/Parcial.</div>' : ''}
        ${es.map((e) => `<div class="ev">📎 ${esc(e.original_name)} — ${EVST[e.status]}${e.valid_until ? ' · validade ' + new Date(e.valid_until + 'T00:00:00').toLocaleDateString('pt-BR') : ''}${e.note ? `<div class="err">Motivo: ${esc(e.note)}</div>` : ''}</div>`).join('')}
        ${editable() ? `<label>Arquivo (PDF, imagem, Word ou Excel)</label><input type="file" data-f="${it.kpi_id}" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"><label>Data do documento</label><input type="date" data-dd="${it.kpi_id}"><label>Validade (se houver)</label><input type="date" data-vu="${it.kpi_id}"><p><button class="btn ghost" data-up="${it.kpi_id}" data-t="${esc(it.evidence_type || '')}">Enviar arquivo</button></p><p class="sub" data-msg="${it.kpi_id}"></p>` : ''}</div>`;
    }).join('') : '<div class="card">Nenhuma evidência é solicitada neste questionário.</div>') + navBtns());
    document.querySelectorAll('[data-up]').forEach((b) => (b.onclick = () => upload(b)));
    bindNav();
  } else if (step === 5) {
    const issues = review();
    shell(`<div class="card"><b>Revisão</b><p>${answered()} de ${D.items.length} indicadores respondidos.</p>${issues.length ? `<ul class="err">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '<p class="ok">Tudo certo para enviar.</p>'}</div>${navBtns()}`);
    bindNav();
  } else {
    const issues = review();
    shell(`<div class="card"><b>Envio</b>${editable() ? `<p>Ao enviar, as respostas seguem para análise da Unidasul e não poderão ser alteradas, salvo se for solicitada correção.</p>${issues.length ? `<p class="err">Resolva antes de enviar:</p><ul class="err">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}<button class="btn" id="send" ${issues.length ? 'disabled' : ''}>Enviar avaliação</button><p id="sendmsg"></p>` : '<p class="ok">✓ Avaliação enviada. Obrigado!</p>'}</div><div class="nav"><button class="btn ghost" id="back">Voltar</button><span></span></div>`);
    bindNav();
    const s = document.getElementById('send');
    if (s) s.onclick = async () => {
      if (!confirm('Confirmar o envio?')) return;
      s.disabled = true;
      const { error } = await rpc('portal_submit', { p_token: token });
      if (error) { document.getElementById('sendmsg').innerHTML = `<span class="err">${esc(error.message)}</span>`; s.disabled = false; return; }
      await load(); render();
    };
  }
}

function review() {
  const out = [];
  D.items.forEach((it) => {
    if (it.required && it.state === 'nao_informado') out.push(`Pergunta obrigatória sem resposta: ${it.question}`);
    if (it.evidence_mandatory && ['sim', 'parcial'].includes(it.state) && !D.evidences.some((e) => e.kpi_id === it.kpi_id && ['pendente', 'validada', 'correcao'].includes(e.status))) out.push(`Falta anexar evidência: ${it.question}`);
  });
  return out;
}

async function upload(btn) {
  const k = btn.dataset.up, f = document.querySelector(`[data-f="${k}"]`).files[0], msg = document.querySelector(`[data-msg="${k}"]`);
  if (!f) { msg.textContent = 'Escolha um arquivo.'; return; }
  const ext = f.name.split('.').pop().toLowerCase();
  if (!EXT.includes(ext)) { msg.textContent = 'Formato não permitido.'; return; }
  btn.disabled = true; msg.textContent = 'Enviando…';
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/portal-upload`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
      body: JSON.stringify({ token, kpi_id: k, filename: f.name, size: f.size, doc_date: document.querySelector(`[data-dd="${k}"]`).value, valid_until: document.querySelector(`[data-vu="${k}"]`).value, evidence_type: btn.dataset.t }) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Falha no envio');
    const up = await sb.storage.from('evidences').uploadToSignedUrl(j.path, j.token, f); if (up.error) throw up.error;
    await load(); render();
  } catch (e) { msg.innerHTML = `<span class="err">${esc(e.message || e)}</span>`; btn.disabled = false; }
}

(async () => {
  if (!token) { root.innerHTML = '<div class="card err">Link incompleto. Use o link enviado pela Unidasul.</div>'; return; }
  if (await load()) render();
})();
