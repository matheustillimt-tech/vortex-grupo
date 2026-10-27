-- Etapa 3E (Tarefa 2, correção da 1ª rodada): "GRUPOS DUPLICADOS" lia TODOS os grupos ativos da campanha pra
-- agrupar por nome em JS, sem teto — uma campanha com muitos grupos pagaria uma consulta cara e sem limite a
-- cada clique no botão. Agrupa e limita a 200 nomes já no banco, idêntico ao `participantes_duplicados_campanha`.

create function grupos_duplicados_campanha(p_campanha uuid)
returns table (nome text, grupos jsonb)
language sql stable security invoker set search_path = public as $$
  select g.nome, jsonb_agg(jsonb_build_object('id', g.id, 'numero', g.numero) order by g.numero)
  from grupos g
  where g.campanha_id = p_campanha and g.ativo
  group by g.nome
  having count(*) > 1
  order by g.nome
  limit 200
$$;

revoke execute on function grupos_duplicados_campanha(uuid) from public, anon;
grant execute on function grupos_duplicados_campanha(uuid) to authenticated, service_role;
