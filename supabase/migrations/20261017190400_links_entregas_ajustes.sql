-- Etapa 3J (Tarefa 3, revisão): ajustes das seções de links e da Confirmação de entrega.
--
-- Aditiva: um índice parcial novo, uma RPC nova e três funções trocadas com a MESMA assinatura (grants mantidos):
--   * campanhas_links_vencidas: o passo `links` do tick só recebe campanha que precisa mesmo de atualização (sem
--     campanha "parada" na frente das outras);
--   * conferir_entregas: parte das campanhas com a seção ligada e só alerta quando a campanha (ou a conta que
--     enviou) já teve recibo de observador nos últimos 7 dias — sem isso a falta de recibo não quer dizer nada;
--   * listar_acoes: esconde as atualizações periódicas de link (uma por hora) a não ser que o filtro de tipos
--     peça "Atualizar links dos grupos".

-- Tarefas confirmadas recentes (prova de que os recibos de observador chegam).
create index tarefas_entrega_confirmada on tarefas (enviado_em) where entrega = 'confirmada';

-- 1. campanhas_links_vencidas: campanhas ativas (não arquivadas, não terminadas, com grupo ativo) com
--    "Atualização periódica de links" ligada e vencida (`24 h / links_por_dia` desde a última). Fica de fora,
--    nesta volta, a campanha com mensagem/enquete marcada para os próximos 30 min (ou enviando agora): a
--    atualização não disputa a fila do número com o disparo.
create function campanhas_links_vencidas(p_limite int default 20)
returns table (id uuid, links_por_dia smallint, links_atualizados_em timestamptz)
language sql stable security invoker set search_path = public as $$
  select c.id, c.links_por_dia, c.links_atualizados_em
  from campanhas c
  where c.links_periodicos and not c.arquivada
    and (c.termina_em is null or c.termina_em > now())
    and (c.links_atualizados_em is null or c.links_atualizados_em <= now() - interval '24 hours' / c.links_por_dia)
    and exists (select 1 from grupos g where g.campanha_id = c.id and g.ativo)
    and not exists (
      select 1 from execucoes e
      where e.campanha_id = c.id and e.tipo in ('mensagem', 'enquete')
        and e.agendada_para >= now() - interval '1 day'
        and ((e.status = 'agendada' and e.agendada_para <= now() + interval '30 minutes') or e.status = 'enviando')
    )
  order by c.links_atualizados_em nulls first, c.id
  limit least(greatest(coalesce(p_limite, 20), 1), 200)
$$;

revoke execute on function campanhas_links_vencidas(int) from public, anon, authenticated;
grant execute on function campanhas_links_vencidas(int) to service_role;

