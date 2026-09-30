-- UNIDASUL ESG FORNECEDORES | Fase 1 | 001_schema.sql
-- Rodar no SQL Editor do Supabase. Idempotente onde possível.

create extension if not exists pgcrypto;
create schema if not exists core;   -- cadastro mestre + acesso + auditoria (compartilhado por futuros módulos)
create schema if not exists esg;    -- módulo ESG

-- ========== ENUMS ==========
do $$ begin
  create type core.app_role as enum ('admin','gestor','comprador','validador','fornecedor');
  create type esg.dimension as enum ('E','S','G');
  create type esg.answer_type as enum ('sim_nao','sim_nao_parcial','numero','percentual','texto','data','selecao','multipla','upload_doc','upload_foto');
  create type esg.answer_state as enum ('sim','nao','parcial','nao_informado','nao_aplicavel');
  create type esg.evidence_level as enum ('declarado','comprovado','validado');
  create type esg.evidence_status as enum ('pendente','validada','reprovada','correcao','nao_aplicavel');
  create type esg.assessment_status as enum ('nao_iniciada','em_andamento','enviada','em_validacao','concluida');
  create type esg.pendencia_status as enum ('aberta','em_analise','aguardando_fornecedor','aguardando_documento','resolvida','cancelada');
exception when duplicate_object then null; end $$;

-- ========== CORE ==========
create table if not exists core.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, role core.app_role not null default 'comprador',
  buyer_name text,                       -- liga o COMPRADOR aos seus fornecedores (suppliers.buyer)
  active boolean not null default true, created_at timestamptz default now()
);

create table if not exists core.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text,                    -- código interno (chave principal de conciliação)
  cnpj char(14),                         -- só dígitos; validado na importação
  company_name text not null, trade_name text,
  buyer text, category text, department text, supplier_group text, status text,
  raw_data jsonb not null default '{}',  -- linha original da base, preservada
  is_demo boolean not null default false,
  created_at timestamptz default now(), updated_at timestamptz default now(), deleted_at timestamptz
);
create unique index if not exists suppliers_code_uq on core.suppliers(supplier_code) where supplier_code is not null and deleted_at is null;
create unique index if not exists suppliers_cnpj_uq on core.suppliers(cnpj) where cnpj is not null and deleted_at is null;

create table if not exists core.import_batches (
  id uuid primary key default gen_random_uuid(), file_name text, column_map jsonb,
  n_new int, n_updated int, n_duplicate int, n_error int, errors jsonb default '[]',
  created_by uuid default auth.uid(), created_at timestamptz default now()
);

create table if not exists core.audit_logs (
  id bigserial primary key, at timestamptz default now(), user_id uuid,
  action text, table_name text, record_id text, old_value jsonb, new_value jsonb
);

-- ========== ESG: CONFIGURAÇÃO ==========
create table if not exists esg.settings (
  key text primary key, value jsonb not null, description text, updated_at timestamptz default now()
);

create table if not exists esg.kpis (
  id uuid primary key default gen_random_uuid(),
  code text not null unique, name text not null, dimension esg.dimension not null,
  category text, description text,
  weight numeric not null default 1 check (weight >= 0),
  min_score numeric not null default 0, max_score numeric not null default 1,
  requires_evidence boolean not null default false,
  evidence_mandatory boolean not null default false,
  evidence_type text, periodicity text, validity_days int,
  active boolean not null default true, sort_order int default 0,
  is_demo boolean not null default false,
  created_at timestamptz default now(), deleted_at timestamptz
);

create table if not exists esg.questions (
  id uuid primary key default gen_random_uuid(),
  kpi_id uuid not null references esg.kpis(id),
  question text not null, description text,
  answer_type esg.answer_type not null default 'sim_nao_parcial',
  options jsonb, required boolean not null default false,
  active boolean not null default true, sort_order int default 0,
  is_demo boolean not null default false
);

