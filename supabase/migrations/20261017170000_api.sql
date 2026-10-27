-- Etapa 3H2, Tarefa 1: chaves da API própria e do MCP. O banco guarda só o prefixo (8 caracteres depois
-- de "vg_", pra identificar na tela) e o hash SHA-256 da chave inteira; a chave em texto aparece uma vez, na criação.
-- Só adiciona.

create table api_chaves (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  prefixo text not null check (prefixo ~ '^[A-Za-z0-9]{8}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  escopo text not null check (escopo in ('leitura', 'envio')),
  -- 'api' = tela API; 'mcp' = tela MCP (Conectar assistente). As duas autenticam do mesmo jeito.
  tipo text not null default 'api' check (tipo in ('api', 'mcp')),
  criada_por uuid references auth.users (id) on delete set null,
  ultimo_uso timestamptz,
  revogada_em timestamptz
);

alter table api_chaves enable row level security;
create policy equipe_le on api_chaves for select to authenticated using (true);
grant select, insert, update, delete on api_chaves to service_role;
-- O default privileges da Fase 1 já concedeu a tabela inteira pra authenticated: revoga antes do grant por coluna,
-- senão a coluna hash fica legível. Criar e revogar só pelo servidor (service role), nas ações de Administrador.
revoke all on api_chaves from authenticated, anon;
grant select (id, created_at, nome, prefixo, escopo, tipo, criada_por, ultimo_uso, revogada_em) on api_chaves to authenticated;

-- Contador de chamadas por chave e por minuto (limite de 60/min). Só o servidor lê e grava.
create table api_uso (
  chave_id uuid not null references api_chaves (id) on delete cascade,
  minuto timestamptz not null,
  chamadas int not null default 0 check (chamadas >= 0),
  primary key (chave_id, minuto)
);
alter table api_uso enable row level security;
grant select, insert, update, delete on api_uso to service_role;
revoke all on api_uso from authenticated, anon;

-- Soma uma chamada no minuto atual da chave e devolve o total do minuto; marca o último uso e limpa os minutos
-- com mais de uma hora (da mesma chave, pela chave primária).
create or replace function api_registrar_uso(p_chave uuid)
returns int
language plpgsql security invoker set search_path = public as $$
declare
  v_total int;
begin
  insert into api_uso (chave_id, minuto, chamadas)
  values (p_chave, date_trunc('minute', now()), 1)
  on conflict (chave_id, minuto) do update set chamadas = api_uso.chamadas + 1
  returning chamadas into v_total;
  update api_chaves set ultimo_uso = now() where id = p_chave;
  delete from api_uso where chave_id = p_chave and minuto < now() - interval '1 hour';
  return v_total;
end;
$$;
revoke execute on function api_registrar_uso(uuid) from public, anon, authenticated;
grant execute on function api_registrar_uso(uuid) to service_role;
