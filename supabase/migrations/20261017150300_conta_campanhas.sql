-- Etapa 3G (revisão final): troca a leitura-depois-escreve de `definirCampanhasDaConta` (app) por uma RPC só,
-- pra acabar com a corrida entre duas pessoas editando a mesma conta ao mesmo tempo (o app lia `campanhas` e
-- `campanha_conexoes`, decidia o que mudar em JS, e chamava `aplicar_contas_campanha` uma vez por campanha —
-- entre a leitura e cada chamada, outra edição podia já ter mudado a linha). Só aditiva: função nova, mesmo
-- padrão de grants das RPCs de contas×campanhas (`aplicar_contas_campanha`, `20261017120100_campanha_contas.sql`).

-- definir_campanhas_da_conta: o espelho de `aplicar_contas_campanha`, só que do lado da CONTA em vez da
-- campanha — "esta conta entra/sai de quais campanhas" em vez de "esta campanha fica com quais contas". Insere
-- a conta em `campanha_conexoes` das campanhas pedidas (ignora a campanha onde ela já é criadora — essa nunca
-- entra na seleção, é admin implícita) e apaga a linha dela nas campanhas que não vieram na lista, sem tocar em
-- nenhuma outra conta. SÓ enxerga campanhas ATIVAS (`arquivada = false`) — a aba "Campanhas" do detalhe da
-- conta só lista campanhas ativas, então uma campanha arquivada nunca entra em `p_campanhas` nem pode ser
-- "removida": a linha dela em `campanha_conexoes`, se existir, fica intocada (correção da revisão: a versão
-- anterior apagava a linha de QUALQUER campanha fora da lista, inclusive arquivadas, só porque elas nunca
-- aparecem em `p_campanhas`). Pras campanhas ativas de onde ela saiu, respeita `reassociar_acoes` igual
-- `aplicar_contas_campanha`: ligado, chama `remover_conta_das_execucoes` (reassocia/cancela); desligado, não
-- toca nas execuções e só conta em `mantidas` as agendadas que ainda citam a conta. `for update` trava as
-- campanhas envolvidas (as pedidas + as que a conta já tem hoje) antes de decidir, igual a `aplicar_contas_campanha`
-- trava a campanha única dela.
create function definir_campanhas_da_conta(p_conexao uuid, p_campanhas uuid[])
returns table (adicionadas int, removidas int, reassociadas int, canceladas int, mantidas int)
language plpgsql security invoker set search_path = public as $$
declare
  v_campanhas uuid[];
  v_saiu uuid[];
  v_campanha uuid;
  v_reassociar boolean;
  v_mantidas int;
  v_r record;
begin
  perform 1 from campanhas c
   where c.arquivada = false
     and (
       c.id = any (coalesce(p_campanhas, '{}'))
       or exists (select 1 from campanha_conexoes cc where cc.conexao_id = p_conexao and cc.campanha_id = c.id)
     )
   for update;

  v_campanhas := array(
    select distinct c.id from campanhas c
     where c.id = any (coalesce(p_campanhas, '{}'))
       and c.arquivada = false
       and c.conexao_criadora_id is distinct from p_conexao
  );

  insert into campanha_conexoes (campanha_id, conexao_id)
  select unnest(v_campanhas), p_conexao
  on conflict (campanha_id, conexao_id) do nothing;
  get diagnostics adicionadas = row_count;

  with apagadas as (
    delete from campanha_conexoes cc
     where cc.conexao_id = p_conexao
       and not (cc.campanha_id = any (v_campanhas))
       and exists (
         select 1 from campanhas c
          where c.id = cc.campanha_id
            and c.arquivada = false
            and c.conexao_criadora_id is distinct from p_conexao
       )
    returning cc.campanha_id
  )
  select coalesce(array_agg(a.campanha_id), '{}') into v_saiu from apagadas a;
  removidas := cardinality(v_saiu);

  reassociadas := 0;
  canceladas := 0;
  mantidas := 0;
  if removidas > 0 then
    foreach v_campanha in array v_saiu loop
      select c.reassociar_acoes into v_reassociar from campanhas c where c.id = v_campanha;
      if v_reassociar then
        select * into v_r from remover_conta_das_execucoes(v_campanha, p_conexao);
        reassociadas := reassociadas + v_r.reassociadas;
        canceladas := canceladas + v_r.canceladas;
      else
        select count(*)::int into v_mantidas
          from execucoes e
         where e.campanha_id = v_campanha and e.status = 'agendada' and e.alvo_contas @> array[p_conexao];
        mantidas := mantidas + v_mantidas;
      end if;
    end loop;
  end if;
  return next;
end;
$$;

revoke execute on function definir_campanhas_da_conta(uuid, uuid[]) from public, anon;
grant execute on function definir_campanhas_da_conta(uuid, uuid[]) to authenticated, service_role;
