-- Etapa 3K, Tarefa 7: "Acessos de atendentes" na API. O Administrador gera um link de convite pra uma chave; um
-- atendente logado abre o link e pede acesso; o Administrador aprova/recusa/revoga; aprovado, o atendente gera a
-- própria chave (filha), vista uma vez. Só aditiva: colunas novas anuláveis e uma tabela nova.
-- (O plano dizia 20261017200500, mas esse número já é da migração do anti-spam: esta vem depois da 200600.)

-- Convite: o banco guarda só o SHA-256 (hex) do token; o token (32 bytes, base64url) aparece uma vez pro admin.
-- Gerar de novo troca o hash (o link anterior para de valer); usar o link (pedir acesso) apaga o hash (uso único).
alter table api_chaves add column convite_hash text unique check (convite_hash is null or convite_hash ~ '^[0-9a-f]{64}$');
alter table api_chaves add column convite_expira_em timestamptz;
-- Chave filha: a chave do atendente aponta pra chave mãe; apagar a mãe apaga as filhas.
alter table api_chaves add column acesso_de uuid references api_chaves (id) on delete cascade;
create index api_chaves_acesso_de on api_chaves (acesso_de) where acesso_de is not null;

-- `authenticated` lê api_chaves só pelas colunas concedidas em 20261017170000_api.sql. `acesso_de` e a validade do
-- convite podem ser lidos (a tela separa as filhas e mostra até quando o link vale); o hash do convite, nunca.
grant select (acesso_de, convite_expira_em) on api_chaves to authenticated;
revoke select (convite_hash) on api_chaves from authenticated;
revoke all on api_chaves from anon;

create table api_acessos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  chave_id uuid not null references api_chaves (id) on delete cascade,
  solicitante uuid not null,
  motivo text check (char_length(motivo) <= 280),
  status text not null default 'aguardando' check (status in ('aguardando', 'aprovado', 'recusado', 'revogado')),
  decidido_por uuid,
  decidido_em timestamptz,
  chave_emitida_id uuid references api_chaves (id) on delete set null
);
-- Um pedido vivo (aguardando ou aprovado) por atendente e chave: pedido duplicado é recusado pelo banco.
create unique index api_acessos_vivo on api_acessos (chave_id, solicitante) where status in ('aguardando', 'aprovado');
create index api_acessos_solicitante on api_acessos (solicitante);

-- Só o servidor (service role, nas ações): nada pra authenticated nem anon.
alter table api_acessos enable row level security;
revoke all on api_acessos from anon, authenticated;
grant select, insert, update, delete on api_acessos to service_role;

-- Limite de tentativas na página do convite (abrir o link e pedir acesso), por usuário e por hora. Só o servidor.
create table api_acessos_tentativas (
  usuario uuid not null,
  hora timestamptz not null,
  tentativas int not null default 0 check (tentativas >= 0),
  primary key (usuario, hora)
);
alter table api_acessos_tentativas enable row level security;
revoke all on api_acessos_tentativas from anon, authenticated;
grant select, insert, update, delete on api_acessos_tentativas to service_role;

-- Soma uma tentativa na hora atual do usuário e devolve o total da hora; limpa as horas com mais de um dia.
create or replace function api_acesso_tentativa(p_usuario uuid)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_total int;
begin
  insert into api_acessos_tentativas (usuario, hora, tentativas)
  values (p_usuario, date_trunc('hour', now()), 1)
  on conflict (usuario, hora) do update set tentativas = api_acessos_tentativas.tentativas + 1
  returning tentativas into v_total;
  delete from api_acessos_tentativas where usuario = p_usuario and hora < now() - interval '1 day';
  return v_total;
end;
$$;
revoke execute on function api_acesso_tentativa(uuid) from public, anon, authenticated;
grant execute on function api_acesso_tentativa(uuid) to service_role;
