-- Etapa 3D (revisão final): troca de contas associadas da campanha feita no banco, de uma vez só.
--
-- remover_conta_das_execucoes: tira uma conta de `alvo_contas` das execuções `agendada` da campanha que a citam
-- (array_remove). Quando a lista fica vazia, a execução é cancelada com motivo — nunca vira null nem '{}', que
-- pros jobs (src/lib/jobs/execucoes.ts) significam "todas as contas", e a ação acabaria disparando por contas que
-- ninguém escolheu. A linha cancelada mantém o alvo antigo (registro do que foi escolhido). Devolve quantas foram
-- reassociadas e quantas canceladas.
--
-- aplicar_contas_campanha: troca as contas associadas (`campanha_conexoes`) pela lista dada — só contas que
-- existem, nunca a conta criadora — inserindo as novas antes de apagar as que saíram (a campanha nunca fica um
-- instante sem contas) e, com `reassociar_acoes` ligado, chamando remover_conta_das_execucoes pra cada conta que
-- saiu. Tudo numa transação só (a função inteira). Com `reassociar_acoes` desligado, só conta quantas execuções
-- agendadas continuam citando contas que saíram.
--
-- security invoker nas duas: respeitam o RLS de quem chama (equipe logada). Grants no padrão das últimas
-- migrações: nada pra public/anon; authenticated e service_role executam.

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
  return next;
end;
$$;

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
