-- Etapa 3J (Tarefa 1): uma coluna por seção da Visão geral da campanha (Tarefas 1, 2 e 3 de uma vez, pra a tela já
-- ler `select("*")` completo). Os padrões mantêm o comportamento de hoje sem ninguém mexer em nada:
--   * o que já existe nasce LIGADO: `cookie_redirecionamento` (cookie `vg_{slug}` do link), `compradores_ativo`
--     ("Remover compradores" / regras_compra) e `checar_duplicados` (remoção de duplicado da conferência);
--   * o que é novo nasce DESLIGADO (false) ou vazio (null / '{}').
-- Sem grant novo: `campanhas` não tem grant por coluna (vale o grant da tabela inteira e as políticas de sempre), então
-- as colunas novas herdam o acesso de `campanhas` (authenticated e service_role; anon continua sem nada).

alter table campanhas
  -- Gerenciamento de Tags (Tarefa 2)
  add column tags_ativo boolean not null default false,
  add column tag_entrou_adicionar uuid references tags (id) on delete set null,
  add column tag_entrou_remover uuid references tags (id) on delete set null,
  add column tag_saiu_adicionar uuid references tags (id) on delete set null,
  add column tag_saiu_remover uuid references tags (id) on delete set null,
  -- Cookie de redirecionamento (já existe: ligado)
  add column cookie_redirecionamento boolean not null default true,
  -- Verificação de Colaboradores (Tarefa 2)
  add column verificacao_colaboradores boolean not null default false,
  -- Confirmação de entrega (Tarefa 3)
  add column confirmar_entrega boolean not null default false,
  add column confirmar_entrega_desde timestamptz,
  -- Grupo VIP Hotmart (já existe como "Remover compradores": ligado)
  add column compradores_ativo boolean not null default true,
  -- Atualização de links (Tarefa 3)
  add column atualizar_links_banimento boolean not null default false,
  -- Atualização periódica de links (Tarefa 3)
  add column links_periodicos boolean not null default false,
  add column links_por_dia smallint not null default 1 check (links_por_dia between 1 and 24),
  add column links_atualizados_em timestamptz,
  -- Redefinir link de convite (Tarefa 3)
  add column redefinir_link_cheio boolean not null default false,
  -- Remover Lead de Campanhas Anteriores (Tarefa 2)
  add column remover_anteriores_ativo boolean not null default false,
  add column campanhas_anteriores uuid[] not null default '{}',
  add constraint campanhas_anteriores_check check (cardinality(campanhas_anteriores) <= 50 and not (id = any(campanhas_anteriores))),
  -- Deep Linking + Pixel da Meta
  add column deep_linking boolean not null default false,
  add column pixel_meta_ativo boolean not null default false,
  add column pixel_meta_id text check (pixel_meta_id is null or pixel_meta_id ~ '^[0-9]{10,20}$'),
  -- Checar participantes duplicados (já existe: ligado)
  add column checar_duplicados boolean not null default true;
