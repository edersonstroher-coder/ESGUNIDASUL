-- UNIDASUL ESG FORNECEDORES | 005_esg_program.sql  (rodar depois de 001-004; não reexecute a 004 depois desta)
-- Permite ao fornecedor anexar o PROGRAMA ESG PRÓPRIO inteiro (documento não vinculado a um KPI da Unidasul).

alter table esg.evidences alter column kpi_id drop not null;
alter table esg.evidences add column if not exists is_esg_program boolean not null default false;
alter table esg.evidences drop constraint if exists evid_kpi_or_program;
alter table esg.evidences add constraint evid_kpi_or_program check (is_esg_program or kpi_id is not null);

-- A view precisa ser recriada para enxergar a coluna nova
drop view if exists esg.v_evidence_validity;
create view esg.v_evidence_validity with (security_invoker = true) as
select e.*, case
  when e.valid_until is null then 'sem_validade'
  when e.valid_until < current_date then 'vencido'
  when e.valid_until <= current_date + coalesce((select (value->>1)::int from esg.settings where key = 'expiry_alert_days'), 30) then 'vence_30'
  when e.valid_until <= current_date + coalesce((select (value->>0)::int from esg.settings where key = 'expiry_alert_days'), 90) then 'vence_90'
  else 'valido' end as validity_status
from esg.evidences e;
grant select on esg.v_evidence_validity to authenticated;

-- Validação: pendência automática também para o programa próprio (sem KPI)
create or replace function esg.tg_apply_validation() returns trigger language plpgsql security definer set search_path = esg, core, public as $$
declare ev esg.evidences;
begin
  update esg.evidences set status = new.decision, validated_by = new.decided_by,
         validated_at = new.decided_at, note = coalesce(new.justification, note)
  where id = new.evidence_id returning * into ev;

  if new.decision = 'correcao' then
    update esg.assessments set status = 'em_andamento' where id = ev.assessment_id;
  elsif ev.assessment_id is not null then
    update esg.assessments set status = 'em_validacao' where id = ev.assessment_id and status = 'enviada';
  end if;

  if new.decision in ('reprovada','correcao') then
    insert into esg.pendencias(supplier_id, kpi_id, dimension, title, origin, status, priority, note)
    values (ev.supplier_id, ev.kpi_id, (select dimension from esg.kpis where id = ev.kpi_id),
            case when ev.is_esg_program then 'Programa ESG próprio ' else 'Evidência ' end || new.decision::text || ': ' || ev.original_name,
            'validacao', 'aguardando_documento', 'alta', new.justification);
  elsif new.decision = 'validada' then
    update esg.pendencias set status = 'resolvida', closed_at = now()
    where supplier_id = ev.supplier_id and kpi_id is not distinct from ev.kpi_id and origin = 'validacao' and status <> 'resolvida';
  end if;
  return null;
end $$;
