-- Etapa 3N, Task 1: Grupo VIP Hotmart de verdade. Uma venda aprovada de produto VIP vira uma linha em `vip_entradas`
-- (uma por venda e campanha) e o job `processarVip` (tick) adiciona o comprador ao grupo VIP. Só aditiva:
--   * `vip_ativo` nasce false e nenhuma regra nasce `modo = 'vip'` = o cron faz as mesmas chamadas e escritas de hoje;
--   * `regras_compra.modo` nasce 'remover' em todas as linhas existentes ("Remover compradores" continua igual);
--   * `alertas_tipo_check` ganha 'vip_convite' e 'vip_erro', mantendo os 9 de hoje.

-- 1. Configuração do Grupo VIP na campanha (a da regra de compra).
--    SEM FK de propósito: `vip_campanha_id` e `vip_grupo_id` apontam pra `campanhas` e `grupos`, mas uma segunda chave
--    entre `campanhas` e `grupos` (ou de `campanhas` pra ela mesma) deixa ambíguos os `campanhas(...)` embutidos a partir
--    de `grupos` no PostgREST (erro PGRST201), usados na conferência, nas vendas e nas telas. A validade é conferida na
--    action `salvarConfigVip` e no job (campanha apagada/arquivada ou grupo inativo viram `erro` + alerta).
alter table campanhas add column vip_ativo boolean not null default false;
alter table campanhas add column vip_campanha_id uuid;
alter table campanhas add column vip_grupo_id uuid;
alter table campanhas add column vip_mensagem text check (vip_mensagem is null or char_length(vip_mensagem) <= 1000);

-- 2. Produtos por modo: 'remover' (o de hoje, tira dos grupos desta campanha) ou 'vip' (adiciona no grupo VIP).
alter table regras_compra add column modo text not null default 'remover' check (modo in ('remover', 'vip'));
create index regras_compra_provedor_modo on regras_compra (provedor, modo);

-- 3. Fila do Grupo VIP: uma linha por venda e campanha (`unique`): venda reprocessada ou webhook repetido não duplicam.
--    `campanha_id` é a campanha da regra (única FK pra `campanhas`); `vip_campanha_id` fica sem FK (ver item 1).
create table vip_entradas (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  venda_id uuid not null references vendas (id) on delete cascade,
  campanha_id uuid not null references campanhas (id) on delete cascade,
  vip_campanha_id uuid,
  grupo_id uuid references grupos (id) on delete set null,
  telefone text not null,
  -- convite_pendente: marcado antes do send-text (vira convite_enviado só com o messageId); convite_repetido: outra
  -- campanha já convidou nesta compra.
  status text not null default 'fila' check (status in ('fila', 'processando', 'adicionado', 'ja_estava', 'convite_pendente', 'convite_enviado',
                                                        'convite_repetido', 'bloqueado', 'erro')),
  tentativas int not null default 0,
  erro text,
  pego_em timestamptz,
  processado_em timestamptz,
  unique (venda_id, campanha_id)
);
create index vip_entradas_fila on vip_entradas (created_at) where status = 'fila';
create index vip_entradas_processando on vip_entradas (pego_em) where status = 'processando';
create index vip_entradas_campanha on vip_entradas (campanha_id, created_at desc);
-- Convite no privado no máximo uma vez por venda, mesmo com duas campanhas VIP casando com a mesma compra: o job marca
-- `convite_pendente` ANTES de mandar, e a segunda marca da mesma venda é recusada aqui (23505).
create unique index vip_entradas_um_convite_por_venda on vip_entradas (venda_id) where status in ('convite_pendente', 'convite_enviado');

alter table vip_entradas enable row level security;
-- A equipe só lê (Histórico VIP da seção); quem grava é o servidor, com a service role (vendas e o job).
create policy equipe_le on vip_entradas for select to authenticated using (true);
revoke all on vip_entradas from anon, authenticated;
grant select on vip_entradas to authenticated;
grant select, insert, update on vip_entradas to service_role;

-- 4. Pega até `p_n` linhas da fila (e as presas em 'processando' há mais de 10 minutos), sem duas rodadas pegarem a
--    mesma linha (`for update skip locked`, como `pegar_acoes`). Não mexe em `tentativas`: quem conta é o job.
create or replace function pegar_vip(p_n int) returns setof vip_entradas
language plpgsql security definer set search_path = public as $$
begin
  return query
  update vip_entradas set status = 'processando', pego_em = now()
  where id in (
    select id from vip_entradas
    where status = 'fila' or (status = 'processando' and pego_em < now() - interval '10 minutes')
    order by created_at
    limit greatest(0, least(coalesce(p_n, 0), 100))
    for update skip locked
  )
  returning *;
end $$;
revoke execute on function pegar_vip(int) from public, anon, authenticated;
grant execute on function pegar_vip(int) to service_role;

-- 5. Alertas novos, mantendo os 9 de hoje (definição atual em 20261017190100_links_entregas.sql).
alter table alertas drop constraint alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro', 'bloqueado_removido', 'antispam_sem_conta', 'entrega_nao_confirmada',
                  'vip_convite', 'vip_erro'));
