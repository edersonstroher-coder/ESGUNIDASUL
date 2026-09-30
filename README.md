# UNIDASUL ESG FORNECEDORES

Sistema web de avaliação ESG de fornecedores (HTML/JS + Supabase). Cadastro mestre de fornecedores preservado; o módulo ESG só acrescenta informação.

## Como colocar no ar
1. **Supabase**: crie o projeto. No **SQL Editor** rode, nesta ordem:
   `supabase/migrations/001_schema.sql` → `002_campaigns_portal.sql` → (opcional) `supabase/seed_demo.sql`.
   > Se rodar o 001 de novo, rode o 002 em seguida (ele redefine funções).
2. **Settings → API → Exposed schemas**: adicione `core` e `esg`.
3. **Primeiro administrador**: crie o usuário em Authentication → Users e rode:
   ```sql
   insert into core.profiles (id, full_name, role) select id, 'Seu nome', 'admin' from auth.users where email = 'SEU_EMAIL';
   ```
   Outros perfis: `gestor`, `comprador` (preencha `buyer_name` igual ao campo Comprador dos fornecedores), `validador`.
4. **Edge Function do portal** (upload de evidências pelo fornecedor):
   `supabase functions deploy portal-upload --no-verify-jwt`
5. **Frontend**: preencha `src/config.js` (URL e anon key). Publique a pasta na Vercel (projeto estático, sem build) ou teste local com `npx serve .` — precisa de servidor HTTP, não abre por `file://` (usa ES Modules).
6. Portal do fornecedor: `portal.html?t=TOKEN` (os links saem em CSV ao convidar fornecedores).

## Fluxo de uso
Importar fornecedores → criar campanha → selecionar e convidar (baixar CSV de links) → fornecedor responde no portal → equipe valida evidências → score E/S/G e coberturas recalculados automaticamente → dashboard, histórico, relatório (Imprimir → salvar PDF) e destaques.

## O que foi verificado
- As duas migrações e o seed rodaram sem erro em PostgreSQL 16 local (com stubs de `auth`/`storage`).
- Testado no banco: score e cobertura (inclusive dimensão sem respostas = vazio, não 100/0), `nao_informado` fora do denominador, token inválido rejeitado, `anon` sem acesso às tabelas, portal sem vazar dados internos, justificativa obrigatória em reprovação, pendência automática e status da avaliação na validação, auditoria.
- Sintaxe de todos os módulos JS validada com `node --check`; CNPJ testado.
- **Não testado**: as telas rodando no navegador contra um Supabase real, a Edge Function e o Storage. Espere pequenos ajustes no primeiro uso.

## Decisões e limites conhecidos
- Score, cobertura e classificação vivem no banco e leem `esg.settings`/`esg.kpis`. Valores em `settings` são **DEMO** (pesos 35/35/30, sim=1/parcial=0,5/não=0, faixas 80/60/40). Fatores de evidência 1/1/1 = regra de bônus preparada, desativada.
- Uma resposta consolidada por KPI (a pergunta ativa de menor ordem é a exibida).
- Lembretes: só o controle (datas e contagem); não há envio automático de e-mail. Estrutura pronta para automatizar depois.
- Limites de validade 30/90 dias estão na view `esg.v_evidence_validity` (o setting `expiry_alert_days` ainda não é lido por ela).
- Relatório PDF via impressão do navegador. A "carteira" de reconhecimento usa o botão de imprimir dos Destaques.
- Upload do fornecedor: a Edge Function registra a evidência antes do arquivo terminar de subir; se o upload falhar, sobra um registro sem arquivo (tratável na validação: "Reprovar").
- Integração futura: tabela `core.module_scores` e cadastro mestre em `core.suppliers`.
- Dados DEMO têm flag `is_demo` e o dashboard os oculta se houver fornecedores reais (instruções de limpeza no fim do arquivo `seed_demo.sql` / abaixo).

## Remover dados DEMO
```sql
delete from esg.answers where assessment_id in (select a.id from esg.assessments a join core.suppliers s on s.id=a.supplier_id where s.is_demo);
delete from esg.scores where assessment_id in (select a.id from esg.assessments a join core.suppliers s on s.id=a.supplier_id where s.is_demo);
delete from esg.evidence_validations where evidence_id in (select e.id from esg.evidences e join core.suppliers s on s.id=e.supplier_id where s.is_demo);
delete from esg.evidences where supplier_id in (select id from core.suppliers where is_demo);
delete from esg.pendencias where supplier_id in (select id from core.suppliers where is_demo);
delete from esg.assessments where supplier_id in (select id from core.suppliers where is_demo);
delete from esg.campaign_suppliers where supplier_id in (select id from core.suppliers where is_demo);
delete from esg.campaigns where is_demo; delete from esg.questions where is_demo; delete from esg.kpis where is_demo;
delete from core.suppliers where is_demo;
```
