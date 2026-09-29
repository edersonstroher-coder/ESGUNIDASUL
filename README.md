# UNIDASUL ESG FORNECEDORES — Fase 1 (parte 1: banco e segurança)

## Como subir o banco
1. Crie um projeto no Supabase (ou use um existente).
2. **SQL Editor** → rode `supabase/migrations/001_schema.sql`.
3. Opcional: rode `supabase/seed_demo.sql` para ver dados **DEMO** e o score calculado.
4. **Authentication → Users → Add user** (e-mail e senha) para você.
5. Torne esse usuário ADMIN (troque o e-mail):
   ```sql
   insert into core.profiles (id, full_name, role)
   select id, 'Ederson', 'admin' from auth.users where email = 'SEU_EMAIL';
   ```
6. **Settings → API → Exposed schemas**: adicione `core` e `esg` (necessário para o frontend acessá-los).

## Conferindo o cálculo
```sql
select s.company_name, h.score_e, h.score_s, h.score_g, h.score_total,
       h.cov_questionnaire, esg.classify(h.score_total) as status
from esg.v_history h join core.suppliers s on s.id = h.supplier_id;
```

## Remover dados DEMO
```sql
delete from esg.scores where assessment_id in (select a.id from esg.assessments a join core.suppliers s on s.id=a.supplier_id where s.is_demo);
delete from esg.answers where assessment_id in (select a.id from esg.assessments a join core.suppliers s on s.id=a.supplier_id where s.is_demo);
delete from esg.assessments where supplier_id in (select id from core.suppliers where is_demo);
delete from esg.campaigns where is_demo; delete from esg.questions where is_demo;
delete from esg.kpis where is_demo; delete from core.suppliers where is_demo;
```

## Decisões desta entrega
- Score, cobertura e classificação são calculados **no banco** (`esg.calculate_score`, `esg.classify`), sempre a partir de `esg.settings` e `esg.kpis`.
- Cada cálculo grava um snapshot da configuração usada; o histórico nunca é sobrescrito.
- Valores de `settings` (pesos 35/35/30, pontuação sim/parcial/não, faixas 80/60/40) são **DEMO** e editáveis. Fatores de evidência ficam 1/1/1 (regra desativada).
- Fase 1 usa uma resposta consolidada por KPI. Várias perguntas por KPI ficam para depois.
- Limites de validade 30/90 dias estão fixos na view `v_evidence_validity` e migram para `settings` em seguida.

## Próximos passos (Fase 1, parte 2)
Login e shell do admin, importação de fornecedores (CSV/XLSX com mapeamento e prévia), Matriz de KPIs, questionário, evidências, dashboard básico.
