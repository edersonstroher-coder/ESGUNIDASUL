import { sb, core, $, esc, state } from './lib.js';
import { normCnpj, isValidCnpj } from './cnpj.js';
import * as A from './views_a.js';
import * as B from './views_b.js';
import * as C from './views_c.js';
import * as U from './views_d.js';

let profile = null;

const MENU = [
  ['dashboard', 'Dashboard'], ['fornecedores', 'Fornecedores'], ['importar', 'Importar fornecedores', 'admin'],
  ['campanhas', 'Campanhas ESG'], ['questionarios', 'Questionários'], ['avaliacoes', 'Avaliações'],
  ['evidencias', 'Evidências'], ['kpis', 'KPIs ESG'], ['pendencias', 'Pendências'],
  ['relatorios', 'Relatórios'], ['destaques', 'Destaques ESG'], ['historico', 'Histórico'], ['config', 'Configurações', 'admin'], ['usuarios', 'Usuários', 'admin'],
];
const ALIAS = { 'fornecedor-novo': 'fornecedores', 'fornecedor-editar': 'fornecedores', fornecedor: 'fornecedores', avaliacao: 'avaliacoes', relatorio: 'relatorios' };

/* ---------- autenticação ---------- */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#email').value.trim(), password: $('#pass').value });
  if (error) $('#loginErr').textContent = 'E-mail ou senha incorretos.';
});

// setTimeout evita travar o cliente ao chamar o Supabase dentro do próprio callback de autenticação
sb.auth.onAuthStateChange((_evt, session) => setTimeout(() => boot(session), 0));

async function boot(session) {
  window.__ready = true; $('#boot')?.remove(); $('#fatal')?.remove();
  if (!session) { profile = null; $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); return; }
  const { data, error } = await core().from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  if (error || !data || !data.active) {
    $('#loginErr').textContent = 'Seu usuário não tem perfil ativo. Peça acesso a um administrador.';
    await sb.auth.signOut(); return;
  }
  profile = data; state.profile = data;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
  renderMenu(); route();
}
sb.auth.getSession().then(({ data }) => { if (!data.session) boot(null); });

/* ---------- menu e rotas ---------- */
function renderMenu() {
  const seg = (location.hash.replace('#/', '') || 'dashboard').split('/')[0];
  const cur = ALIAS[seg] || seg;
  $('#menu').innerHTML = '<div class="logo">Unidasul<small>ESG Fornecedores</small></div>' +
    MENU.filter((m) => !m[2] || m[2] === profile.role).map(([id, label]) => `<a href="#/${id}" class="${cur === id ? 'on' : ''}">${label}</a>`).join('') +
    `<div class="who">${esc(profile.full_name || 'Usuário')}<br>${esc(profile.role)}<br><button id="out">Sair</button></div>`;
  $('#out').onclick = () => sb.auth.signOut();
}
window.addEventListener('hashchange', () => { if (profile) { renderMenu(); route(); } });
function route() {
  const [r, arg] = (location.hash.replace('#/', '') || 'dashboard').split('/');
  const V = $('#view');
  const map = {
    dashboard: () => A.dashboard(V), fornecedores: () => viewSuppliers(), fornecedor: () => A.supplierPage(V, arg),
    importar: () => (profile.role === 'admin' ? viewImport() : viewSuppliers()), avaliacoes: () => A.assessments(V), avaliacao: () => A.assessmentPage(V, arg),
    historico: () => A.history(V, arg), relatorios: () => A.reportsList(V), relatorio: () => A.report(V, arg),
    'fornecedor-novo': () => (profile.role === 'admin' ? U.supplierForm(V) : viewSuppliers()), 'fornecedor-editar': () => (profile.role === 'admin' ? U.supplierForm(V, arg) : viewSuppliers()),
    usuarios: () => (profile.role === 'admin' ? U.users(V) : viewSuppliers()),
    kpis: () => B.kpis(V), questionarios: () => B.questions(V), config: () => B.config(V), destaques: () => B.highlights(V),
    campanhas: () => C.campaigns(V, arg), evidencias: () => C.evidences(V), pendencias: () => C.pendencias(V),
  };
  (map[r] || map.dashboard)();
}

