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

/* ---------- Configurações ---------- */
function validateSetting(key, v) {
  if (key === 'dimension_weights') { if (!['E', 'S', 'G'].every((d) => typeof v[d] === 'number' && v[d] >= 0) || v.E + v.S + v.G <= 0) return 'Informe E, S e G numéricos (≥ 0) com soma maior que 0.'; }
  if (key === 'status_thresholds') { if (!(v.conforme > v.acompanhamento && v.acompanhamento > v.plano_acao)) return 'Use conforme > acompanhamento > plano_acao.'; }
  if (key === 'evidence_factors') { if (!['declarado', 'comprovado', 'validado'].every((d) => typeof v[d] === 'number' && v[d] >= 0)) return 'Informe fatores numéricos (≥ 0) para declarado, comprovado e validado.'; }
  if (key === 'answer_scores') { if (!['sim', 'parcial', 'nao'].every((d) => typeof v[d] === 'number' && v[d] >= 0 && v[d] <= 1)) return 'Pontuações de sim/parcial/nao devem estar entre 0 e 1.'; }
  return null;
}
export async function config(V) {
  const { data, error } = await esg().from('settings').select('*').order('key');
  if (error) { V.innerHTML = errBox(error); return; }
  V.innerHTML = `<h2>Configurações</h2><p class="sub">Tudo que afeta score, classificação e alertas fica aqui, sem mexer no código. Valores marcados DEMO são provisórios.</p>` +
    data.map((s) => `<div class="card"><b>${esc(s.key)}</b><p class="sub">${esc(s.description || '')}</p><textarea data-s="${esc(s.key)}" rows="${Math.min(10, JSON.stringify(s.value, null, 2).split('\n').length + 1)}" style="width:100%;font-family:monospace">${esc(JSON.stringify(s.value, null, 2))}</textarea><p><button class="btn" data-k="${esc(s.key)}">Salvar</button></p></div>`).join('');
  V.querySelectorAll('[data-k]').forEach((b) => (b.onclick = async () => {
    let v; try { v = JSON.parse(V.querySelector(`[data-s="${b.dataset.k}"]`).value); } catch { return alert('JSON inválido.'); }
    const bad = validateSetting(b.dataset.k, v); if (bad) return alert(bad);
    const { error: er } = await esg().from('settings').update({ value: v, updated_at: new Date().toISOString() }).eq('key', b.dataset.k);
    if (er) alert(er.message); else { await settings(true); b.textContent = 'Salvo ✓'; setTimeout(() => (b.textContent = 'Salvar'), 1500); }
  }));
}

/* ---------- Destaques ESG ---------- */
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
      ${can('admin') ? `<div class="card noprint" style="margin-top:16px"><b>Critérios (JSON)</b><p class="sub">year: ciclo (null = mais recente) · limit: quantos por critério · min_coverage: cobertura mínima do questionário · metric: score_total, score_e, score_s, score_g, cov_questionnaire, cov_evidence, cov_validated ou evolution.</p><textarea id="hj" rows="14" style="width:100%;font-family:monospace">${esc(JSON.stringify(hc, null, 2))}</textarea><p><button class="btn" id="hsv">Salvar critérios</button></p></div>` : ''}`;
    const sv = $('#hsv');
    if (sv) sv.onclick = async () => {
      let v; try { v = JSON.parse($('#hj').value); } catch { return alert('JSON inválido.'); }
      if (!Array.isArray(v.criteria)) return alert('Informe a lista "criteria".');
      const { error } = await esg().from('settings').update({ value: v, updated_at: new Date().toISOString() }).eq('key', 'highlight_criteria');
      if (error) alert(error.message); else highlights(V);
    };
  } catch (e) { V.innerHTML = errBox(e); }
}
