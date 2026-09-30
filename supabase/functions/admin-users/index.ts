// Deploy: supabase functions deploy admin-users   (mantenha a verificação de JWT ligada)
// Só administradores ativos podem listar, criar e editar usuários. A chave de serviço nunca sai daqui.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const ROLES = ['admin', 'gestor', 'comprador', 'validador'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await caller.auth.getUser();
    if (!u?.user) return json({ error: 'Não autenticado' }, 401);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const prof = () => admin.schema('core').from('profiles');
    const { data: me } = await prof().select('role,active').eq('id', u.user.id).maybeSingle();
    if (me?.role !== 'admin' || !me.active) return json({ error: 'Somente administradores' }, 403);

    const b = await req.json();

    if (b.action === 'list') {
      const { data: rows, error } = await prof().select('*').order('full_name');
      if (error) return json({ error: error.message }, 400);
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const em = new Map((list?.users ?? []).map((x) => [x.id, x.email]));
      return json({ users: (rows ?? []).map((p) => ({ ...p, email: em.get(p.id) ?? null })), me: u.user.id });
    }

    if (b.action === 'create') {
      const email = String(b.email ?? '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
      if (String(b.password ?? '').length < 8) return json({ error: 'A senha precisa ter ao menos 8 caracteres' }, 400);
      if (!ROLES.includes(b.role)) return json({ error: 'Perfil inválido' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password: b.password, email_confirm: true });
      if (error) return json({ error: error.message }, 400);
      const { error: e2 } = await prof().insert({ id: data.user.id, full_name: b.full_name || null, role: b.role, active: true });
      if (e2) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: e2.message }, 400); }
      return json({ ok: true });
    }

    if (b.action === 'update') {
      if (!b.id) return json({ error: 'Usuário não informado' }, 400);
      const patch: Record<string, unknown> = {};
      if (b.role !== undefined) { if (!ROLES.includes(b.role)) return json({ error: 'Perfil inválido' }, 400); patch.role = b.role; }
      if (b.active !== undefined) patch.active = !!b.active;
      if (b.full_name !== undefined) patch.full_name = b.full_name || null;
      // evita se trancar para fora do sistema
      if (b.id === u.user.id && (patch.role && patch.role !== 'admin' || patch.active === false)) return json({ error: 'Você não pode rebaixar nem desativar a si mesmo' }, 400);
      if (Object.keys(patch).length) { const { error } = await prof().update(patch).eq('id', b.id); if (error) return json({ error: error.message }, 400); }
      if (b.password) {
        if (String(b.password).length < 8) return json({ error: 'A senha precisa ter ao menos 8 caracteres' }, 400);
        const { error } = await admin.auth.admin.updateUserById(b.id, { password: b.password });
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }
    return json({ error: 'Ação desconhecida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