-- ========== ESG: CAMPANHAS E AVALIAÇÕES ==========
create table if not exists esg.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text, cycle_year int not null,
  start_date date, end_date date, owner_id uuid references core.profiles(id),
  status text not null default 'rascunho', is_demo boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists esg.campaign_suppliers (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references esg.campaigns(id),
  supplier_id uuid not null references core.suppliers(id),
  invited_at timestamptz, token_hash text, token_expires_at timestamptz,
  last_reminder_at timestamptz, next_reminder_at timestamptz, reminder_count int not null default 0,
  unique (campaign_id, supplier_id)
);

create table if not exists esg.assessments (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references esg.campaigns(id),
  supplier_id uuid not null references core.suppliers(id),
  cycle_year int not null, status esg.assessment_status not null default 'nao_iniciada',
  submitted_at timestamptz, created_at timestamptz default now(),
  unique (campaign_id, supplier_id)      -- um ciclo nunca sobrescreve outro
);

create table if not exists esg.answers (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references esg.assessments(id),
  kpi_id uuid not null references esg.kpis(id),
  question_id uuid references esg.questions(id),
  state esg.answer_state not null default 'nao_informado',
  value jsonb, note text, answered_at timestamptz default now(),
  unique (assessment_id, kpi_id)         -- Fase 1: uma resposta consolidada por KPI
);

-- ========== ESG: EVIDÊNCIAS ==========
create table if not exists esg.evidences (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references esg.assessments(id),
  supplier_id uuid not null references core.suppliers(id),
  kpi_id uuid not null references esg.kpis(id),
  evidence_type text, original_name text not null, storage_path text not null,
  uploaded_at timestamptz default now(), uploaded_by uuid,
  doc_date date, valid_until date,
  status esg.evidence_status not null default 'pendente',
  validated_by uuid, validated_at timestamptz, note text
);

create table if not exists esg.evidence_validations (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references esg.evidences(id),
  decision esg.evidence_status not null, justification text,
  decided_by uuid default auth.uid(), decided_at timestamptz default now(),
  constraint just_required check (decision not in ('reprovada','correcao') or length(trim(coalesce(justification,''))) > 0)
);

-- ========== ESG: RESULTADOS, PENDÊNCIAS ==========
create table if not exists esg.scores (       -- snapshots imutáveis: histórico por cálculo
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references esg.assessments(id),
  score_e numeric, score_s numeric, score_g numeric, score_total numeric,
  cov_questionnaire numeric, cov_evidence numeric, cov_validated numeric,
  config_snapshot jsonb, calculated_at timestamptz default clock_timestamp()
);
create index if not exists scores_assess_idx on esg.scores(assessment_id, calculated_at desc);

create table if not exists esg.pendencias (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references core.suppliers(id),
  kpi_id uuid references esg.kpis(id), dimension esg.dimension,
  title text not null, origin text, owner_id uuid references core.profiles(id),
  due_date date, priority text default 'media',
  status esg.pendencia_status not null default 'aberta',
  note text, created_at timestamptz default now(), closed_at timestamptz
);

-- ========== VIEWS ==========
create or replace view esg.v_kpi_state with (security_invoker = true) as
select a.id as assessment_id, k.id as kpi_id, k.dimension, k.weight, k.requires_evidence,
  coalesce(an.state, 'nao_informado'::esg.answer_state) as state,
  case when exists (select 1 from esg.evidences ev where ev.assessment_id=a.id and ev.kpi_id=k.id and ev.status='validada') then 'validado'::esg.evidence_level
       when exists (select 1 from esg.evidences ev where ev.assessment_id=a.id and ev.kpi_id=k.id and ev.status in ('pendente','correcao')) then 'comprovado'::esg.evidence_level
       else 'declarado'::esg.evidence_level end as level,
  exists (select 1 from esg.evidences ev where ev.assessment_id=a.id and ev.kpi_id=k.id and ev.status in ('pendente','correcao','validada')) as has_evidence,
  exists (select 1 from esg.evidences ev where ev.assessment_id=a.id and ev.kpi_id=k.id and ev.status='validada') as is_validated
