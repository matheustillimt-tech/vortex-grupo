-- Etapa 3G, Tarefa 3: pasta (projeto) da conta, pra "Definir projeto" no detalhe e "Por projeto" na ordenação
-- da lista de contas. Aditiva: só a coluna, sem tocar em nada que já existe.
alter table conexoes add column projeto_id uuid references projetos (id) on delete set null;
create index conexoes_projeto on conexoes (projeto_id);

-- `conexoes` só concede select por coluna pra authenticated (Fase 1): a coluna nova não entra sozinha, precisa
-- do grant explícito. Escrita continua só pelo service role (`dbAdmin`), como as demais colunas da tabela.
grant select (projeto_id) on conexoes to authenticated;
