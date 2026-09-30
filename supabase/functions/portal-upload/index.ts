// Deploy: supabase functions deploy portal-upload --no-verify-jwt
// O fornecedor não tem login: a autorização é o token da campanha, validado no banco.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const EXT = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx'];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { token, kpi_id, filename, size, doc_date, valid_until, evidence_type } = await req.json();
    if (!token || !kpi_id || !filename) return json({ error: 'Dados incompletos' }, 400);

    const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const esg = sb.schema('esg');

    const { data: a, error: ea } = await esg.rpc('portal_assessment', { p_token: token });
    if (ea || !a?.id) return json({ error: 'Link inválido ou expirado' }, 403);
    if (!['nao_iniciada', 'em_andamento'].includes(a.status)) return json({ error: 'Avaliação já enviada' }, 409);

    const ext = String(filename).split('.').pop()!.toLowerCase();
    if (!EXT.includes(ext)) return json({ error: 'Formato não permitido. Use: ' + EXT.join(', ') }, 400);

    const { data: cfg } = await esg.from('settings').select('value').eq('key', 'max_upload_mb').maybeSingle();
    const maxMb = Number(cfg?.value ?? 20);
    if (size && size > maxMb * 1024 * 1024) return json({ error: `Arquivo maior que ${maxMb} MB` }, 400);

    // O KPI precisa existir e estar ativo
    const { data: k } = await esg.from('kpis').select('id').eq('id', kpi_id).eq('active', true).maybeSingle();
    if (!k) return json({ error: 'Indicador inválido' }, 400);

    const path = `${a.supplier_id}/${a.id}/${kpi_id}/${crypto.randomUUID()}.${ext}`;
    const { data: up, error: eu } = await sb.storage.from('evidences').createSignedUploadUrl(path);
    if (eu) return json({ error: eu.message }, 500);

    const { error: ei } = await esg.from('evidences').insert({
      assessment_id: a.id, supplier_id: a.supplier_id, kpi_id, evidence_type: evidence_type ?? null,
      original_name: String(filename).slice(0, 200), storage_path: path,
      doc_date: doc_date || null, valid_until: valid_until || null, status: 'pendente',
    });
    if (ei) return json({ error: ei.message }, 500);

    return json({ path, token: up.token });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
