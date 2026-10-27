-- Etapa 3K, Tarefa 3: 4 ações novas no assistente "Adicionar ação" e a tela
-- "Ver exportações". Só aditiva: os checks ganham valores e mantêm todos os de antes; nada muda pro que já existe.

-- 1. "Privacidade Avançada na Conversa" vira um tipo de execução (roda grupo a grupo, como as outras ações de grupo).
--    Os 14 valores de 20261017110000_acoes_v2.sql continuam valendo (execucoes e tarefas têm o mesmo check).
alter table execucoes drop constraint execucoes_tipo_check;
alter table execucoes add constraint execucoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos',
  'privacidade_avancada'
));

alter table tarefas drop constraint tarefas_tipo_check;
alter table tarefas add constraint tarefas_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos',
  'privacidade_avancada'
));

-- 2. "Entrar no Grupo": uma linha da fila `acoes` por conta (dados {link, conexao_id}), processada por
--    `processarAcoes` no próximo minuto. O check era inline em 20261015120000_inicial.sql (nome gerado
--    `acoes_tipo_check`, com 'criar_grupo' e 'remover', que continuam valendo). `pegar_acoes`
--    (20261016180000_automacoes_parte2.sql) não filtra por tipo: nada a mudar nela.
alter table acoes drop constraint acoes_tipo_check;
alter table acoes add constraint acoes_tipo_check check (tipo in ('criar_grupo', 'remover', 'entrar_grupo'));
-- Dedupe: o mesmo convite pra mesma conta só uma vez na fila (clique duplo, aba aberta duas vezes).
create unique index acoes_um_entrar_por_conta on acoes ((dados ->> 'conexao_id'), (dados ->> 'link'))
  where tipo = 'entrar_grupo' and status in ('fila', 'processando');

-- 3. Exportações: só os metadados (tipo, filtros, contagem da primeira vez). O arquivo nunca é guardado — "BAIXAR"
--    gera de novo com os dados de hoje a partir dos filtros.
create table exportacoes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  criada_por uuid,
  tipo text not null check (tipo in ('leads', 'status_mensagens', 'historico_mensagens')),
  filtros jsonb not null,
  linhas int not null default 0,
  nome_arquivo text not null
);
create index exportacoes_data on exportacoes (created_at desc);

alter table exportacoes enable row level security;
create policy equipe_tudo on exportacoes for all to authenticated using (true) with check (true);
grant select, insert, update, delete on exportacoes to authenticated, service_role;
revoke all on exportacoes from anon;

-- 4. "Relatório de status de mensagens": uma linha por tarefa × pessoa de `recibos` (tarefa sem recibo = uma linha
--    com telefone vazio), com o primeiro horário de cada tipo de recibo. security invoker: respeita o RLS de quem
--    chama (a rota confere Leads/ver antes, porque sai telefone). Página de até 1000 linhas.
create or replace function relatorio_status_mensagens(p_execucoes uuid[], p_limite int, p_deslocamento int)
returns table (
  execucao_id uuid, tipo text, campanha text, grupo text, conta text, status text, enviado_em timestamptz,
  telefone text, recebeu_em timestamptz, visualizou_em timestamptz, reproduziu_em timestamptz
)
language sql stable security invoker set search_path = public as $$
  select t.execucao_id, e.tipo, c.nome, coalesce('#' || g.numero || ' ' || g.nome, ''), coalesce(cx.nome, ''), t.status,
         t.enviado_em, coalesce(r.telefone, ''), r.recebeu_em, r.visualizou_em, r.reproduziu_em
  from tarefas t
  join execucoes e on e.id = t.execucao_id
  join campanhas c on c.id = e.campanha_id
  left join grupos g on g.id = t.grupo_id
  left join conexoes cx on cx.id = t.conexao_id
  left join lateral (
    select rc.telefone,
           min(rc.em) filter (where rc.tipo = 'recebeu') as recebeu_em,
           min(rc.em) filter (where rc.tipo = 'visualizou') as visualizou_em,
           min(rc.em) filter (where rc.tipo = 'reproduziu') as reproduziu_em
    from recibos rc
    where rc.tarefa_id = t.id
    group by rc.telefone
  ) r on true
  where t.execucao_id = any (p_execucoes)
  order by e.agendada_para, t.execucao_id, g.numero nulls last, t.id, r.telefone nulls first
  limit least(greatest(coalesce(p_limite, 1000), 1), 1000)
  offset greatest(coalesce(p_deslocamento, 0), 0)
$$;
revoke execute on function relatorio_status_mensagens(uuid[], int, int) from public, anon;
grant execute on function relatorio_status_mensagens(uuid[], int, int) to authenticated, service_role;