/* ---------- fornecedores ---------- */
function viewSuppliers() {
  $('#view').innerHTML = `<h2>Fornecedores</h2><p class="sub">Cadastro mestre. Busque por código, CNPJ, razão social ou nome fantasia.</p>
    <div class="card"><div class="row"><div><label for="q">Buscar</label><input id="q" placeholder="Ex.: 1234, 11222333000181, Alfa"></div>${profile.role === 'admin' ? '<a class="btn" href="#/fornecedor-novo">Novo fornecedor</a>' : ''}</div></div>
    <div class="card scroll" id="list">Carregando…</div>`;
  let t; $('#q').oninput = () => { clearTimeout(t); t = setTimeout(loadSuppliers, 300); };
  loadSuppliers();
}
async function loadSuppliers() {
  const q = $('#q').value.trim().replace(/[,()%]/g, ' ');
  let req = core().from('suppliers').select('id,supplier_code,cnpj,company_name,trade_name,email,category,is_demo')
    .is('deleted_at', null).order('company_name').limit(200);
  if (q) {
    const d = q.replace(/\D/g, '');
    req = req.or(['supplier_code.ilike.%' + q + '%', 'company_name.ilike.%' + q + '%', 'trade_name.ilike.%' + q + '%'].concat(d ? ['cnpj.ilike.%' + d + '%'] : []).join(','));
  }
  const { data, error } = await req;
  if (error) { $('#list').textContent = 'Erro ao carregar: ' + error.message; return; }
  $('#list').innerHTML = data.length ? `<table class="tbl"><thead><tr><th>Código</th><th>CNPJ</th><th>Razão social</th><th>E-mail</th><th>Categoria</th></tr></thead><tbody>` +
    data.map((s) => `<tr><td>${esc(s.supplier_code)}</td><td>${esc(s.cnpj)}</td><td><a href="#/fornecedor/${s.id}">${esc(s.company_name)}</a> ${s.is_demo ? '<span class="tag">DEMO</span>' : ''}<br><small>${esc(s.trade_name)}</small></td><td>${esc(s.email)}</td><td>${esc(s.category)}</td></tr>`).join('') +
    '</tbody></table>' + (data.length === 200 ? '<p class="sub">Mostrando os 200 primeiros. Refine a busca.</p>' : '')
    : 'Nenhum fornecedor encontrado. Use "Importar fornecedores" para carregar sua base.';
}

/* ---------- importação ---------- */
const FIELDS = [
  ['supplier_code', 'Código do fornecedor', /c[oó]d/i], ['cnpj', 'CNPJ', /cnpj/i], ['company_name', 'Razão social', /raz[aã]o|nome$|^nome/i],
  ['trade_name', 'Nome fantasia', /fantasia/i], ['email', 'E-mail', /e-?mail/i], ['buyer', 'Comprador (opcional, não usado)', /comprador/i], ['category', 'Categoria', /categ/i],
  ['department', 'Departamento', /depart/i], ['supplier_group', 'Grupo', /grupo/i], ['status', 'Status', /status|situa/i],
];
let imp = { rows: [], headers: [], map: {}, recs: [], file: '' };

