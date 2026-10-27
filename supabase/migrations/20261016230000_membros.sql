-- Etapa 2K: papéis e permissões da equipe.
create table membros (
  usuario_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nome text not null default '' check (char_length(nome) <= 60),
  papel text not null default 'membro' check (papel in ('admin', 'membro')),
  permissoes jsonb not null default '{}'::jsonb check (jsonb_typeof(permissoes) = 'object')
);
alter table membros enable row level security;
create policy le_a_propria on membros for select to authenticated using (usuario_id = auth.uid());
revoke all on membros from anon, authenticated;
grant select on membros to authenticated;
grant select, insert, update, delete on membros to service_role;

-- Quem já tem acesso vira Administrador.
insert into membros (usuario_id, papel) select id, 'admin' from auth.users on conflict do nothing;

-- Acesso novo nasce Membro (permissões vazias = padrão das regras).
create or replace function membro_novo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.membros (usuario_id) values (new.id) on conflict do nothing;
  return new;
end $$;
create trigger membro_novo after insert on auth.users for each row execute function membro_novo();
