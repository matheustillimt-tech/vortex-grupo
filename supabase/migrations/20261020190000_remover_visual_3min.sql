-- Regra dos 3 min retirada (20/10/2026, pedido do dono): ele mesmo agenda as trocas de nome/imagem/descrição antes
-- da mensagem. Sai o par de gatilhos de 20261020180000; nada mais muda.
drop trigger if exists visual_antes_da_mensagem on execucoes;
drop trigger if exists mensagem_empurra_visual on execucoes;
drop function if exists visual_antes_da_mensagem();
drop function if exists mensagem_empurra_visual();
