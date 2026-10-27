-- Etapa 2I: webhooks de saída configuráveis e histórico de ações do painel.
create table webhooks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  url text not null check (url ~ '^https://' and char_length(url) <= 500),
  eventos text[] not null check (array_length(eventos, 1) >= 1 and eventos <@ array['entrou', 'saiu', 'alerta', 'compra']::text[]),
  campanhas uuid[],
  ativo boolean not null default true,
  arquivado boolean not null default false,
  segredo text not null
);
alter table webhooks enable row level security;
create policy equipe_tudo on webhooks for all to authenticated using (true) with check (true);
grant select, insert, update, delete on webhooks to service_role;
-- O default privileges da Fase 1 já concedeu select de tabela inteira pra authenticated: revoga antes do
-- grant por coluna, senão a coluna segredo continua legível.
revoke select on webhooks from authenticated;
grant select (id, created_at, nome, url, eventos, campanhas, ativo, arquivado) on webhooks to authenticated;
grant insert, update, delete on webhooks to authenticated;
-- Nunca exposto a anon (o default privileges da Fase 1 só alcança authenticated/service_role, mas fica explícito).
revoke all on webhooks from anon;

alter table eventos_saida
  add column webhook_id uuid references webhooks (id) on delete set null,
  alter column campanha_id drop not null;
create index eventos_saida_webhook on eventos_saida (webhook_id, created_at desc) where webhook_id is not null;

-- Marca as linhas enfileiradas pra um webhook cadastrado (em vez de endereço legado). Serve pra `processarEventos`
-- diferenciar, depois que a FK zera `webhook_id` (webhook excluído), de um evento legado de verdade: uma linha
-- `de_webhook = true` com `webhook_id` nulo nunca deve ser enviada sem assinatura — ela é marcada como erro.
alter table eventos_saida add column de_webhook boolean not null default false;

-- Chave de idempotência opcional (ex.: "compra:<venda id>") pra quem enfileira poder usar upsert com
-- `ignoreDuplicates` e não duplicar o evento numa nova tentativa. NULL é distinto de NULL num índice único, então
-- as linhas sem chave (a maioria) nunca conflitam entre si; não pode ser parcial porque o `onConflict` do
-- PostgREST não aceita índice parcial.
alter table eventos_saida add column chave text;
create unique index eventos_saida_chave on eventos_saida (webhook_id, chave);

create table historico (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  usuario_id uuid references auth.users (id) on delete set null,
  usuario_email text,
  acao text not null check (acao in ('adicionar', 'atualizar', 'remover', 'executar')),
  area text not null check (char_length(area) between 1 and 30),
  resumo text not null check (char_length(resumo) between 1 and 300),
  ref_id text
);
create index historico_data on historico (created_at desc);
alter table historico enable row level security;
create policy equipe_le on historico for select to authenticated using (true);
-- O default privileges da Fase 1 já concedeu insert/update/delete pra authenticated: revoga pra só service
-- role gravar (o painel grava histórico via rota de servidor).
revoke insert, update, delete on historico from authenticated;
grant select on historico to authenticated;
grant select, insert on historico to service_role;
-- Nunca exposto a anon.
revoke all on historico from anon;
