import { esg, $, esc, can, pct, all, suppliers, settings, avg, uniq, errBox } from './lib.js';

/* ---------- formulário genérico ---------- */
function formHTML(fields, v = {}) {
  return fields.map(([k, l, t, o]) => {
    const val = v[k] ?? '';
    const inp = t === 'bool' ? `<input type="checkbox" data-f="${k}" ${v[k] ? 'checked' : ''} style="width:auto">`
      : t === 'sel' ? `<select data-f="${k}">${o.map((x) => `<option value="${esc(x[0] ?? x)}" ${String(x[0] ?? x) === String(val) ? 'selected' : ''}>${esc(x[1] ?? x)}</option>`).join('')}</select>`
      : `<input data-f="${k}" type="${t === 'number' ? 'number' : 'text'}" ${t === 'number' ? 'step="any"' : ''} value="${esc(val)}">`;
    return `<div><label>${l}</label>${inp}</div>`;
  }).join('');
}
function readForm(root, fields) {
  const out = {};
  for (const [k, , t] of fields) {
    const el = root.querySelector(`[data-f="${k}"]`);
    out[k] = t === 'bool' ? el.checked : el.value === '' ? null : t === 'number' ? Number(el.value) : el.value;
  }
  return out;
}

/* ---------- Matriz de KPIs ---------- */
const KF = [['code', 'Código KPI', 'text'], ['name', 'Nome KPI', 'text'], ['dimension', 'Dimensão', 'sel', [['E', 'E — Ambiental'], ['S', 'S — Social'], ['G', 'G — Governança']]],
  ['category', 'Categoria', 'text'], ['description', 'Descrição', 'text'], ['weight', 'Peso', 'number'], ['min_score', 'Pontuação mínima', 'number'], ['max_score', 'Pontuação máxima', 'number'],
  ['requires_evidence', 'Exige evidência?', 'bool'], ['evidence_mandatory', 'Evidência obrigatória?', 'bool'], ['evidence_type', 'Tipo de evidência', 'text'],
  ['periodicity', 'Periodicidade', 'text'], ['validity_days', 'Validade (dias)', 'number'], ['active', 'Ativo?', 'bool'], ['sort_order', 'Ordem de exibição', 'number']];