from esg.assessments a
cross join esg.kpis k
left join esg.answers an on an.assessment_id=a.id and an.kpi_id=k.id
where k.active and k.deleted_at is null;

create or replace view esg.v_evidence_validity with (security_invoker = true) as
select e.*, case when e.valid_until is null then 'sem_validade'
  when e.valid_until < current_date then 'vencido'
  when e.valid_until <= current_date + 30 then 'vence_30'
  when e.valid_until <= current_date + 90 then 'vence_90'
  else 'valido' end as validity_status
from esg.evidences e;   -- limites 30/90 fixos na Fase 1; migrar para esg.settings('expiry_alert_days')

create or replace view esg.v_history with (security_invoker = true) as
select distinct on (s.assessment_id) s.*, a.supplier_id, a.cycle_year, a.campaign_id
from esg.scores s join esg.assessments a on a.id = s.assessment_id
order by s.assessment_id, s.calculated_at desc;

-- ========== CÁLCULO DO SCORE (tudo lido de esg.settings / esg.kpis) ==========
-- pontos_kpi = pontuação_da_resposta * fator_do_nível_de_evidência
-- score_dimensão = 100 * Σ(pontos*peso) / Σ(peso) só sobre KPIs aplicáveis E respondidos (sim/nao/parcial)
-- "nao_informado" e "nao_aplicavel" ficam fora do denominador: nunca viram zero.
create or replace function esg.calculate_score(p_assessment uuid) returns uuid
language plpgsql security definer set search_path = esg, core, public as $$
declare
  cfg jsonb; w jsonb; ss jsonb; fac jsonb;
  e numeric; s numeric; g numeric; total numeric; cq numeric; ce numeric; cv numeric; v_id uuid;
begin
  select jsonb_object_agg(key, value) into cfg from esg.settings;
  w := cfg->'dimension_weights'; ss := cfg->'answer_scores'; fac := cfg->'evidence_factors';

  select max(sc) filter (where dimension='E'), max(sc) filter (where dimension='S'), max(sc) filter (where dimension='G')
  into e, s, g from (
    select dimension,
           case when sum(weight) filter (where pt is not null) > 0   -- sem resposta aplicável => NULL (least() ignoraria o NULL e daria 100)
                then least(100, 100 * sum(pt*weight) / sum(weight) filter (where pt is not null)) end as sc
    from (
      select dimension, weight,
        case when state in ('sim','nao','parcial')
             then (ss->>(state::text))::numeric * coalesce((fac->>(level::text))::numeric, 1) end as pt
      from esg.v_kpi_state where assessment_id = p_assessment and state <> 'nao_aplicavel'
    ) x group by dimension
  ) d;

  select sum(v*wt) / nullif(sum(wt), 0) into total
  from (values (e, (w->>'E')::numeric), (s, (w->>'S')::numeric), (g, (w->>'G')::numeric)) t(v, wt)
  where v is not null;

  select 100.0 * count(*) filter (where state not in ('nao_informado','nao_aplicavel')) / nullif(count(*) filter (where state <> 'nao_aplicavel'), 0),
         100.0 * count(*) filter (where requires_evidence and has_evidence and state <> 'nao_aplicavel') / nullif(count(*) filter (where requires_evidence and state <> 'nao_aplicavel'), 0),
         100.0 * count(*) filter (where is_validated) / nullif(count(*) filter (where has_evidence), 0)
  into cq, ce, cv from esg.v_kpi_state where assessment_id = p_assessment;

  insert into esg.scores(assessment_id, score_e, score_s, score_g, score_total, cov_questionnaire, cov_evidence, cov_validated, config_snapshot)
  values (p_assessment, e, s, g, total, cq, ce, cv, cfg) returning id into v_id;
  return v_id;
