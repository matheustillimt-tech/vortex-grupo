-- Token do webhook de saída: coluna própria e opcional, separada do `segredo` do HMAC. Webhook sem `token`
-- não recebe o cabeçalho `X-Vortex-Grupo-Token`; o `segredo` continua só no servidor, assinando.
-- Só aditiva: coluna nova anulável, sem default, nada apagado nem renomeado.
alter table webhooks add column token text check (token is null or token ~ '^[0-9a-f]{48}$');

-- Mesma proteção do `segredo`: `authenticated` lê a tabela só pelas colunas concedidas em
-- 20261016210000_webhooks_historico.sql (a coluna nova não entra nessa lista); o revoke por coluna deixa explícito.
revoke select (token) on webhooks from authenticated;
revoke all on webhooks from anon;
