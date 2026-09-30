-- UNIDASUL ESG FORNECEDORES | 004_settings_recalc.sql  (rodar depois de 001, 002 e 003)

-- Alertas de validade passam a ler esg.settings('expiry_alert_days') = [dias_medio_prazo, dias_curto_prazo]
create or replace view esg.v_evidence_validity with (security_invoker = true) as
select e.*, case
  when e.valid_until is null then 'sem_validade'
  when e.valid_until < current_date then 'vencido'
  when e.valid_until <= current_date + coalesce((select (value->>1)::int from esg.settings where key = 'expiry_alert_days'), 30) then 'vence_30'
  when e.valid_until <= current_date + coalesce((select (value->>0)::int from esg.settings where key = 'expiry_alert_days'), 90) then 'vence_90'
  else 'valido' end as validity_status
from esg.evidences e;   -- vence_30 = curto prazo (laranja), vence_90 = médio prazo (amarelo)

-- Recalcula todas as avaliações com a configuração atual (novo snapshot; o histórico de cálculos anteriores permanece)
create or replace function esg.recalculate_all() returns int
language plpgsql security definer set search_path = esg, core, public as $$
declare n int := 0; r record;
begin
  if core.user_role() is distinct from 'admin' then raise exception 'sem permissão'; end if;
  for r in select id from esg.assessments loop perform esg.calculate_score(r.id); n := n + 1; end loop;
  return n;
end $$;
revoke all on function esg.recalculate_all() from public, anon, authenticated;
grant execute on function esg.recalculate_all() to authenticated;
