import { sb, core, $, esc, all, suppliers, errBox } from './lib.js';
import { normCnpj, isValidCnpj } from './cnpj.js';
import { FN_ADMIN_USERS } from './config.js';

/* ---------- Usuários (admin) ---------- */
async function fn(body) {
  const { data, error } = await sb.functions.invoke(FN_ADMIN_USERS, { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j.error) msg = j.error; } catch { /* mantém msg */ }
    throw new Error(msg.includes('Failed to send') || msg.includes('non-2xx') ? `A função "${FN_ADMIN_USERS}" não respondeu. Confira o nome (slug) dela em Supabase > Edge Functions e o valor FN_ADMIN_USERS em src/config.js.` : msg);
  }
  return data;
}
const ROLES = [['admin', 'Administrador'], ['gestor', 'Gestor'], ['comprador', 'Comprador (somente leitura)'], ['validador', 'Validador ESG']];

export async function users(V) {
  V.innerHTML = '<h2>Usuários</h2><p class="sub">Carregando…</p>';
  try {
    const { users: list, me } = await fn({ action: 'list' });
    V.innerHTML = `<h2>Usuários</h2><p class="sub">Quem acessa o painel interno. Fornecedores não são usuários: eles respondem pelo link da campanha.</p>
      <div class="card"><b>Novo usuário</b><div class="row" style="margin-top:8px">
        <div><label>Nome</label><input id="un"></div><div><label>E-mail</label><input id="ue" type="email"></div>
        <div><label>Senha inicial (mín. 8)</label><input id="up" type="text" autocomplete="off"></div>
        <div><label>Perfil</label><select id="ur">${ROLES.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
        <button class="btn" id="uadd">Criar usuário</button></div></div>
      <div class="card scroll"><table class="tbl"><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Ativo</th><th></th></tr></thead><tbody>${list.map((u) => `<tr>
        <td>${esc(u.full_name || '—')}</td><td>${esc(u.email || '—')}</td>
        <td><select data-r="${u.id}">${ROLES.map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input type="checkbox" data-a="${u.id}" ${u.active ? 'checked' : ''} style="width:auto"></td>
        <td><a href="#" data-p="${u.id}">Redefinir senha</a>${u.id === me ? ' <small>(você)</small>' : ''}</td></tr>`).join('')}</tbody></table></div>`;
    const run = async (body, msg) => { try { await fn(body); if (msg) alert(msg); await users(V); } catch (e) { alert(e.message); await users(V); } };
    $('#uadd').onclick = () => run({ action: 'create', full_name: $('#un').value.trim(), email: $('#ue').value, password: $('#up').value, role: $('#ur').value }, 'Usuário criado. Informe a senha inicial a ele.');
    V.querySelectorAll('[data-r]').forEach((s) => (s.onchange = () => run({ action: 'update', id: s.dataset.r, role: s.value })));
    V.querySelectorAll('[data-a]').forEach((c) => (c.onchange = () => run({ action: 'update', id: c.dataset.a, active: c.checked })));
    V.querySelectorAll('[data-p]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const p = prompt('Nova senha (mín. 8 caracteres):'); if (p) run({ action: 'update', id: a.dataset.p, password: p }, 'Senha redefinida.'); }));
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ---------- Formulário de fornecedor (admin) ---------- */
const SF = [['supplier_code', 'Código do fornecedor *'], ['cnpj', 'CNPJ'], ['company_name', 'Razão social *'], ['trade_name', 'Nome fantasia'], ['email', 'E-mail (para envio do link)'],
  ['category', 'Categoria'], ['department', 'Departamento'], ['supplier_group', 'Grupo'], ['status', 'Status']];

export async function supplierForm(V, id) {
  let s = {};
  if (id) { const { data, error } = await core().from('suppliers').select('*').eq('id', id).single(); if (error) { V.innerHTML = errBox(error); return; } s = data; }
  V.innerHTML = `<p><a href="${id ? '#/fornecedor/' + id : '#/fornecedores'}">← Voltar</a></p><h2>${id ? 'Editar' : 'Novo'} fornecedor</h2>
    <p class="sub">O CNPJ é validado. Código e CNPJ não podem repetir entre fornecedores.</p>
    <div class="card"><div class="row">${SF.map(([k, l]) => `<div><label>${l}</label><input data-f="${k}" value="${esc(s[k])}"></div>`).join('')}</div>
    <p><button class="btn" id="sv">Salvar</button></p><div id="msg" class="err"></div></div>`;
  $('#sv').onclick = async () => {
    const v = {}; SF.forEach(([k]) => { v[k] = V.querySelector(`[data-f="${k}"]`).value.trim() || null; });
    const msg = (t) => ($('#msg').textContent = t);
    if (!v.supplier_code) return msg('Informe o código do fornecedor.');
    if (!v.company_name) return msg('Informe a razão social.');
    if (v.cnpj) { v.cnpj = normCnpj(v.cnpj); if (!isValidCnpj(v.cnpj)) return msg('CNPJ inválido.'); }
    if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) return msg('E-mail inválido.');
    $('#sv').disabled = true;
    const q = id ? core().from('suppliers').update({ ...v, updated_at: new Date().toISOString() }).eq('id', id).select('id').single() : core().from('suppliers').insert(v).select('id').single();
    const { data, error } = await q;
    $('#sv').disabled = false;
    if (error) return msg(/duplicate|unique/i.test(error.message) ? 'Já existe fornecedor com esse código ou CNPJ.' : error.message);
    await suppliers(true);
    location.hash = '#/fornecedor/' + data.id;
  };
}
