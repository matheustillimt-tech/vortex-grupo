-- Etapa 3M, Tarefa 3: foto real dos grupos no lugar da letra (linha do grupo, cartão da campanha, Visão geral,
-- migalha e aba Grupos da conta). Fonte: o `avatarUrl` que já vem no `GET groups/{id}` da conferência (sem chamada
-- nova). URL do WhatsApp pode expirar: a tela volta pra letra no erro da imagem e a conferência regrava.
-- Tudo nulo = letra (comportamento de hoje). Só `https://`.

alter table grupos add column foto_url text check (foto_url is null or foto_url ~ '^https://');
-- Quando a conferência gravou a foto pela última vez (só muda quando a foto mudou). Nula = nunca gravada.
alter table grupos add column foto_atualizada_em timestamptz;
-- Última vez que a conferência perguntou na rota `groups/{id}/avatar` (foto sumiu do GET do grupo e a gravada tem
-- mais de 24 h): no máximo uma vez por grupo por dia. Nula = nunca perguntou.
alter table grupos add column foto_conferida_em timestamptz;

-- "Atualizar" da aba Grupos da conta (`GET groups`): só grava quando a resposta trouxer `avatarUrl`.
alter table conta_grupos add column foto_url text check (foto_url is null or foto_url ~ '^https://');

-- Foto de cada campanha pra uma página inteira de cartões numa chamada só: a do grupo ATIVO de menor `numero` que
-- tem foto. Campanha sem grupo com foto não aparece (= letra). A imagem própria da campanha (quando existir) vem
-- primeiro e é decidida no código (`fotoDaCampanha`). security invoker: respeita o RLS de quem chama.
create function fotos_campanhas(p_ids uuid[])
returns table (campanha_id uuid, foto_url text)
language sql stable security invoker set search_path = public as $$
  select distinct on (g.campanha_id) g.campanha_id, g.foto_url
    from grupos g
   where g.campanha_id = any (coalesce(p_ids, '{}'))
     and g.ativo
     and g.foto_url is not null
   order by g.campanha_id, g.numero, g.id
$$;

revoke all on function fotos_campanhas(uuid[]) from public, anon;
grant execute on function fotos_campanhas(uuid[]) to authenticated, service_role;
