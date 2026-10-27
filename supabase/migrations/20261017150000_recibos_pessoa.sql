-- Etapa 3G (Tarefa 1): recibos por pessoa, Leadscoring e Desempenho por grupo.
--
-- Aditiva: tabela nova `recibos` (um recibo por mensagem, pessoa e tipo) e RPCs novas. `somar_recibos` ganha
-- parâmetros novos COM default: o webhook antigo (`{ p_ids, p_lido }`) continua funcionando durante o deploy
-- (a migração sobe antes do código). A versão de 2 parâmetros é trocada pela de 4 na mesma transação (deixar as
-- duas tornaria a chamada de 2 parâmetros ambígua); os grants são refeitos logo abaixo.
--
-- Pontos: recebeu 10, visualizou 20, reproduziu 40. Os dados por pessoa só existem a partir da
-- publicação desta etapa (17/10/2026): o que chegou antes só está somado em tarefas.entregues/lidos.

create table recibos (
  tarefa_id uuid not null references tarefas (id) on delete cascade,
  telefone text not null,
  tipo text not null check (tipo in ('recebeu', 'visualizou', 'reproduziu')),
  em timestamptz not null default now(),
  primary key (tarefa_id, telefone, tipo)
);
-- Sem índice extra: todas as leituras partem das tarefas da campanha e usam a chave primária (tarefa_id, …).

alter table recibos enable row level security;
-- Equipe logada só lê: quem escreve é o webhook (service_role), pela somar_recibos.
create policy equipe_le on recibos for select to authenticated using (true);
revoke all on recibos from anon, authenticated;
grant select on recibos to authenticated;
grant select, insert, update, delete on recibos to service_role;

-- 1. somar_recibos: UMA chamada por aviso do Zapbot.
--    Com telefone: grava o recibo da pessoa (on conflict do nothing) e soma em tarefas.entregues/lidos SÓ o que foi
--    gravado de fato — aviso repetido não conta duas vezes.
--    Sem telefone (pessoa desconhecida, ou o webhook antigo durante o deploy): comportamento de antes, soma sem
--    linha por pessoa.
--    "reproduziu" (PLAYED) nunca soma em lidos: o WhatsApp também manda READ pra mesma pessoa.
--    As tarefas são travadas em ordem de id antes de escrever: dois avisos com ids sobrepostos (o Zapbot junta
--    vários ids num aviso) esperam um pelo outro em vez de travar em ordem cruzada (deadlock).
drop function somar_recibos(text[], boolean);

create function somar_recibos(p_ids text[], p_lido boolean default false, p_telefone text default null, p_tipo text default null)
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_tipo text := coalesce(p_tipo, case when p_lido then 'visualizou' else 'recebeu' end);
  v_tel text := nullif(btrim(coalesce(p_telefone, '')), '');
begin
  if v_tipo not in ('recebeu', 'visualizou', 'reproduziu') then
    raise exception 'tipo de recibo inválido: %', v_tipo;
  end if;
  if v_tel is null and v_tipo = 'reproduziu' then return; end if;
  perform 1 from tarefas where message_id = any(p_ids) order by id for update;
  if v_tel is null then
    update tarefas set
      entregues = entregues + case when v_tipo = 'recebeu' then 1 else 0 end,
      lidos = lidos + case when v_tipo = 'visualizou' then 1 else 0 end
    where message_id = any(p_ids);
    return;
  end if;
  with novos as (
    insert into recibos (tarefa_id, telefone, tipo)
    select t.id, v_tel, v_tipo from tarefas t where t.message_id = any(p_ids)
    on conflict do nothing
    returning tarefa_id
  )
  update tarefas t set
    entregues = t.entregues + case when v_tipo = 'recebeu' then 1 else 0 end,
    lidos = t.lidos + case when v_tipo = 'visualizou' then 1 else 0 end
  from novos n
  where t.id = n.tarefa_id and v_tipo <> 'reproduziu';
end $$;

