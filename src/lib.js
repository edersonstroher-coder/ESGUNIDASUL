import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
export const core = () => sb.schema('core');
export const esg = () => sb.schema('esg');
export const $ = (s) => document.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const state = { profile: null };
export const can = (...roles) => roles.includes(state.profile?.role);
export const pct = (v) => (v == null ? '—' : Number(v).toFixed(1).replace('.', ',') + '%');
export const fdate = (d) => (d ? new Date(d + (String(d).length === 10 ? 'T00:00:00' : '')).toLocaleDateString('pt-BR') : '—');
export const num = (v) => (v == null ? null : Number(v));

export const STATE_LABEL = { sim: 'Sim', nao: 'Não', parcial: 'Parcial', nao_informado: 'Não informado', nao_aplicavel: 'Não aplicável' };
export const EV_LABEL = { pendente: '🟡 Pendente de análise', validada: '🟢 Validada', reprovada: '🔴 Reprovada', correcao: '🟠 Correção solicitada', nao_aplicavel: '⚪ Não aplicável' };
export const VALID_LABEL = { valido: '🟢 Válido', vence_90: '🟡 Vence em até 90 dias', vence_30: '🟠 Vence em até 30 dias', vencido: '🔴 Vencido', sem_validade: '—' };
export const STATUS_LABEL = { conforme: '🟢 Conforme', em_acompanhamento: '🟡 Em acompanhamento', plano_de_acao: '🟠 Plano de ação', critico: '🔴 Crítico', sem_avaliacao: '⚪ Sem avaliação' };
export const ASSESS_LABEL = { nao_iniciada: 'Não iniciada', em_andamento: 'Em andamento', enviada: 'Enviada', em_validacao: 'Em validação', concluida: 'Concluída' };

// Carrega todas as linhas (paginado) de uma consulta
export async function all(build) {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await build().range(from, from + 999).abortSignal(AbortSignal.timeout(25000));
    if (error) throw new Error(/abort|timed? ?out/i.test(error.message) ? 'Tempo esgotado ao consultar o banco (25 s). Atualize a página e tente de novo.' : error.message);
    out = out.concat(data);
    if (data.length < 1000) return out;
    from += 1000;
  }
}

let _sup;
export async function suppliers(force) {
  if (!_sup || force) {
    const rows = await all(() => core().from('suppliers').select('id,supplier_code,cnpj,company_name,trade_name,buyer,category,department,supplier_group,is_demo').is('deleted_at', null).order('id'));
    _sup = new Map(rows.map((s) => [s.id, s]));
  }
  return _sup;
}

const charts = {};
export function chart(id, cfg) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  charts[id]?.destroy();
  charts[id] = new window.Chart(el, cfg);
}

export async function signedUrl(path) {
  const { data, error } = await sb.storage.from('evidences').createSignedUrl(path, 120);
  if (error) { alert('Não foi possível abrir o arquivo: ' + error.message); return null; }
  return data.signedUrl;
}

// Decisão de validação (reprovar/correção exigem justificativa: também garantido por CHECK no banco)
export async function decide(evidenceId, decision) {
  let justification = null;
  if (decision === 'reprovada' || decision === 'correcao') {
    justification = prompt(decision === 'reprovada' ? 'Justificativa da reprovação (obrigatória):' : 'O que o fornecedor precisa corrigir? (obrigatório)');
    if (!justification || !justification.trim()) { alert('Justificativa obrigatória.'); return false; }
  }
  const { error } = await esg().from('evidence_validations').insert({ evidence_id: evidenceId, decision, justification });
  if (error) { alert('Erro: ' + error.message); return false; }
  return true;
}

export function evActions(e) {
  if (!can('admin', 'gestor', 'validador')) return '';
  return `<button class="btn ghost" data-open="${esc(e.storage_path)}">Abrir</button> ` +
    ['validada', 'correcao', 'reprovada'].map((d) => `<button class="btn ghost" data-dec="${d}" data-ev="${e.id}">${{ validada: 'Validar', correcao: 'Pedir correção', reprovada: 'Reprovar' }[d]}</button>`).join(' ');
}
export function bindEvActions(root, after) {
  root.querySelectorAll('[data-open]').forEach((b) => (b.onclick = async () => { const u = await signedUrl(b.dataset.open); if (u) window.open(u, '_blank'); }));
  root.querySelectorAll('[data-dec]').forEach((b) => (b.onclick = async () => { if (await decide(b.dataset.ev, b.dataset.dec)) after(); }));
}

let _cfg;
export async function settings(force) {
  if (!_cfg || force) {
    const { data, error } = await esg().from('settings').select('key,value').abortSignal(AbortSignal.timeout(25000));
    if (error) throw new Error(/abort|timed? ?out/i.test(error.message) ? 'Tempo esgotado ao consultar o banco (25 s). Atualize a página e tente de novo.' : error.message);
    _cfg = Object.fromEntries(data.map((r) => [r.key, r.value]));
  }
  return _cfg;
}
// Classificação operacional a partir das faixas em esg.settings (mesma regra de esg.classify)
export function classify(total, th) {
  if (total == null) return 'sem_avaliacao';
  if (total >= th.conforme) return 'conforme';
  if (total >= th.acompanhamento) return 'em_acompanhamento';
  if (total >= th.plano_acao) return 'plano_de_acao';
  return 'critico';
}
export const avg = (a) => { const v = a.filter((x) => x != null).map(Number); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const uniq = (a) => [...new Set(a.filter(Boolean))].sort();
export const options = (arr, sel, all) => (all ? `<option value="">${all}</option>` : '') + arr.map((v) => `<option ${String(v) === String(sel) ? 'selected' : ''}>${esc(v)}</option>`).join('');
export function latestPer(hist) {
  const m = new Map();
  for (const h of hist) { const c = m.get(h.supplier_id); if (!c || h.cycle_year > c.cycle_year || (h.cycle_year === c.cycle_year && h.calculated_at > c.calculated_at)) m.set(h.supplier_id, h); }
  return m;
}
export const errBox = (e) => `<div class="card err">Erro: ${esc(e.message || e)}</div>`;
