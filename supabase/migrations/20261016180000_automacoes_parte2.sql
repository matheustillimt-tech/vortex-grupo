-- Etapa 2F: gatilhos de pessoa e checkout; ações de admin/link/remover; fila de remoções com atraso e sem repetir.

alter table automacoes drop constraint automacoes_gatilho_check;
alter table automacoes add constraint automacoes_gatilho_check
  check (gatilho in ('cronograma', 'grupo_criado', 'grupo_cheio', 'entrou', 'saiu', 'checkout'));
alter table automacoes
  add column provedor text check (provedor is null or provedor in ('vortex', 'pagarme', 'hotmart', 'kiwify')),
  add column produto text check (produto is null or char_length(produto) between 1 and 120),
  add constraint automacoes_checkout_campos check ((gatilho = 'checkout') = (provedor is not null and produto is not null));

alter table automacao_acoes drop constraint automacao_acoes_tipo_check;
alter table automacao_acoes add constraint automacao_acoes_tipo_check
  check (tipo in ('mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link', 'remover_participante'));

alter table acoes
  add column executar_apos timestamptz not null default now(),
  add column automacao_id uuid references automacoes (id) on delete set null,
  add column automacao_acao_id uuid references automacao_acoes (id) on delete set null,
  add column gatilho_chave text;
create unique index acoes_automacao_unica on acoes (automacao_acao_id, gatilho_chave);
create index acoes_automacao on acoes (automacao_id) where automacao_id is not null;

-- Conferência de grupos: desde quando a leitura do WhatsApp está estranha (lista vazia, sem o nosso número ou metade
-- sumindo). Depois de 10 minutos assim, a leitura é aceita (sem automações de pessoas). Rodada normal limpa.
alter table grupos add column leitura_suspeita_desde timestamptz;

-- Fila de ações respeita "executar a partir de" (remoção com atraso).
create or replace function pegar_acoes(limite int) returns setof acoes language plpgsql as $$
begin
  update acoes set status = 'fila' where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update acoes set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select id from acoes where status = 'fila' and executar_apos <= now() order by created_at limit limite for update skip locked
  )
  returning *;
end $$;
revoke execute on function pegar_acoes(int) from public, anon, authenticated;
grant execute on function pegar_acoes(int) to service_role;

-- Placar soma execuções (sem canceladas) e remoções da automação.
create or replace function resumo_automacoes(p_ids uuid[])
returns table (automacao_id uuid, total bigint, agendadas bigint, enviando bigint, concluidas bigint, falhas bigint)
language sql stable security invoker set search_path = public as $$
  with ex as (
    select e.automacao_id,
      count(*) as total,
      count(*) filter (where e.status = 'agendada') as agendadas,
      count(*) filter (where e.status = 'enviando') as enviando,
      count(*) filter (where e.status = 'concluida'
        and not exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro')) as concluidas,
      count(*) filter (where e.status = 'bloqueada'
        or (e.status = 'concluida' and exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro'))) as falhas
    from execucoes e
    where e.automacao_id = any (p_ids) and e.status <> 'cancelada'
    group by e.automacao_id
  ), ac as (
    select a.automacao_id,
      count(*) as total,
      count(*) filter (where a.status = 'fila') as agendadas,
      count(*) filter (where a.status = 'processando') as enviando,
      count(*) filter (where a.status = 'ok') as concluidas,
      count(*) filter (where a.status = 'erro') as falhas
    from acoes a
    where a.automacao_id = any (p_ids)
    group by a.automacao_id
  )
  select coalesce(ex.automacao_id, ac.automacao_id),
    coalesce(ex.total, 0) + coalesce(ac.total, 0),
    coalesce(ex.agendadas, 0) + coalesce(ac.agendadas, 0),
    coalesce(ex.enviando, 0) + coalesce(ac.enviando, 0),
    coalesce(ex.concluidas, 0) + coalesce(ac.concluidas, 0),
    coalesce(ex.falhas, 0) + coalesce(ac.falhas, 0)
  from ex full join ac on ac.automacao_id = ex.automacao_id
$$;
revoke execute on function resumo_automacoes(uuid[]) from public, anon;
grant execute on function resumo_automacoes(uuid[]) to authenticated, service_role;
