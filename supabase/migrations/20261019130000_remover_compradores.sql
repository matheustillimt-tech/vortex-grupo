-- "Remover compradores" removido por decisão do dono (19/10/2026): tirar o comprador dos grupos é feito por webhook
-- fora do Vórtex Grupo. Sai a configuração da seção (`regras_compra` e `campanhas.compradores_ativo`).
-- Ordem de deploy: o código sem a seção vai primeiro (não lê nem grava nada daqui) e esta migração depois.
--
-- Fica como está (nada aqui mexe):
--   * `vendas` (webhooks de checkout), a tag Comprador, as automações de checkout e os Hooks de compra;
--   * o histórico de remoções já feitas por venda: linhas de `acoes` com `tipo = 'remover'` e `origem` 'venda …'
--     (texto livre, sem check nem chave pra `regras_compra`), e os checks de `acoes`/`execucoes`, que outras
--     partes usam (automações, bloqueio, duplicados).
-- Nenhuma função, view ou check do banco usa `regras_compra` nem `compradores_ativo`. Tudo com `if exists`: pode rodar
-- de novo sem erro.

-- 1. Regras de compra. A política (equipe_tudo), a chave primária e a FK pra campanhas saem junto com a tabela.
do $$
begin
  if to_regclass('public.regras_compra') is not null then
    execute 'drop policy if exists equipe_tudo on regras_compra';
  end if;
end $$;
drop table if exists regras_compra;

-- 2. Interruptor da seção na campanha.
alter table campanhas drop column if exists compradores_ativo;
