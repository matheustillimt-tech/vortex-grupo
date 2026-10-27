-- Seção "Dividir envios entre chips" da campanha (20/10/2026, pedido do dono): liga/desliga a divisão de mensagens e
-- enquetes entre os chips (`distribuirEntreChips`) e escolhe quais chips entram. Nasce LIGADA e sem chips escolhidos
-- (= todos os conectados e admin do grupo), que é como já funciona desde f30dad7. Sem grant novo: as colunas herdam o
-- acesso de `campanhas`, como as outras seções.
alter table campanhas
  add column dividir_chips boolean not null default true,
  add column chips_divisao uuid[] not null default '{}',
  add constraint chips_divisao_check check (cardinality(chips_divisao) <= 50);
