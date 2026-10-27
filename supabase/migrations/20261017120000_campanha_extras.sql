-- Etapa 3D (Tarefa 1): dados de campanha que faltam pro link público e pra tela — tipo
-- ("campanha", "lista" e "viral" se comportam todos iguais por ora; "aleatorio" sorteia o grupo), término (data +
-- link de redirecionamento depois dela), fixar no topo, posição na lista, updated_at e reassociar_acoes (usada
-- pela Tarefa 3 ao remover conta da campanha). Também cria `configuracoes` (chave/valor), usada pelo padrão de
-- criação de campanhas (Tarefa 3).

-- Gatilho genérico de updated_at (reaproveitado por qualquer tabela que tenha a coluna).
create or replace function set_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table campanhas
  add column tipo text not null default 'campanha' check (tipo in ('campanha', 'lista', 'viral', 'aleatorio')),
  add column termina_em timestamptz,
  add column link_apos_termino text check (link_apos_termino is null or (link_apos_termino ~ '^https://' and char_length(link_apos_termino) <= 500)),
  add column fixada boolean not null default false,
  add column posicao int not null default 0,
  add column updated_at timestamptz not null default now(),
  add column reassociar_acoes boolean not null default true;

create trigger campanhas_set_updated_at before update on campanhas
  for each row execute function set_updated_at();

create table configuracoes (
  chave text primary key,
  valor jsonb not null,
  updated_at timestamptz not null default now()
);
alter table configuracoes enable row level security;
create policy equipe_tudo on configuracoes for all to authenticated using (true) with check (true);
grant select, insert, update, delete on configuracoes to authenticated, service_role;
revoke all on configuracoes from anon;

create trigger configuracoes_set_updated_at before update on configuracoes
  for each row execute function set_updated_at();
