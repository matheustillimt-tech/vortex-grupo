-- "Contas" virou "Conexões" na tela: o motivo gravado quando a última conexão escolhida sai da campanha (execução
-- cancelada ou automação desativada) passa a dizer "conexão". Função recriada igual à da 3F (mesma assinatura,
-- retorno e grants), só com o texto novo; os motivos já gravados com o texto antigo são atualizados.
create or replace function remover_conta_das_execucoes(p_campanha uuid, p_conexao uuid)
returns table (reassociadas int, canceladas int)
language plpgsql security invoker set search_path = public as $$
begin
  with alteradas as (
    update execucoes e
       set alvo_contas = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then e.alvo_contas
                              else array_remove(e.alvo_contas, p_conexao) end,
           status = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then 'cancelada' else e.status end,
           motivo = case when cardinality(array_remove(e.alvo_contas, p_conexao)) = 0 then 'A conexão escolhida saiu da campanha.'
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
                                  then 'A conexão escolhida saiu da campanha.' else au.motivo_desativada end
   where au.campanha_id = p_campanha
     and au.alvo_contas @> array[p_conexao];

  return next;
end;
$$;

update execucoes set motivo = 'A conexão escolhida saiu da campanha.' where motivo = 'A conta escolhida saiu da campanha.';
update automacoes set motivo_desativada = 'A conexão escolhida saiu da campanha.' where motivo_desativada = 'A conta escolhida saiu da campanha.';

revoke execute on function remover_conta_das_execucoes(uuid, uuid) from public, anon;
grant execute on function remover_conta_das_execucoes(uuid, uuid) to authenticated, service_role;
