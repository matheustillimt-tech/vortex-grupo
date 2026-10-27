-- Tarja de número caído (20/10/2026, pedido do dono): quando um número sai do ar, o monitor pergunta ao WhatsApp,
-- por outro número conectado, se ele ainda existe. Continua existindo = só desconectou (parear de novo); sumiu =
-- provável banimento. A tarja no topo do painel lê `caiu_em` e o diagnóstico (só leitura pro navegador).
alter table conexoes
  add column diagnostico_queda text check (diagnostico_queda in ('desconectado', 'banido', 'indefinido')),
  add column diagnostico_em timestamptz;
grant select (caiu_em, diagnostico_queda, diagnostico_em) on conexoes to authenticated;
