-- Bloco 2B: bloqueados (anti-spam), tags de pessoa, motivo de saída e listagem de pessoas.

-- 1. Bloqueados

create table bloqueados (
  telefone text primary key,
  motivo text,
  origem text not null check (origem in ('botao', 'manual', 'csv')),
  criado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- 2. Tags (moram no telefone; a Saiu é por campanha)

create table tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  nome text not null,
  tipo text not null default 'manual' check (tipo in ('manual', 'campanha', 'comprador', 'saiu')),
  campanha_id uuid references campanhas (id) on delete cascade,
  check ((tipo = 'campanha') = (campanha_id is not null))
);
create unique index tags_manual_nome on tags (lower(nome)) where tipo = 'manual';
create unique index tags_uma_por_campanha on tags (campanha_id) where tipo = 'campanha';
create unique index tags_fixas on tags (tipo) where tipo in ('comprador', 'saiu');
insert into tags (nome, tipo) values ('Comprador', 'comprador'), ('Saiu', 'saiu');

create table pessoa_tags (
  telefone text not null,
  tag_id uuid not null references tags (id) on delete cascade,
  campanha_id uuid references campanhas (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index pessoa_tags_unica on pessoa_tags (telefone, tag_id, coalesce(campanha_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index pessoa_tags_tag on pessoa_tags (tag_id);

-- 3. Motivo da saída e alerta novo

alter table participantes add column motivo_saida text
  check (motivo_saida in ('sozinho', 'bloqueado', 'duplicado', 'comprador', 'manual'));

-- Histórico da página do lead procura todas as participações do número (o índice antigo só cobre quem está no grupo).
create index if not exists participantes_telefone_todas on participantes (telefone);

alter table alertas drop constraint alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro', 'bloqueado_removido'));

-- 4. Funções

-- Mesma regra de src/lib/telefone.ts (variantesTelefone): o WhatsApp tira ou põe o nono dígito do celular brasileiro.
create or replace function variantes_telefone(t text) returns text[] language sql immutable set search_path = public as $$
  select case
    when t like '55%' and length(t) = 13 and substr(t, 5, 1) = '9' then array[t, substr(t, 1, 4) || substr(t, 6)]
    when t like '55%' and length(t) = 12 then array[t, substr(t, 1, 4) || '9' || substr(t, 5)]
    else array[t]
  end
$$;

-- Tag "Campanha" (nome da campanha): cria na primeira vez, devolve a mesma depois.
create or replace function tag_da_campanha(p_campanha uuid) returns uuid language plpgsql security invoker set search_path = public as $$
declare v uuid;
begin
  select id into v from tags where tipo = 'campanha' and campanha_id = p_campanha;
  if v is null then
    insert into tags (nome, tipo, campanha_id) select nome, 'campanha', id from campanhas where id = p_campanha
    on conflict do nothing returning id into v;
    if v is null then
      select id into v from tags where tipo = 'campanha' and campanha_id = p_campanha;
    end if;
  end if;
  return v;
end $$;

-- Pôr e tirar tag de vários telefones de uma vez, sem erro quando já tem / já não tem.
create or replace function por_tag(p_telefones text[], p_tag uuid, p_campanha uuid) returns void language sql security invoker set search_path = public as $$
  insert into pessoa_tags (telefone, tag_id, campanha_id)
  select distinct t, p_tag, p_campanha from unnest(p_telefones) as t
  on conflict do nothing
$$;

create or replace function tirar_tag(p_telefones text[], p_tag uuid, p_campanha uuid) returns void language sql security invoker set search_path = public as $$
  delete from pessoa_tags pt
  where pt.tag_id = p_tag
    and pt.campanha_id is not distinct from p_campanha
    and exists (select 1 from unnest(p_telefones) as x where pt.telefone = any (variantes_telefone(x)))
$$;

-- Participações (uma linha por pessoa em cada grupo) com os filtros da tela Pessoas. Admin não entra.
create or replace function pessoas_filtradas(p_campanha uuid, p_grupo uuid, p_situacao text, p_tag uuid, p_busca text)
returns table (participante_id uuid, telefone text, campanha_id uuid, campanha text, grupo_id uuid, grupo text,
               entrou_em timestamptz, saiu_em timestamptz, motivo_saida text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.telefone, g.campanha_id, c.nome, g.id, g.nome, p.entrou_em, p.saiu_em, p.motivo_saida
  from participantes p
  join grupos g on g.id = p.grupo_id
  join campanhas c on c.id = g.campanha_id
  where p.admin = false
    and (p_campanha is null or g.campanha_id = p_campanha)
    and (p_grupo is null or p.grupo_id = p_grupo)
    and (p_situacao is null
         or (p_situacao = 'dentro' and p.saiu_em is null)
         or (p_situacao = 'saiu' and p.saiu_em is not null))
    and (p_tag is null or exists (
          select 1 from pessoa_tags pt where pt.tag_id = p_tag and pt.telefone = any (variantes_telefone(p.telefone))))
    and (p_busca is null or p.telefone like '%' || p_busca || '%')
$$;

create or replace function listar_pessoas(p_campanha uuid, p_grupo uuid, p_situacao text, p_tag uuid, p_busca text, p_limite int, p_deslocamento int)
returns table (participante_id uuid, telefone text, campanha_id uuid, campanha text, grupo_id uuid, grupo text,
               entrou_em timestamptz, saiu_em timestamptz, motivo_saida text, tags text[])
language sql stable security invoker set search_path = public as $$
  select f.participante_id, f.telefone, f.campanha_id, f.campanha, f.grupo_id, f.grupo, f.entrou_em, f.saiu_em, f.motivo_saida,
         coalesce((
           select array_agg(distinct coalesce(tc.nome, t.nome))
           from pessoa_tags pt
           join tags t on t.id = pt.tag_id
           left join campanhas tc on tc.id = t.campanha_id
           where pt.telefone = any (variantes_telefone(f.telefone))
         ), '{}'::text[])
  from pessoas_filtradas(p_campanha, p_grupo, p_situacao, p_tag, p_busca) f
  order by f.entrou_em desc, f.participante_id
  limit least(p_limite, 1000) offset p_deslocamento
$$;

create or replace function contar_pessoas(p_campanha uuid, p_grupo uuid, p_situacao text, p_tag uuid, p_busca text)
returns bigint language sql stable security invoker set search_path = public as $$
  select count(*) from pessoas_filtradas(p_campanha, p_grupo, p_situacao, p_tag, p_busca)
$$;

-- Pessoas distintas por tag (aba Tags): o mesmo número com e sem o nono dígito conta uma vez, e a "Saiu" de duas
-- campanhas também conta uma pessoa só.
create or replace function contar_pessoas_por_tag() returns table (tag_id uuid, pessoas bigint)
language sql stable security invoker set search_path = public as $$
  select pt.tag_id, count(distinct (select min(v) from unnest(variantes_telefone(pt.telefone)) as v))
  from pessoa_tags pt
  group by pt.tag_id
$$;

revoke execute on function variantes_telefone(text), tag_da_campanha(uuid), por_tag(text[], uuid, uuid), tirar_tag(text[], uuid, uuid),
  pessoas_filtradas(uuid, uuid, text, uuid, text), listar_pessoas(uuid, uuid, text, uuid, text, int, int),
  contar_pessoas(uuid, uuid, text, uuid, text), contar_pessoas_por_tag() from public, anon;
grant execute on function variantes_telefone(text), tag_da_campanha(uuid), por_tag(text[], uuid, uuid), tirar_tag(text[], uuid, uuid),
  pessoas_filtradas(uuid, uuid, text, uuid, text), listar_pessoas(uuid, uuid, text, uuid, text, int, int),
  contar_pessoas(uuid, uuid, text, uuid, text), contar_pessoas_por_tag() to authenticated, service_role;

-- 5. RLS e grants (mesmo padrão: equipe logada lê e escreve; anônimo nada)

do $$
declare t text;
begin
  foreach t in array array['bloqueados', 'tags', 'pessoa_tags'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy equipe_tudo on %I for all to authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to authenticated, service_role', t);
  end loop;
end $$;
