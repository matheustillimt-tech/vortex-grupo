-- Etapa 3I ("resto"), Tarefa 1: Leads como cadastro. Leads ganha uma aba "Visão
-- geral" (pessoa = cadastro, uma linha por número) além das "Participações" de hoje (que continuam intactas, com
-- `pessoas_filtradas`/`listar_pessoas`/`contar_pessoas`/`contar_pessoas_por_tag` sem mudar nenhuma assinatura).

-- 1. Contatos: nome e campos personalizados de um telefone, cadastrados à mão ou editados na página do lead.
--    `telefone` é a chave (mesmo formato normalizado de participantes.telefone/pessoa_tags.telefone).

create table contatos (
  telefone text primary key,
  nome text check (char_length(nome) <= 80),
  campos jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- `set_updated_at()` já existe (20261017120000_campanha_extras.sql).
create trigger contatos_set_updated_at before update on contatos
  for each row execute function set_updated_at();

alter table contatos enable row level security;
create policy equipe_tudo on contatos for all to authenticated using (true) with check (true);
grant select, insert, update, delete on contatos to authenticated, service_role;
revoke all on contatos from anon;

-- 2. Listagem "Visão geral": união de telefones distintos de participantes (sem admin) e contatos — uma linha por
--    pessoa (nome e campos vêm de `contatos`; sem registro em `contatos`, nome fica nulo e campos vazio). Tags
--    agregadas como em `listar_pessoas`. Busca cobre dígitos do telefone (ignora o que não é dígito na busca) e o
--    nome (`ilike`, escapado). Aditivo: não toca nas RPCs antigas, que a aba Participações e a exportação continuam
--    usando.

create or replace function listar_leads(p_busca text, p_tag uuid, p_limite int, p_deslocamento int)
returns table (telefone text, nome text, campos jsonb, tags text[])
language sql stable security invoker set search_path = public as $$
  with base as (
    select telefone from participantes where admin = false
    union
    select telefone from contatos
  ),
  canon as (
    select distinct (select min(v) from unnest(variantes_telefone(b.telefone)) as v) as telefone
    from base b
  )
  select
    c.telefone,
    ct.nome,
    coalesce(ct.campos, '{}'::jsonb),
    coalesce((
      select array_agg(distinct coalesce(tc.nome, t.nome))
      from pessoa_tags pt
      join tags t on t.id = pt.tag_id
      left join campanhas tc on tc.id = t.campanha_id
      where pt.telefone = any (variantes_telefone(c.telefone))
    ), '{}'::text[])
  from canon c
  left join contatos ct on ct.telefone = any (variantes_telefone(c.telefone))
  where (p_busca is null or (
          (nullif(regexp_replace(p_busca, '\D', '', 'g'), '') is not null and c.telefone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')
          or ct.nome ilike '%' || p_busca || '%' escape '\'
        ))
    and (p_tag is null or exists (
          select 1 from pessoa_tags pt2 where pt2.tag_id = p_tag and pt2.telefone = any (variantes_telefone(c.telefone))))
  order by ct.nome nulls last, c.telefone
  limit least(p_limite, 1000) offset p_deslocamento
$$;

create or replace function contar_leads(p_busca text, p_tag uuid)
returns bigint language sql stable security invoker set search_path = public as $$
  with base as (
    select telefone from participantes where admin = false
    union
    select telefone from contatos
  ),
  canon as (
    select distinct (select min(v) from unnest(variantes_telefone(b.telefone)) as v) as telefone
    from base b
  )
  select count(*) from canon c
  left join contatos ct on ct.telefone = any (variantes_telefone(c.telefone))
  where (p_busca is null or (
          (nullif(regexp_replace(p_busca, '\D', '', 'g'), '') is not null and c.telefone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%')
          or ct.nome ilike '%' || p_busca || '%' escape '\'
        ))
    and (p_tag is null or exists (
          select 1 from pessoa_tags pt2 where pt2.tag_id = p_tag and pt2.telefone = any (variantes_telefone(c.telefone))))
$$;

revoke execute on function listar_leads(text, uuid, int, int), contar_leads(text, uuid) from public, anon;
grant execute on function listar_leads(text, uuid, int, int), contar_leads(text, uuid) to authenticated, service_role;

-- A lista de leads parte de todos os participantes não-admin: índice parcial pra não varrer a tabela inteira.
create index if not exists participantes_nao_admin_telefone on participantes (telefone) where admin = false;
