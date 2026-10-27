-- Etapa 3N, Task 7: "Posição" em Projetos e coluna pra uma futura foto real da conta. Só aditiva.
--
-- Projetos: ordenação "Posição" (nulls last, depois `created_at` — comportamento de hoje). Nula em todos os
-- projetos de hoje, então a ordem muda só quando alguém usar "Mover para cima"/"Mover para baixo".
alter table projetos add column posicao int;

-- Conta: foto real do número conectado (como já existe em `grupos.foto_url`), só `https://`. Conferido na doc do
-- Zapbot (`https://api.zapbot.online/docs`) em 17/10/2026: existe `PUT profile-picture` (troca a foto), mas não há
-- rota de leitura do avatar atual da instância/conexão — só a de grupo (`GET groups/{id}/avatar`) existe pra
-- leitura. Decisão: "Zapbot sem foto do perfil" — a coluna nasce nula e a tela
-- continua com a letra até existir uma rota de leitura. Ela já entra granted pra `authenticated`, no mesmo padrão
-- das outras colunas de `conexoes`, pra não precisar de outra migração quando a rota existir.
alter table conexoes add column foto_url text check (foto_url is null or foto_url ~ '^https://');
grant select (foto_url) on conexoes to authenticated;
