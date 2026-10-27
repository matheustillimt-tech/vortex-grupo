# Vórtex Grupo

Sistema pra gerenciar grupos de WhatsApp por campanha: um link só que distribui as pessoas entre vários grupos,
cria os grupos sozinho e agenda mensagens e ações pra todos de uma vez.

## O que ele faz

- **Link único por campanha** (`seu-dominio.com.br/l/nome-da-campanha`): quem clica cai no grupo que ainda tem
  vaga. Quando um grupo enche, o próximo abre sozinho. Opcional: Pixel da Meta na página do link e uma página
  onde o lead confere se um número é mesmo da sua equipe (contra golpistas).
- **Criação automática de grupos**: deixa sempre um ou mais grupos de reserva prontos, com nome numerado
  (`AULÃO #01`, `AULÃO #02`…), descrição, imagem, administradores e opção de comunidade.
- **Ações pra todos os grupos**: enviar mensagem (texto, imagem, áudio, vídeo, GIF, figurinha, documento,
  enquete, contato, evento), trocar nome, descrição ou imagem, abrir e fechar o grupo, adicionar ou remover administradores, remover
  participantes, redefinir o link de convite e mais. Na hora ou agendadas, com ações em sequência
  ("depois desta, faça aquela").
- **Calendário** com tudo que está agendado.
- **Automações**: cronograma de mensagens, gatilhos quando alguém entra ou sai e quando uma compra é aprovada
  no checkout, e sequências.
- **Conexões de WhatsApp** pelo Zapbot: liga quantos números quiser (QR Code ou código de pareamento), com aviso
  quando um número cai e reserva que assume a criação de grupos.
- **Métricas**: cliques no link, entradas, saídas, ocupação dos grupos, entregas e leituras das mensagens,
  pontuação de engajamento por pessoa (leadscoring) e funil da campanha. Exportação em planilha (CSV).
- **Leads**: cadastro das pessoas, etiquetas (tags) e histórico de participação nos grupos.
- **Segurança**: anti-spam, listas de bloqueio (blacklists), números administrativos e solicitações de entrada
  (aprovar ou recusar pedidos pra entrar nos grupos).
- **Modelos e variáveis**: mensagens prontas pra reaproveitar e campos que mudam por campanha
  (link da aula, data, cupom).
- **Integrações**:
  - **webhooks de saída**: o sistema avisa outro sistema seu (CRM, planilha, automação) quando algo acontece
    (pessoa entrou, grupo encheu, ação terminou…), com assinatura de segurança;
  - **webhooks de checkout**: recebe as vendas aprovadas da Hotmart, Kiwify, Pagar.me ou de um checkout próprio;
  - **API**: outros sistemas criam campanhas e ações por uma chave de acesso;
  - **MCP**: conecta o Claude, o ChatGPT ou outro assistente de IA pra operar os grupos conversando;
  - **deep link**: links curtos que contam cliques e redirecionam.
- **Equipe**: administradores e membros com permissão por área.

## Como funciona

Você acessa um painel na internet (feito em Next.js e publicado na Vercel). Tudo que você cadastra fica num banco
de dados no Supabase. Os números de WhatsApp ficam ligados ao **Zapbot**, um serviço que conversa com o WhatsApp
por você. A cada minuto, um **agendador** (cron) chama o sistema, que manda as mensagens agendadas, cria grupos
novos quando precisa, confere quem entrou e saiu e envia os avisos pros seus outros sistemas.

## Com o que é feito

- **Next.js 15 + React 19 + TypeScript** (o painel e as rotas da API)
- **Tailwind CSS 4** (o visual)
- **Supabase** (banco de dados Postgres, login e a pasta de arquivos `midias`)
- **Zapbot** (API de WhatsApp)
- **Vercel** (onde o painel fica no ar, com o agendador de 1 em 1 minuto)
- **Vitest** (testes automáticos)

## De quais contas você precisa

