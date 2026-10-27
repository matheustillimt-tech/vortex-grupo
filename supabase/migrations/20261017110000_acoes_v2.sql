-- Etapa 3C (Tarefa 1): conteúdo v2 de mensagens (várias mensagens, formatos novos e opções de envio) e tipos
-- novos do assistente "Adicionar ação": configuração, remover participantes, desativar
-- comunidade, atualizar links dos grupos e mover grupos para outra campanha. `automacao_acoes` fica de fora por
-- enquanto — o motor de automações (Etapa 3F) decide quais desses tipos ele vai suportar, e só então ganha o
-- mesmo alargamento.

alter table execucoes drop constraint execucoes_tipo_check;
alter table execucoes add constraint execucoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos'
));

alter table tarefas drop constraint tarefas_tipo_check;
alter table tarefas add constraint tarefas_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'configuracao', 'remover_participantes', 'desativar_comunidade', 'atualizar_links', 'mover_grupos'
));

-- progresso: índice da próxima mensagem a enviar (conteúdo v2 pode ter várias). Uma tarefa que falha e tenta de
-- novo continua dali, em vez de mandar de novo as mensagens que já saíram.
alter table tarefas add column progresso int not null default 0;

-- alvo_contas: só essas contas da campanha disparam a execução; null (padrão, igual hoje) continua sendo "todas".
alter table execucoes add column alvo_contas uuid[];
