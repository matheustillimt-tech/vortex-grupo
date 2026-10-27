-- Número excluído que só era dono de grupos já excluídos (ativo = false e não suspenso) pode ser apagado:
-- esses grupos ficam no histórico sem dono (conexao_id nulo) em vez de travar a exclusão da conexão.
alter table grupos alter column conexao_id drop not null;
alter table grupos drop constraint grupos_conexao_id_fkey;
alter table grupos add constraint grupos_conexao_id_fkey foreign key (conexao_id) references conexoes (id) on delete set null;
