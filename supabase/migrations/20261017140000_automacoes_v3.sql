-- Etapa 3F (Tarefa 1): motor de automações v3 — ações novas, Tag Condicional, contas e gatilhos por plataforma.
-- Só aditiva: os checks ficam mais largos (todo valor antigo continua valendo) e as colunas novas nascem null
-- (null = o comportamento de hoje).

-- 1. Ações novas da automação: os tipos de execução da Etapa 3C que o motor passa a criar (configuração, atualizar
--    links, desativar comunidade, mover grupos) e a Tag Condicional (não vira execução: decide se as ações seguintes
--    são criadas pra pessoa do gatilho). Mesmo nome de constraint da parte 2.
alter table automacao_acoes drop constraint automacao_acoes_tipo_check;
alter table automacao_acoes add constraint automacao_acoes_tipo_check check (tipo in (
  'mensagem', 'enquete', 'nome', 'descricao', 'abrir', 'fechar', 'admin_add', 'admin_remover', 'redefinir_link',
  'remover_participante',
  'configuracao', 'atualizar_links', 'desativar_comunidade', 'mover_grupos', 'tag_condicional'
));

-- 2. Contas: só essas contas da campanha fazem as execuções criadas pela automação (vai pra execucoes.alvo_contas).
--    null = todas (igual hoje). `alvo_grupos` já existe desde a 2E.
alter table automacoes add column alvo_contas uuid[]
  check (alvo_contas is null or cardinality(alvo_contas) > 0);

-- 3. Gatilho de checkout por plataforma. A plataforma já mora em `provedor` (2F, obrigatória até aqui); agora
--    `provedor` null num checkout = qualquer plataforma ("Checkout - Compra aprovada"). As automações de checkout
--    que existem têm provedor, então continuam disparando só pela plataforma delas (como hoje).
--
-- Evento da venda. null = compra aprovada (as que já existem). 'recusada' fica reservado: hoje a venda só guarda
-- `aprovada` (true/false) e uma não aprovada pode ser recusa, estorno, boleto gerado etc., então o motor ainda não
-- dispara por recusa (as regras só aceitam 'aprovada').
alter table automacoes add column checkout_evento text check (checkout_evento in ('aprovada', 'recusada'));

-- Check novo nas duas direções: checkout ⇔ produto; fora do checkout, nem plataforma nem evento. O check antigo
-- deixava (fora do checkout) provedor sem produto ou produto sem provedor; o app nunca gravou isso (validarAutomacao
-- zera os dois fora do checkout), mas, por segurança, zera antes os que sobrarem — fora do checkout esses campos
-- não são lidos por nada (o motor só olha provedor/produto no gatilho de checkout), então não muda comportamento.
update automacoes set provedor = null, produto = null
 where gatilho <> 'checkout' and (provedor is not null or produto is not null);
alter table automacoes drop constraint automacoes_checkout_campos;
alter table automacoes add constraint automacoes_checkout_campos check (
  (gatilho = 'checkout') = (produto is not null)
  and (gatilho = 'checkout' or (provedor is null and checkout_evento is null))
);
