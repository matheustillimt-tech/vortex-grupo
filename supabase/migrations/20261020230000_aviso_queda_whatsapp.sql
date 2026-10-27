-- Seção "Aviso de chip caído" da campanha (20/10/2026, pedido do dono): quando um chip da campanha cai (desconectou
-- ou foi banido), outro chip conectado manda mensagem no privado de cada telefone desta lista. Vazio = sem aviso.
-- `aviso_queda_enviado_em` evita mandar de novo na mesma queda. Sem grant novo nas colunas de `campanhas`.
alter table campanhas
  add column telefones_aviso_queda text[] not null default '{}',
  add constraint telefones_aviso_queda_check check (cardinality(telefones_aviso_queda) <= 10);
alter table conexoes add column aviso_queda_enviado_em timestamptz;