| Conta | Pra quê | Tem plano grátis? |
|---|---|---|
| GitHub | guardar a sua cópia do código | sim |
| Supabase | banco de dados, login e arquivos | sim (bom pra começar) |
| Vercel | deixar o painel no ar | sim, mas o plano grátis é pra uso pessoal e o agendador de 1 em 1 minuto só vem no **Pro** (US$ 20/mês). No grátis, use o agendador do Supabase (explicado no INSTALACAO.md) |
| Zapbot | ligar os números de WhatsApp | serviço pago à parte: confira os planos no site do Zapbot |
| Um número de WhatsApp | pra criar e administrar os grupos | use um número só pra isso (chip dedicado) |

Opcional: Hotmart, Kiwify ou Pagar.me (se quiser que vendas aprovadas disparem ações nos grupos).

## Instalar com o Claude Code

Abra o Claude Code na aba **Code**, numa **pasta vazia**, e cole este prompt. Ele confere o seu computador, baixa
o código e instala tudo com você, um passo de cada vez. Ele nunca vai pedir pra você colar senha ou chave no chat.

```text
Você vai me ajudar a instalar o Vórtex Grupo, um sistema que gerencia grupos de WhatsApp por campanha
(código aberto em https://github.com/matheustillimt-tech/vortex-grupo). Eu não sou programador: explique
cada passo em português simples, um de cada vez, e espere eu dizer "pronto" antes de seguir.

REGRAS QUE VOCÊ NUNCA QUEBRA
- Nunca me peça pra colar chave, senha ou token aqui no chat. Quando precisar de um segredo:
  (a) abra o arquivo .env.local pra mim (com o comando `open -e .env.local` no Mac ou `notepad .env.local` no
      Windows) e me diga em qual linha colar, ou
  (b) rode no MEU terminal `vercel env add NOME` ou `supabase secrets set ...`, que pedem o valor lá, sem passar
      pelo chat.
- Nunca suba o arquivo .env.local pro GitHub.
- Antes de qualquer comando que publica algo ou mexe no banco (supabase db push, vercel --prod), me diga o que vai
  acontecer e espere meu OK.
- Se algum comando der erro, leia a mensagem, me explique em uma frase e proponha a correção.

PASSO 1 — Conferir o computador
Confira se tenho Node.js 20 ou mais novo, Git, a CLI do Supabase e a CLI da Vercel (`node -v`, `git --version`,
`supabase --version`, `vercel --version`). Instale o que faltar, explicando antes:
- Mac: Homebrew (`brew install node git supabase/tap/supabase`) e `npm i -g vercel`.
- Windows: `winget install OpenJS.NodeJS.LTS Git.Git`, `npm i -g vercel` e a CLI do Supabase pelo Scoop
  (`scoop bucket add supabase https://github.com/supabase/scoop-bucket.git` e `scoop install supabase`).

PASSO 2 — Baixar o código
Rode `git clone https://github.com/matheustillimt-tech/vortex-grupo.git .` (com o ponto, pra baixar nesta pasta),
depois `npm install`. Copie `.env.example` para `.env.local`.

PASSO 3 — Contas (uma de cada vez, esperando eu terminar cada uma)
1. GitHub (github.com): pra guardar a minha cópia do código. Me ajude a criar um repositório PRIVADO meu e a
   enviar o código pra ele (`git remote set-url origin ...` e `git push`).
2. Supabase (supabase.com, plano grátis serve pra começar): crie um projeto novo (região São Paulo). Me mostre
   onde ficam, em Project Settings > API, a URL do projeto e as chaves anon e service_role, e me faça colar no
   .env.local (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY).
   IMPORTANTE: em Authentication > Sign In / Providers > Email, desligue "Allow new users to sign up" (só o
   administrador cadastra gente nova pelo painel).
3. Zapbot (zapbot.online): é quem liga o sistema ao WhatsApp. Crie a conta e me faça colar o e-mail e a senha
   dela no .env.local (ZAPBOT_EMAIL e ZAPBOT_PASSWORD). Lembre que o Zapbot é um serviço pago à parte.