revoke execute on function somar_recibos(text[], boolean, text, text) from public, anon, authenticated;
grant execute on function somar_recibos(text[], boolean, text, text) to service_role;

-- 2. leadscore_campanha: pontos por pessoa na campanha, paginado no banco. `p_tipos` (chips "Status:") limita
--    quais recibos contam (null = todos). `p_busca` procura pelos dígitos do número. `total` = linhas sem paginação.
--    Limite de 1 a 50.000: a tela pede 25 por página; os 50.000 são só pra `leadscore_exportar`.
create function leadscore_campanha(p_campanha uuid, p_busca text default null, p_limite int default 25, p_deslocamento int default 0, p_tipos text[] default null)
returns table (telefone text, pontos bigint, recebeu bigint, visualizou bigint, reproduziu bigint, total bigint)
language sql stable security invoker set search_path = public as $$
  with digitos as (
    select nullif(regexp_replace(coalesce(p_busca, ''), '\D', '', 'g'), '') as d
  ), r as (
    select r.telefone,
           count(*) filter (where r.tipo = 'recebeu') as recebeu,
           count(*) filter (where r.tipo = 'visualizou') as visualizou,
           count(*) filter (where r.tipo = 'reproduziu') as reproduziu
    from recibos r
    join tarefas t on t.id = r.tarefa_id
    join execucoes e on e.id = t.execucao_id
    cross join digitos
    where e.campanha_id = p_campanha
      and (p_tipos is null or r.tipo = any(p_tipos))
      and (digitos.d is null or strpos(r.telefone, digitos.d) > 0)
    group by r.telefone
  )
  select r.telefone, r.recebeu * 10 + r.visualizou * 20 + r.reproduziu * 40, r.recebeu, r.visualizou, r.reproduziu, count(*) over ()
  from r
  order by 2 desc, r.telefone
  limit least(greatest(coalesce(p_limite, 25), 1), 50000)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;

-- 2b. leadscore_exportar: o ranking inteiro (até 50.000 pessoas) numa chamada só, pro EXPORTAR. Devolve um jsonb
--     (um valor só) porque o PostgREST corta conjuntos de linhas em max_rows (1000), e paginar em várias chamadas
--     deixaria o ranking mudar entre as páginas se chegasse recibo no meio. Mesma ordem e pontos da tela.
create function leadscore_exportar(p_campanha uuid, p_busca text default null, p_tipos text[] default null)
returns jsonb
language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'telefone', l.telefone, 'pontos', l.pontos, 'recebeu', l.recebeu, 'visualizou', l.visualizou, 'reproduziu', l.reproduziu
         ) order by l.pontos desc, l.telefone), '[]'::jsonb)
  from leadscore_campanha(p_campanha, p_busca, 50000, 0, p_tipos) l
$$;

-- 3. volume_recibos: recibos da campanha por hora/dia/semana/mês de Brasília, com os períodos vazios (zero).
--    Limitado no banco: por hora, no máximo 31 dias; nos outros, no máximo ~2 anos.
create function volume_recibos(p_campanha uuid, p_agrupar text, p_inicio timestamptz)
returns table (periodo text, recebeu bigint, visualizou bigint, reproduziu bigint)
language plpgsql stable security invoker set search_path = public as $$
declare
  v_unidade text := case p_agrupar when 'hora' then 'hour' when 'dia' then 'day' when 'semana' then 'week' when 'mes' then 'month' end;
  v_passo interval := case p_agrupar when 'hora' then interval '1 hour' when 'dia' then interval '1 day' when 'semana' then interval '1 week' when 'mes' then interval '1 month' end;
  v_inicio timestamptz;
