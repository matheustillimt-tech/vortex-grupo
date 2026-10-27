-- Diagnósticos (20/10/2026): "É admin de X / Y grupos" passa a contar TODOS os grupos ativos da campanha, não só os
-- que a conexão é dona. É o número que importa pra contingência: a reserva tem que ser admin de todos. Antes, com
-- um chip dono de 11 e outro dono de 3, a tela mostrava 11/11 e 3/3 e escondia que um chip faltava em grupos do outro.
-- `donos` = grupos em que ela é a conexão dona; `criadora` = é o número que cria os grupos. A conferência (data e
-- `algum_pendente`) continua vindo dos grupos de que ela é dona: é ela quem confere esses.
drop function if exists diagnostico_contas(uuid, text, int, int);
create function diagnostico_contas(p_campanha uuid, p_busca text default null, p_limite int default 10, p_deslocamento int default 0)
returns table (conexao_id uuid, nome text, telefone text, total_grupos bigint, admin_grupos bigint, donos bigint, criadora boolean, ultima_conferencia timestamptz, algum_pendente boolean, total bigint)
language sql stable security invoker set search_path = public as $$
  with contas as (
    select cc.conexao_id as id from campanha_conexoes cc where cc.campanha_id = p_campanha
    union
    select c.conexao_criadora_id from campanhas c where c.id = p_campanha and c.conexao_criadora_id is not null
    union
    select g.conexao_id from grupos g where g.campanha_id = p_campanha and g.ativo = true
  ), grp as (
    select g.id, g.conexao_id, g.conferido_em from grupos g where g.campanha_id = p_campanha and g.ativo = true
  )
  select cx.id, cx.nome, cx.telefone,
         (select count(*) from grp) as total_grupos,
         (select count(*) from grp where cx.telefone is not null and exists (
            select 1 from participantes p
            where p.grupo_id = grp.id and p.admin = true and p.saiu_em is null
              and p.telefone = any (variantes_telefone(cx.telefone)))) as admin_grupos,
         (select count(*) from grp where grp.conexao_id = cx.id) as donos,
         exists (select 1 from campanhas c where c.id = p_campanha and c.conexao_criadora_id = cx.id) as criadora,
         (select min(grp.conferido_em) from grp where grp.conexao_id = cx.id) as ultima_conferencia,
         coalesce((select bool_or(grp.conferido_em is null) from grp where grp.conexao_id = cx.id), false) as algum_pendente,
         count(*) over () as total
  from contas c
  join conexoes cx on cx.id = c.id
  where coalesce(p_busca, '') = '' or cx.nome ilike '%' || replace(replace(replace(p_busca, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  order by cx.nome
  limit least(greatest(coalesce(p_limite, 10), 1), 100)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;

revoke execute on function diagnostico_contas(uuid, text, int, int) from public, anon;
grant execute on function diagnostico_contas(uuid, text, int, int) to authenticated, service_role;
