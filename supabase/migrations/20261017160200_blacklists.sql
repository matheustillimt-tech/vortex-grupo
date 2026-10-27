-- Etapa 3H, Tarefa 3: Blacklists e extras do Anti-spam. Só adiciona: nada existente muda de
-- comportamento sem blacklist cadastrada (a view abaixo devolve exatamente `bloqueados` quando não há lista).

-- 1. Blacklists (listas nomeadas de números que contam como bloqueados enquanto a lista estiver ativa)

create table blacklists (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 1 and 60),
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table blacklist_numeros (
  blacklist_id uuid not null references blacklists (id) on delete cascade,
  telefone text not null check (telefone ~ '^[0-9]{11,15}$'),
  created_at timestamptz not null default now(),
  primary key (blacklist_id, telefone)
);
-- A conferência procura por telefone (com as variantes do nono dígito), não por lista.
create index blacklist_numeros_telefone on blacklist_numeros (telefone);

-- 2. Nome no número bloqueado (diálogo "Adicionar número": "Nome *" na tela, opcional no banco)

alter table bloqueados add column if not exists nome text;

-- 3. Fonte única do anti-spam: bloqueados + números das blacklists ativas. A conferência (remoção com atraso de
-- 60 s, nunca admin, nunca número conectado) e a análise de grupos leem daqui, sem duplicar a regra de remoção.
-- security_invoker: quem lê precisa de acesso às tabelas de baixo (RLS de cada uma vale).

create view bloqueados_efetivos with (security_invoker = true) as
  select telefone from bloqueados
  union
  select n.telefone from blacklist_numeros n join blacklists b on b.id = n.blacklist_id where b.ativa;

-- 4. Alerta novo: remoção do anti-spam em grupo de conta não autorizada ("Antispam por Contas Associadas").

alter table alertas drop constraint alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro', 'bloqueado_removido', 'antispam_sem_conta'));

-- 5. RLS e grants (mesmo padrão de `bloqueados`: equipe logada lê e escreve; anônimo nada)

do $$
declare t text;
begin
  foreach t in array array['blacklists', 'blacklist_numeros'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy equipe_tudo on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
    execute format('revoke all on %I from anon', t);
  end loop;
end $$;

grant select on bloqueados_efetivos to authenticated, service_role;
revoke all on bloqueados_efetivos from anon;
