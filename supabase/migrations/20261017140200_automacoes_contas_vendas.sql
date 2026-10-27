-- Etapa 3F (revisão da Tarefa 1): contas das automações quando uma conta sai da campanha, e venda aprovada que
-- chega depois de um evento não aprovado do mesmo pedido. Só aditiva (coluna nova nasce null; funções recriadas com
-- as mesmas assinaturas e grants).

-- 1. Motivo de uma automação desativada pelo sistema (ex.: a conta escolhida saiu da campanha). null = ninguém
--    desativou por motivo nenhum. O app limpa ao ativar de novo.
alter table automacoes add column motivo_desativada text;

-- 2. remover_conta_das_execucoes: além das execuções `agendada` (como na 3D), tira a conta de `alvo_contas` das
--    automações da campanha. Automação cuja lista fica vazia é desativada com motivo — nunca vira null nem '{}' (null
--    é "todas as contas", e a automação passaria a disparar por contas que ninguém escolheu); a lista antiga fica
--    como registro do que foi escolhido. As execuções agendadas dela que só tinham essa conta já são canceladas pelo
--    primeiro update; remoções na fila de uma automação desativada são barradas no processarAcoes. Mesma assinatura
--    e mesmo retorno (as automações não entram na contagem).
create or replace function remover_conta_das_execucoes(p_campanha uuid, p_conexao uuid)
returns table (reassociadas int, canceladas int)
language plpgsql security invoker set search_path = public as $$
begin
  with alteradas as (
    update execucoes e
       set alvo_contas = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then e.alvo_contas
                              else array_remove(e.alvo_contas, p_conexao) end,
           status = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then 'cancelada' else e.status end,
           motivo = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then 'A conta escolhida saiu da campanha.'
                         else e.motivo end
     where e.campanha_id = p_campanha
       and e.status = 'agendada'
       and e.alvo_contas @> array[p_conexao]
    returning e.status
  )
  select (count(*) filter (where a.status = 'agendada'))::int, (count(*) filter (where a.status = 'cancelada'))::int
    into reassociadas, canceladas
    from alteradas a;

  update automacoes au
     set alvo_contas = case when cardinality(array_remove(au.alvo_contas, p_conexao)) = 0 then au.alvo_contas
                            else array_remove(au.alvo_contas, p_conexao) end,
         ativo = case when cardinality(array_remove(au.alvo_contas, p_conexao)) = 0 then false else au.ativo end,
         motivo_desativada = case when cardinality(array_remove(au.alvo_contas, p_conexao)) = 0
                                  then 'A conta escolhida saiu da campanha.' else au.motivo_desativada end
   where au.campanha_id = p_campanha
     and au.alvo_contas @> array[p_conexao];

  return next;
end;
$$;

-- aplicar_contas_campanha: igual à 3D (recriada junto pra ficar claro que as automações seguem a mesma regra): com
-- `reassociar_acoes` ligado, cada conta que saiu passa por remover_conta_das_execucoes (execuções e automações);
-- desligado, nada é mexido e `mantidas` conta as execuções agendadas que ainda citam contas que saíram.
create or replace function aplicar_contas_campanha(p_campanha uuid, p_contas uuid[])
returns table (adicionadas int, removidas int, reassociadas int, canceladas int, mantidas int)
language plpgsql security invoker set search_path = public as $$
declare
  v_criadora uuid;
  v_reassociar boolean;
  v_contas uuid[];
  v_saiu uuid[];
  v_conta uuid;
  v_r record;
begin
  select c.conexao_criadora_id, c.reassociar_acoes into v_criadora, v_reassociar
    from campanhas c where c.id = p_campanha
    for update;
  if not found then
    raise exception 'campanha % não encontrada', p_campanha using errcode = 'P0002';
  end if;

  v_contas := array(
    select distinct x.id from conexoes x
     where x.id = any (coalesce(p_contas, '{}'))
       and x.id is distinct from v_criadora
  );

  insert into campanha_conexoes (campanha_id, conexao_id)
  select p_campanha, unnest(v_contas)
  on conflict (campanha_id, conexao_id) do nothing;
  get diagnostics adicionadas = row_count;

  with apagadas as (
    delete from campanha_conexoes cc
     where cc.campanha_id = p_campanha
       and not (cc.conexao_id = any (v_contas))
       and cc.conexao_id is distinct from v_criadora
    returning cc.conexao_id
  )
  select coalesce(array_agg(a.conexao_id), '{}') into v_saiu from apagadas a;
  removidas := cardinality(v_saiu);

  reassociadas := 0;
  canceladas := 0;
  mantidas := 0;
  if removidas > 0 then
    if v_reassociar then
      foreach v_conta in array v_saiu loop
        select * into v_r from remover_conta_das_execucoes(p_campanha, v_conta);
        reassociadas := reassociadas + v_r.reassociadas;
        canceladas := canceladas + v_r.canceladas;
      end loop;
    else
      select count(*)::int into mantidas
        from execucoes e
       where e.campanha_id = p_campanha and e.status = 'agendada' and e.alvo_contas && v_saiu;
    end if;
  end if;
  return next;
end;
$$;

revoke execute on function remover_conta_das_execucoes(uuid, uuid), aplicar_contas_campanha(uuid, uuid[]) from public, anon;
grant execute on function remover_conta_das_execucoes(uuid, uuid), aplicar_contas_campanha(uuid, uuid[]) to authenticated, service_role;

-- 3. registrar_venda: grava a venda do webhook de checkout. Idêntico ao upsert com ignoreDuplicates de antes, menos
--    num caso: o mesmo (provedor, evento_id) que chegou NÃO aprovado e agora chega aprovado (o Kiwify usa o
--    order_id como evento: "aguardando pagamento" e depois "pago" têm a mesma chave). Aí a linha vira aprovada com
--    os dados novos e volta pra fila (`processada_em`/`resultado` limpos): processarVendas a processa de novo. A
--    rodada anterior, não aprovada, não fez nada além de marcar "ignorada", e tudo o que a aprovada faz é idempotente
--    (tag por_tag on conflict, remoção única por grupo+telefone, automação por venda:<id>:<grupo>, evento compra:<id>).
--    Aprovada nunca volta a não aprovada, e uma aprovada repetida não muda nada.
create or replace function registrar_venda(p_provedor text, p_evento_id text, p_aprovada boolean, p_telefone text, p_produtos text[], p_payload jsonb)
returns void
language sql security invoker set search_path = public as $$
  insert into vendas (provedor, evento_id, aprovada, telefone, produtos, payload)
  values (p_provedor, p_evento_id, p_aprovada, p_telefone, coalesce(p_produtos, '{}'), p_payload)
  on conflict (provedor, evento_id) do update
     set aprovada = true,
         payload = excluded.payload,
         telefone = excluded.telefone,
         produtos = excluded.produtos,
         processada_em = null,
         resultado = null
   where vendas.aprovada = false and excluded.aprovada = true
$$;
revoke execute on function registrar_venda(text, text, boolean, text, text[], jsonb) from public, anon, authenticated;
grant execute on function registrar_venda(text, text, boolean, text, text[], jsonb) to service_role;
