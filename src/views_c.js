import { esg, $, esc, state, can, pct, fdate, EV_LABEL, VALID_LABEL, ASSESS_LABEL, all, suppliers, evActions, bindEvActions, uniq, options, errBox } from './lib.js';

const stat = (l, v, c = '') => `<div class="stat ${c}"><b>${v}</b>${l}</div>`;
const portalBase = () => new URL('portal.html', location.href).href.split('?')[0] + '?t=';
const csvDownload = (name, rows) => {
  const csv = rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(';')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' })); a.download = name; a.click();
};

/* ================= CAMPANHAS ================= */
export async function campaigns(V, id) { return id ? campaignPage(V, id) : campaignList(V); }

async function campaignList(V) {
  V.innerHTML = '<h2>Campanhas ESG</h2><p class="sub">Carregando…</p>';
  try {
    const [camps, ass] = await Promise.all([all(() => esg().from('campaigns').select('*').order('id')), all(() => esg().from('assessments').select('id,campaign_id,status').order('id'))]);
    const admin = can('admin', 'gestor');
    V.innerHTML = `<h2>Campanhas ESG</h2><p class="sub">Crie a campanha, selecione fornecedores e envie o link do questionário.</p>
      ${admin ? `<div class="card"><b>Nova campanha</b><div class="row" style="margin-top:8px"><div><label>Nome</label><input id="cn" placeholder="Programa ESG Fornecedores 2026"></div><div><label>Ano/ciclo</label><input id="cy" type="number" value="${new Date().getFullYear()}"></div>
        <div><label>Início</label><input id="cs" type="date"></div><div><label>Fim</label><input id="ce" type="date"></div><div><label>Status</label><select id="cst"><option>rascunho</option><option>ativa</option><option>encerrada</option></select></div>
        <div style="flex-basis:100%"><label>Descrição</label><input id="cd"></div><button class="btn" id="cadd">Criar campanha</button></div></div>` : ''}
      <div class="card scroll"><table class="tbl"><thead><tr><th>Campanha</th><th>Ciclo</th><th>Status</th><th>Convidados</th><th>Respondidos</th><th>Adesão</th></tr></thead><tbody>${camps.map((c) => {
        const A = ass.filter((a) => a.campaign_id === c.id), r = A.filter((a) => ['enviada', 'em_validacao', 'concluida'].includes(a.status)).length;
        return `<tr><td><a href="#/campanhas/${c.id}">${esc(c.name)}</a> ${c.is_demo ? '<span class="tag">DEMO</span>' : ''}</td><td>${c.cycle_year}</td><td>${esc(c.status)}</td><td>${A.length}</td><td>${r}</td><td>${pct(A.length ? 100 * r / A.length : null)}</td></tr>`;
      }).join('')}</tbody></table></div>`;
    if (admin) $('#cadd').onclick = async () => {
      if (!$('#cn').value.trim()) return alert('Informe o nome.');
      const { data, error } = await esg().from('campaigns').insert({ name: $('#cn').value.trim(), description: $('#cd').value || null, cycle_year: Number($('#cy').value), start_date: $('#cs').value || null, end_date: $('#ce').value || null, status: $('#cst').value, owner_id: state.profile.id }).select('id').single();
      if (error) alert(error.message); else location.hash = '#/campanhas/' + data.id;
    };
  } catch (e) { V.innerHTML = errBox(e); }
}

