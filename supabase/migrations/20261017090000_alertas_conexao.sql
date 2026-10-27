-- Etapa 3A (revisão): `alertas` não tinha coluna de conta. O "Conta" de `/alertas` casava o nome da conta dentro
-- do texto (só funcionava pra `numero_caiu`, o único tipo que cita o nome); com a coluna, o filtro e o
-- agrupamento por conta passam a usar o relacionamento de verdade pros alertas novos — o texto continua sendo o
-- fallback pras linhas antigas, que nasceram sem `conexao_id`.

alter table alertas add column conexao_id uuid references conexoes (id) on delete set null;
create index alertas_conexao on alertas (conexao_id, created_at desc);
