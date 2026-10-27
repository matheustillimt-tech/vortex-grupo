-- Etapa 2B: números por grupo (aba Grupos) e lista filtrada de mensagens (aba Mensagens). security invoker.

create or replace function resumo_grupos(p_campanha uuid)
returns table (grupo_id uuid, cliques bigint, admins bigint, leads bigint)
language sql stable security invoker set search_path = public as $$
  with k as (
    select c.grupo_id, count(*) as n from cliques c
    where c.campanha_id = p_campanha and c.grupo_id is not null
    group by c.grupo_id
  ), p as (
    select p.grupo_id, count(*) filter (where p.admin) as admins, count(*) filter (where not p.admin) as leads
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha and p.saiu_em is null
    group by p.grupo_id
  )
  select g.id, coalesce(k.n, 0), coalesce(p.admins, 0), coalesce(p.leads, 0)
  from grupos g
  left join k on k.grupo_id = g.id
  left join p on p.grupo_id = g.id
  where g.campanha_id = p_campanha
$$;

-- Abas: todas (menos canceladas), fila (agendada vencida), agendado (agendada futura), processando (enviando),
-- sucesso (concluída sem tarefa com erro), falhas (bloqueada, ou concluída com alguma tarefa com erro).
create or replace function listar_execucoes(p_campanha uuid, p_aba text, p_inicio timestamptz, p_fim timestamptz, p_limite int, p_deslocamento int)
returns table (id uuid, total bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select e.id, e.agendada_para
    from execucoes e
    where e.campanha_id = p_campanha
      and e.tipo in ('mensagem', 'enquete')
      and e.status <> 'cancelada'
      and (p_inicio is null or e.agendada_para >= p_inicio)
      and (p_fim is null or e.agendada_para < p_fim)
      and case p_aba
        when 'fila' then e.status = 'agendada' and e.agendada_para <= now()
        when 'agendado' then e.status = 'agendada' and e.agendada_para > now()
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
  limit least(p_limite, 100) offset p_deslocamento
$$;

revoke execute on function resumo_grupos(uuid), listar_execucoes(uuid, text, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function resumo_grupos(uuid), listar_execucoes(uuid, text, timestamptz, timestamptz, int, int) to authenticated, service_role;
