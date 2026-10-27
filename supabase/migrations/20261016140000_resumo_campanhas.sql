-- Resumo por campanha para a lista e a Visão geral: clicks, entradas e saídas desde p_desde e o
-- total atual de participantes, admins e grupos. Mesmas regras de metricas_campanha (entrada não conta importado nem
-- admin; saída não conta admin). security invoker: respeita o RLS de quem chama.
-- Agrega cada fonte uma única vez (CTEs) em vez de 4 subconsultas correlacionadas por campanha, que em 60 campanhas
-- / 100k participantes varriam `participantes` repetidas vezes (~1.5s).
create or replace function resumo_campanhas(p_desde timestamptz, p_campanha uuid default null)
returns table (campanha_id uuid, cliques bigint, entradas bigint, saidas bigint, participantes bigint, admins bigint, grupos bigint, grupos_cheios bigint)
language sql stable security invoker set search_path = public as $$
  with part as (
    select
      g.campanha_id,
      count(*) filter (where p.importado = false and p.admin = false and p.entrou_em >= p_desde) as entradas,
      count(*) filter (where p.admin = false and p.saiu_em >= p_desde) as saidas,
      count(*) filter (where g.ativo and p.saiu_em is null) as participantes,
      count(*) filter (where g.ativo and p.saiu_em is null and p.admin) as admins
    from participantes p
    join grupos g on g.id = p.grupo_id
    where p_campanha is null or g.campanha_id = p_campanha
    group by g.campanha_id
  ), click as (
    select campanha_id, count(*) as cliques
    from cliques
    where created_at >= p_desde and (p_campanha is null or campanha_id = p_campanha)
    group by campanha_id
  ), grupo as (
    select campanha_id, count(*) as grupos, count(*) filter (where cheio) as grupos_cheios
    from grupos
    where ativo and (p_campanha is null or campanha_id = p_campanha)
    group by campanha_id
  )
  select
    c.id,
    coalesce(click.cliques, 0),
    coalesce(part.entradas, 0),
    coalesce(part.saidas, 0),
    coalesce(part.participantes, 0),
    coalesce(part.admins, 0),
    coalesce(grupo.grupos, 0),
    coalesce(grupo.grupos_cheios, 0)
  from campanhas c
  left join part on part.campanha_id = c.id
  left join click on click.campanha_id = c.id
  left join grupo on grupo.campanha_id = c.id
  where p_campanha is null or c.id = p_campanha
$$;
revoke execute on function resumo_campanhas(timestamptz, uuid) from public, anon;
grant execute on function resumo_campanhas(timestamptz, uuid) to authenticated, service_role;
