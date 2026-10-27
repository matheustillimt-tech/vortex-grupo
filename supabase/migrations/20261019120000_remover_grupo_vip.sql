-- Grupo VIP Hotmart removido por decisão do dono (19/10/2026). Desfaz `20261017240000_grupo_vip.sql`; "Remover
-- compradores" (`campanhas.compradores_ativo` + `regras_compra`) continua igual.
-- Ordem de deploy: o código sem o VIP vai primeiro (não lê nem grava nada daqui) e esta migração depois.
-- Tudo com `if exists`: pode rodar de novo sem erro.

-- 1. Fila e função do job (a função devolve `setof vip_entradas`: sai antes da tabela).
drop function if exists pegar_vip(int);
drop table if exists vip_entradas;

-- 2. Configuração do Grupo VIP na campanha.
alter table campanhas drop column if exists vip_ativo;
alter table campanhas drop column if exists vip_campanha_id;
alter table campanhas drop column if exists vip_grupo_id;
alter table campanhas drop column if exists vip_mensagem;

-- 3. Regras de compra voltam a ser só de "Remover compradores" (todas eram `modo = 'remover'`).
drop index if exists regras_compra_provedor_modo;
alter table regras_compra drop column if exists modo;

-- 4. Alertas: volta aos 9 tipos de antes (definição de 20261017190100_links_entregas.sql).
delete from alertas where tipo in ('vip_convite', 'vip_erro');
alter table alertas drop constraint if exists alertas_tipo_check;
alter table alertas add constraint alertas_tipo_check
  check (tipo in ('grupo_cheio', 'numero_caiu', 'execucao_bloqueada', 'tarefa_erro', 'grupo_sumiu', 'criacao_erro', 'bloqueado_removido', 'antispam_sem_conta', 'entrega_nao_confirmada'));