-- 2. conferir_entregas (mesma assinatura e regra de marcação da 20261017190100). Muda:
--    * parte de `campanhas` com `confirmar_entrega` (execuções dos últimos 7 dias, tarefas pela chave da execução);
--    * a execução só volta (e só ganha `entrega_alertada`) se a campanha teve tarefa confirmada nos últimos 7 dias
--      (inclusive nesta chamada) ou se alguma conta que enviou tarefa não confirmada teve. Sem essa prova, as
--      tarefas ficam marcadas e nada é alertado.
create or replace function conferir_entregas(p_limite int default 500)
returns table (execucao_id uuid, campanha_id uuid, nao_confirmadas int)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v_limite int := least(greatest(coalesce(p_limite, 500), 1), 5000);
begin
  -- Promoção (recibo atrasado), só nas campanhas com a seção ligada.
  update tarefas t set entrega = 'confirmada'
  where t.id in (
    select t2.id
    from campanhas c
    join execucoes e on e.campanha_id = c.id and e.agendada_para >= now() - interval '7 days'
    join tarefas t2 on t2.execucao_id = e.id
    where c.confirmar_entrega
      and t2.entrega = 'nao_confirmada'
      and t2.enviado_em >= now() - interval '24 hours'
      and exists (
        select 1 from recibos r
        where r.tarefa_id = t2.id and r.tipo in ('recebeu', 'visualizou')
          and r.telefone = any (array(
            select v from conexoes cx cross join lateral unnest(variantes_telefone(cx.telefone)) as v
            where cx.telefone is not null and cx.id <> t2.conexao_id
              and (cx.id in (select cc.conexao_id from campanha_conexoes cc where cc.campanha_id = c.id)
                   or cx.id = c.conexao_criadora_id)
          ))
      )
    order by t2.enviado_em
    limit v_limite
  );

  return query
  with camp as (
    select c.id, c.confirmar_entrega_desde, c.conexao_criadora_id
    from campanhas c
    where c.confirmar_entrega and c.confirmar_entrega_desde is not null
  ), cand as (
    select t.id, t.execucao_id, t.grupo_id, t.conexao_id, camp.id as campanha_id, camp.conexao_criadora_id, t.enviado_em
    from camp
    join execucoes e on e.campanha_id = camp.id and e.agendada_para >= now() - interval '7 days'
    join tarefas t on t.execucao_id = e.id
    where t.entrega is null and t.status = 'enviado' and t.message_id is not null
      and t.tipo in ('mensagem', 'enquete')
      and t.enviado_em <= now() - interval '30 minutes'
      and t.enviado_em >= now() - interval '25 hours'
      and t.enviado_em >= camp.confirmar_entrega_desde
      and not exists (
        select 1 from tarefas t3
        where t3.execucao_id = t.execucao_id
          and (t3.status in ('fila', 'processando') or (t3.status = 'enviado' and t3.enviado_em > now() - interval '30 minutes'))
      )
  ), ex as (
    select cand.execucao_id, count(*) as n, min(cand.enviado_em) as m from cand group by cand.execucao_id
  ), escolhidas as (
    select x.execucao_id from (
      select ex.execucao_id, sum(ex.n) over (order by ex.m, ex.execucao_id) - ex.n as antes from ex
    ) x
    where x.antes < v_limite
  ), obs as (
    select cand.id, array(
      select v from conexoes cx cross join lateral unnest(variantes_telefone(cx.telefone)) as v
      where cx.telefone is not null and cx.id <> cand.conexao_id
        and (cx.id in (select cc.conexao_id from campanha_conexoes cc where cc.campanha_id = cand.campanha_id)
             or cx.id = cand.conexao_criadora_id)
    ) as tels
    from cand join escolhidas on escolhidas.execucao_id = cand.execucao_id
  ), julgadas as (
    select cand.id, cand.execucao_id, cand.campanha_id, cand.conexao_id,
      case
        when not exists (
          select 1 from participantes p where p.grupo_id = cand.grupo_id and p.saiu_em is null and p.telefone = any (obs.tels)
        ) then 'sem_observador'
        when exists (
          select 1 from recibos r where r.tarefa_id = cand.id and r.tipo in ('recebeu', 'visualizou') and r.telefone = any (obs.tels)
        ) then 'confirmada'
        else 'nao_confirmada'
      end as entrega
    from cand join obs on obs.id = cand.id
  ), marcadas as (
    update tarefas t set entrega = j.entrega
    from julgadas j
    where t.id = j.id and t.entrega is null
    returning t.id, j.execucao_id, j.campanha_id, j.conexao_id, j.entrega
  ), por_execucao as (
    select m.execucao_id, m.campanha_id, count(*)::int as n
    from marcadas m where m.entrega = 'nao_confirmada'
    group by m.execucao_id, m.campanha_id
  ), com_prova as (
    select pe.execucao_id, pe.campanha_id, pe.n
    from por_execucao pe
    where exists (select 1 from marcadas m where m.campanha_id = pe.campanha_id and m.entrega = 'confirmada')
       or exists (
         select 1 from execucoes e2 join tarefas t4 on t4.execucao_id = e2.id
         where e2.campanha_id = pe.campanha_id and e2.agendada_para >= now() - interval '8 days'
           and t4.entrega = 'confirmada' and t4.enviado_em >= now() - interval '7 days'
       )
       or exists (
         select 1 from tarefas t5
         where t5.entrega = 'confirmada' and t5.enviado_em >= now() - interval '7 days'
           and t5.conexao_id in (select m.conexao_id from marcadas m where m.execucao_id = pe.execucao_id and m.entrega = 'nao_confirmada')
       )
  ), alertadas as (
    update execucoes e set entrega_alertada = true
    from com_prova cp
    where e.id = cp.execucao_id and not e.entrega_alertada
    returning e.id
  )
  select cp.execucao_id, cp.campanha_id, cp.n
  from com_prova cp join alertadas a on a.id = cp.execucao_id;
end $$;

-- 3. listar_acoes (mesma assinatura e regra da 20261017140100) + as atualizações periódicas de link
--    (`origem 'campanha'`, `gatilho_chave 'periodico:…'`) só aparecem quando o filtro de tipos inclui
--    `atualizar_links`. As de troca de conta (`banimento:…`) continuam aparecendo.
create or replace function listar_acoes(
  p_campanha uuid, p_conexao uuid, p_tipos text[], p_aba text,
  p_inicio timestamptz, p_fim timestamptz, p_limite int, p_deslocamento int,
  p_automacao uuid default null
)
returns table (id uuid, total bigint)
language sql stable security invoker set search_path = public as $$
  with base as (
    select e.id, e.agendada_para
    from execucoes e
    where (p_campanha is null or e.campanha_id = p_campanha)
      and (p_tipos is null or e.tipo = any(p_tipos))
      and (p_automacao is null or e.automacao_id = p_automacao)
      and e.status <> 'cancelada'
      and not (
        e.origem = 'campanha' and e.tipo = 'atualizar_links' and coalesce(e.gatilho_chave, '') like 'periodico:%'
        and not coalesce('atualizar_links' = any(p_tipos), false)
      )
      -- "conta": execuções com alguma tarefa daquela conexão (`tarefas.conexao_id`).
      and (p_conexao is null or exists (select 1 from tarefas t where t.execucao_id = e.id and t.conexao_id = p_conexao))
      and (p_inicio is null or e.agendada_para >= p_inicio)
      and (p_fim is null or e.agendada_para < p_fim)
      and case p_aba
        when 'fila' then e.status = 'agendada' and e.agendada_para <= now()
        when 'agendado' then e.status = 'agendada' and e.agendada_para > now()
        when 'processando' then e.status = 'enviando'
        when 'sucesso' then e.status = 'concluida'
          and not exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro')
        when 'falhas' then e.status = 'bloqueada'
          or (e.status = 'concluida' and exists (select 1 from tarefas t where t.execucao_id = e.id and t.status = 'erro'))
        else true
      end
  )
  select b.id, count(*) over ()
  from base b
  order by b.agendada_para desc, b.id
  limit least(p_limite, 300) offset p_deslocamento
$$;
