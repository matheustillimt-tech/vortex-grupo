-- Etapa 3K, Tarefa 5: Hooks com os eventos que o Vórtex Grupo já detecta.
-- Só aditiva: o check de `webhooks.eventos` ganha 11 valores e mantém os 4 de antes ('entrou', 'saiu', 'alerta',
-- 'compra'); nenhuma coluna nova (o token é o `segredo` que já existe).
--
-- O check era inline em 20261016210000_webhooks_historico.sql (nome gerado pelo Postgres, normalmente
-- `webhooks_eventos_check`). Em vez de confiar no nome, apaga todo check da tabela `webhooks` cuja definição usa a
-- coluna `eventos` (lido em pg_constraint) e cria o novo com nome fixo.
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.webhooks'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%eventos%'
  loop
    execute format('alter table public.webhooks drop constraint %I', c.conname);
  end loop;
end $$;

alter table webhooks add constraint webhooks_eventos_check check (
  array_length(eventos, 1) >= 1
  and eventos <@ array[
    'entrou', 'saiu', 'alerta', 'compra',
    'metricas_campanha', 'metricas_mensagens', 'sem_conta', 'falha_disparo', 'acao_concluida',
    'grupo_criado', 'grupo_cheio', 'grupo_suspenso',
    'mensagem_recebida',
    'conta_pareada', 'conta_deslogada'
  ]::text[]
);
