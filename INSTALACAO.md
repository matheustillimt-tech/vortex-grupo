# Instalação do Vórtex Grupo (passo a passo manual)

Este guia é pra quem quer instalar sem o Claude Code. Se preferir que o Claude faça com você, use o prompt do
[PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

Tempo estimado: 1 a 2 horas na primeira vez.

---

## 1. Contas que você vai criar

1. **GitHub** (github.com): guarda a sua cópia do código. Grátis.
2. **Supabase** (supabase.com): banco de dados, login e arquivos. O plano grátis serve pra começar.
3. **Vercel** (vercel.com): deixa o painel no ar. Entre com a conta do GitHub.
   - O sistema precisa de um **agendador que roda a cada 1 minuto**. Na Vercel isso só existe no plano **Pro**
     (US$ 20/mês, que também é o plano certo pra uso comercial). No plano grátis (Hobby), a Vercel só aceita
     agendador uma vez por dia: aí você usa o agendador do próprio Supabase (passo 7.2).
4. **Zapbot** (zapbot.online): o serviço que liga os seus números ao WhatsApp. É pago à parte; confira os planos
   no site deles.
5. **Um número de WhatsApp só pra isso** (chip dedicado): é ele que cria e administra os grupos.

## 2. Programas no seu computador

- **Node.js 20 ou mais novo** (nodejs.org) — roda o sistema.
- **Git** (git-scm.com) — baixa o código.
- **CLI do Supabase** — comandos do banco. Mac: `brew install supabase/tap/supabase`. Windows: pelo Scoop
  (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` e `scoop install supabase`).
- **CLI da Vercel** — `npm i -g vercel`.

> "CLI" é um programa que você usa digitando comandos no terminal.

## 3. Baixar o código

```bash
git clone https://github.com/matheustillimt-tech/vortex-grupo.git
cd vortex-grupo
npm install
cp .env.example .env.local
```

O arquivo `.env.local` guarda as suas chaves. Ele **nunca** vai pro GitHub (o `.gitignore` já bloqueia).

Recomendado: crie um repositório **privado** seu no GitHub e envie o código pra lá
(`git remote set-url origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git` e `git push -u origin main`).
É desse repositório que a Vercel vai publicar.

## 4. Criar o projeto no Supabase e aplicar o banco

1. No Supabase, clique em **New project**. Escolha um nome, uma senha forte pro banco (guarde) e a região
   **South America (São Paulo)**.
2. Em **Project Settings > API**, copie pro `.env.local`:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** → `SUPABASE_SERVICE_ROLE_KEY` (secreta!)
3. **Desligue o cadastro aberto**: em **Authentication > Sign In / Providers > Email**, desligue
   **Allow new users to sign up**. Gente nova entra só pelo painel (tela Equipe), criada por um administrador.
4. No terminal, dentro da pasta do projeto:

```bash
supabase login
supabase link --project-ref SEU-PROJETO   # o pedaço da Project URL antes de .supabase.co; pede a senha do banco
supabase db push                          # cria as tabelas, as regras de acesso e a pasta de arquivos "midias"
```

O `db push` aplica as migrações da pasta `supabase/migrations` em ordem. Não precisa de funções (Edge Functions)
nem de `supabase secrets set`: este sistema não usa.

## 5. Todas as variáveis de ambiente

| Nome | Pra que serve | Onde pegar | Obrigatória? |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | endereço do seu banco | Supabase > Project Settings > API > Project URL | sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública do banco (login e telas) | Supabase > Project Settings > API > anon public | sim |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secreta do servidor (agendador, webhooks, API) | Supabase > Project Settings > API > service_role | sim |
| `ZAPBOT_API_URL` | endereço da API do Zapbot | deixe `https://api.zapbot.online` | não (esse é o padrão) |
| `ZAPBOT_EMAIL` | e-mail da sua conta no Zapbot | o que você usou no cadastro do Zapbot | sim |
| `ZAPBOT_PASSWORD` | senha da sua conta no Zapbot | a sua senha do Zapbot | sim |
| `ZAPBOT_JWT` | token de login do Zapbot já pronto | deixe vazio (o sistema faz login sozinho) | não |
| `CRYPTO_KEY` | embaralha no banco os tokens das conexões de WhatsApp | gere: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` | sim |
| `CRON_SECRET` | senha que o agendador manda pra rodar o sistema | gere: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` | sim |
| `NEXT_PUBLIC_SITE_URL` | endereço público do painel, sem `/` no fim (vai nos links de grupo, deep links e webhooks do Zapbot) | o endereço da Vercel ou o seu domínio (passo 6) | sim |
| `NEXT_PUBLIC_NOME_SISTEMA` | nome no logo e na aba do navegador | escolha (ex.: "Grupos da Minha Empresa") | não (padrão: "Vórtex Grupo") |

> Guarde a `CRYPTO_KEY`: se ela mudar, as conexões de WhatsApp já cadastradas param de funcionar e precisam ser
> refeitas.

Pra testar no seu computador antes de publicar: `npm run dev` e abra http://localhost:3000 (o WhatsApp só
consegue avisar o sistema quando ele estiver no ar num endereço público, então o teste completo é depois do
passo 6).

## 6. Publicar na Vercel

1. Na Vercel, clique em **Add New > Project** e importe o seu repositório do GitHub.
2. Em **Environment Variables**, cadastre todas as variáveis da tabela acima (pode deixar
   `NEXT_PUBLIC_SITE_URL` com um valor provisório).
3. **Plano grátis (Hobby)?** Antes de publicar, apague o bloco `"crons"` do arquivo `vercel.json` (deixe só
   `{ "regions": ["gru1"] }`), faça commit e push. Senão a Vercel recusa a publicação, porque o agendador de
   1 em 1 minuto é do plano Pro. Você liga o agendador pelo Supabase no passo 7.2.
4. Clique em **Deploy**. No fim, copie o endereço (ex.: `https://seu-projeto.vercel.app`) ou ligue o seu
   domínio em **Settings > Domains**.
5. Atualize `NEXT_PUBLIC_SITE_URL` na Vercel com esse endereço e publique de novo (**Deployments > Redeploy**).
6. No Supabase, em **Authentication > URL Configuration**, coloque o mesmo endereço em **Site URL**.

Pela linha de comando dá pra fazer o mesmo: `vercel link`, `vercel env add NOME production` (pede o valor no
terminal) e `vercel --prod`.

## 7. O agendador (a cada 1 minuto)

O endereço `/api/cron/tick` faz o trabalho de fundo: manda as mensagens agendadas, cria grupos, confere
entradas e saídas, processa vendas e envia os webhooks. Ele precisa ser chamado a cada minuto com o cabeçalho
`Authorization: Bearer <CRON_SECRET>`.

### 7.1 Vercel Pro

Nada a fazer: o `vercel.json` já traz o agendador (`"schedule": "* * * * *"`) e a Vercel manda o `CRON_SECRET`
sozinha. Confira em **Settings > Cron Jobs**.

### 7.2 Plano grátis: agendador pelo Supabase

1. No Supabase, em **Database > Extensions**, ligue **pg_cron** e **pg_net**.
2. Abra o **SQL Editor** e rode o bloco abaixo, trocando os dois valores **ali mesmo** (o endereço do seu painel
   e o mesmo valor do `CRON_SECRET`). Eles ficam guardados no **Vault** do Supabase (cofre de segredos do banco),
   não no código:

```sql
-- 1) Guarda o endereço e a senha do agendador no cofre (Vault).
select vault.create_secret('https://seu-dominio.com.br/api/cron/tick', 'vortex_grupo_tick_url');
select vault.create_secret('COLE-AQUI-O-CRON_SECRET', 'vortex_grupo_cron_secret');

-- 2) Chama o sistema a cada minuto, lendo os dois valores do cofre.
select cron.schedule(
  'vortex-grupo-tick',
  '* * * * *',
  $$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_grupo_tick_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vortex_grupo_cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
```

Pra conferir: `select * from cron.job_run_details order by start_time desc limit 5;`
Pra desligar: `select cron.unschedule('vortex-grupo-tick');`

Outra opção grátis é um serviço de cron externo (ex.: cron-job.org) chamando o mesmo endereço a cada minuto,
com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.

## 8. Criar o primeiro administrador

1. No Supabase, em **Authentication > Users > Add user > Create new user**, coloque o seu e-mail e uma senha e
   marque **Auto Confirm User**.
2. No **SQL Editor**, rode (com o seu e-mail):

```sql
update membros set papel = 'admin'
 where usuario_id = (select id from auth.users where email = 'voce@exemplo.com');
```

3. Abra o endereço do painel e entre com esse e-mail e senha. As próximas pessoas você cadastra na tela
   **Equipe** (o sistema gera a senha e você escolhe as permissões).

> Quem já existia em Authentication > Users antes do `supabase db push` vira administrador sozinho.

## 9. Ligar as integrações

### WhatsApp (obrigatório)

1. No painel, vá em **Conexões** e crie uma conexão nova (o sistema cria a instância no Zapbot com as
   credenciais do `.env`).
2. Leia o QR Code com o WhatsApp do número dedicado (WhatsApp > Aparelhos conectados) ou use o código de
   pareamento.
3. Quando aparecer "conectado", o número está pronto. Cada conexão recebe um endereço de aviso próprio
   (`/api/webhooks/zapbot/...`), registrado no Zapbot automaticamente com base no `NEXT_PUBLIC_SITE_URL`.

### Vendas (opcional)

Em **Integrações > Webhooks de checkout**, cada plataforma tem um link secreto. Cole esse link no evento de
**compra aprovada** da Hotmart, Kiwify ou Pagar.me. Pra um checkout próprio, faça o seu sistema mandar um `POST`
com o JSON `{"evento_id": "...", "status": "aprovado", "telefone": "...", "produto": "..."}`.

### Avisos pra outros sistemas (opcional)

Em **Integrações > Webhooks de saída**, cadastre o endereço do seu CRM ou automação e escolha os eventos. Cada
envio leva o cabeçalho `X-Vortex-Grupo-Assinatura` (HMAC do corpo) e, se você quiser, `X-Vortex-Grupo-Token`.

### API e assistentes de IA (opcional)

- **Integrações > API**: crie uma chave (`vg_...`) pra outros sistemas usarem os endpoints `/api/v1/...`.
  A documentação dos endpoints está na própria tela.
- **Integrações > MCP**: crie uma chave e siga o guia da tela pra conectar o Claude ou o ChatGPT no endereço
  `/api/mcp`.

## 10. Checklist de teste

- [ ] Entrei no painel com o administrador.
- [ ] A conexão de WhatsApp aparece como **conectada**.
- [ ] Criei uma campanha, associei a conexão e cliquei em **Criar grupo agora**: o grupo apareceu em até 1 minuto
      (isso prova que o agendador está rodando).
- [ ] Abri o link `seu-dominio.com.br/l/nome-da-campanha` no celular e caí no grupo.
- [ ] Mandei uma mensagem de teste em **Ações**: ela aparece como enviada e chegou no grupo.
- [ ] Em **Métricas** da campanha, o clique e a entrada aparecem.

## 11. Problemas comuns

| O que acontece | O que fazer |
|---|---|
| A Vercel recusa a publicação falando de cron/"daily" | Você está no plano grátis: apague o bloco `"crons"` do `vercel.json` e use o passo 7.2. |
| Nada é enviado nem criado, as ações ficam "agendadas" | O agendador não está rodando. Confira o passo 7 e se o `CRON_SECRET` é o mesmo na Vercel e no agendador (resposta 401 = senha diferente). |
| Erro "Variável de ambiente ausente" | Falta alguma variável na Vercel (tabela do passo 5). Depois de cadastrar, publique de novo. |
| "CRYPTO_KEY precisa ter 32 bytes em base64" | Gere a chave de novo com o comando da tabela do passo 5. |
| O QR Code não aparece ou a conexão não fica "conectada" | Confira `ZAPBOT_EMAIL`/`ZAPBOT_PASSWORD` e se a sua conta do Zapbot está ativa. |
| A conexão conecta, mas entradas e saídas não aparecem | O `NEXT_PUBLIC_SITE_URL` estava errado quando a conexão foi criada (o Zapbot avisa um endereço que não existe). Corrija a variável, publique de novo e recrie a conexão. |
| Consigo entrar, mas não aparece a tela Equipe (ou faltam telas no menu) | O seu usuário está como "membro". Rode o SQL do passo 8. |
| Alguém se cadastrou sozinho | Desligue **Allow new users to sign up** (passo 4.3) e apague o usuário em Authentication > Users. |
| A Vercel reclama do tempo máximo da função do agendador | Em `app/api/cron/tick/route.ts`, baixe `maxDuration` de 120 para 60. |
