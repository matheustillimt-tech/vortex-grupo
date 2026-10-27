-- Etapa 3N, Task 4: tabela "Desempenho por grupo" abaixo do gráfico, com paginação e critério em destaque.
-- `desempenho_grupos` (20261017150000) fica intacta: o gráfico e a exportação de hoje continuam usando ela. Esta
-- função nova devolve os 4 sinais por grupo (não só o do critério escolhido), para a tabela mostrar todas as
-- colunas com a do critério ativo destacada, e pagina com offset/limite + total via `count(*) over ()`.
create function desempenho_grupos_tabela(
  p_campanha uuid,
  p_criterio text default 'geral',
  p_execucao uuid default null,
  p_busca text default null,
  p_offset int default 0,
  p_limite int default 10
)
returns table (
  grupo_id uuid,
  numero int,
  nome text,
  group_id text,
  participantes int,
  geral numeric,
  visualizacao numeric,
  reproducao numeric,
  recebimento numeric,
  total bigint
)
language sql stable security invoker set search_path = public as $$
  with c as (
    select t.grupo_id,
           count(*) filter (where r.tipo = 'recebeu') as recebeu,
           count(*) filter (where r.tipo = 'visualizou') as visualizou,
           count(*) filter (where r.tipo = 'reproduziu') as reproduziu
    from recibos r
    join tarefas t on t.id = r.tarefa_id
    join execucoes e on e.id = t.execucao_id
    where e.campanha_id = p_campanha and (p_execucao is null or e.id = p_execucao)
    group by t.grupo_id
  ), g as (
    select g.id, g.numero, g.nome, g.group_id, g.participantes,
           coalesce(c.recebeu, 0) as recebeu, coalesce(c.visualizou, 0) as visualizou, coalesce(c.reproduziu, 0) as reproduziu
    from grupos g
    left join c on c.grupo_id = g.id
    where g.campanha_id = p_campanha
      and (coalesce(p_busca, '') = '' or g.nome ilike '%' || replace(replace(replace(p_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), p as (
    select g.id, g.numero, g.nome, g.group_id, g.participantes,
           round(g.recebeu * 10::numeric / greatest(g.participantes, 1), 2) as recebimento,
           round(g.visualizou * 20::numeric / greatest(g.participantes, 1), 2) as visualizacao,
           round(g.reproduziu * 40::numeric / greatest(g.participantes, 1), 2) as reproducao,
           round((g.recebeu * 10 + g.visualizou * 20 + g.reproduziu * 40)::numeric / greatest(g.participantes, 1), 2) as geral
    from g
  )
  select p.id, p.numero, p.nome, p.group_id, p.participantes, p.geral, p.visualizacao, p.reproducao, p.recebimento,
         count(*) over ()
  from p
  order by
    case coalesce(p_criterio, 'geral')
      when 'visualizacao' then p.visualizacao
      when 'reproducao' then p.reproducao
      when 'recebimento' then p.recebimento
      else p.geral
    end desc,
    p.numero
  limit least(greatest(coalesce(p_limite, 10), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

revoke execute on function desempenho_grupos_tabela(uuid, text, uuid, text, int, int) from public, anon;
grant execute on function desempenho_grupos_tabela(uuid, text, uuid, text, int, int) to authenticated, service_role;
