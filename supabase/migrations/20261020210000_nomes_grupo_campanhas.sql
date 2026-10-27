-- Cartão da campanha (20/10/2026, pedido do dono): embaixo do nome da campanha vai o nome ATUAL do grupo (o do grupo
-- ativo de menor número, como a foto de `fotos_campanhas`), pra acompanhar as últimas trocas de nome. O app tira o
-- número do grupo (`nomeSemNumero`). Campanha sem grupo ativo não aparece.
create function nomes_grupo_campanhas(p_ids uuid[])
returns table (campanha_id uuid, nome text, numero int)
language sql stable security invoker set search_path = public as $$
  select distinct on (g.campanha_id) g.campanha_id, g.nome, g.numero
    from grupos g
   where g.campanha_id = any (coalesce(p_ids, '{}'))
     and g.ativo
   order by g.campanha_id, g.numero, g.id
$$;
revoke all on function nomes_grupo_campanhas(uuid[]) from public, anon;
grant execute on function nomes_grupo_campanhas(uuid[]) to authenticated, service_role;
