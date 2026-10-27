-- Etapa 3J (Tarefa 3): seções de links (Atualização de links, Atualização periódica de links, Redefinir link de
-- convite) e Confirmação de entrega.
--
-- Aditiva: só colunas novas (todas null ou false), um índice único parcial novo, dois `check` ampliados com TODOS os
-- valores antigos e duas RPCs novas. Nada muda pra quem não ligar as seções (os interruptores nascem desligados na
-- migração 20261017190000).

-- 1. execucoes.origem ganha 'campanha' (execuções criadas pelas seções da campanha), mantendo os 5 valores.
alter table execucoes drop constraint execucoes_origem_check;
alter table execucoes add constraint execucoes_origem_check
  check (origem in ('avulsa', 'sequencia', 'massa', 'grupo_novo', 'automacao', 'campanha'));

-- Uma execução por campanha e chave de disparo das seções (insert simples; 23505 = já existe):
--   * `banimento:{conexão}:{minuto}`  troca de dono depois da queda de uma conta;
--   * `periodico:{hora}`               atualização periódica (no máximo uma por hora e campanha);
--   * `cheio:{grupo}:{conferido_em}`   redefinir o link quando o grupo enche (uma por enchimento).
create unique index execucoes_campanha_chave on execucoes (campanha_id, gatilho_chave) where origem = 'campanha';

-- Confirmação de entrega: o alerta de "sem confirmação" sai no máximo uma vez por execução.
alter table execucoes add column entrega_alertada boolean not null default false;

-- 2. tarefas.entrega: null = ainda não conferida.
alter table tarefas add column entrega text check (entrega in ('confirmada', 'sem_observador', 'nao_confirmada'));
-- Só as tarefas que a conferência ainda pode olhar (janela de 25 h, ver conferir_entregas).
create index tarefas_entrega_pendente on tarefas (enviado_em) where entrega is null and status = 'enviado' and message_id is not null;
create index tarefas_entrega_nao_confirmada on tarefas (enviado_em) where entrega = 'nao_confirmada';

-- 3. Alerta novo, mantendo os 8 tipos.
alter table alertas drop constraint alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro', 'bloqueado_removido', 'antispam_sem_conta', 'entrega_nao_confirmada'));

-- 4. Atualização de links: desde quando a conta está caída (gravado nas duas quedas automáticas: monitor e envio;
--    o "Desconectar" manual não grava) e quando os grupos dela já foram trocados de dono nesta queda. Só o service
--    role escreve e lê (`conexoes` tem grant por coluna pra authenticated: estas não entram).
alter table conexoes
  add column caiu_em timestamptz,
  add column grupos_trocados_em timestamptz;

-- 5. conferir_entregas: marca as tarefas de mensagem/enquete enviadas há pelo menos 30 min (e no máximo 25 h) nas
--    campanhas com a Confirmação de entrega ligada, só as enviadas depois de ligar (`confirmar_entrega_desde`).
--    Observadores = telefones (com as variantes do nono dígito) das contas da campanha (associadas + a criadora),
--    menos a conta que enviou. `sem_observador`: nenhum observador está no grupo; `confirmada`: chegou recibo
--    (recebeu/visualizou) de um observador; senão `nao_confirmada`.
--    Execuções inteiras de uma vez (só quando nenhuma tarefa delas está na fila ou foi enviada há menos de 30 min),
--    até ~p_limite tarefas por chamada. Recibos só pela chave primária (tarefa_id, …): nunca varre a tabela.
--    Também promove `nao_confirmada → confirmada` quando o recibo chega até 24 h depois do envio.
--    Devolve, por execução que ganhou tarefa não confirmada nesta chamada e ainda não tinha sido alertada, quantas
--    foram; a execução fica marcada (`entrega_alertada`) e nunca volta.
create function conferir_entregas(p_limite int default 500)
returns table (execucao_id uuid, campanha_id uuid, nao_confirmadas int)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v_limite int := least(greatest(coalesce(p_limite, 500), 1), 5000);
begin
  -- Promoção (recibo atrasado).
  update tarefas t set entrega = 'confirmada'
  where t.id in (
    select t2.id
    from tarefas t2
    join execucoes e on e.id = t2.execucao_id
    where t2.entrega = 'nao_confirmada'
      and t2.enviado_em >= now() - interval '24 hours'
      and exists (
        select 1 from recibos r
        where r.tarefa_id = t2.id and r.tipo in ('recebeu', 'visualizou')
          and r.telefone = any (array(
            select v from conexoes cx cross join lateral unnest(variantes_telefone(cx.telefone)) as v
            where cx.telefone is not null and cx.id <> t2.conexao_id
              and (cx.id in (select cc.conexao_id from campanha_conexoes cc where cc.campanha_id = e.campanha_id)
                   or cx.id = (select c.conexao_criadora_id from campanhas c where c.id = e.campanha_id))
          ))
      )
    order by t2.enviado_em
    limit v_limite
  );

  return query
  with cand as (
    select t.id, t.execucao_id, t.grupo_id, t.conexao_id, e.campanha_id, t.enviado_em
    from tarefas t
    join execucoes e on e.id = t.execucao_id
    join campanhas c on c.id = e.campanha_id
    where t.entrega is null and t.status = 'enviado' and t.message_id is not null
      and t.tipo in ('mensagem', 'enquete')
      and t.enviado_em <= now() - interval '30 minutes'
      and t.enviado_em >= now() - interval '25 hours'
      and c.confirmar_entrega and c.confirmar_entrega_desde is not null
      and t.enviado_em >= c.confirmar_entrega_desde
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
             or cx.id = (select c.conexao_criadora_id from campanhas c where c.id = cand.campanha_id))
    ) as tels
    from cand join escolhidas on escolhidas.execucao_id = cand.execucao_id
  ), julgadas as (
    select cand.id, cand.execucao_id, cand.campanha_id,
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
    returning t.id, j.execucao_id, j.campanha_id, j.entrega
  ), por_execucao as (
    select m.execucao_id, m.campanha_id, count(*)::int as n
    from marcadas m where m.entrega = 'nao_confirmada'
    group by m.execucao_id, m.campanha_id
  ), alertadas as (
    update execucoes e set entrega_alertada = true
    from por_execucao pe
    where e.id = pe.execucao_id and not e.entrega_alertada
    returning e.id
  )
  select pe.execucao_id, pe.campanha_id, pe.n
  from por_execucao pe join alertadas a on a.id = pe.execucao_id;
end $$;

revoke execute on function conferir_entregas(int) from public, anon, authenticated;
grant execute on function conferir_entregas(int) to service_role;

-- 6. entregas_das_execucoes: placar da Confirmação de entrega por execução (cartão da mensagem). Lê como quem
--    chama (RLS da equipe). No máximo 500 ids por chamada (a tela manda uma página).
create function entregas_das_execucoes(p_ids uuid[])
returns table (execucao_id uuid, confirmadas int, sem_observador int, nao_confirmadas int, total int)
language sql stable security invoker set search_path = public as $$
  select t.execucao_id,
         (count(*) filter (where t.entrega = 'confirmada'))::int,
         (count(*) filter (where t.entrega = 'sem_observador'))::int,
         (count(*) filter (where t.entrega = 'nao_confirmada'))::int,
         (count(*) filter (where t.entrega is not null))::int
  from tarefas t
  where t.execucao_id = any (p_ids[1:500])
  group by t.execucao_id
$$;

revoke execute on function entregas_das_execucoes(uuid[]) from public, anon;
grant execute on function entregas_das_execucoes(uuid[]) to authenticated, service_role;
