import { sb, esg, core, $, esc, state, can, pct, fdate, STATE_LABEL, EV_LABEL, VALID_LABEL, STATUS_LABEL, ASSESS_LABEL,
  all, suppliers, chart, evActions, bindEvActions, settings, classify, avg, uniq, options, latestPer, errBox } from './lib.js';

const card = (label, val, cls = '') => `<div class="stat ${cls}"><b>${val}</b>${label}</div>`;
const OPEN = (p) => !['resolvida', 'cancelada'].includes(p.status);

/* ================= DASHBOARD ================= */
export async function dashboard(V) {
  V.innerHTML = '<h2>Dashboard executivo</h2><p class="sub">Carregando…</p>';
  let D;
  try {
    const [sup, hist, evs, pend, ass, camps, cfg] = await Promise.all([
      suppliers(), all(() => esg().from('v_history').select('*').order('assessment_id')),
      all(() => esg().from('v_evidence_validity').select('id,status,validity_status,supplier_id').order('id')),
      all(() => esg().from('pendencias').select('id,status,supplier_id').order('id')),
      all(() => esg().from('assessments').select('id,status,supplier_id,campaign_id').order('id')),
      all(() => esg().from('campaigns').select('id,name,end_date,status').order('id')), settings()]);
    D = { sup, hist, evs, pend, ass, camps, cfg };
  } catch (e) { V.innerHTML = errBox(e); return; }
  const list = [...D.sup.values()];
  const F = { demo: !list.some((s) => !s.is_demo), year: '', buyer: '', cat: '', grp: '' };

  const draw = () => {
    const S = list.filter((s) => (F.demo || !s.is_demo) && (!F.cat || s.category === F.cat) && (!F.grp || s.supplier_group === F.grp));
    const ids = new Set(S.map((s) => s.id));
    const H = D.hist.filter((h) => ids.has(h.supplier_id));
    const cur = F.year ? new Map(H.filter((h) => String(h.cycle_year) === F.year).map((h) => [h.supplier_id, h])) : latestPer(H);
    const R = [...cur.values()].filter((h) => h.score_total != null);
    const th = D.cfg.status_thresholds;
    const E = D.evs.filter((e) => ids.has(e.supplier_id));
    const A = D.ass.filter((a) => ids.has(a.supplier_id));
    const done = A.filter((a) => ['enviada', 'em_validacao', 'concluida'].includes(a.status)).length;
    const nPend = D.pend.filter((p) => ids.has(p.supplier_id) && OPEN(p)).length;
    const near = E.filter((e) => ['vence_30', 'vence_90'].includes(e.validity_status)).length, exp = E.filter((e) => e.validity_status === 'vencido').length;
    const st = { conforme: 0, em_acompanhamento: 0, plano_de_acao: 0, critico: 0 };
    R.forEach((h) => st[classify(Number(h.score_total), th)]++);

    const group = (key) => {
      const g = new Map();
      S.forEach((s) => { const k = s[key] || '(sem informação)'; if (!g.has(k)) g.set(k, []); g.get(k).push(s); });
      return [...g.entries()].sort().map(([k, ss]) => {
        const rs = ss.map((s) => cur.get(s.id)).filter((h) => h && h.score_total != null);
        return `<tr><td>${esc(k)}</td><td>${ss.length}</td><td>${rs.length}</td><td>${pct(avg(rs.map((h) => h.score_total)))}</td><td>${pct(avg(rs.map((h) => h.score_e)))}</td><td>${pct(avg(rs.map((h) => h.score_s)))}</td><td>${pct(avg(rs.map((h) => h.score_g)))}</td><td>${rs.filter((h) => classify(Number(h.score_total), th) === 'critico').length}</td><td>${ss.length - rs.length}</td></tr>`;
      }).join('');
    };
    const head = (t) => `<table class="tbl"><thead><tr><th>${t}</th><th>Fornec.</th><th>Avaliados</th><th>ESG</th><th>E</th><th>S</th><th>G</th><th>Críticos</th><th>Sem avaliação</th></tr></thead><tbody>`;
    const today = new Date(), soon = D.camps.filter((c) => c.status === 'ativa' && c.end_date && (new Date(c.end_date) - today) / 864e5 <= 15 && new Date(c.end_date) >= today);
    const alerts = [
      exp && `🔴 ${exp} documento(s) vencido(s)`, near && `🟠 ${near} documento(s) vencendo em até 90 dias`, nPend && `🟡 ${nPend} pendência(s) aberta(s)`,
      A.filter((a) => a.status === 'em_andamento').length && `🟡 ${A.filter((a) => a.status === 'em_andamento').length} avaliação(ões) incompleta(s)`,
      A.filter((a) => a.status === 'nao_iniciada').length && `⚪ ${A.filter((a) => a.status === 'nao_iniciada').length} fornecedor(es) sem resposta`,
      ...soon.map((c) => `⏰ Campanha "${esc(c.name)}" encerra em ${fdate(c.end_date)}`)].filter(Boolean);

    V.innerHTML = `<h2>Dashboard executivo</h2><p class="sub">Visão geral do programa ESG de fornecedores.</p>
      <div class="card"><div class="row">
        <div><label>Ano/ciclo</label><select id="fy">${options(uniq(D.hist.map((h) => h.cycle_year)), F.year, 'Mais recente')}</select></div>
        <div><label>Categoria</label><select id="fc">${options(uniq(list.map((s) => s.category)), F.cat, 'Todas')}</select></div>
        <div><label>Grupo</label><select id="fg">${options(uniq(list.map((s) => s.supplier_group)), F.grp, 'Todos')}</select></div>
        <div><label><input type="checkbox" id="fd" ${F.demo ? 'checked' : ''} style="width:auto"> Incluir dados DEMO</label></div></div></div>
      <div class="stats">${card('Fornecedores', S.length)}${card('Avaliados', R.length, 'ok')}${card('Pendentes', S.length - R.length, 'warn')}${card('Taxa de adesão', pct(A.length ? 100 * done / A.length : null))}
        ${card('Índice ESG médio', pct(avg(R.map((h) => h.score_total))))}${card('Ambiental', pct(avg(R.map((h) => h.score_e))))}${card('Social', pct(avg(R.map((h) => h.score_s))))}${card('Governança', pct(avg(R.map((h) => h.score_g))))}
        ${card('Evidências validadas', E.filter((e) => e.status === 'validada').length, 'ok')}${card('Evidências pendentes', E.filter((e) => e.status === 'pendente').length, 'warn')}${card('Docs a vencer', near, 'warn')}${card('Docs vencidos', exp, 'bad')}</div>
      <div class="card"><b>Alertas</b>${alerts.length ? '<ul>' + alerts.map((a) => `<li>${a}</li>`).join('') + '</ul>' : '<p class="sub">Nenhum alerta no momento.</p>'}</div>
      <div class="row"><div class="card"><b>Evolução do programa</b><canvas id="ch1" height="160"></canvas></div>
        <div class="card"><b>Status ESG (classificação operacional)</b><canvas id="ch2" height="160"></canvas><p class="sub">Sem avaliação: ${S.length - R.length}</p></div></div>
      <div class="card scroll"><b>Por categoria</b>${head('Categoria')}${group('category')}</tbody></table></div>`;

    const yrs = uniq(H.map((h) => h.cycle_year));
    const by = (f) => yrs.map((y) => avg(H.filter((h) => h.cycle_year === y).map((h) => h[f])));
    chart('ch1', { type: 'line', data: { labels: yrs, datasets: [{ label: 'ESG', data: by('score_total'), borderColor: '#1f5d46' }, { label: 'E', data: by('score_e'), borderColor: '#4c9a2a' }, { label: 'S', data: by('score_s'), borderColor: '#c98a1b' }, { label: 'G', data: by('score_g'), borderColor: '#2a5d9a' }] }, options: { scales: { y: { min: 0, max: 100 } } } });
    chart('ch2', { type: 'doughnut', data: { labels: ['Conforme', 'Em acompanhamento', 'Plano de ação', 'Crítico'], datasets: [{ data: Object.values(st), backgroundColor: ['#1f7a4d', '#e0b400', '#d9822b', '#b3261e'] }] } });
    const bind = (id, k) => ($(id).onchange = (e) => { F[k] = e.target.value; draw(); });
    bind('#fy', 'year'); bind('#fc', 'cat'); bind('#fg', 'grp');
    $('#fd').onchange = (e) => { F.demo = e.target.checked; draw(); };
  };
  draw();
}

