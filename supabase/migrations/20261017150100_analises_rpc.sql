-- Etapa 3G (Tarefa 2): RPCs para as abas Atividades, Clicks e Diagnósticos.
--
-- Aditiva: nenhuma tabela nem função existente muda de forma — só tabela nova (`verificacoes_contas`) e RPCs
-- novas. O gráfico "Atividade Diaria"/"Cliques diários" reaproveita `metricas_campanha` (já existe, já soma no
-- banco); aqui só entram as listas paginadas e os agregados que faltam. A comparação das duas formas do nono
-- dígito reaproveita `variantes_telefone`, que já existe desde o Bloco 2B.

-- 1. atividades_campanha: entradas e saídas de participantes da campanha, uma linha por evento (a mesma pessoa
--    pode aparecer duas vezes: "entrada" e "saida"). `p_busca` procura pelos dígitos do telefone; `p_evento`
--    filtra 'entrada'/'saida' (null = todos); `p_inicio`/`p_fim` filtram a data do evento. `total` = linhas sem
--    paginação.
create function atividades_campanha(
  p_campanha uuid, p_busca text default null, p_grupo uuid default null, p_evento text default null,
  p_inicio timestamptz default null, p_fim timestamptz default null, p_limite int default 10, p_deslocamento int default 0
)
returns table (telefone text, grupo_id uuid, grupo_nome text, grupo_numero int, evento text, em timestamptz, total bigint)
language sql stable security invoker set search_path = public as $$
  with digitos as (
    select nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '') as d
  ), eventos as (
    select p.telefone, p.grupo_id, 'entrada'::text as evento, p.entrou_em as em
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha
    union all
    select p.telefone, p.grupo_id, 'saida'::text as evento, p.saiu_em as em
    from participantes p join grupos g on g.id = p.grupo_id
    where g.campanha_id = p_campanha and p.saiu_em is not null
  )
  select e.telefone, e.grupo_id, g.nome, g.numero, e.evento, e.em, count(*) over () as total
  from eventos e
  join grupos g on g.id = e.grupo_id
  cross join digitos
  where (p_grupo is null or e.grupo_id = p_grupo)
    and (p_evento is null or e.evento = p_evento)
    and (p_inicio is null or e.em >= p_inicio)
    and (p_fim is null or e.em <= p_fim)
    and (digitos.d is null or strpos(e.telefone, digitos.d) > 0)
  order by e.em desc
  limit least(greatest(coalesce(p_limite, 10), 1), 1000)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;

-- 2. cliques_campanha: cliques da campanha com as UTMs, paginados. `p_grupo` e as datas filtram; "Visitante" é
--    o hash/id do visitante por inteiro aqui — a tela mostra só os 8 primeiros caracteres (não temos IP em
--    claro). Tabela "Visitante | Grupo | Data | Parâmetros da URL", paginação.
create function cliques_campanha(
  p_campanha uuid, p_grupo uuid default null, p_inicio timestamptz default null, p_fim timestamptz default null,
  p_limite int default 10, p_deslocamento int default 0
)
returns table (
  id bigint, visitante text, grupo_id uuid, grupo_nome text, grupo_numero int, criado_em timestamptz,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text, total bigint
)
language sql stable security invoker set search_path = public as $$
  select k.id, k.visitante, k.grupo_id, g.nome, g.numero, k.created_at, k.utm_source, k.utm_medium, k.utm_campaign, k.utm_content, k.utm_term,
         count(*) over () as total
  from cliques k
  left join grupos g on g.id = k.grupo_id
  where k.campanha_id = p_campanha
    and (p_grupo is null or k.grupo_id = p_grupo)
    and (p_inicio is null or k.created_at >= p_inicio)
    and (p_fim is null or k.created_at <= p_fim)
  order by k.created_at desc
  limit least(greatest(coalesce(p_limite, 10), 1), 1000)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;

