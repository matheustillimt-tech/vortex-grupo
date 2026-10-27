-- Cliques, entradas e saídas por dia (Brasília) de todas as campanhas não arquivadas (como os cartões da tela
-- Métricas). Mesmas regras de metricas_campanha. security invoker: respeita o RLS de quem chama.
create or replace function metricas_gerais(p_desde timestamptz)
returns table (dia date, cliques bigint, entradas bigint, saidas bigint)
language sql stable security invoker set search_path = public as $$
  with c as (
    select (k.created_at at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from cliques k
    join campanhas ca on ca.id = k.campanha_id
    where k.created_at >= p_desde and not ca.arquivada
    group by 1
  ), e as (
    select (p.entrou_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from participantes p
    join grupos g on g.id = p.grupo_id
    join campanhas ca on ca.id = g.campanha_id
    where p.importado = false and p.admin = false and p.entrou_em >= p_desde and not ca.arquivada
    group by 1
  ), s as (
    select (p.saiu_em at time zone 'America/Sao_Paulo')::date as d, count(*) as n
    from participantes p
    join grupos g on g.id = p.grupo_id
    join campanhas ca on ca.id = g.campanha_id
    where p.admin = false and p.saiu_em >= p_desde and not ca.arquivada
    group by 1
  )
  select d, coalesce(c.n, 0), coalesce(e.n, 0), coalesce(s.n, 0)
  from c full join e using (d) full join s using (d)
  order by d
$$;
revoke execute on function metricas_gerais(timestamptz) from public, anon;
grant execute on function metricas_gerais(timestamptz) to authenticated, service_role;

-- Cliques por campanha desde p_desde (leve: só o que a tela Métricas precisa pra achar campanhas ativas sem
-- cliques hoje, em vez de chamar resumo_campanhas de novo só por isso).
create or replace function cliques_por_campanha(p_desde timestamptz)
returns table (campanha_id uuid, cliques bigint)
language sql stable security invoker set search_path = public as $$
  select k.campanha_id, count(*) as cliques
  from cliques k
  where k.created_at >= p_desde
  group by k.campanha_id
$$;
revoke execute on function cliques_por_campanha(timestamptz) from public, anon;
grant execute on function cliques_por_campanha(timestamptz) to authenticated, service_role;

-- Índices pras consultas da tela Métricas (cliques por período, participantes que saíram).
create index if not exists cliques_data on cliques (created_at);
create index if not exists participantes_saiu on participantes (saiu_em) where saiu_em is not null;
