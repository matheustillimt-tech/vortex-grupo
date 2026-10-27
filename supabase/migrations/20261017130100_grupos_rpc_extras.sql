-- Etapa 3E (Tarefa 2): aba Grupos — contagem de cliques reais (visitantes únicos), lista de
-- participantes duplicados entre grupos ativos da campanha e selo de "última vez que ATUALIZAR LEADS foi pedido"
-- (pra travar o botão em até 1 por 2 minutos, sem precisar de outra tabela).
--
-- Tudo aqui é aditivo: nenhuma coluna ou função existente perde dado ou comportamento (resumo_grupos precisa ser
-- recriada porque o Postgres não deixa "CREATE OR REPLACE" mudar as colunas de saída de uma função, só o corpo).

alter table campanhas add column leads_atualizados_em timestamptz;

drop function if exists resumo_grupos(uuid);

create function resumo_grupos(p_campanha uuid)
returns table (grupo_id uuid, cliques bigint, cliques_reais bigint, admins bigint, leads bigint)
language sql stable security invoker set search_path = public as $$
  with k as (
    select c.grupo_id, count(*) as n from cliques c
    where c.campanha_id = p_campanha and c.grupo_id is not null
    group by c.grupo_id
  ), r as (
    -- Cliques reais: visitantes únicos (um clique real por pessoa, não por clique).
    select c.grupo_id, count(distinct c.visitante) as n from cliques c
    where c.campanha_id = p_campanha and c.grupo_id is not null
    group by c.grupo_id
  ), p as (
    select p.grupo_id, count(*) filter (where p.admin) as admins, count(*) filter (where not p.admin) as leads
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha and p.saiu_em is null
    group by p.grupo_id
  )
  select g.id, coalesce(k.n, 0), coalesce(r.n, 0), coalesce(p.admins, 0), coalesce(p.leads, 0)
  from grupos g
  left join k on k.grupo_id = g.id
  left join r on r.grupo_id = g.id
  left join p on p.grupo_id = g.id
  where g.campanha_id = p_campanha
$$;

revoke execute on function resumo_grupos(uuid) from public, anon;
grant execute on function resumo_grupos(uuid) to authenticated, service_role;

-- Participantes (saiu_em is null) presentes em mais de um grupo ATIVO da mesma campanha, com os nomes dos
-- grupos (ordem pelo número do grupo). Limitado a 200 telefones (diálogo "Participantes duplicados").
create function participantes_duplicados_campanha(p_campanha uuid)
returns table (telefone text, grupos text[])
language sql stable security invoker set search_path = public as $$
  select p.telefone, array_agg(g.nome order by g.numero)
  from participantes p
  join grupos g on g.id = p.grupo_id
  where g.campanha_id = p_campanha and g.ativo and p.saiu_em is null
  group by p.telefone
  having count(*) > 1
  order by p.telefone
  limit 200
$$;

revoke execute on function participantes_duplicados_campanha(uuid) from public, anon;
grant execute on function participantes_duplicados_campanha(uuid) to authenticated, service_role;
