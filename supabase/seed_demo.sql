-- UNIDASUL ESG FORNECEDORES | seed_demo.sql
-- Todos os registros levam is_demo = true. Remover: delete ... where is_demo (ver README).

insert into esg.kpis (code, name, dimension, category, weight, requires_evidence, evidence_type, validity_days, sort_order, is_demo) values
 ('DEMO-E01','[DEMO] Licença ambiental de operação','E','Licenciamento',3,true,'PDF',365,1,true),
 ('DEMO-E02','[DEMO] Gestão de resíduos','E','Resíduos',2,false,null,null,2,true),
 ('DEMO-S01','[DEMO] Política contra trabalho infantil/forçado','S','Direitos humanos',3,true,'PDF',null,3,true),
 ('DEMO-S02','[DEMO] Saúde e segurança ocupacional','S','SST',2,true,'PDF',365,4,true),
 ('DEMO-G01','[DEMO] Código de conduta','G','Ética',2,true,'PDF',null,5,true),
 ('DEMO-G02','[DEMO] Canal de denúncias','G','Ética',1,false,null,null,6,true)
on conflict (code) do nothing;

insert into esg.questions (kpi_id, question, answer_type, required, sort_order, is_demo)
select id, 'A empresa atende ao critério: ' || name || '?', 'sim_nao_parcial', true, sort_order, true
from esg.kpis where is_demo and not exists (select 1 from esg.questions q where q.kpi_id = esg.kpis.id);

insert into core.suppliers (supplier_code, cnpj, company_name, trade_name, buyer, category, is_demo) values
 ('DEMO001','11222333000181','[DEMO] Fornecedor Alfa Ltda','Alfa','Comprador Demo','Mercearia',true),
 ('DEMO002','45997418000153','[DEMO] Fornecedor Beta S.A.','Beta','Comprador Demo','Bebidas',true),
 ('DEMO003','11444777000161','[DEMO] Fornecedor Gama ME','Gama','Comprador Demo','Higiene',true)
on conflict do nothing;

insert into esg.campaigns (name, description, cycle_year, status, is_demo)
select '[DEMO] Programa ESG Fornecedores', 'Campanha fictícia para demonstração', extract(year from current_date)::int, 'ativa', true
where not exists (select 1 from esg.campaigns where is_demo);

insert into esg.assessments (campaign_id, supplier_id, cycle_year, status)
select c.id, s.id, c.cycle_year, 'em_andamento'
from esg.campaigns c cross join core.suppliers s where c.is_demo and s.is_demo
on conflict do nothing;

-- Respostas fictícias (Alfa completo, Beta parcial, Gama quase sem resposta) -> dispara o recálculo
insert into esg.answers (assessment_id, kpi_id, state)
select a.id, k.id,
  case s.supplier_code
    when 'DEMO001' then 'sim'::esg.answer_state
    when 'DEMO002' then (case when k.sort_order % 2 = 0 then 'parcial' else 'sim' end)::esg.answer_state
    else (case when k.sort_order = 1 then 'nao' else 'nao_informado' end)::esg.answer_state end
from esg.assessments a
join core.suppliers s on s.id = a.supplier_id and s.is_demo
join esg.kpis k on k.is_demo
on conflict (assessment_id, kpi_id) do nothing;

-- Conferência: select s.company_name, sc.* from esg.v_history sc join core.suppliers s on s.id = sc.supplier_id;
