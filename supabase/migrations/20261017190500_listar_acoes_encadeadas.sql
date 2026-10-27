-- Etapa 3J (revisão final): ações encadeadas ("Adicionar outra ação") que esperam a anterior (`depois_de`) não
-- deveriam aparecer na aba "Fila" mesmo com `agendada_para` já vencida — elas não vão sair até a anterior
-- terminar, então misturadas com o que está mesmo pronto pra rodar só confunde. Ficam na aba "Agendado" enquanto
-- esperam, junto com as de data futura.
--
-- Aditiva: `listar_acoes` trocada com a MESMA assinatura e os MESMOS grants da 20261017190400 (só a regra das
-- abas `fila`/`agendado` muda):
--   * fila: `agendada`, vencida (`agendada_para <= now()`) E sem `depois_de` (não espera nenhuma anterior);
--   * agendado: `agendada`, com (`agendada_para > now()` OU `depois_de is not null`) — a de data futura normal, e
--     a encadeada esperando mesmo que a data dela já tenha passado.

create or replace function listar_acoes(
  p_campanha uuid, p_conexao uuid, p_tipos text[], p_aba text,
  p_inicio timestamptz, p_fim timestamptz, p_limite int, p_deslocamento int,
  p_automacao uuid default null
)
returns table (id uuid, total bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select e.id, e.agendada_para
    from execucoes e
    where (p_campanha is null or e.campanha_id = p_campanha)
      and (p_tipos is null or e.tipo = any(p_tipos))
      and (p_automacao is null or e.automacao_id = p_automacao)
      and e.status <> 'cancelada'
      and not (
        e.origem = 'campanha' and e.tipo = 'atualizar_links' and coalesce(e.gatilho_chave, '') like 'periodico:%'
        and not coalesce('atualizar_links' = any(p_tipos), false)
      )
      -- "conta": execuções com alguma tarefa daquela conexão (`tarefas.conexao_id`).
      and (p_conexao is null or exists (select 1 from tarefas t where t.execucao_id = e.id and t.conexao_id = p_conexao))
      and (p_inicio is null or e.agendada_para >= p_inicio)
      and (p_fim is null or e.agendada_para < p_fim)
      and case p_aba
        when 'fila' then e.status = 'agendada' and e.agendada_para <= now() and e.depois_de is null
        when 'agendado' then e.status = 'agendada' and (e.agendada_para > now() or e.depois_de is not null)
        when 'processando' then e.status = 'enviando'
        when 'sucesso' then e.status = 'concluida'
          and not exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro')
        when 'falhas' then e.status = 'bloqueada'
          or (e.status = 'concluida' and exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro'))
        else true
      end
  )
  select b.id, count(*) over ()
  from base b
  order by b.agendada_para desc, b.id
  limit least(p_limite, 300) offset p_deslocamento
$$;

revoke execute on function listar_acoes(uuid, uuid, text[], text, timestamptz, timestamptz, int, int, uuid) from public, anon;
grant execute on function listar_acoes(uuid, uuid, text[], text, timestamptz, timestamptz, int, int, uuid) to authenticated, service_role;
