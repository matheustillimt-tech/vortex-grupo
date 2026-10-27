-- Etapa 3N, Tarefa 3: Hook "Solicitações de entrada em grupos".
-- Só aditiva: o check de `webhooks.eventos` ganha 'solicitacoes_entrada' e mantém TODOS os 15 valores de antes
-- (20261017200400_hooks_eventos.sql). Nenhuma coluna nova. `eventos_saida` não tem check de evento (o evento vai
-- dentro do `payload`), então nada muda lá.
--
-- Mesmo bloco de 20261017200400: em vez de confiar no nome, apaga todo check da tabela `webhooks` cuja definição usa
-- a coluna `eventos` (lido em pg_constraint) e recria com o mesmo nome fixo.
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
    'conta_pareada', 'conta_deslogada',
    'solicitacoes_entrada'
  ]::text[]
);
