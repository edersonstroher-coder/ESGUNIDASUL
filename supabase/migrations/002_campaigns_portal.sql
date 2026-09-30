-- UNIDASUL ESG FORNECEDORES | 002_campaigns_portal.sql
-- Rodar DEPOIS de 001_schema.sql.

-- ========== GRANTS (schemas customizados não recebem grants automáticos no Supabase) ==========
grant usage on schema core, esg to authenticated, service_role;
grant usage on schema esg to anon;                       -- anon só chega às funções do portal (tabelas continuam sem grant)
grant select, insert, update, delete on all tables in schema core to authenticated;
grant select, insert, update, delete on all tables in schema esg to authenticated;
grant all on all tables in schema core, esg to service_role;
grant usage, select on all sequences in schema core, esg to authenticated, service_role;
alter default privileges in schema core grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema esg grant select, insert, update, delete on tables to authenticated;

-- ========== AJUSTES ==========
alter table esg.campaign_suppliers add column if not exists consented_at timestamptz;

drop policy if exists gestor_write_ans on esg.answers;
create policy gestor_write_ans on esg.answers for all using (core.user_role() = 'gestor') with check (core.user_role() = 'gestor');
drop policy if exists gestor_write_evid on esg.evidences;
create policy gestor_write_evid on esg.evidences for all using (core.user_role() = 'gestor') with check (core.user_role() = 'gestor');

insert into esg.settings(key, value, description) values
 ('evidence_types', '["Certificação","Licença","Política","Foto","Relatório","Outro"]', 'Tipos de evidência disponíveis'),
 ('reminder_interval_days', '7', 'Intervalo padrão entre lembretes'),
 ('highlight_criteria', '{"year":null,"limit":3,"min_coverage":0,"criteria":[
    {"key":"top_total","label":"Maior score ESG","metric":"score_total"},
    {"key":"top_cov","label":"Maior cobertura do questionário","metric":"cov_questionnaire"},
    {"key":"top_e","label":"Destaque ambiental","metric":"score_e"},
    {"key":"top_s","label":"Destaque social","metric":"score_s"},
    {"key":"top_g","label":"Destaque governança","metric":"score_g"},
    {"key":"top_evo","label":"Maior evolução","metric":"evolution"}]}', 'DEMO: critérios dos Destaques ESG (editáveis)')
on conflict (key) do nothing;

-- Estrutura para futura integração com outros módulos (comercial, logística, qualidade...)
create table if not exists core.module_scores (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references core.suppliers(id),
  module text not null, metric text not null, value numeric, ref_date date default current_date,
  payload jsonb, created_at timestamptz default now()
);
alter table core.module_scores enable row level security;
drop policy if exists admin_all on core.module_scores;
create policy admin_all on core.module_scores for all using (core.user_role() = 'admin') with check (core.user_role() = 'admin');
drop policy if exists staff_read on core.module_scores;
create policy staff_read on core.module_scores for select using (core.user_role() in ('gestor','validador'));
grant select, insert, update, delete on core.module_scores to authenticated;

create or replace view esg.v_latest with (security_invoker = true) as
select distinct on (supplier_id) * from esg.v_history order by supplier_id, cycle_year desc, calculated_at desc;
grant select on esg.v_latest to authenticated;

-- ========== VALIDAÇÃO: status da avaliação e pendências automáticas ==========
create or replace function esg.tg_apply_validation() returns trigger language plpgsql security definer set search_path = esg, core, public as $$
declare ev esg.evidences;
begin
  update esg.evidences set status = new.decision, validated_by = new.decided_by,
         validated_at = new.decided_at, note = coalesce(new.justification, note)
  where id = new.evidence_id returning * into ev;

  if new.decision = 'correcao' then
    update esg.assessments set status = 'em_andamento' where id = ev.assessment_id;      -- devolve ao fornecedor
  elsif ev.assessment_id is not null then
    update esg.assessments set status = 'em_validacao' where id = ev.assessment_id and status = 'enviada';
  end if;

  if new.decision in ('reprovada','correcao') then
    insert into esg.pendencias(supplier_id, kpi_id, dimension, title, origin, status, priority, note)
    select ev.supplier_id, ev.kpi_id, k.dimension, 'Evidência ' || new.decision::text || ': ' || ev.original_name,
           'validacao', 'aguardando_documento', 'alta', new.justification
    from esg.kpis k where k.id = ev.kpi_id;
  elsif new.decision = 'validada' then
    update esg.pendencias set status = 'resolvida', closed_at = now()
    where supplier_id = ev.supplier_id and kpi_id = ev.kpi_id and origin = 'validacao' and status <> 'resolvida';
  end if;
  return null;