-- 3. cliques_por_origem / cliques_por_grupo: sub-aba "Análise" — cliques por utm_source e por grupo.
create function cliques_por_origem(p_campanha uuid, p_limite int default 20)
returns table (origem text, cliques bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(nullif(k.utm_source, ''), '(direto)'), count(*)
  from cliques k
  where k.campanha_id = p_campanha
  group by 1
  order by 2 desc, 1
  limit least(greatest(coalesce(p_limite, 20), 1), 200)
$$;

create function cliques_por_grupo(p_campanha uuid, p_limite int default 20)
returns table (grupo_id uuid, numero int, nome text, cliques bigint)
language sql stable security invoker set search_path = public as $$
  select g.id, g.numero, g.nome, count(k.id)
  from grupos g
  left join cliques k on k.grupo_id = g.id
  where g.campanha_id = p_campanha
  group by g.id, g.numero, g.nome
  order by 4 desc, g.numero
  limit least(greatest(coalesce(p_limite, 20), 1), 200)
$$;

-- 4. diagnostico_contas: "Compatibilidade de contas" — por conta associada à campanha (as mesmas de
--    `contasDaCampanha`: `campanha_conexoes`, a criadora e as donas de grupo ativo), quantos grupos ativos ela
--    tem e em quantos é admin (participante aberto com `admin = true`, comparando as duas formas do nono
--    dígito), e a conferência mais antiga dos grupos dela (`grupos.conferido_em`; `algum_pendente` quando algum
--    nunca foi conferido). `total` = contas sem paginação. Paginação 10.
create function diagnostico_contas(p_campanha uuid, p_busca text default null, p_limite int default 10, p_deslocamento int default 0)
returns table (conexao_id uuid, nome text, telefone text, total_grupos bigint, admin_grupos bigint, ultima_conferencia timestamptz, algum_pendente boolean, total bigint)
language sql stable security invoker set search_path = public as $$
  with contas as (
    select cc.conexao_id as id from campanha_conexoes cc where cc.campanha_id = p_campanha
    union
    select c.conexao_criadora_id from campanhas c where c.id = p_campanha and c.conexao_criadora_id is not null
    union
    select g.conexao_id from grupos g where g.campanha_id = p_campanha and g.ativo = true
  ), grp as (
    select g.id, g.conexao_id, g.conferido_em from grupos g where g.campanha_id = p_campanha and g.ativo = true
  ), adm as (
    select grp.id as grupo_id, grp.conexao_id
    from grp
    join conexoes cx on cx.id = grp.conexao_id
    where cx.telefone is not null
      and exists (
        select 1 from participantes p
        where p.grupo_id = grp.id and p.admin = true and p.saiu_em is null
          and p.telefone = any (variantes_telefone(cx.telefone))
      )
  )
  select cx.id, cx.nome, cx.telefone,
         count(distinct grp.id) as total_grupos,
         count(distinct adm.grupo_id) as admin_grupos,
         min(grp.conferido_em) as ultima_conferencia,
         bool_or(grp.conferido_em is null) as algum_pendente,
         count(*) over () as total
  from contas c
  join conexoes cx on cx.id = c.id
  left join grp on grp.conexao_id = cx.id
  left join adm on adm.conexao_id = cx.id and adm.grupo_id = grp.id
  where coalesce(p_busca, '') = '' or cx.nome ilike '%' || replace(replace(replace(p_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  group by cx.id, cx.nome, cx.telefone
  order by cx.nome
  limit least(greatest(coalesce(p_limite, 10), 1), 100)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;

revoke execute on function
  atividades_campanha(uuid, text, uuid, text, timestamptz, timestamptz, int, int),
  cliques_campanha(uuid, uuid, timestamptz, timestamptz, int, int), cliques_por_origem(uuid, int), cliques_por_grupo(uuid, int),
  diagnostico_contas(uuid, text, int, int)
from public, anon;
grant execute on function
  atividades_campanha(uuid, text, uuid, text, timestamptz, timestamptz, int, int),
  cliques_campanha(uuid, uuid, timestamptz, timestamptz, int, int), cliques_por_origem(uuid, int), cliques_por_grupo(uuid, int),
  diagnostico_contas(uuid, text, int, int)
to authenticated, service_role;

-- "Verificar compatibilidade": pede a conferência imediata dos grupos ativos de UMA conta (limpa
-- `grupos.conferido_em`, igual "ATUALIZAR LEADS" faz pra campanha inteira), travado a 1 pedido por conta a cada
-- 2 minutos. `verificado_em` guarda só a trava — a data mostrada na tela vem de `diagnostico_contas`
-- (`ultima_conferencia`, que é a conferência de verdade). Grava/lê pela ação do servidor (`dbAdmin`).
create table verificacoes_contas (
  campanha_id uuid not null references campanhas (id) on delete cascade,
  conexao_id uuid not null references conexoes (id) on delete cascade,
  verificado_em timestamptz not null default now(),
  primary key (campanha_id, conexao_id)
);
alter table verificacoes_contas enable row level security;
create policy equipe_le on verificacoes_contas for select to authenticated using (true);
revoke all on verificacoes_contas from anon;
grant select on verificacoes_contas to authenticated;
grant select, insert, update, delete on verificacoes_contas to service_role;
