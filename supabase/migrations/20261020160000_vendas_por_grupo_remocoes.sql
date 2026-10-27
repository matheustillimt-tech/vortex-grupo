-- Vendas por grupo (20/10/2026, ajuste): conta também as remoções de comprador feitas à mão ou por automação
-- (`acoes` tipo remover com origem "venda …", inclusive as que deram erro: a compra aconteceu). Venda que não
-- passou pela tabela `vendas` só aparece por aí. Cada comprador conta uma vez por grupo, mesmo
-- que tenha venda + remoção. Vendas de teste (produto "produto-teste") e as remoções desses telefones ficam de fora.
create or replace function vendas_por_grupo(p_campanha uuid)
returns table (grupo_id uuid, vendas bigint)
language sql stable security invoker set search_path = public as $$
  with teste as (
    select distinct unnest(variantes_telefone(v.telefone)) as telefone
    from vendas v where v.telefone is not null and 'produto-teste' = any (v.produtos)
  ), compradores as (
    select p.grupo_id, v.telefone
    from participantes p
    join grupos g on g.id = p.grupo_id
    join vendas v on v.aprovada = true and v.telefone = any (variantes_telefone(p.telefone)) and v.created_at >= p.entrou_em
    where g.campanha_id = p_campanha and p.admin = false and not ('produto-teste' = any (v.produtos))
    union
    select a.grupo_id, a.telefone
    from acoes a
    join grupos g on g.id = a.grupo_id
    where g.campanha_id = p_campanha and a.tipo = 'remover' and a.origem like 'venda%' and a.telefone is not null
      and not exists (select 1 from teste t where t.telefone = a.telefone)
  )
  -- Mesmo comprador com e sem o nono dígito conta uma vez: agrupa pela menor variante do telefone.
  select c.grupo_id, count(distinct (select min(x) from unnest(variantes_telefone(c.telefone)) x)) as vendas
  from compradores c
  group by c.grupo_id
$$;
