-- Etapa 2J: projetos (pastas de campanhas).
create table projetos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  descricao text not null default '' check (char_length(descricao) <= 200),
  cor text not null default 'amarelo' check (cor in ('amarelo', 'verde', 'azul', 'roxo', 'rosa', 'vermelho', 'laranja', 'cinza')),
  arquivado boolean not null default false
);
alter table projetos enable row level security;
create policy equipe_tudo on projetos for all to authenticated using (true) with check (true);
grant select, insert, update, delete on projetos to authenticated, service_role;
revoke all on projetos from anon;

alter table campanhas add column projeto_id uuid references projetos (id) on delete set null;
create index campanhas_projeto on campanhas (projeto_id);

-- Contagens por projeto (campanhas não arquivadas, grupos ativos, pessoas no grupo agora). Mesmas regras de
-- resumo_campanhas (ver 20261016140000_resumo_campanhas.sql): grupo ativo conta em "grupos"; participante com
-- saiu_em nulo num grupo ativo conta em "leads". security invoker: respeita o RLS de quem chama.
create or replace function resumo_projetos(ids uuid[])
returns table (projeto_id uuid, campanhas bigint, grupos bigint, leads bigint)
language sql stable security invoker set search_path = public as $$
  with camp as (
    select projeto_id, count(*) as campanhas
    from campanhas
    where projeto_id = any(ids) and not arquivada
    group by projeto_id
  ), grupo as (
    select c.projeto_id, count(*) as grupos
    from grupos g
    join campanhas c on c.id = g.campanha_id
    where c.projeto_id = any(ids) and g.ativo
    group by c.projeto_id
  ), lead as (
    select c.projeto_id, count(*) as leads
    from participantes p
    join grupos g on g.id = p.grupo_id
    join campanhas c on c.id = g.campanha_id
    where c.projeto_id = any(ids) and g.ativo and p.saiu_em is null
    group by c.projeto_id
  )
  select
    pid,
    coalesce(camp.campanhas, 0),
    coalesce(grupo.grupos, 0),
    coalesce(lead.leads, 0)
  from unnest(ids) as pid
  left join camp on camp.projeto_id = pid
  left join grupo on grupo.projeto_id = pid
  left join lead on lead.projeto_id = pid
$$;
revoke execute on function resumo_projetos(uuid[]) from public, anon;
grant execute on function resumo_projetos(uuid[]) to authenticated, service_role;
