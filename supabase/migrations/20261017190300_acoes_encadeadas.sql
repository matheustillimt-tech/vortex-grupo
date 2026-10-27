-- Etapa 3J, Tarefa 5: "Adicionar outra ação" (ações encadeadas no mesmo disparo). Só aditiva: uma coluna nova,
-- nula por padrão, e um índice parcial. Toda execução que já existe fica com `depois_de = null` e se comporta
-- exatamente como antes.
--
-- `depois_de` = a execução que tem que terminar antes desta começar. Quem cria (`criarAcaoComo`) grava a principal e
-- as seguintes num único insert, por campanha: a seguinte n aponta pra execução n-1 da mesma campanha.
-- O tick (`liberarEncadeadas`, src/lib/jobs/encadeadas.ts) olha a anterior: concluída/pulada → `depois_de = null` e
-- a seguinte sai uns 30 s depois; cancelada/bloqueada → a seguinte vira cancelada; agendada/enviando → espera.
-- `iniciarExecucoesVencidas` só pega `depois_de is null`.
--
-- `on delete set null`: excluir a anterior nunca trava a seguinte nem dá erro de FK. O app ("Excluir" da lista de
-- Ações) cancela antes as seguintes de uma anterior que ainda não terminou; se a anterior já tinha terminado, a
-- seguinte fica solta e sai sozinha no próximo tick.
alter table execucoes add column depois_de uuid references execucoes (id) on delete set null;

alter table execucoes add constraint execucoes_depois_de_outra check (depois_de is null or depois_de <> id);

-- O passo `encadeadas` do tick lê só as que esperam a anterior.
create index execucoes_encadeadas_esperando on execucoes (depois_de) where depois_de is not null and status = 'agendada';

-- Pro `on delete set null`: apagar execuções (Excluir, sequências, configurações) acha as seguintes pelo índice em vez
-- de varrer a tabela a cada linha apagada. Quase todas as linhas têm `depois_de` nulo e ficam fora.
create index execucoes_depois_de on execucoes (depois_de) where depois_de is not null;
