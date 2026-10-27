-- Desempenho por grupo (20/10/2026): quantas compras aprovadas saíram de cada grupo da campanha. Conta a venda
-- quando o telefone (com ou sem o nono dígito) é de alguém que entrou no grupo antes da compra, mesmo que já tenha
-- saído (o comprador costuma ser tirado do grupo depois). Admins (números da equipe) não contam.
create function vendas_por_grupo(p_campanha uuid)
returns table (grupo_id uuid, vendas bigint)
language sql stable security invoker set search_path = public as $$
  select p.grupo_id, count(distinct v.id) as vendas
  from participantes p
  join grupos g on g.id = p.grupo_id
  join vendas v on v.aprovada = true and v.telefone = any (variantes_telefone(p.telefone)) and v.created_at >= p.entrou_em
  where g.campanha_id = p_campanha and p.admin = false
  group by p.grupo_id
$$;
revoke execute on function vendas_por_grupo(uuid) from public, anon;
grant execute on function vendas_por_grupo(uuid) to authenticated, service_role;
