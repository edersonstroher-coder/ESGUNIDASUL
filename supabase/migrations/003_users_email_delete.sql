-- UNIDASUL ESG FORNECEDORES | 003_users_email_delete.sql
-- Rodar DEPOIS de 001 e 002.

-- E-mail do fornecedor (para envio do link do questionário)
alter table core.suppliers add column if not exists email text;

-- A avaliação é do fornecedor, não do comprador: o perfil "comprador" passa a ler todos os fornecedores (somente leitura).
drop policy if exists buyer_suppliers on core.suppliers;
drop policy if exists buyer_assess on esg.assessments;
drop policy if exists buyer_pend on esg.pendencias;
drop policy if exists buyer_scores on esg.scores;
do $$ declare t text; begin
  foreach t in array array['core.suppliers','esg.assessments','esg.answers','esg.evidences','esg.scores','esg.pendencias'] loop
    execute format('drop policy if exists viewer_read on %s', t);
    execute format('create policy viewer_read on %s for select using (core.user_role() = ''comprador'')', t);
  end loop;
end $$;

-- Excluir campanha (somente admin). Devolve os caminhos dos arquivos para o frontend removê-los do Storage.
create or replace function esg.delete_campaign(p_campaign uuid) returns text[]
language plpgsql security definer set search_path = esg, core, public as $$
declare paths text[];
begin
  if core.user_role() is distinct from 'admin' then raise exception 'sem permissão'; end if;
  if not exists (select 1 from esg.campaigns where id = p_campaign) then raise exception 'campanha inexistente'; end if;
  select coalesce(array_agg(e.storage_path), '{}') into paths
    from esg.evidences e join esg.assessments a on a.id = e.assessment_id where a.campaign_id = p_campaign;
  delete from esg.evidence_validations where evidence_id in (select e.id from esg.evidences e join esg.assessments a on a.id = e.assessment_id where a.campaign_id = p_campaign);
  delete from esg.evidences where assessment_id in (select id from esg.assessments where campaign_id = p_campaign);
  delete from esg.answers  where assessment_id in (select id from esg.assessments where campaign_id = p_campaign);  -- dispara recálculo...
  delete from esg.scores   where assessment_id in (select id from esg.assessments where campaign_id = p_campaign);  -- ...por isso os scores saem depois
  delete from esg.assessments where campaign_id = p_campaign;
  delete from esg.campaign_suppliers where campaign_id = p_campaign;
  delete from esg.campaigns where id = p_campaign;
  return paths;
end $$;
revoke all on function esg.delete_campaign(uuid) from public, anon, authenticated;
grant execute on function esg.delete_campaign(uuid) to authenticated;

drop policy if exists evid_admin_delete on storage.objects;
create policy evid_admin_delete on storage.objects for delete using (bucket_id = 'evidences' and core.user_role() = 'admin');
