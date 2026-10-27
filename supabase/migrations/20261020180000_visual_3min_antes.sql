-- Regra do dono (20/10/2026): troca de nome, imagem e descrição sai pelo menos 3 min antes de qualquer mensagem ou
-- enquete agendada da mesma campanha. No lançamento de 19/10, nome e imagem agendados no mesmo minuto da mensagem
-- das 20h atrasaram o disparo. Vale pra tudo que agenda (tela, MCP, sequência, automação), por isso fica no banco:
-- troca agendada de 3 min antes até o minuto seguinte de uma mensagem é puxada pra 3 min antes dela. Ação encadeada
-- ("depois de outra") não muda: o horário dela vem da anterior.

-- 1. Troca agendada (ou com horário mudado): puxa pra antes da mensagem mais cedo que bate com ela. Repete porque, ao
--    andar pra trás, pode encostar em outra mensagem (no máximo 20 voltas).
create or replace function visual_antes_da_mensagem() returns trigger language plpgsql set search_path = public as $$
declare
  msg timestamptz;
  voltas int := 0;
begin
  if new.status <> 'agendada' or new.depois_de is not null or new.campanha_id is null then return new; end if;
  loop
    select min(e.agendada_para) into msg from execucoes e
    where e.campanha_id = new.campanha_id and e.tipo in ('mensagem', 'enquete') and e.status = 'agendada'
      and e.id <> new.id
      and new.agendada_para > e.agendada_para - interval '3 minutes'
      and new.agendada_para < e.agendada_para + interval '1 minute';
    exit when msg is null or voltas >= 20;
    new.agendada_para := msg - interval '3 minutes';
    voltas := voltas + 1;
  end loop;
  return new;
end $$;

create trigger visual_antes_da_mensagem
  before insert or update of agendada_para, status, tipo, campanha_id, depois_de on execucoes
  for each row when (new.tipo in ('nome', 'imagem', 'descricao'))
  execute function visual_antes_da_mensagem();

-- 2. Mensagem agendada (ou com horário mudado) depois da troca: "toca" as trocas que batem com ela, e o gatilho 1
--    puxa cada uma pra 3 min antes.
create or replace function mensagem_empurra_visual() returns trigger language plpgsql set search_path = public as $$
begin
  if new.status <> 'agendada' or new.campanha_id is null then return null; end if;
  update execucoes e set agendada_para = e.agendada_para
  where e.campanha_id = new.campanha_id and e.tipo in ('nome', 'imagem', 'descricao') and e.status = 'agendada'
    and e.depois_de is null
    and e.agendada_para > new.agendada_para - interval '3 minutes'
    and e.agendada_para < new.agendada_para + interval '1 minute';
  return null;
end $$;

create trigger mensagem_empurra_visual
  after insert or update of agendada_para, status, tipo, campanha_id on execucoes
  for each row when (new.tipo in ('mensagem', 'enquete'))
  execute function mensagem_empurra_visual();

revoke execute on function visual_antes_da_mensagem(), mensagem_empurra_visual() from public, anon, authenticated;