async function campaignPage(V, id) {
  V.innerHTML = '<p class="sub">Carregando…</p>';
  try {
    const sup = await suppliers();
    const [{ data: c, error }, cs, ass, ev] = await Promise.all([esg().from('campaigns').select('*').eq('id', id).single(), all(() => esg().from('campaign_suppliers').select('*').eq('campaign_id', id).order('id')),
      all(() => esg().from('assessments').select('*').eq('campaign_id', id).order('id')), all(() => esg().from('evidences').select('assessment_id,status').eq('status', 'correcao').order('id'))]);
    if (error) throw error;
    const am = new Map(ass.map((a) => [a.supplier_id, a])), n = (f) => ass.filter(f).length;
    const done = n((a) => ['enviada', 'em_validacao', 'concluida'].includes(a.status));
    const back = new Set(ev.filter((e) => ass.some((a) => a.id === e.assessment_id)).map((e) => e.assessment_id)).size;
    const admin = can('admin', 'gestor'), invited = new Set(cs.map((x) => x.supplier_id));
    V.innerHTML = `<p><a href="#/campanhas">← Campanhas</a></p><h2>${esc(c.name)}</h2><p class="sub">Ciclo ${c.cycle_year} · ${fdate(c.start_date)} a ${fdate(c.end_date)} · ${esc(c.status)}</p>
      <div class="stats">${stat('Convidados', cs.length)}${stat('Respondidos', done, 'ok')}${stat('Em andamento', n((a) => a.status === 'em_andamento'))}${stat('Enviados', n((a) => a.status === 'enviada'))}${stat('Validados', n((a) => a.status === 'concluida'), 'ok')}${stat('Devolvidos p/ correção', back, 'warn')}${stat('Não responderam', n((a) => a.status === 'nao_iniciada'), 'bad')}${stat('Adesão', pct(cs.length ? 100 * done / cs.length : null))}</div>
      ${admin ? `<div class="card"><b>Selecionar fornecedores</b><div class="row" style="margin-top:8px"><div><label>Buscar</label><input id="pq"></div><div><label>Comprador</label><select id="pb">${options(uniq([...sup.values()].map((s) => s.buyer)), '', 'Todos')}</select></div><div><label>Categoria</label><select id="pc">${options(uniq([...sup.values()].map((s) => s.category)), '', 'Todas')}</select></div><div><label>Grupo</label><select id="pg">${options(uniq([...sup.values()].map((s) => s.supplier_group)), '', 'Todos')}</select></div></div>
        <div id="plist" class="scroll" style="max-height:300px;margin-top:10px"></div><p><button class="btn ghost" id="pall">Marcar todos os filtrados</button> <button class="btn" id="pinv">Convidar selecionados</button></p><div id="links"></div></div>` : ''}
      <div class="card scroll"><b>Lembretes e acompanhamento</b><table class="tbl"><thead><tr><th>Fornecedor</th><th>Convite</th><th>Último lembrete</th><th>Próximo</th><th>Qtd.</th><th>Status</th><th></th></tr></thead><tbody>${cs.map((x) => `<tr><td>${esc(sup.get(x.supplier_id)?.company_name)}</td><td>${fdate(x.invited_at?.slice(0, 10))}</td><td>${fdate(x.last_reminder_at?.slice(0, 10))}</td><td>${fdate(x.next_reminder_at?.slice(0, 10))}</td><td>${x.reminder_count}</td><td>${ASSESS_LABEL[am.get(x.supplier_id)?.status] || '—'}</td>
        <td>${admin ? `<a href="#" data-r="${x.supplier_id}">Registrar lembrete</a> · <a href="#" data-l="${x.supplier_id}">Novo link</a>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
    if (!admin) return;
    const picked = new Set();
    const cand = () => {
      const q = $('#pq').value.toLowerCase(), b = $('#pb').value, cat = $('#pc').value, g = $('#pg').value;
      return [...sup.values()].filter((s) => !invited.has(s.id) && (!b || s.buyer === b) && (!cat || s.category === cat) && (!g || s.supplier_group === g) && (!q || (s.company_name + ' ' + s.supplier_code + ' ' + s.cnpj).toLowerCase().includes(q)));
    };
    const drawList = () => {
      const L = cand();
      $('#plist').innerHTML = `<table class="tbl"><tbody>${L.slice(0, 300).map((s) => `<tr><td style="width:30px"><input type="checkbox" data-p="${s.id}" ${picked.has(s.id) ? 'checked' : ''} style="width:auto"></td><td>${esc(s.company_name)}</td><td>${esc(s.category)}</td></tr>`).join('')}</tbody></table>${L.length > 300 ? `<p class="sub">Mostrando 300 de ${L.length}. Use "Marcar todos os filtrados".</p>` : ''}`;
      $('#plist').querySelectorAll('[data-p]').forEach((i) => (i.onchange = () => (i.checked ? picked.add(i.dataset.p) : picked.delete(i.dataset.p))));
    };
    ['#pq', '#pb', '#pc', '#pg'].forEach((s) => ($(s).oninput = drawList)); drawList();
    $('#pall').onclick = () => { cand().forEach((s) => picked.add(s.id)); drawList(); };
    const showLinks = (rows) => {
      const base = portalBase(), data = rows.map((r) => [sup.get(r.out_supplier)?.company_name, sup.get(r.out_supplier)?.cnpj, base + r.out_token]);
      $('#links').innerHTML = `<div class="card"><b>Links gerados</b><p class="sub">Guarde agora: por segurança o sistema só armazena o hash e não mostra o link de novo (use "Novo link" para gerar outro).</p><button class="btn" id="dl">Baixar CSV com links</button></div>`;
      $('#dl').onclick = () => csvDownload('links-fornecedores.csv', [['fornecedor', 'cnpj', 'link'], ...data]);
    };
    $('#pinv').onclick = async () => {
      if (!picked.size) return alert('Selecione ao menos um fornecedor.');
      const { data, error: er } = await esg().rpc('invite_suppliers', { p_campaign: id, p_suppliers: [...picked] });
      if (er) return alert(er.message);
      showLinks(data); picked.forEach((x) => invited.add(x)); picked.clear();
    };
    V.querySelectorAll('[data-r]').forEach((a) => (a.onclick = async (e) => { e.preventDefault(); const { error: er } = await esg().rpc('register_reminder', { p_campaign: id, p_supplier: a.dataset.r }); if (er) alert(er.message); else campaignPage(V, id); }));
    V.querySelectorAll('[data-l]').forEach((a) => (a.onclick = async (e) => {
      e.preventDefault();
      if (!confirm('Gerar novo link? O link anterior deixa de funcionar.')) return;
      const { data, error: er } = await esg().rpc('invite_suppliers', { p_campaign: id, p_suppliers: [a.dataset.l] });
      if (er) alert(er.message); else { showLinks(data); prompt('Link do fornecedor (copie):', portalBase() + data[0].out_token); }
    }));
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ================= EVIDÊNCIAS ================= */
export async function evidences(V) {
  V.innerHTML = '<h2>Evidências</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, ev, kp] = await Promise.all([suppliers(), all(() => esg().from('v_evidence_validity').select('*').order('id')), all(() => esg().from('kpis').select('id,code').order('id'))]);
    const km = new Map(kp.map((k) => [k.id, k.code]));
    V.innerHTML = `<h2>Evidências</h2><p class="sub">Declarado → Comprovado → Validado. Reprovar ou pedir correção exige justificativa.</p><div class="card"><div class="row">
      <div><label>Status</label><select id="es"><option value="">Todos</option>${Object.entries(EV_LABEL).map(([k, v]) => `<option value="${k}" ${k === 'pendente' ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
      <div><label>Validade</label><select id="ev"><option value="">Todas</option>${Object.entries(VALID_LABEL).filter(([k]) => k !== 'sem_validade').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div></div></div><div class="card scroll" id="el"></div>`;
    const draw = () => {
      const s = $('#es').value, v = $('#ev').value, rows = ev.filter((e) => (!s || e.status === s) && (!v || e.validity_status === v));
      $('#el').innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Fornecedor</th><th>KPI</th><th>Arquivo</th><th>Status</th><th>Validade</th><th></th></tr></thead><tbody>${rows.slice(0, 300).map((e) => `<tr><td><a href="#/avaliacao/${e.assessment_id}">${esc(sup.get(e.supplier_id)?.company_name)}</a></td><td>${esc(km.get(e.kpi_id))}</td><td>${esc(e.original_name)}</td><td>${EV_LABEL[e.status]}</td><td>${VALID_LABEL[e.validity_status]} ${fdate(e.valid_until)}</td><td>${evActions(e)}</td></tr>`).join('')}</tbody></table>` : 'Nenhuma evidência neste filtro.';
      bindEvActions($('#el'), () => evidences(V));
    };
    $('#es').onchange = draw; $('#ev').onchange = draw; draw();
  } catch (e) { V.innerHTML = errBox(e); }
}

/* ================= PENDÊNCIAS ================= */
const PST = ['aberta', 'em_analise', 'aguardando_fornecedor', 'aguardando_documento', 'resolvida', 'cancelada'];
export async function pendencias(V) {
  V.innerHTML = '<h2>Pendências</h2><p class="sub">Carregando…</p>';
  try {
    const [sup, pend, kp] = await Promise.all([suppliers(), all(() => esg().from('pendencias').select('*').order('created_at', { ascending: false }).order('id')), all(() => esg().from('kpis').select('id,code,dimension').order('id'))]);
    const km = new Map(kp.map((k) => [k.id, k])), edit = can('admin', 'gestor');
    const byLabel = new Map([...sup.values()].map((s) => [`${s.supplier_code || '—'} · ${s.company_name}`, s.id]));
    V.innerHTML = `<h2>Pendências</h2><p class="sub">Geradas automaticamente na validação de evidências ou criadas manualmente.</p>
      ${edit ? `<div class="card"><b>Nova pendência</b><div class="row" style="margin-top:8px"><div><label>Fornecedor</label><input id="ps" list="pdl" placeholder="Digite código ou nome"><datalist id="pdl">${[...byLabel.keys()].slice(0, 2000).map((l) => `<option value="${esc(l)}">`).join('')}</datalist></div>
        <div><label>KPI (opcional)</label><select id="pk"><option value="">—</option>${kp.map((k) => `<option value="${k.id}">${esc(k.code)}</option>`).join('')}</select></div><div><label>Pendência</label><input id="pt"></div>
        <div><label>Prioridade</label><select id="pp"><option>baixa</option><option selected>media</option><option>alta</option></select></div><div><label>Prazo</label><input id="pd" type="date"></div><button class="btn" id="padd">Adicionar</button></div></div>` : ''}
      <div class="card"><div class="row"><div><label>Status</label><select id="pf"><option value="">Todos</option>${PST.map((s) => `<option ${s === 'aberta' ? 'selected' : ''}>${s}</option>`).join('')}</select></div></div></div><div class="card scroll" id="pl"></div>`;
    const draw = () => {
      const f = $('#pf').value, rows = pend.filter((p) => !f || p.status === f);
      $('#pl').innerHTML = rows.length ? `<table class="tbl"><thead><tr><th>Fornecedor</th><th>KPI</th><th>Pendência</th><th>Prioridade</th><th>Prazo</th><th>Status</th></tr></thead><tbody>${rows.slice(0, 300).map((p) => `<tr><td><a href="#/fornecedor/${p.supplier_id}">${esc(sup.get(p.supplier_id)?.company_name)}</a></td><td>${esc(km.get(p.kpi_id)?.code || '')}</td><td>${esc(p.title)}${p.note ? '<br><small>' + esc(p.note) + '</small>' : ''}</td><td>${esc(p.priority)}</td><td>${fdate(p.due_date)}</td>
        <td>${edit ? `<select data-ps="${p.id}">${PST.map((s) => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select>` : esc(p.status)}</td></tr>`).join('')}</tbody></table>` : 'Nenhuma pendência neste filtro.';
      $('#pl').querySelectorAll('[data-ps]').forEach((s) => (s.onchange = async () => {
        const closed = ['resolvida', 'cancelada'].includes(s.value);
        const { error } = await esg().from('pendencias').update({ status: s.value, closed_at: closed ? new Date().toISOString() : null }).eq('id', s.dataset.ps);
        if (error) alert(error.message); else pendencias(V);
      }));
    };
    $('#pf').onchange = draw; draw();
    if (edit) $('#padd').onclick = async () => {
      const sid = byLabel.get($('#ps').value); if (!sid) return alert('Escolha um fornecedor da lista.'); if (!$('#pt').value.trim()) return alert('Descreva a pendência.');
      const kid = $('#pk').value || null;
      const { error } = await esg().from('pendencias').insert({ supplier_id: sid, kpi_id: kid, dimension: kid ? km.get(kid).dimension : null, title: $('#pt').value.trim(), origin: 'manual', owner_id: state.profile.id, priority: $('#pp').value, due_date: $('#pd').value || null });
      if (error) alert(error.message); else pendencias(V);
    };
  } catch (e) { V.innerHTML = errBox(e); }
}
