-- Etapa 3K, Tarefa 6: Anti-spam › "Números administrativos" (cadastro manual + CSV), "Bloquear por LID" e
-- "Denunciar golpista". Só aditiva: tabela nova, colunas novas com default
-- (bloqueados antigos ficam com lid null e golpista false = comportamento de hoje) e o check de `acoes.tipo`
-- ampliado mantendo os 3 valores de 20261017200100_acoes_novas_exportacoes.sql.
-- (O brief pedia 20261017200400, mas esse timestamp já é de 20261017200400_hooks_eventos.sql.)

-- 1. Números administrativos: nunca removidos pelo anti-spam, duplicado, campanha anterior, "Remover Lead" nem
--    remoção em massa, e nunca bloqueados. Tabela vazia = comportamento de hoje (só as contas conectadas protegidas).
create table numeros_administrativos (
  telefone text primary key check (telefone ~ '^[0-9]{11,15}$'),
  nome text check (char_length(nome) <= 80),
  criado_por uuid,
  created_at timestamptz not null default now()
);
create index numeros_administrativos_data on numeros_administrativos (created_at desc);

alter table numeros_administrativos enable row level security;
create policy equipe_tudo on numeros_administrativos for all to authenticated using (true) with check (true);
grant select, insert, update, delete on numeros_administrativos to authenticated, service_role;
revoke all on numeros_administrativos from anon;

-- 2. Bloquear por LID e Denunciar golpista. `lid` = só os dígitos do id opaco do WhatsApp (`…@lid`), descoberto
--    pelo `resolve-lid` do Zapbot: a conferência casa participante que vem como LID com esta coluna.
alter table bloqueados
  add column lid text unique check (lid ~ '^[0-9]{6,20}$'),
  add column golpista boolean not null default false,
  add column denunciado_em timestamptz;

-- 3. Fila `acoes`: bloquear/desbloquear o contato no WhatsApp de uma conta (dados {telefone, conexao_id}),
--    processada por `processarAcoes` no próximo minuto. `pegar_acoes` não filtra por tipo.
alter table acoes drop constraint acoes_tipo_check;
alter table acoes add constraint acoes_tipo_check
  check (tipo in ('criar_grupo', 'remover', 'entrar_grupo', 'bloquear_contato', 'desbloquear_contato'));
