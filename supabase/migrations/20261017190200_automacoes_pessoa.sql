-- Etapa 3J, Tarefa 4: ações de pessoa nas automações (tags e blacklist). Só aditiva: o check de tipo fica mais largo
-- (os 15 valores de 20261017140000_automacoes_v3.sql continuam valendo) e nada que já existe muda.
--
-- As 4 ações novas são aplicadas na hora pelo motor (`aplicarAcoesDePessoa` em src/lib/automacoes.ts): não viram
-- execução nem remoção. O app confere o resto (tag existe e é `manual`, blacklist existe, atraso 0).
-- Mesmo nome de constraint da parte 2 e da v3.
alter table automacao_acoes drop constraint automacao_acoes_tipo_check;
alter table automacao_acoes add constraint automacao_acoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'remover_participante',
  'configuracao', 'atualizar_links', 'desativar_comunidade', 'mover_grupos', 'tag_condicional',
  'adicionar_tag', 'remover_tag', 'adicionar_blacklist', 'remover_blacklist'
));