end $$;

-- ========== CAMPANHAS: convite, token e lembretes ==========
create or replace function esg.invite_suppliers(p_campaign uuid, p_suppliers uuid[])
returns table(out_supplier uuid, out_token text) language plpgsql security definer
set search_path = esg, core, public, extensions as $$
declare sid uuid; t text; c esg.campaigns;
begin
  if core.user_role() not in ('admin','gestor') then raise exception 'sem permissão'; end if;
  select * into c from esg.campaigns where id = p_campaign;
  if not found then raise exception 'campanha inexistente'; end if;
  foreach sid in array p_suppliers loop
    t := encode(gen_random_bytes(24), 'hex');           -- o token em claro só é devolvido aqui; guardamos apenas o hash
    insert into esg.campaign_suppliers(campaign_id, supplier_id, invited_at, token_hash, token_expires_at, next_reminder_at)
    values (p_campaign, sid, now(), encode(digest(t, 'sha256'), 'hex'),
            coalesce(c.end_date::timestamptz, now() + interval '90 days') + interval '30 days', now() + interval '7 days')
    on conflict (campaign_id, supplier_id) do update
      set token_hash = excluded.token_hash, token_expires_at = excluded.token_expires_at;
    insert into esg.assessments(campaign_id, supplier_id, cycle_year) values (p_campaign, sid, c.cycle_year)
    on conflict (campaign_id, supplier_id) do nothing;
    out_supplier := sid; out_token := t; return next;
  end loop;
end $$;

create or replace function esg.register_reminder(p_campaign uuid, p_supplier uuid) returns void
language plpgsql security definer set search_path = esg, core, public as $$
declare d int := coalesce((select (value #>> '{}')::int from esg.settings where key = 'reminder_interval_days'), 7);
begin
  if core.user_role() not in ('admin','gestor') then raise exception 'sem permissão'; end if;
  update esg.campaign_suppliers set last_reminder_at = now(), reminder_count = reminder_count + 1,
         next_reminder_at = now() + make_interval(days => d)
  where campaign_id = p_campaign and supplier_id = p_supplier;
end $$;

-- ========== PORTAL DO FORNECEDOR (acesso só por token; nada além da própria avaliação) ==========
create or replace function esg.portal_assessment(p_token text) returns esg.assessments
language plpgsql security definer set search_path = esg, core, public, extensions as $$
declare a esg.assessments;
begin
  select a2.* into a from esg.campaign_suppliers cs
  join esg.assessments a2 on a2.campaign_id = cs.campaign_id and a2.supplier_id = cs.supplier_id
  where cs.token_hash = encode(digest(coalesce(p_token,''), 'sha256'), 'hex') and cs.token_expires_at > now();
  if a.id is null then raise exception 'Link inválido ou expirado'; end if;
  return a;
end $$;

create or replace function esg.portal_get(p_token text) returns jsonb
language plpgsql security definer set search_path = esg, core, public, extensions as $$
declare a esg.assessments;
begin
  a := esg.portal_assessment(p_token);
  return jsonb_build_object(
    'assessment_id', a.id, 'status', a.status,
    'supplier', (select jsonb_build_object('company_name', s.company_name, 'trade_name', s.trade_name, 'cnpj', s.cnpj) from core.suppliers s where s.id = a.supplier_id),
    'campaign', (select jsonb_build_object('name', c.name, 'end_date', c.end_date, 'cycle_year', c.cycle_year) from esg.campaigns c where c.id = a.campaign_id),
    'consented', exists (select 1 from esg.campaign_suppliers x where x.campaign_id = a.campaign_id and x.supplier_id = a.supplier_id and x.consented_at is not null),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kpi_id', k.id, 'dimension', k.dimension, 'category', k.category,
        'question', coalesce(q.question, k.name), 'description', coalesce(q.description, k.description),
        'answer_type', coalesce(q.answer_type, 'sim_nao_parcial'), 'options', q.options,
        'required', coalesce(q.required, false), 'requires_evidence', k.requires_evidence,
        'evidence_mandatory', k.evidence_mandatory, 'evidence_type', k.evidence_type,
        'state', coalesce(an.state, 'nao_informado'), 'value', an.value, 'note', an.note) order by k.dimension, k.sort_order)
      from esg.kpis k
      left join lateral (select * from esg.questions qq where qq.kpi_id = k.id and qq.active order by qq.sort_order limit 1) q on true
      left join esg.answers an on an.assessment_id = a.id and an.kpi_id = k.id
      where k.active and k.deleted_at is null), '[]'::jsonb),
    'evidences', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'kpi_id', e.kpi_id, 'original_name', e.original_name,
        'status', e.status, 'valid_until', e.valid_until, 'note', case when e.status in ('reprovada','correcao') then e.note end))
      from esg.evidences e where e.assessment_id = a.id), '[]'::jsonb));