4. Vercel (vercel.com): onde o painel fica no ar. Entre com a conta do GitHub. Explique que o agendador de
   1 em 1 minuto do arquivo vercel.json só funciona no plano Pro; no plano grátis vamos usar o agendador do
   Supabase (passo 7).

PASSO 4 — Gerar as chaves internas
Gere CRYPTO_KEY com `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` e CRON_SECRET com
`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` e grave direto no .env.local (sem mostrar
os valores no chat). NEXT_PUBLIC_SITE_URL fica pra depois do passo 6.

PASSO 5 — Criar o banco
Rode `supabase login`, depois `supabase link --project-ref <id do projeto>` (o id é o pedaço da URL antes de
.supabase.co) e, com o meu OK, `supabase db push`. Isso cria todas as tabelas, as regras de acesso e a pasta de
arquivos `midias`. Confira se terminou sem erro.

PASSO 6 — Publicar na Vercel
Rode `vercel link` (projeto novo, ligado ao meu repositório). Cadastre cada variável do .env.local na Vercel com
`vercel env add NOME production` (o valor é digitado no terminal, não no chat). Se eu estiver no plano grátis,
apague o bloco "crons" do vercel.json antes de publicar (senão a Vercel recusa). Publique com `vercel --prod`.
Pegue o endereço final (ex.: https://meu-projeto.vercel.app ou meu domínio), grave em NEXT_PUBLIC_SITE_URL no
.env.local e na Vercel, e publique de novo.

PASSO 7 — Agendador (só se eu estiver no plano grátis da Vercel)
No Supabase, em Database > Extensions, ligue pg_cron e pg_net. Depois me passe o SQL do INSTALACAO.md
(seção "Agendador pelo Supabase") pra eu colar no SQL Editor do Supabase, trocando os dois valores lá mesmo.

PASSO 8 — Primeiro administrador
No Supabase, em Authentication > Users > Add user, eu crio o meu usuário (e-mail e senha, marcando
"Auto Confirm User"). Depois rode no SQL Editor (eu colo lá):
  update membros set papel = 'admin' where usuario_id = (select id from auth.users where email = 'MEU-EMAIL');
Abra o endereço do sistema e me ajude a entrar.

PASSO 9 — Ligar o WhatsApp
No painel, em Conexões, me guie pra criar a primeira conexão e ler o QR Code com o WhatsApp do número que vai
administrar os grupos.

PASSO 10 — Checklist
Faça comigo o checklist do INSTALACAO.md: criar campanha, criar grupo, abrir o link /l/..., mandar uma mensagem
de teste num grupo, conferir se o agendador está rodando (aba Ações mostra a mensagem como enviada). No fim, me
diga o que ficou pronto e o que eu ainda preciso fazer.
```

O mesmo texto está em [PROMPT-DE-INSTALACAO.md](PROMPT-DE-INSTALACAO.md).

## Instalar na mão

O passo a passo completo, com todas as variáveis, está em **[INSTALACAO.md](INSTALACAO.md)**.

## Estrutura de pastas (resumo)

```
app/
  (painel)/        as telas do painel (campanhas, ações, automações, métricas, integrações, equipe…)
  api/             rotas do servidor: agendador (cron/tick), webhooks do Zapbot e de checkout, API v1, MCP, exportações
  l/[slug]/        o link público da campanha (manda a pessoa pro grupo com vaga)
  d/[slug]/        os deep links
  login/           tela de entrada
  dev/vitrine/     vitrine dos componentes (só abre rodando no seu computador)
src/lib/
  regras/          regras de negócio (funções puras, com teste)
  jobs/            o que o agendador faz a cada minuto
  zapbot/          conversa com a API do Zapbot
  api/ e mcp/      API externa e servidor MCP
supabase/
  migrations/      o banco inteiro, em ordem
tests/             testes automáticos (Vitest)
docs/              referência das rotas de grupo do Zapbot
```

## Licença

MIT. Veja [LICENSE](LICENSE). Você pode usar, mudar e vender a sua versão.

---

Feito pelo Grupo Vórtex · entregue na Plataforma Vórtex IA
