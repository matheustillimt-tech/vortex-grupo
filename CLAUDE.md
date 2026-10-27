# CLAUDE.md — Vórtex Grupo

Guia pro Claude Code mexer neste template. Quem usa normalmente é dono de negócio, não programador: explique o
que vai fazer em português simples antes de mudar algo e confirme antes de publicar.

## O que é

Painel pra gerenciar grupos de WhatsApp por campanha: link único (`/l/{slug}`) que distribui os leads entre
vários grupos (enche um e abre o próximo), criação automática de grupos, mensagens e ações agendadas pra todos os
grupos, automações, conexões de WhatsApp pelo Zapbot, métricas, anti-spam e blacklists, deep links (`/d/{slug}`),
webhooks de saída e de checkout, API (`/api/v1`) e servidor MCP (`/api/mcp`).

Stack: Next.js 15 (App Router) + React 19 + TypeScript + Tailwind 4, Supabase (Postgres, Auth e o bucket público
`midias`), Zapbot (API de WhatsApp), Vercel (hospedagem + cron a cada minuto), Vitest.

## Onde está cada coisa

- `app/(painel)/` — telas do painel. `_componentes/` tem as peças compartilhadas (menu, cartões, editor de
  mensagens, gráficos). Rotas das integrações: `hooks/` (webhooks de saída), `webhooks/` (webhooks de checkout),
  `api-externa/` (chaves e docs da API), `mcp/`, `deeplinks/`.
- `app/api/cron/tick/route.ts` — o agendador: a cada minuto roda os jobs de `src/lib/jobs/` (sequências,
  execuções, tarefas de envio, criação de grupos, conferência de grupos, vendas, eventos de webhook…).
  Protegido por `Authorization: Bearer CRON_SECRET`.
- `app/api/webhooks/zapbot/[conexaoId]/[segredo]/` — avisos do Zapbot (entrou, saiu, status de mensagem).
- `app/api/webhooks/checkout/[provedor]/[segredo]/` — vendas da Hotmart, Kiwify, Pagar.me ou checkout próprio
  (`provedor = vortex`, JSON simples: `evento_id`, `status: "aprovado"`, `telefone`, `produto`).
- `app/api/v1/` e `app/api/mcp/` — API externa e MCP, autenticadas por chave (`vg_…`, tabela de chaves com hash).
- `app/l/`, `app/d/` — páginas públicas (link da campanha e deep link). `app/dev/vitrine/` — vitrine de
  componentes, só abre no `npm run dev`.
- `src/lib/regras/` — regras de negócio puras (sem banco), todas com teste em `tests/`.
- `src/lib/zapbot/` — cliente da API do Zapbot. As rotas de grupo usadas estão descritas nos comentários de `client.ts`.
- `src/lib/supabase/` — clientes do banco (`admin.ts` usa a service role; só no servidor).
- `supabase/migrations/` — o banco inteiro, em ordem de data. `middleware.ts` — exige login fora das rotas públicas.

## Como rodar

```bash
npm install
cp .env.example .env.local   # preencha (ver INSTALACAO.md, tabela de variáveis)
npm run dev                  # http://localhost:3000
npm test                     # Vitest (não precisa de banco: usa PGlite e dublês)
npm run typecheck
npm run build                # compila sem variáveis; pra rodar de verdade precisa delas
```

Pra instalar do zero (Supabase, Vercel, agendador, primeiro administrador), siga o `INSTALACAO.md`.

## Como personalizar

- **Nome no logo e na aba do navegador**: variável `NEXT_PUBLIC_NOME_SISTEMA` (código em `src/lib/marca.ts`).
- **Cores**: variáveis `--color-vg-*` no começo de `app/globals.css` (todas as telas usam as classes `vg-*`).
- **Símbolo (logo)**: `app/(painel)/_componentes/logo.tsx` e o ícone da aba em `app/icon.svg`.
- **Textos das telas**: ficam nos próprios componentes de `app/(painel)/` e nas regras de `src/lib/regras/`
  (rótulos, mensagens de erro). Vários textos citam "Vórtex Grupo": pra trocar a marca em tudo, procure essa
  expressão e troque, rodando `npm test` depois (alguns testes conferem textos).
- **Menu e abas**: `src/lib/regras/topo.ts`. **Permissões por área**: `src/lib/regras/permissoes.ts`.

## Regras

- Nunca versione `.env`, `.env.local` nem qualquer chave. Segredo só no `.env.local` e nas variáveis da Vercel.
- Nunca peça pra pessoa colar chave ou senha no chat: abra o `.env.local` pra ela ou use `vercel env add`.
- Migração nova **sempre no fim da fila**: arquivo novo em `supabase/migrations/` com data/hora maior que a
  última. Nunca edite uma migração que já foi aplicada no banco de alguém. Aplique com `supabase db push`.
- Tabela nova: as migrações não contam com "expor tabelas automaticamente". Dê os `grant` explícitos e ligue o
  RLS, seguindo o padrão das migrações existentes (`tests/migracao.test.ts` confere isso).
- Regra de negócio nova vai em `src/lib/regras/` como função pura, com teste em `tests/`.
- `SUPABASE_SERVICE_ROLE_KEY` e `src/lib/supabase/admin.ts` só em código de servidor (`"server-only"`).
- Se o repositório estiver ligado à Vercel, **push na `main` publica** o sistema na hora. Trabalhe em outra
  branch e só junte na `main` quando a pessoa aprovar.
- Ações em grupos de WhatsApp são reais (mensagens chegam pra muita gente): ao testar, use uma campanha e
  grupos de teste.
- Nos testes, os telefones fictícios aparecem partidos (`"5511" + "900000001"`): é de propósito, pra varredura
  de vazamento não confundir dado de teste com número real. O valor é o mesmo.
