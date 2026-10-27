-- Etapa 3E (Tarefa 1): opções de criação de grupos da campanha, "cheio" marcado à mão, grupo suspenso e valores
-- de variáveis por grupo.
--
-- Os padrões não mudam nada do que existe: com eles, uma campanha cria grupos exatamente como antes (mesmo nome,
-- mesma numeração, mesmo "fechado", sem chamadas extras ao Zapbot).
--
-- caractere_numeracao: padrão '' (e não '#'). Hoje o "#" vem do próprio `padrao_nome` (ex.: "AULÃO #{n}"); um
-- padrão '#' faria "AULÃO ##01" nas campanhas que já existem. Com '' o nome sai idêntico ao de hoje.
-- inicio_contagem: número do primeiro grupo (hoje 1). numero_no_inicio: sem `{n}` no padrão, o número vai no
-- começo em vez do fim. nao_criar_grupos / limite_cliques_sem_criar: travas da criação automática (folga e link
-- sem vaga). criar_aberto_fechar_24h: cria o grupo aberto e agenda o "fechar" 24 h depois. mensagens_temporarias e
-- aprovacao_entrada: aplicadas no grupo logo depois de criado. modo_criacao 'seguro': no mínimo 10 min entre
-- criações de grupo da mesma conta.

alter table campanhas
  add column caractere_numeracao text not null default '' check (char_length(caractere_numeracao) between 0 and 3),
  add column inicio_contagem int not null default 1 check (inicio_contagem >= 0),
  add column numero_no_inicio boolean not null default false,
  add column nao_criar_grupos boolean not null default false,
  add column limite_cliques_sem_criar int check (limite_cliques_sem_criar is null or limite_cliques_sem_criar >= 1),
  add column criar_aberto_fechar_24h boolean not null default false,
  add column mensagens_temporarias text not null default 'nao' check (mensagens_temporarias in ('nao', '24h', '7d', '90d')),
  add column aprovacao_entrada boolean not null default false,
  add column modo_criacao text not null default 'normal' check (modo_criacao in ('normal', 'seguro'));

-- cheio_manual: null = automático (conferência e link decidem); true/false = marcado à mão (a conferência mantém).
-- suspenso: o WhatsApp deixou de mostrar o grupo (banido/indisponível); marcado junto com ativo = false.
alter table grupos
  add column cheio_manual boolean,
  add column suspenso boolean not null default false;

-- Valores das variáveis num grupo: sobrepõem o valor da campanha; vazio (ou sem linha) herda o da campanha.
create table grupo_variaveis (
  grupo_id uuid not null references grupos (id) on delete cascade,
  chave text not null check (chave ~ '^[a-z_]{2,30}$'),
  valor text not null default '',
  primary key (grupo_id, chave)
);
alter table grupo_variaveis enable row level security;
create policy equipe_tudo on grupo_variaveis for all to authenticated using (true) with check (true);
grant select, insert, update, delete on grupo_variaveis to authenticated, service_role;
revoke all on grupo_variaveis from anon;

-- Conteúdo já resolvido só pra este grupo (variáveis do grupo diferentes das da campanha). null = usa o
-- `conteudo_final` da execução, como sempre.
alter table tarefas add column conteudo_grupo jsonb;