end $$;

create or replace function esg.classify(p_total numeric) returns text
language sql stable as $$
  select case when p_total is null then 'sem_avaliacao'
    when p_total >= (value->>'conforme')::numeric then 'conforme'
    when p_total >= (value->>'acompanhamento')::numeric then 'em_acompanhamento'
    when p_total >= (value->>'plano_acao')::numeric then 'plano_de_acao'
    else 'critico' end
  from esg.settings where key = 'status_thresholds'; $$;
-- Gancho futuro: incluir pendências abertas e documentos vencidos na classificação.

-- Recalcula ao mudar respostas/evidências
create or replace function esg.tg_recalc() returns trigger language plpgsql security definer set search_path = esg as $$
begin perform esg.calculate_score(coalesce(new.assessment_id, old.assessment_id)); return null; end $$;
drop trigger if exists recalc_answers on esg.answers;
create trigger recalc_answers after insert or update or delete on esg.answers for each row execute function esg.tg_recalc();
drop trigger if exists recalc_evid on esg.evidences;
create trigger recalc_evid after insert or update of status on esg.evidences for each row execute function esg.tg_recalc();

-- Validação aplica o status à evidência (reprovar/correção exige justificativa via CHECK)
create or replace function esg.tg_apply_validation() returns trigger language plpgsql security definer set search_path = esg as $$
begin
  update esg.evidences set status = new.decision, validated_by = new.decided_by,
         validated_at = new.decided_at, note = coalesce(new.justification, note)
  where id = new.evidence_id;
  return null;
end $$;
drop trigger if exists apply_validation on esg.evidence_validations;
create trigger apply_validation after insert on esg.evidence_validations for each row execute function esg.tg_apply_validation();