export async function kpis(V) {
  const { data, error } = await esg().from('kpis').select('*').is('deleted_at', null).order('dimension').order('sort_order');
  if (error) { V.innerHTML = errBox(error); return; }
  const admin = can('admin');
  V.innerHTML = `<h2>Matriz de KPIs ESG</h2><p class="sub">Cadastre e edite indicadores sem alterar o código. ${admin ? '' : 'Somente leitura.'}</p>
    ${admin ? `<div class="card"><b id="kt">Novo KPI</b><div class="row" id="kf" style="margin-top:8px">${formHTML(KF, { weight: 1, min_score: 0, max_score: 1, sort_order: 0, active: true })}</div><p><button class="btn" id="ks">Salvar KPI</button> <button class="btn ghost" id="kc">Limpar</button></p></div>` : ''}
    <div class="card scroll"><table class="tbl"><thead><tr><th>Código</th><th>Nome</th><th>Dim.</th><th>Peso</th><th>Evidência</th><th>Ativo</th><th></th></tr></thead><tbody>
    ${data.map((k) => `<tr><td>${esc(k.code)} ${k.is_demo ? '<span class="tag">DEMO</span>' : ''}</td><td>${esc(k.name)}</td><td>${k.dimension}</td><td>${k.weight}</td><td>${k.requires_evidence ? (k.evidence_mandatory ? 'Obrigatória' : 'Sim') : 'Não'}</td><td>${k.active ? 'Sim' : 'Não'}</td>
    <td>${admin ? `<a href="#" data-e="${k.id}">Editar</a> · <a href="#" data-d="${k.id}">Excluir</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  if (!admin) return;
  let editing = null;
  V.querySelectorAll('[data-e]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); editing = data.find((k) => k.id === a.dataset.e); $('#kt').textContent = 'Editando ' + editing.code; $('#kf').innerHTML = formHTML(KF, editing); scrollTo(0, 0); }));
  V.querySelectorAll('[data-d]').forEach((a) => (a.onclick = async (e) => {
    e.preventDefault();
    if (!confirm('Excluir este KPI? (exclusão lógica: respostas antigas são preservadas)')) return;
    const { error: er } = await esg().from('kpis').update({ deleted_at: new Date().toISOString(), active: false }).eq('id', a.dataset.d);
    if (er) alert(er.message); else kpis(V);
  }));
  $('#kc').onclick = () => kpis(V);
  $('#ks').onclick = async () => {
    const v = readForm($('#kf'), KF);
    if (!v.code || !v.name) return alert('Código e nome são obrigatórios.');
    if (v.weight == null || v.weight < 0) return alert('Peso inválido.');
    if (v.min_score != null && v.max_score != null && v.min_score > v.max_score) return alert('Pontuação mínima maior que a máxima.');
    const { error: er } = editing ? await esg().from('kpis').update(v).eq('id', editing.id) : await esg().from('kpis').insert(v);
    if (er) alert(er.message); else kpis(V);
  };
}

/* ---------- Questionários (perguntas no banco) ---------- */
export async function questions(V) {
  const [k, q] = await Promise.all([esg().from('kpis').select('id,code,name').is('deleted_at', null).order('code'), esg().from('questions').select('*').order('sort_order')]);
  if (k.error || q.error) { V.innerHTML = errBox(k.error || q.error); return; }
  const km = new Map(k.data.map((x) => [x.id, x])), admin = can('admin');
  const QF = [['kpi_id', 'KPI', 'sel', k.data.map((x) => [x.id, x.code + ' · ' + x.name])], ['question', 'Pergunta', 'text'], ['description', 'Descrição', 'text'],
    ['answer_type', 'Tipo de resposta', 'sel', ['sim_nao', 'sim_nao_parcial', 'numero', 'percentual', 'texto', 'data', 'selecao', 'multipla', 'upload_doc', 'upload_foto']],
    ['options_txt', 'Opções (separe com ;)', 'text'], ['required', 'Obrigatória?', 'bool'], ['active', 'Ativa?', 'bool'], ['sort_order', 'Ordem', 'number']];
  V.innerHTML = `<h2>Questionários</h2><p class="sub">As perguntas ficam no banco. Fase 1: uma pergunta ativa por KPI é usada no formulário.</p>
    ${admin ? `<div class="card"><b id="qt">Nova pergunta</b><div class="row" id="qf" style="margin-top:8px">${formHTML(QF, { answer_type: 'sim_nao_parcial', active: true, sort_order: 0 })}</div><p><button class="btn" id="qs">Salvar pergunta</button> <button class="btn ghost" id="qc">Limpar</button></p></div>` : ''}
    <div class="card scroll"><table class="tbl"><thead><tr><th>KPI</th><th>Pergunta</th><th>Tipo</th><th>Obrig.</th><th>Ativa</th><th></th></tr></thead><tbody>${q.data.map((x) => `<tr><td>${esc(km.get(x.kpi_id)?.code)}</td><td>${esc(x.question)}</td><td>${x.answer_type}</td><td>${x.required ? 'Sim' : 'Não'}</td><td>${x.active ? 'Sim' : 'Não'}</td><td>${admin ? `<a href="#" data-e="${x.id}">Editar</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  if (!admin) return;
  let editing = null;
  V.querySelectorAll('[data-e]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); editing = q.data.find((x) => x.id === a.dataset.e); $('#qt').textContent = 'Editando pergunta'; $('#qf').innerHTML = formHTML(QF, { ...editing, options_txt: (editing.options || []).join('; ') }); scrollTo(0, 0); }));
  $('#qc').onclick = () => questions(V);
  $('#qs').onclick = async () => {
    const v = readForm($('#qf'), QF);
    if (!v.question) return alert('Informe a pergunta.');
    v.options = v.options_txt ? v.options_txt.split(';').map((s) => s.trim()).filter(Boolean) : null; delete v.options_txt;
    const { error } = editing ? await esg().from('questions').update(v).eq('id', editing.id) : await esg().from('questions').insert(v);
    if (error) alert(error.message); else questions(V);
  };
}

/* ---------- Configurações (formulários, sem JSON) ---------- */
const n2 = (v) => (v === '' || v == null ? NaN : Number(v));
const pc = (x) => Math.round(Number(x) * 10000) / 100;      // 0.5 -> 50
const card = (title, help, body, id) => `<div class="card"><b>${title}</b><p class="sub">${help}</p>${body}<p><button class="btn" data-save="${id}">Salvar</button> <span class="sub" id="ok_${id}"></span></p></div>`;
const num = (id, label, v, extra = '') => `<div><label for="${id}">${label}</label><input id="${id}" type="number" step="any" value="${esc(v)}" ${extra}></div>`;

export async function config(V) {
  V.innerHTML = '<h2>Configurações</h2><p class="sub">Carregando…</p>';
  let cfg;
  try { cfg = await settings(true); } catch (e) { V.innerHTML = errBox(e); return; }
  const w = cfg.dimension_weights || { E: 35, S: 35, G: 30 }, a = cfg.answer_scores || { sim: 1, parcial: 0.5, nao: 0 };
  const f = cfg.evidence_factors || { declarado: 1, comprovado: 1, validado: 1 }, t = cfg.status_thresholds || { conforme: 80, acompanhamento: 60, plano_acao: 40 };
  const d = cfg.expiry_alert_days || [90, 30], evOn = ['declarado', 'comprovado', 'validado'].some((k) => Number(f[k]) !== 1);
  V.innerHTML = `<h2>Configurações</h2><p class="sub">Tudo que afeta o score e os alertas. Os pesos de cada indicador ficam na tela <a href="#/kpis">KPIs ESG</a>. Valores iniciais são provisórios (DEMO): a Unidasul define os oficiais.</p>
    ${card('Peso de cada dimensão no score geral', 'O sistema converte em percentual automaticamente (não precisa somar 100).',
      `<div class="row">${num('w_E', 'E — Ambiental', w.E, 'min="0"')}${num('w_S', 'S — Social', w.S, 'min="0"')}${num('w_G', 'G — Governança', w.G, 'min="0"')}</div><p class="sub" id="wsum"></p>`, 'w')}
    ${card('Pontuação de cada resposta', 'Quantos % dos pontos do indicador a resposta vale. "Não informado" e "Não aplicável" ficam fora do cálculo (não viram zero).',
      `<div class="row">${num('a_sim', 'Sim (%)', pc(a.sim), 'min="0" max="100"')}${num('a_parcial', 'Parcial (%)', pc(a.parcial), 'min="0" max="100"')}${num('a_nao', 'Não (%)', pc(a.nao), 'min="0" max="100"')}</div>`, 'a')}
    ${card('Qualidade da evidência no score', 'Desmarcado: a resposta vale o mesmo com ou sem evidência. Marcado: o valor da resposta é multiplicado conforme o nível da evidência. O score de cada dimensão é limitado a 100%.',
      `<label style="font-weight:400"><input type="checkbox" id="ev_on" style="width:auto" ${evOn ? 'checked' : ''}> Considerar a qualidade da evidência no score</label>
       <div class="row" id="ev_box" style="${evOn ? '' : 'display:none'}">${num('ev_declarado', 'Declarado (%)', pc(f.declarado), 'min="0"')}${num('ev_comprovado', 'Comprovado (%)', pc(f.comprovado), 'min="0"')}${num('ev_validado', 'Validado (%)', pc(f.validado), 'min="0"')}</div>`, 'ev')}
    ${card('Classificação do fornecedor', 'Score mínimo para cada status. Abaixo da última faixa o fornecedor fica Crítico.',
      `<div class="row">${num('t_conforme', '🟢 Conforme a partir de (%)', t.conforme, 'min="0" max="100"')}${num('t_acompanhamento', '🟡 Em acompanhamento a partir de (%)', t.acompanhamento, 'min="0" max="100"')}${num('t_plano', '🟠 Plano de ação a partir de (%)', t.plano_acao, 'min="0" max="100"')}</div>`, 't')}
    ${card('Alertas de vencimento de documentos', 'Quantos dias antes do vencimento o documento muda de cor.',
      `<div class="row">${num('d_medio', '🟡 Alerta amarelo: vence em até (dias)', d[0], 'min="1"')}${num('d_curto', '🟠 Alerta laranja: vence em até (dias)', d[1], 'min="1"')}</div>`, 'd')}
    ${card('Evidências', 'Limite de tamanho por arquivo e tipos de evidência disponíveis (um por linha).',
      `<div class="row">${num('u_mb', 'Tamanho máximo por arquivo (MB)', cfg.max_upload_mb ?? 20, 'min="1"')}<div style="flex-basis:100%"><label for="u_types">Tipos de evidência</label><textarea id="u_types" rows="5">${esc((cfg.evidence_types || []).join('\n'))}</textarea></div></div>`, 'u')}
    ${card('Lembretes', 'Intervalo padrão até o próximo lembrete ao fornecedor.', `<div class="row">${num('r_days', 'Dias entre lembretes', cfg.reminder_interval_days ?? 7, 'min="1"')}</div>`, 'r')}
    <div class="card"><b>Aplicar aos resultados já calculados</b><p class="sub">Mudanças de peso, pontuação, evidência e cobertura só valem para novos cálculos. Este botão recalcula todas as avaliações com a configuração atual (o histórico de cálculos anteriores é mantido).</p>
      <button class="btn" id="recalc">Recalcular todos os scores agora</button> <span class="sub" id="ok_recalc"></span></div>`;

  const val = (id) => n2($('#' + id).value);
  const sumTxt = () => { const e = val('w_E'), s = val('w_S'), g = val('w_G'), t = e + s + g;
    $('#wsum').textContent = t > 0 ? `Resultado: E ${(100 * e / t).toFixed(1)}% · S ${(100 * s / t).toFixed(1)}% · G ${(100 * g / t).toFixed(1)}%` : ''; };
  ['w_E', 'w_S', 'w_G'].forEach((i) => ($('#' + i).oninput = sumTxt)); sumTxt();
  $('#ev_on').onchange = () => ($('#ev_box').style.display = $('#ev_on').checked ? '' : 'none');

  const BUILD = {
    w: () => { const v = { E: val('w_E'), S: val('w_S'), G: val('w_G') };
      if (Object.values(v).some((x) => !(x >= 0)) || v.E + v.S + v.G <= 0) return 'Informe os três pesos (zero ou mais), com soma maior que zero.'; return ['dimension_weights', v]; },
    a: () => { const v = { sim: val('a_sim'), parcial: val('a_parcial'), nao: val('a_nao') };
      if (Object.values(v).some((x) => !(x >= 0 && x <= 100))) return 'Cada pontuação deve estar entre 0 e 100.'; return ['answer_scores', { sim: v.sim / 100, parcial: v.parcial / 100, nao: v.nao / 100 }]; },
    ev: () => { if (!$('#ev_on').checked) return ['evidence_factors', { declarado: 1, comprovado: 1, validado: 1 }];
      const v = { declarado: val('ev_declarado'), comprovado: val('ev_comprovado'), validado: val('ev_validado') };
      if (Object.values(v).some((x) => !(x >= 0))) return 'Informe os três percentuais (zero ou mais).'; return ['evidence_factors', { declarado: v.declarado / 100, comprovado: v.comprovado / 100, validado: v.validado / 100 }]; },
    t: () => { const v = { conforme: val('t_conforme'), acompanhamento: val('t_acompanhamento'), plano_acao: val('t_plano') };
      if (Object.values(v).some((x) => !(x >= 0 && x <= 100)) || !(v.conforme > v.acompanhamento && v.acompanhamento > v.plano_acao)) return 'Use faixas entre 0 e 100 em ordem decrescente: Conforme > Em acompanhamento > Plano de ação.'; return ['status_thresholds', v]; },
    d: () => { const m = val('d_medio'), c = val('d_curto');
      if (!(Number.isInteger(m) && Number.isInteger(c) && c >= 1 && m > c)) return 'Informe dias inteiros, com o alerta amarelo maior que o laranja.'; return ['expiry_alert_days', [m, c]]; },
    u: () => { const mb = val('u_mb'), types = $('#u_types').value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!(mb >= 1)) return 'O tamanho máximo deve ser de ao menos 1 MB.'; if (!types.length) return 'Informe ao menos um tipo de evidência.'; return [['max_upload_mb', mb], ['evidence_types', types]]; },
    r: () => { const v = val('r_days'); if (!(Number.isInteger(v) && v >= 1)) return 'Informe um número inteiro de dias (1 ou mais).'; return ['reminder_interval_days', v]; },
  };
  V.querySelectorAll('[data-save]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.save, r = BUILD[id](), msg = $('#ok_' + id);
    if (typeof r === 'string') { msg.className = 'err'; msg.textContent = r; return; }
    b.disabled = true;
    for (const [key, value] of Array.isArray(r[0]) ? r : [r]) {
      const { error } = await esg().from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
      if (error) { msg.className = 'err'; msg.textContent = error.message; b.disabled = false; return; }
    }
    await settings(true); b.disabled = false; msg.className = 'sub'; msg.textContent = 'Salvo ✓ (vale para novos cálculos; use "Recalcular" para aplicar aos existentes)';
  }));
  $('#recalc').onclick = async () => {
    if (!confirm('Recalcular todas as avaliações com a configuração atual?')) return;
    $('#recalc').disabled = true; $('#ok_recalc').textContent = 'Calculando…';
    const { data, error } = await esg().rpc('recalculate_all');
    $('#recalc').disabled = false; $('#ok_recalc').className = error ? 'err' : 'sub'; $('#ok_recalc').textContent = error ? error.message : `${data} avaliações recalculadas ✓`;
  };
}

/* ---------- Destaques ESG ---------- */
const METRICS = [['score_total', 'Score ESG geral'], ['score_e', 'Ambiental (E)'], ['score_s', 'Social (S)'], ['score_g', 'Governança (G)'], ['cov_questionnaire', 'Cobertura do questionário'], ['cov_evidence', 'Cobertura de evidências'], ['cov_validated', 'Cobertura validada'], ['evolution', 'Evolução em relação ao ciclo anterior']];
const DEFAULT_LABEL = { score_total: 'Maior score ESG', score_e: 'Destaque ambiental', score_s: 'Destaque social', score_g: 'Destaque governança', cov_questionnaire: 'Maior cobertura do questionário', cov_evidence: 'Maior cobertura de evidências', cov_validated: 'Maior cobertura validada', evolution: 'Maior evolução' };
export async function highlights(V) {
  V.innerHTML = '<h2>Destaques ESG Unidasul</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, hist, cfg] = await Promise.all([suppliers(), all(() => esg().from('v_history').select('*').order('assessment_id')), settings(true)]);
    const hc = cfg.highlight_criteria || { criteria: [], limit: 3 };
    const year = hc.year || Math.max(0, ...hist.map((h) => h.cycle_year));
    const cur = hist.filter((h) => h.cycle_year === year && h.score_total != null && (h.cov_questionnaire ?? 0) >= (hc.min_coverage || 0));
    const prev = (sid) => hist.filter((h) => h.supplier_id === sid && h.cycle_year < year).sort((a, b) => b.cycle_year - a.cycle_year)[0];
    const val = (h, m) => (m === 'evolution' ? (prev(h.supplier_id) ? h.score_total - prev(h.supplier_id).score_total : null) : h[m]);
    const cards = hc.criteria.map((c) => {
      const top = cur.map((h) => ({ h, v: val(h, c.metric) })).filter((x) => x.v != null).sort((a, b) => b.v - a.v).slice(0, hc.limit || 3);
      return `<div class="card"><b>🏅 ${esc(c.label)}</b>${top.length ? '<ol>' + top.map((x) => `<li>${esc(sup.get(x.h.supplier_id)?.company_name)} ${sup.get(x.h.supplier_id)?.is_demo ? '<span class="tag">DEMO</span>' : ''} — ${c.metric === 'evolution' ? (x.v >= 0 ? '+' : '') + x.v.toFixed(1).replace('.', ',') + ' p.p.' : pct(x.v)}</li>`).join('') + '</ol>' : '<p class="sub">Sem dados suficientes para este critério.</p>'}</div>`;
    }).join('');
    V.innerHTML = `<div class="noprint"><h2>Destaques ESG Unidasul</h2><p class="sub">Ranking do ciclo ${year}. Critérios, período e cobertura mínima são configuráveis.</p></div>
      <h2 style="display:none" class="printonly">FORNECEDOR DESTAQUE ESG — ${year}</h2>${cards || '<div class="card">Nenhum critério configurado.</div>'}
      <div class="noprint"><button class="btn ghost" onclick="window.print()">Imprimir reconhecimento</button></div>
      ${can('admin') ? `<div class="card noprint" style="margin-top:16px"><b>Configurar destaques</b><p class="sub">Escolha o ciclo, quantos fornecedores aparecem por ranking e quais rankings exibir.</p>
        <div class="row"><div><label>Ciclo (vazio = mais recente)</label><input id="hy" type="number" value="${hc.year ?? ''}"></div><div><label>Quantos por ranking</label><input id="hl" type="number" min="1" value="${hc.limit || 3}"></div><div><label>Cobertura mínima do questionário (%)</label><input id="hm" type="number" min="0" max="100" value="${hc.min_coverage || 0}"></div></div>
        <table class="tbl" style="margin-top:10px"><thead><tr><th>Exibir</th><th>Ranking</th><th>Título na tela</th></tr></thead><tbody>${METRICS.map(([m, l]) => { const c = hc.criteria.find((x) => x.metric === m); return `<tr><td><input type="checkbox" data-m="${m}" ${c ? 'checked' : ''} style="width:auto"></td><td>${l}</td><td><input data-l="${m}" value="${esc(c?.label || DEFAULT_LABEL[m])}"></td></tr>`; }).join('')}</tbody></table>
        <p><button class="btn" id="hsv">Salvar destaques</button></p></div>` : ''}`;
    const sv = $('#hsv');
    if (sv) sv.onclick = async () => {
      const limit = Number($('#hl').value), minc = Number($('#hm').value || 0), y = $('#hy').value === '' ? null : Number($('#hy').value);
      if (!(limit >= 1) || !(minc >= 0 && minc <= 100)) return alert('Informe quantidade (1 ou mais) e cobertura entre 0 e 100.');
      const criteria = METRICS.filter(([m]) => V.querySelector(`[data-m="${m}"]`).checked).map(([m]) => ({ key: 'top_' + m, label: V.querySelector(`[data-l="${m}"]`).value.trim() || DEFAULT_LABEL[m], metric: m }));
      const { error } = await esg().from('settings').update({ value: { year: y, limit, min_coverage: minc, criteria }, updated_at: new Date().toISOString() }).eq('key', 'highlight_criteria');
      if (error) alert(error.message); else highlights(V);
    };
  } catch (e) { V.innerHTML = errBox(e); }
}
