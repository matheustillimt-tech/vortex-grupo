-- Etapa 3K, Tarefa 1: administradores por número ("NOVO ADMINISTRADOR") nos diálogos "Criação de grupos" e
-- "Alterar grupos em lote". Telefones livres (sem conta conectada) que viram
-- admin de cada grupo novo da campanha: o job de criação adiciona e promove cada um depois das contas.
-- Tabela vazia = comportamento de hoje (nenhuma chamada extra ao Zapbot). Até 20 por campanha (regra no app).

create table campanha_admins_numeros (
  campanha_id uuid not null references campanhas (id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{11,15}$'),
  criado_por uuid,
  created_at timestamptz not null default now(),
  primary key (campanha_id, telefone)
);

alter table campanha_admins_numeros enable row level security;
create policy equipe_tudo on campanha_admins_numeros for all to authenticated using (true) with check (true);
grant select, insert, update, delete on campanha_admins_numeros to authenticated, service_role;
revoke all on campanha_admins_numeros from anon;