begin
  if v_unidade is null then
    raise exception 'agrupamento inválido: %', p_agrupar;
  end if;
  v_inicio := greatest(coalesce(p_inicio, now() - interval '7 days'), now() - case when p_agrupar = 'hora' then interval '31 days' else interval '800 days' end);
  -- O primeiro período começa no início dele (ex.: 00:00 do dia em Brasília), não no meio: senão sairia incompleto.
  v_inicio := date_trunc(v_unidade, v_inicio at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  return query
  with c as (
    select date_trunc(v_unidade, r.em at time zone 'America/Sao_Paulo') as p,
           count(*) filter (where r.tipo = 'recebeu') as recebeu,
           count(*) filter (where r.tipo = 'visualizou') as visualizou,
           count(*) filter (where r.tipo = 'reproduziu') as reproduziu
    from recibos r
    join tarefas t on t.id = r.tarefa_id
    join execucoes e on e.id = t.execucao_id
    where e.campanha_id = p_campanha and r.em >= v_inicio
    group by 1
  ), s as (
    select generate_series(
      date_trunc(v_unidade, v_inicio at time zone 'America/Sao_Paulo'),
      date_trunc(v_unidade, now() at time zone 'America/Sao_Paulo'),
      v_passo
    ) as p
  )
  select to_char(s.p, 'YYYY-MM-DD HH24:MI'), coalesce(c.recebeu, 0), coalesce(c.visualizou, 0), coalesce(c.reproduziu, 0)
  from s left join c on c.p = s.p
  order by s.p;
end $$;

-- 4. desempenho_grupos: pontos por grupo no critério escolhido ÷ participantes atuais do grupo (mínimo 1), do
--    maior pro menor. `p_execucao` limita a um disparo; `p_busca` filtra pelo nome do grupo.
create function desempenho_grupos(p_campanha uuid, p_criterio text default 'geral', p_execucao uuid default null, p_limite int default 20, p_busca text default null)
returns table (grupo_id uuid, numero int, nome text, participantes int, recebeu bigint, visualizou bigint, reproduziu bigint, pontos bigint, pontuacao numeric)
language sql stable security invoker set search_path = public as $$
  with c as (
    select t.grupo_id,
           count(*) filter (where r.tipo = 'recebeu') as recebeu,
           count(*) filter (where r.tipo = 'visualizou') as visualizou,
           count(*) filter (where r.tipo = 'reproduziu') as reproduziu
    from recibos r
    join tarefas t on t.id = r.tarefa_id
    join execucoes e on e.id = t.execucao_id
    where e.campanha_id = p_campanha and (p_execucao is null or e.id = p_execucao)
    group by t.grupo_id
  ), g as (
    select g.id, g.numero, g.nome, g.participantes,
           coalesce(c.recebeu, 0) as recebeu, coalesce(c.visualizou, 0) as visualizou, coalesce(c.reproduziu, 0) as reproduziu
    from grupos g
    left join c on c.grupo_id = g.id
    where g.campanha_id = p_campanha
      and (coalesce(p_busca, '') = '' or g.nome ilike '%' || replace(replace(replace(p_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%')
  ), p as (
    select g.*,
           case coalesce(p_criterio, 'geral')
             when 'visualizacao' then g.visualizou * 20
             when 'reproducao' then g.reproduziu * 40
             when 'recebimento' then g.recebeu * 10
             else g.recebeu * 10 + g.visualizou * 20 + g.reproduziu * 40
           end as pontos
    from g
  )
  select p.id, p.numero, p.nome, p.participantes, p.recebeu, p.visualizou, p.reproduziu, p.pontos,
         round(p.pontos::numeric / greatest(p.participantes, 1), 2)
  from p
  order by 9 desc, p.numero
  limit least(greatest(coalesce(p_limite, 20), 1), 1000)
$$;

revoke execute on function leadscore_exportar(uuid, text, text[]) from public, anon;
grant execute on function leadscore_exportar(uuid, text, text[]) to authenticated, service_role;
revoke execute on function leadscore_campanha(uuid, text, int, int, text[]), volume_recibos(uuid, text, timestamptz), desempenho_grupos(uuid, text, uuid, int, text) from public, anon;
grant execute on function leadscore_campanha(uuid, text, int, int, text[]), volume_recibos(uuid, text, timestamptz), desempenho_grupos(uuid, text, uuid, int, text) to authenticated, service_role;
