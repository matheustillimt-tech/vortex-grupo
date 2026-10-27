-- Etapa 3M, Tarefa 2: "Trocar imagem" (assistente de ação), "Atualizar foto do grupo" (automações) e "Imagem do
-- grupo" (Criação de grupos, Alterar grupos em lote e Padrão de criação). Só aditiva: os checks de tipo ganham
-- 'imagem' e mantêm todos os valores de antes; a coluna nova é nula (= hoje).
--
-- Nenhuma RPC filtra por esses tipos (`pegar_tarefas`, `iniciar_execucao`, `listar_acoes` e `listar_execucoes` só
-- olham 'mensagem'/'enquete' e 'atualizar_links'): nada a mudar nelas.

-- 1. Tipo de execução `imagem` (`PUT group-picture`, grupo a grupo como as outras ações de grupo). Os 15 valores de
--    20261017200100_acoes_novas_exportacoes.sql continuam valendo (execucoes e tarefas têm o mesmo check).
alter table execucoes drop constraint execucoes_tipo_check;
alter table execucoes add constraint execucoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos',
  'privacidade_avancada',
  'imagem'
));

alter table tarefas drop constraint tarefas_tipo_check;
alter table tarefas add constraint tarefas_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos',
  'privacidade_avancada',
  'imagem'
));

-- 2. "Atualizar foto do grupo" nas automações. Os 19 valores de 20261017190200_automacoes_pessoa.sql continuam.
alter table automacao_acoes drop constraint automacao_acoes_tipo_check;
alter table automacao_acoes add constraint automacao_acoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'remover_participante',
  'configuracao', 'atualizar_links', 'desativar_comunidade', 'mover_grupos', 'tag_condicional',
  'adicionar_tag', 'remover_tag', 'adicionar_blacklist', 'remover_blacklist',
  'imagem'
));

-- 3. Imagem que a campanha põe em cada grupo novo (passo `foto` depois de criar; falha vira alerta). Nula = o grupo
--    nasce sem foto (comportamento de hoje). Só `https://`, até 2048 caracteres (o app também recusa host privado).
alter table campanhas add column imagem_grupo_url text
  check (imagem_grupo_url is null or (imagem_grupo_url ~ '^https://' and length(imagem_grupo_url) <= 2048));
comment on column campanhas.imagem_grupo_url is 'Imagem do grupo (Etapa 3M): nula = grupo nasce sem foto (hoje).';