-- ========== AUDITORIA ==========
create or replace function core.audit() returns trigger language plpgsql security definer set search_path = core, public as $$
declare r jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into core.audit_logs(user_id, action, table_name, record_id, old_value, new_value)
  values (auth.uid(), tg_op, tg_table_schema || '.' || tg_table_name, r->>'id',
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return null;
end $$;

do $$ declare t text; begin
  foreach t in array array['core.suppliers','esg.kpis','esg.questions','esg.settings','esg.campaigns','esg.evidences','esg.evidence_validations','esg.pendencias','esg.scores'] loop
    execute format('drop trigger if exists audit_%s on %s', replace(t,'.','_'), t);
    execute format('create trigger audit_%s after insert or update or delete on %s for each row execute function core.audit()', replace(t,'.','_'), t);
  end loop;
end $$;

-- ========== SEGURANÇA (RLS) ==========
create or replace function core.user_role() returns core.app_role language sql stable security definer set search_path = core as $$
  select role from core.profiles where id = auth.uid() and active $$;
create or replace function core.my_buyer() returns text language sql stable security definer set search_path = core as $$
  select buyer_name from core.profiles where id = auth.uid() and active $$;

alter table core.profiles enable row level security;
drop policy if exists own_profile on core.profiles;
create policy own_profile on core.profiles for select using (id = auth.uid() or core.user_role() = 'admin');
drop policy if exists admin_profiles on core.profiles;
create policy admin_profiles on core.profiles for all using (core.user_role() = 'admin') with check (core.user_role() = 'admin');

do $$ declare t text; begin
  -- Admin total; gestor/validador leem tudo
  foreach t in array array['core.suppliers','core.import_batches','core.audit_logs','esg.settings','esg.kpis','esg.questions','esg.campaigns','esg.campaign_suppliers',
                           'esg.assessments','esg.answers','esg.evidences','esg.evidence_validations','esg.scores','esg.pendencias'] loop
    execute format('alter table %s enable row level security', t);
    execute format('drop policy if exists admin_all on %s', t);
    execute format('create policy admin_all on %s for all using (core.user_role()=''admin'') with check (core.user_role()=''admin'')', t);
    execute format('drop policy if exists staff_read on %s', t);
    execute format('create policy staff_read on %s for select using (core.user_role() in (''gestor'',''validador''))', t);
  end loop;
  -- Configuração legível por todo usuário interno
  foreach t in array array['esg.settings','esg.kpis','esg.questions','esg.campaigns'] loop
    execute format('drop policy if exists buyer_read_cfg on %s', t);
    execute format('create policy buyer_read_cfg on %s for select using (core.user_role() = ''comprador'')', t);
  end loop;
end $$;

-- Comprador: apenas seus fornecedores (suppliers.buyer = profiles.buyer_name)
drop policy if exists buyer_suppliers on core.suppliers;
create policy buyer_suppliers on core.suppliers for select using (core.user_role()='comprador' and buyer = core.my_buyer());
drop policy if exists buyer_assess on esg.assessments;
create policy buyer_assess on esg.assessments for select using (core.user_role()='comprador' and exists (select 1 from core.suppliers s where s.id = supplier_id and s.buyer = core.my_buyer()));
drop policy if exists buyer_pend on esg.pendencias;
create policy buyer_pend on esg.pendencias for select using (core.user_role()='comprador' and exists (select 1 from core.suppliers s where s.id = supplier_id and s.buyer = core.my_buyer()));
drop policy if exists buyer_scores on esg.scores;
create policy buyer_scores on esg.scores for select using (core.user_role()='comprador' and exists (select 1 from esg.assessments a join core.suppliers s on s.id=a.supplier_id where a.id = assessment_id and s.buyer = core.my_buyer()));

-- Gestor gerencia campanhas/avaliações/pendências; validador valida evidências
do $$ declare t text; begin
  foreach t in array array['esg.campaigns','esg.campaign_suppliers','esg.assessments','esg.pendencias'] loop
    execute format('drop policy if exists gestor_write on %s', t);
    execute format('create policy gestor_write on %s for all using (core.user_role()=''gestor'') with check (core.user_role()=''gestor'')', t);
  end loop;
end $$;
drop policy if exists validador_decide on esg.evidence_validations;
create policy validador_decide on esg.evidence_validations for insert with check (core.user_role() in ('validador','gestor'));

-- Storage: bucket privado (acesso por URL assinada; portal do fornecedor via Edge Function na Fase 2)
insert into storage.buckets (id, name, public) values ('evidences', 'evidences', false) on conflict (id) do nothing;
drop policy if exists evid_staff_read on storage.objects;
create policy evid_staff_read on storage.objects for select using (bucket_id = 'evidences' and core.user_role() in ('admin','gestor','validador'));
drop policy if exists evid_admin_write on storage.objects;
create policy evid_admin_write on storage.objects for insert with check (bucket_id = 'evidences' and core.user_role() in ('admin','gestor'));

-- ========== CONFIGURAÇÃO PADRÃO (valores DEMO, editáveis; nenhuma regra oficial assumida) ==========
insert into esg.settings(key, value, description) values
 ('dimension_weights', '{"E":35,"S":35,"G":30}', 'DEMO: pesos E/S/G (normalizados no cálculo)'),
 ('answer_scores', '{"sim":1,"parcial":0.5,"nao":0}', 'DEMO: pontuação por resposta (fração do máximo)'),
 ('evidence_factors', '{"declarado":1,"comprovado":1,"validado":1}', 'Fator por nível de evidência. 1/1/1 = regra desativada (preparado para uso futuro)'),
 ('status_thresholds', '{"conforme":80,"acompanhamento":60,"plano_acao":40}', 'DEMO: faixas de classificação operacional'),
 ('expiry_alert_days', '[90,30]', 'Alertas de validade de documentos'),
 ('max_upload_mb', '20', 'Tamanho máximo por evidência')
on conflict (key) do nothing;
