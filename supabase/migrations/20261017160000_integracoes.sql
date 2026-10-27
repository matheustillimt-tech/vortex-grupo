-- Etapa 3H, Tarefa 1: Webhooks de checkout (entrada) — cada integração tem nome, plataforma e o
-- próprio segredo (o link que se cola no checkout). Só adiciona: provedores_checkout continua como está.

create table integracoes_checkout (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null check (char_length(nome) between 1 and 60),
  plataforma text not null check (plataforma in ('vortex', 'pagarme', 'hotmart', 'kiwify')),
  segredo text not null default encode(extensions.gen_random_bytes(24), 'hex'),
  arquivada boolean not null default false
);
-- A rota pública procura as integrações não arquivadas da plataforma a cada venda.
create index integracoes_checkout_plataforma on integracoes_checkout (plataforma) where not arquivada;

alter table integracoes_checkout enable row level security;
create policy equipe_le on integracoes_checkout for select to authenticated using (true);
grant select, insert, update, delete on integracoes_checkout to service_role;
-- O default privileges da Fase 1 já concedeu a tabela inteira pra authenticated: revoga antes do grant por coluna,
-- senão a coluna segredo continua legível (igual webhooks.segredo). Criar, arquivar e regerar o link só pelo
-- servidor (service role), nas ações que exigem webhooks/editar.
revoke all on integracoes_checkout from authenticated, anon;
grant select (id, created_at, nome, plataforma, arquivada) on integracoes_checkout to authenticated;

-- Uma integração por plataforma com o segredo ATUAL de provedores_checkout: os links já colados nos checkouts
-- continuam valendo.
insert into integracoes_checkout (nome, plataforma, segredo)
select case provedor
         when 'hotmart' then 'Hotmart'
         when 'kiwify' then 'Kiwify'
         when 'pagarme' then 'Pagar.me'
         when 'vortex' then 'Checkout próprio'
       end,
       provedor,
       segredo
  from provedores_checkout
 order by case provedor when 'hotmart' then 1 when 'kiwify' then 2 when 'pagarme' then 3 else 4 end;

-- Venda guarda por qual integração chegou (aba Eventos do detalhe do webhook).
alter table vendas add column integracao_id uuid references integracoes_checkout (id) on delete set null;
create index vendas_integracao on vendas (integracao_id, created_at desc) where integracao_id is not null;

-- As vendas antigas chegaram pelo único link de cada plataforma, que é o da integração criada acima.
update vendas v
   set integracao_id = i.id
  from integracoes_checkout i
 where i.plataforma = v.provedor
   and v.integracao_id is null;

-- registrar_venda com a integração: igual à de 6 argumentos (que continua existindo), mais `integracao_id`. Na
-- virada de não aprovada pra aprovada, fica a integração nova (ou a antiga, se a nova vier nula).
create or replace function registrar_venda(p_provedor text, p_evento_id text, p_aprovada boolean, p_telefone text, p_produtos text[], p_payload jsonb, p_integracao uuid)
returns void
language sql security invoker set search_path = public as $$
  insert into vendas (provedor, evento_id, aprovada, telefone, produtos, payload, integracao_id)
  values (p_provedor, p_evento_id, p_aprovada, p_telefone, coalesce(p_produtos, '{}'), p_payload, p_integracao)
  on conflict (provedor, evento_id) do update
     set aprovada = true,
         payload = excluded.payload,
         telefone = excluded.telefone,
         produtos = excluded.produtos,
         processada_em = null,
         resultado = null,
         integracao_id = coalesce(excluded.integracao_id, vendas.integracao_id)
   where vendas.aprovada = false and excluded.aprovada = true
$$;
revoke execute on function registrar_venda(text, text, boolean, text, text[], jsonb, uuid) from public, anon, authenticated;
grant execute on function registrar_venda(text, text, boolean, text, text[], jsonb, uuid) to service_role;