end $$;

create or replace function esg.portal_consent(p_token text) returns void
language plpgsql security definer set search_path = esg, core, public, extensions as $$
declare a esg.assessments;
begin
  a := esg.portal_assessment(p_token);
  update esg.campaign_suppliers set consented_at = coalesce(consented_at, now())
  where campaign_id = a.campaign_id and supplier_id = a.supplier_id;
end $$;

create or replace function esg.portal_save(p_token text, p_kpi uuid, p_state esg.answer_state, p_note text default null, p_value jsonb default null)
returns void language plpgsql security definer set search_path = esg, core, public, extensions as $$
declare a esg.assessments;
begin
  a := esg.portal_assessment(p_token);
  if a.status not in ('nao_iniciada','em_andamento') then raise exception 'Avaliação já enviada; não pode mais ser editada'; end if;
  insert into esg.answers(assessment_id, kpi_id, question_id, state, value, note, answered_at)
  values (a.id, p_kpi, (select id from esg.questions where kpi_id = p_kpi and active order by sort_order limit 1), p_state, p_value, p_note, now())
  on conflict (assessment_id, kpi_id) do update set state = excluded.state, value = excluded.value, note = excluded.note, answered_at = now();
  update esg.assessments set status = 'em_andamento' where id = a.id and status = 'nao_iniciada';
end $$;

create or replace function esg.portal_submit(p_token text) returns void
language plpgsql security definer set search_path = esg, core, public, extensions as $$
declare a esg.assessments;
begin
  a := esg.portal_assessment(p_token);
  if a.status not in ('nao_iniciada','em_andamento') then raise exception 'Avaliação já enviada'; end if;
  if exists (select 1 from esg.kpis k join esg.questions q on q.kpi_id = k.id and q.active and q.required
             left join esg.answers an on an.assessment_id = a.id and an.kpi_id = k.id
             where k.active and k.deleted_at is null and coalesce(an.state, 'nao_informado') = 'nao_informado') then
    raise exception 'Há perguntas obrigatórias sem resposta';
  end if;
  if exists (select 1 from esg.kpis k join esg.answers an on an.kpi_id = k.id and an.assessment_id = a.id
             where k.evidence_mandatory and an.state in ('sim','parcial')
               and not exists (select 1 from esg.evidences e where e.assessment_id = a.id and e.kpi_id = k.id and e.status in ('pendente','validada','correcao'))) then
    raise exception 'Há indicadores com evidência obrigatória sem arquivo anexado';
  end if;
  update esg.assessments set status = 'enviada', submitted_at = now() where id = a.id;
end $$;

-- Permissões: tudo fechado por padrão; abre só o necessário
revoke all on function esg.invite_suppliers(uuid, uuid[]), esg.register_reminder(uuid, uuid), esg.portal_assessment(text),
  esg.portal_get(text), esg.portal_consent(text), esg.portal_save(text, uuid, esg.answer_state, text, jsonb), esg.portal_submit(text),
  esg.calculate_score(uuid) from public, anon, authenticated;
grant execute on function esg.invite_suppliers(uuid, uuid[]), esg.register_reminder(uuid, uuid) to authenticated;
grant execute on function esg.portal_get(text), esg.portal_consent(text), esg.portal_save(text, uuid, esg.answer_state, text, jsonb), esg.portal_submit(text) to anon;
grant execute on function esg.portal_assessment(text), esg.calculate_score(uuid) to service_role;
grant execute on function esg.classify(numeric) to authenticated;