/* ================= FICHA DO FORNECEDOR ================= */
export async function supplierPage(V, id) {
  V.innerHTML = '<p class="sub">Carregando…</p>';
  try {
    const sup = (await suppliers()).get(id);
    if (!sup) { V.innerHTML = errBox('Fornecedor não encontrado ou sem acesso.'); return; }
    const [hist, evs, pend, ass, camps, cfg] = await Promise.all([
      esg().from('v_history').select('*').eq('supplier_id', id).order('cycle_year', { ascending: false }),
      esg().from('v_evidence_validity').select('*').eq('supplier_id', id), esg().from('pendencias').select('*').eq('supplier_id', id).order('created_at', { ascending: false }),
      esg().from('assessments').select('*').eq('supplier_id', id), esg().from('campaigns').select('id,name,cycle_year,status'), settings()]);
    const h = (hist.data || [])[0], E = evs.data || [], P = pend.data || [], AS = ass.data || [];
    const cn = new Map((camps.data || []).map((c) => [c.id, c]));
    const free = (camps.data || []).filter((c) => c.status === 'ativa' && !AS.some((a) => a.campaign_id === c.id));
    const cnt = (v) => E.filter((e) => e.validity_status === v).length;
    const last = AS.slice().sort((a, b) => (b.cycle_year - a.cycle_year))[0];
    V.innerHTML = `<h2>${esc(sup.company_name)} ${sup.is_demo ? '<span class="tag">DEMO</span>' : ''}</h2>
      <p class="sub">CNPJ ${esc(sup.cnpj || '—')} · Código ${esc(sup.supplier_code || '—')} · ${esc(sup.category || 'sem categoria')}${sup.email ? ' · ' + esc(sup.email) : ''}</p>
      <div class="card"><b>Status ESG:</b> ${STATUS_LABEL[classify(h ? Number(h.score_total) : null, cfg.status_thresholds)]}
        <div class="stats">${card('Score ESG', pct(h?.score_total))}${card('Ambiental', pct(h?.score_e))}${card('Social', pct(h?.score_s))}${card('Governança', pct(h?.score_g))}
        ${card('Indicadores respondidos', pct(h?.cov_questionnaire))}${card('Evidências apresentadas', pct(h?.cov_evidence))}${card('Evidências validadas', pct(h?.cov_validated))}</div></div>
      <div class="card"><b>Documentação</b><div class="stats">${card('Válidos', cnt('valido') + cnt('sem_validade'), 'ok')}${card('Vencem em breve', cnt('vence_30') + cnt('vence_90'), 'warn')}${card('Vencidos', cnt('vencido'), 'bad')}</div></div>
      <div class="card"><b>Ações</b><div class="row" style="margin-top:8px">
        ${can('admin', 'gestor') ? `<select id="nc"><option value="">Iniciar avaliação em…</option>${free.map((c) => `<option value="${c.id}" data-y="${c.cycle_year}">${esc(c.name)}</option>`).join('')}</select>` : ''}
        ${last ? `<a class="btn ghost" href="#/avaliacao/${last.id}">Ver questionário / evidências</a>` : ''}
        ${can('admin') ? `<a class="btn ghost" href="#/fornecedor-editar/${id}">Editar cadastro</a>` : ''}<a class="btn ghost" href="#/historico/${id}">Ver histórico</a><a class="btn" href="#/relatorio/${id}">Gerar relatório</a></div></div>
      <div class="card scroll"><b>Pendências</b>${P.length ? `<table class="tbl"><tbody>${P.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.status)}</td><td>${fdate(p.due_date)}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">Nenhuma pendência.</p>'}</div>
      <div class="card scroll"><b>Histórico de avaliações</b>${(hist.data || []).length ? `<table class="tbl"><thead><tr><th>Ciclo</th><th>Campanha</th><th>ESG</th><th>E</th><th>S</th><th>G</th><th>Cobertura</th></tr></thead><tbody>${hist.data.map((x) => `<tr><td>${x.cycle_year}</td><td>${esc(cn.get(x.campaign_id)?.name)}</td><td>${pct(x.score_total)}</td><td>${pct(x.score_e)}</td><td>${pct(x.score_s)}</td><td>${pct(x.score_g)}</td><td>${pct(x.cov_questionnaire)}</td></tr>`).join('')}</tbody></table>` : '<p class="sub">Sem avaliações ainda.</p>'}</div>`;
    const nc = $('#nc');
    if (nc) nc.onchange = async () => {
      if (!nc.value) return;
      const { data, error } = await esg().from('assessments').insert({ campaign_id: nc.value, supplier_id: id, cycle_year: Number(nc.selectedOptions[0].dataset.y) }).select('id').single();
      if (error) return alert(error.message);
      location.hash = '#/avaliacao/' + data.id;
    };
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ================= AVALIAÇÕES ================= */
export async function assessments(V) {
  V.innerHTML = '<h2>Avaliações</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, ass, hist, camps] = await Promise.all([suppliers(), all(() => esg().from('assessments').select('*').order('id')), all(() => esg().from('v_history').select('assessment_id,score_total,cov_questionnaire').order('assessment_id')), all(() => esg().from('campaigns').select('id,name').order('id'))]);
    const hm = new Map(hist.map((h) => [h.assessment_id, h])), cm = new Map(camps.map((c) => [c.id, c.name]));
    const draw = () => {
      const q = ($('#aq')?.value || '').toLowerCase(), st = $('#as')?.value || '';
      const rows = ass.filter((a) => (!st || a.status === st) && (!q || (sup.get(a.supplier_id)?.company_name || '').toLowerCase().includes(q)));
      $('#alist').innerHTML = `<table class="tbl"><thead><tr><th>Fornecedor</th><th>Campanha</th><th>Ciclo</th><th>Status</th><th>ESG</th><th>Cobertura</th></tr></thead><tbody>${rows.slice(0, 300).map((a) => `<tr><td><a href="#/avaliacao/${a.id}">${esc(sup.get(a.supplier_id)?.company_name)}</a></td><td>${esc(cm.get(a.campaign_id))}</td><td>${a.cycle_year}</td><td>${ASSESS_LABEL[a.status]}</td><td>${pct(hm.get(a.id)?.score_total)}</td><td>${pct(hm.get(a.id)?.cov_questionnaire)}</td></tr>`).join('')}</tbody></table>`;
    };
    V.innerHTML = `<h2>Avaliações</h2><p class="sub">Todas as avaliações por campanha e ciclo.</p><div class="card"><div class="row"><div><label>Buscar fornecedor</label><input id="aq"></div><div><label>Status</label><select id="as"><option value="">Todos</option>${Object.entries(ASSESS_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div></div><div class="card scroll" id="alist"></div>`;
    $('#aq').oninput = draw; $('#as').onchange = draw; draw();
  } catch (e) { V.innerHTML = errBox(e); }
}

const EXTS = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];
export async function assessmentPage(V, id) {
  V.innerHTML = '<p class="sub">Carregando…</p>';
  try {
    const { data: a, error } = await esg().from('assessments').select('*').eq('id', id).single();
    if (error) throw error;
    const sup = (await suppliers()).get(a.supplier_id);
    const [kp, qs, an, ev, hs, cfg] = await Promise.all([
      esg().from('kpis').select('*').eq('active', true).is('deleted_at', null).order('dimension').order('sort_order'),
      esg().from('questions').select('*').eq('active', true).order('sort_order'), esg().from('answers').select('*').eq('assessment_id', id),
      esg().from('v_evidence_validity').select('*').eq('assessment_id', id), esg().from('v_history').select('*').eq('assessment_id', id).maybeSingle(), settings()]);
    const qm = new Map(); (qs.data || []).forEach((q) => { if (!qm.has(q.kpi_id)) qm.set(q.kpi_id, q); });
    const am = new Map((an.data || []).map((x) => [x.kpi_id, x])), h = hs.data, edit = can('admin', 'gestor');
    const types = cfg.evidence_types || [];
    V.innerHTML = `<p><a href="#/fornecedor/${a.supplier_id}">← ${esc(sup?.company_name)}</a></p><h2>Avaliação ${a.cycle_year}</h2>
      <div class="card"><div class="row"><div><b>Status:</b> ${edit ? `<select id="ast">${Object.entries(ASSESS_LABEL).map(([k, v]) => `<option value="${k}" ${k === a.status ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ASSESS_LABEL[a.status]}</div>
        <div><b>Classificação:</b> ${STATUS_LABEL[classify(h ? Number(h.score_total) : null, cfg.status_thresholds)]}</div></div>
        <div class="stats">${card('Score ESG', pct(h?.score_total))}${card('E', pct(h?.score_e))}${card('S', pct(h?.score_s))}${card('G', pct(h?.score_g))}${card('Cobertura', pct(h?.cov_questionnaire))}${card('Evidências', pct(h?.cov_evidence))}${card('Validadas', pct(h?.cov_validated))}</div></div>` +
      (kp.data || []).map((k) => {
        const q = qm.get(k.id), r = am.get(k.id), es = (ev.data || []).filter((e) => e.kpi_id === k.id);
        return `<div class="card"><b>[${k.dimension}] ${esc(k.code)} · ${esc(k.name)}</b><p class="sub">${esc(q?.question || k.description || '')}</p>
          <div class="row"><div><label>Resposta (declarado)</label>${edit ? `<select data-k="${k.id}" data-q="${q?.id || ''}">${Object.entries(STATE_LABEL).map(([s, l]) => `<option value="${s}" ${(r?.state || 'nao_informado') === s ? 'selected' : ''}>${l}</option>`).join('')}</select>` : STATE_LABEL[r?.state || 'nao_informado']}</div>
          <div><label>Observação</label>${edit ? `<input data-n="${k.id}" value="${esc(r?.note || '')}">` : esc(r?.note || '')}</div></div>
          ${es.map((e) => `<div style="margin-top:8px;padding-top:8px;border-top:1px dashed var(--line)">📎 ${esc(e.original_name)} · ${EV_LABEL[e.status]} · ${VALID_LABEL[e.validity_status]} ${e.valid_until ? '(até ' + fdate(e.valid_until) + ')' : ''}${e.note ? '<br><small>Obs.: ' + esc(e.note) + '</small>' : ''}<div style="margin-top:6px">${evActions(e)}</div></div>`).join('')}
          ${edit && k.requires_evidence ? `<div class="row" style="margin-top:10px"><div><label>Anexar evidência</label><input type="file" data-f="${k.id}"></div><div><label>Data do documento</label><input type="date" data-dd="${k.id}"></div><div><label>Validade</label><input type="date" data-vu="${k.id}"></div><div><label>Tipo</label><select data-t="${k.id}">${types.map((t) => `<option>${esc(t)}</option>`).join('')}</select></div><button class="btn" data-up="${k.id}">Enviar</button></div>` : ''}</div>`;
      }).join('');
    const again = () => assessmentPage(V, id);
    bindEvActions(V, again);
    const ast = $('#ast'); if (ast) ast.onchange = async () => { const { error: e } = await esg().from('assessments').update({ status: ast.value }).eq('id', id); if (e) alert(e.message); };
    V.querySelectorAll('select[data-k]').forEach((s) => (s.onchange = async () => {
      const note = V.querySelector(`[data-n="${s.dataset.k}"]`).value;
      const { error: e } = await esg().from('answers').upsert({ assessment_id: id, kpi_id: s.dataset.k, question_id: s.dataset.q || null, state: s.value, note }, { onConflict: 'assessment_id,kpi_id' });
      if (e) alert(e.message); else again();
    }));
    V.querySelectorAll('input[data-n]').forEach((i) => (i.onchange = () => V.querySelector(`select[data-k="${i.dataset.n}"]`).onchange()));
    V.querySelectorAll('[data-up]').forEach((b) => (b.onclick = async () => {
      const k = b.dataset.up, f = V.querySelector(`[data-f="${k}"]`).files[0];
      if (!f) return alert('Escolha um arquivo.');
      const ext = f.name.split('.').pop().toLowerCase();
      if (!EXTS.includes(ext)) return alert('Formato não permitido. Use: ' + EXTS.join(', '));
      if (f.size > (Number(cfg.max_upload_mb) || 20) * 1048576) return alert('Arquivo acima do limite de ' + (cfg.max_upload_mb || 20) + ' MB.');
      const path = `${a.supplier_id}/${id}/${k}/${crypto.randomUUID()}.${ext}`;
      b.disabled = true;
      const up = await sb.storage.from('evidences').upload(path, f);
      if (up.error) { b.disabled = false; return alert(up.error.message); }
      const { error: e } = await esg().from('evidences').insert({ assessment_id: id, supplier_id: a.supplier_id, kpi_id: k, evidence_type: V.querySelector(`[data-t="${k}"]`).value, original_name: f.name, storage_path: path, doc_date: V.querySelector(`[data-dd="${k}"]`).value || null, valid_until: V.querySelector(`[data-vu="${k}"]`).value || null, uploaded_by: state.profile.id });
      if (e) { b.disabled = false; return alert(e.message); }
      again();
    }));
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ================= HISTÓRICO ================= */
export async function history(V, sid) {
  V.innerHTML = '<h2>Histórico</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, hist] = await Promise.all([suppliers(), all(() => esg().from('v_history').select('*').order('assessment_id'))]);
    const ids = uniq(hist.map((h) => h.supplier_id));
    const draw = (cur) => {
      const H = hist.filter((h) => h.supplier_id === cur).sort((a, b) => a.cycle_year - b.cycle_year);
      $('#hbody').innerHTML = H.length ? `<div class="card"><canvas id="hc" height="130"></canvas></div><div class="card scroll"><table class="tbl"><thead><tr><th>Ciclo</th><th>ESG</th><th>E</th><th>S</th><th>G</th><th>Cob. questionário</th><th>Cob. evidências</th><th>Cob. validada</th></tr></thead><tbody>${H.map((x) => `<tr><td>${x.cycle_year}</td><td>${pct(x.score_total)}</td><td>${pct(x.score_e)}</td><td>${pct(x.score_s)}</td><td>${pct(x.score_g)}</td><td>${pct(x.cov_questionnaire)}</td><td>${pct(x.cov_evidence)}</td><td>${pct(x.cov_validated)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="card">Sem avaliações para este fornecedor.</div>';
      if (H.length) chart('hc', { type: 'line', data: { labels: H.map((x) => x.cycle_year), datasets: [['ESG', 'score_total', '#1f5d46'], ['E', 'score_e', '#4c9a2a'], ['S', 'score_s', '#c98a1b'], ['G', 'score_g', '#2a5d9a']].map(([l, f, c]) => ({ label: l, data: H.map((x) => x[f]), borderColor: c })) }, options: { scales: { y: { min: 0, max: 100 } } } });
    };
    V.innerHTML = `<h2>Histórico</h2><p class="sub">Ciclos anteriores nunca são sobrescritos.</p><div class="card"><label for="hs">Fornecedor</label><select id="hs">${ids.map((i) => `<option value="${i}" ${i === sid ? 'selected' : ''}>${esc(sup.get(i)?.company_name)}</option>`).join('')}</select></div><div id="hbody"></div>`;
    $('#hs').onchange = (e) => draw(e.target.value);
    if (ids.length) draw(sid && ids.includes(sid) ? sid : ids[0]);
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ================= RELATÓRIOS ================= */
export async function reportsList(V) {
  V.innerHTML = '<h2>Relatórios</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, hist] = await Promise.all([suppliers(), all(() => esg().from('v_history').select('*').order('assessment_id'))]);
    const cur = latestPer(hist);
    const draw = () => {
      const q = ($('#rq').value || '').toLowerCase();
      const rows = [...sup.values()].filter((s) => !q || (s.company_name + s.supplier_code + s.cnpj).toLowerCase().includes(q)).slice(0, 200);
      $('#rl').innerHTML = `<table class="tbl"><thead><tr><th>Fornecedor</th><th>Último ciclo</th><th>ESG</th><th></th></tr></thead><tbody>${rows.map((s) => `<tr><td>${esc(s.company_name)}</td><td>${cur.get(s.id)?.cycle_year || '—'}</td><td>${pct(cur.get(s.id)?.score_total)}</td><td><a href="#/relatorio/${s.id}">Relatório</a></td></tr>`).join('')}</tbody></table>`;
    };
    V.innerHTML = '<h2>Relatórios</h2><p class="sub">Relatório ESG por fornecedor (imprimível / salvar como PDF).</p><div class="card"><label for="rq">Buscar</label><input id="rq"></div><div class="card scroll" id="rl"></div>';
    $('#rq').oninput = draw; draw();
  } catch (e) { V.innerHTML = errBox(e); }
}

export async function report(V, id) {
  V.innerHTML = '<p class="sub">Gerando relatório…</p>';
  try {
    const s = (await suppliers()).get(id);
    if (!s) { V.innerHTML = errBox('Fornecedor não encontrado.'); return; }
    const [hist, evs, pend, cfg] = await Promise.all([esg().from('v_history').select('*').eq('supplier_id', id).order('cycle_year', { ascending: false }),
      esg().from('v_evidence_validity').select('*').eq('supplier_id', id), esg().from('pendencias').select('*').eq('supplier_id', id), settings()]);
    const H = hist.data || [], h = H[0], E = evs.data || [], P = pend.data || [];
    V.innerHTML = `<div class="noprint"><button class="btn" onclick="window.print()">Imprimir / salvar PDF</button> <a class="btn ghost" href="#/fornecedor/${id}">Voltar</a></div>
      <div class="card"><h2>Relatório ESG — ${esc(s.company_name)}</h2><p class="sub">CNPJ ${esc(s.cnpj || '—')} · Código ${esc(s.supplier_code || '—')} · Período: ${h ? 'ciclo ' + h.cycle_year : 'sem avaliação'} · Emitido em ${fdate(new Date().toISOString().slice(0, 10))}${s.is_demo ? ' · DADOS DEMO' : ''}</p>
        <div class="stats">${card('Score ESG', pct(h?.score_total))}${card('Ambiental', pct(h?.score_e))}${card('Social', pct(h?.score_s))}${card('Governança', pct(h?.score_g))}${card('Cob. questionário', pct(h?.cov_questionnaire))}${card('Cob. evidências', pct(h?.cov_evidence))}${card('Cob. validada', pct(h?.cov_validated))}</div>
        <p><b>Status ESG:</b> ${STATUS_LABEL[classify(h ? Number(h.score_total) : null, cfg.status_thresholds)]}</p></div>
      <div class="card scroll"><b>Evidências e documentos</b><table class="tbl"><thead><tr><th>Arquivo</th><th>Tipo</th><th>Status</th><th>Validade</th></tr></thead><tbody>${E.map((e) => `<tr><td>${esc(e.original_name)}</td><td>${esc(e.evidence_type)}</td><td>${EV_LABEL[e.status]}</td><td>${VALID_LABEL[e.validity_status]} ${fdate(e.valid_until)}</td></tr>`).join('') || '<tr><td colspan="4">Nenhuma evidência.</td></tr>'}</tbody></table></div>
      <div class="card scroll"><b>Pendências</b><table class="tbl"><tbody>${P.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.status)}</td></tr>`).join('') || '<tr><td>Nenhuma pendência.</td></tr>'}</tbody></table></div>
      <div class="card scroll"><b>Histórico</b><table class="tbl"><thead><tr><th>Ciclo</th><th>ESG</th><th>E</th><th>S</th><th>G</th><th>Cobertura</th></tr></thead><tbody>${H.map((x) => `<tr><td>${x.cycle_year}</td><td>${pct(x.score_total)}</td><td>${pct(x.score_e)}</td><td>${pct(x.score_s)}</td><td>${pct(x.score_g)}</td><td>${pct(x.cov_questionnaire)}</td></tr>`).join('')}</tbody></table></div>
      <div class="card"><b>Observações</b><div contenteditable="true" style="min-height:60px;border:1px dashed var(--line);padding:8px;margin-top:6px"></div></div>`;
  } catch (e) { V.innerHTML = errBox(e); }
}
