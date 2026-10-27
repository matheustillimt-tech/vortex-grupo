-- Etapa 3K, Tarefa 3 (revisão): `exportacoes` só guarda metadados de quem gerou o arquivo. A equipe logada lê e
-- grava a própria linha (criada_por = quem está logado); ninguém altera nem apaga pelo painel (só o serviço).
-- Aditiva: troca a política ampla de 20261017200100_acoes_novas_exportacoes.sql por duas restritas.

drop policy if exists equipe_tudo on exportacoes;
create policy equipe_le on exportacoes for select to authenticated using (true);
create policy equipe_registra on exportacoes for insert to authenticated with check (criada_por = auth.uid());

revoke all on exportacoes from anon, authenticated;
grant select, insert on exportacoes to authenticated;
grant select, insert, update, delete on exportacoes to service_role;
