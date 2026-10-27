-- Etapa 3H, Tarefa 2: Deep link avulso com pasta e contagem de cliques. A rota pública
-- (`/d/[slug]`) nunca depende de anon/authenticated: usa `dbAdmin` (service role) e a RPC abaixo, igual
-- `registrar_venda` do checkout — por isso a tabela pode seguir o padrão simples de `webhooks`/`projetos`
-- (RLS pra authenticated, sem coluna secreta nem grant por coluna).

create table deeplinks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  destino text not null check (destino ~ '^https://' and char_length(destino) <= 500),
  -- Reserva api/admin/l/d (endereços fixos do painel/rotas; "d" é o próprio deep link).
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,40}$' and slug not in ('api', 'admin', 'l', 'd')),
  pasta text,
  cliques integer not null default 0
);
create index deeplinks_pasta on deeplinks (pasta) where pasta is not null;

alter table deeplinks enable row level security;
create policy equipe_tudo on deeplinks for all to authenticated using (true) with check (true);
grant select, insert, update, delete on deeplinks to service_role;
-- Nunca exposto a anon: a rota pública lê e soma o clique pela RPC abaixo com `dbAdmin` (service role).
revoke all on deeplinks from anon;

-- Soma o clique e devolve o destino (ou null se o slug não existir) numa chamada só, pra rota `/d/[slug]` não
-- precisar de duas idas ao banco. Só o service role chama: a rota pública nunca usa a chave anon/authenticated.
create or replace function registrar_clique_deeplink(p_slug text)
returns text
language plpgsql security invoker set search_path = public as $$
declare
  v_destino text;
begin
  update deeplinks set cliques = cliques + 1 where slug = p_slug returning destino into v_destino;
  return v_destino;
end;
$$;
revoke execute on function registrar_clique_deeplink(text) from public, anon, authenticated;
grant execute on function registrar_clique_deeplink(text) to service_role;
