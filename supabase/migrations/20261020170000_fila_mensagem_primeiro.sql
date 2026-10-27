-- Fila (20/10/2026): o que é enviado dentro do grupo sai primeiro. Mensagens e enquetes passam a ter prioridade 0 e
-- as ações no grupo (nome, imagem, descrição, links…) 1, e `pegar_tarefas` ordena pela prioridade ANTES do horário:
-- entre as tarefas já vencidas, a mensagem passa na frente de troca de nome/imagem que estava na fila antes dela.
-- No lançamento de 19/10, as 28 trocas de nome/imagem das 20h saíram antes e a mensagem das 20h só começou 20h03.
-- Tarefas que estavam na fila com a prioridade antiga são invertidas aqui.
update tarefas set prioridade = 1 - prioridade where status = 'fila';

create or replace function pegar_tarefas(limite int) returns setof tarefas language plpgsql as $$
begin
  update tarefas set status = 'erro', erro = 'Tarefa interrompida: pode ter sido feita. Confira no grupo antes de repetir.'
  where status = 'processando' and pego_em < now() - interval '5 minutes';
  return query
  update tarefas set status = 'processando', pego_em = now(), tentativas = tentativas + 1
  where id in (
    select t.id from tarefas t join conexoes c on c.id = t.conexao_id
    where t.status = 'fila' and t.enviar_apos <= now() and (c.pausado_ate is null or c.pausado_ate <= now())
    order by t.prioridade, t.enviar_apos
    limit limite
    for update of t skip locked
  )
  returning *;
end $$;