function viewImport() {
  imp = { rows: [], headers: [], map: {}, recs: [], file: '' };
  $('#view').innerHTML = `<h2>Importar fornecedores</h2><p class="sub">CSV ou XLSX. Nada é gravado antes da prévia, e nenhum fornecedor é apagado.</p>
    <div class="card"><label for="file">Arquivo</label><input id="file" type="file" accept=".csv,.xlsx,.xls"></div>
    <div id="step2"></div>`;
  $('#file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    if (!rows.length) { $('#step2').innerHTML = '<div class="card err">Arquivo sem linhas de dados.</div>'; return; }
    imp.rows = rows; imp.file = f.name; imp.headers = Object.keys(rows[0]);
    imp.map = {}; FIELDS.forEach(([k, , rx]) => { const h = imp.headers.find((x) => rx.test(x)); if (h) imp.map[k] = h; });
    renderMapping();
  };
}
function renderMapping() {
  $('#step2').innerHTML = `<div class="card"><b>Mapeie as colunas</b> <span class="sub">(${imp.rows.length} linhas em ${esc(imp.file)})</span><div class="row">` +
    FIELDS.map(([k, label]) => `<div><label>${label}</label><select data-k="${k}"><option value="">(não importar)</option>` +
      imp.headers.map((h) => `<option ${imp.map[k] === h ? 'selected' : ''}>${esc(h)}</option>`).join('') + '</select></div>').join('') +
    `</div><p><button class="btn" id="prev">Gerar prévia</button></p></div><div id="step3"></div>`;
  document.querySelectorAll('[data-k]').forEach((s) => (s.onchange = () => (imp.map[s.dataset.k] = s.value)));
  $('#prev').onclick = preview;
}
async function fetchExisting() {
  let out = [], from = 0;
  for (;;) {
    const { data, error } = await core().from('suppliers').select('id,supplier_code,cnpj').is('deleted_at', null).range(from, from + 999);
    if (error) throw error; out = out.concat(data); if (data.length < 1000) return out; from += 1000;
  }
}
function classify(existing) {
  const byCode = new Map(existing.filter((s) => s.supplier_code).map((s) => [s.supplier_code, s]));
  const byCnpj = new Map(existing.filter((s) => s.cnpj).map((s) => [s.cnpj, s]));
  const seenCode = new Set(), seenCnpj = new Set();
  return imp.rows.map((raw, i) => {
    const r = { line: i + 2, raw };
    FIELDS.forEach(([k]) => { const c = imp.map[k]; r[k] = c ? String(raw[c] ?? '').trim() : ''; });
    r.cnpj = normCnpj(r.cnpj);
    const set = (kind, why) => Object.assign(r, { kind, why });
    if (!r.supplier_code) return set('erro', 'Fornecedor sem código');
    if (r.cnpj && !isValidCnpj(r.cnpj)) return set('erro', 'CNPJ inválido: ' + r.cnpj);
    if (seenCode.has(r.supplier_code) || (r.cnpj && seenCnpj.has(r.cnpj))) return set('duplicado', 'Repetido no arquivo (mantida a primeira ocorrência)');
    seenCode.add(r.supplier_code); if (r.cnpj) seenCnpj.add(r.cnpj);
    const ec = byCode.get(r.supplier_code), en = r.cnpj ? byCnpj.get(r.cnpj) : null;
    if (ec && r.cnpj && ec.cnpj && ec.cnpj !== r.cnpj) return set('conflito', `Código já existe com outro CNPJ (${ec.cnpj})`);
    if (en && (!ec || en.id !== ec.id)) return set('conflito', `CNPJ já cadastrado com outro código (${en.supplier_code || 'sem código'})`);
    if (ec) { r.existing = ec; return set('atualizado'); }
    if (!r.company_name) return set('erro', 'Novo fornecedor sem razão social');
    return set('novo');
  });
}
async function preview() {
  if (!imp.map.supplier_code) { $('#step3').innerHTML = '<div class="card err">Mapeie ao menos a coluna de código do fornecedor.</div>'; return; }
  $('#step3').innerHTML = '<div class="card">Comparando com a base atual…</div>';
  try { imp.recs = classify(await fetchExisting()); } catch (e) { $('#step3').innerHTML = `<div class="card err">${esc(e.message)}</div>`; return; }
  const n = (k) => imp.recs.filter((r) => r.kind === k).length;
  const bad = imp.recs.filter((r) => ['erro', 'conflito', 'duplicado'].includes(r.kind));
  const ok = n('novo') + n('atualizado');
  $('#step3').innerHTML = `<div class="card"><b>Prévia</b><div class="stats">
    <div class="stat ok"><b>${n('novo')}</b>novos</div><div class="stat"><b>${n('atualizado')}</b>atualizados</div>
    <div class="stat warn"><b>${n('duplicado')}</b>duplicados</div><div class="stat bad"><b>${n('conflito')}</b>conflitos</div><div class="stat bad"><b>${n('erro')}</b>erros</div></div>
    ${bad.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Linha</th><th>Código</th><th>Tipo</th><th>Motivo</th></tr></thead><tbody>${bad.slice(0, 100).map((r) => `<tr><td>${r.line}</td><td>${esc(r.supplier_code)}</td><td>${r.kind}</td><td>${esc(r.why)}</td></tr>`).join('')}</tbody></table></div>${bad.length > 100 ? '<p class="sub">Exibindo 100 de ' + bad.length + '. O relatório completo sai após gravar.</p>' : ''}` : ''}
    <p>Conflitos e erros não são gravados. Campos em branco no arquivo não apagam dados existentes.</p>
    <button class="btn" id="go" ${ok ? '' : 'disabled'}>Gravar ${ok} registros</button></div><div id="step4"></div>`;
  $('#go').onclick = commit;
}
const FIELD_KEYS = FIELDS.map((f) => f[0]).filter((k) => k !== 'supplier_code');
async function commit() {
  $('#go').disabled = true; $('#go').textContent = 'Gravando…';
  const clean = (r) => Object.fromEntries(FIELD_KEYS.filter((k) => r[k] !== '').map((k) => [k, r[k]]));
  try {
    const news = imp.recs.filter((r) => r.kind === 'novo').map((r) => ({ supplier_code: r.supplier_code, ...clean(r), cnpj: r.cnpj || null, raw_data: r.raw }));
    for (let i = 0; i < news.length; i += 500) { const { error } = await core().from('suppliers').insert(news.slice(i, i + 500)); if (error) throw error; }
    const ups = imp.recs.filter((r) => r.kind === 'atualizado');
    for (let i = 0; i < ups.length; i += 20) {
      await Promise.all(ups.slice(i, i + 20).map(async (r) => {
        const patch = { ...clean(r), raw_data: r.raw, updated_at: new Date().toISOString() };
        if (!r.cnpj) delete patch.cnpj;
        const { error } = await core().from('suppliers').update(patch).eq('id', r.existing.id); if (error) throw error;
      }));
    }
    const errs = imp.recs.filter((r) => ['erro', 'conflito', 'duplicado'].includes(r.kind)).map((r) => ({ line: r.line, code: r.supplier_code, kind: r.kind, why: r.why }));
    await core().from('import_batches').insert({ file_name: imp.file, column_map: imp.map, n_new: news.length, n_updated: ups.length, n_duplicate: errs.filter((e) => e.kind === 'duplicado').length, n_error: errs.filter((e) => e.kind !== 'duplicado').length, errors: errs });
    const csv = 'linha;codigo;tipo;motivo\n' + errs.map((e) => [e.line, e.code, e.kind, e.why].map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    $('#step4').innerHTML = `<div class="card"><b>Importação concluída.</b> ${news.length} novos, ${ups.length} atualizados.` +
      (errs.length ? ` <a href="${url}" download="erros-importacao.csv">Baixar relatório de erros (${errs.length})</a>` : '') + '</div>';
    $('#go').textContent = 'Concluído';
  } catch (e) {
    $('#step4').innerHTML = `<div class="card err">Falha na gravação: ${esc(e.message)}. Revise a prévia e tente de novo; registros já gravados não serão duplicados.</div>`;
    $('#go').disabled = false; $('#go').textContent = 'Tentar novamente';
  }
}
