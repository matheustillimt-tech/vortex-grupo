"use client";
import { useState } from "react";
import { SegmentoRadio } from "@/app/(painel)/_componentes/editor-mensagens/segmento-radio";
import { Janela } from "@/app/(painel)/_componentes/janela";
import { Botao, estiloAcao } from "@/app/(painel)/_componentes/ui";

/** Demo da Etapa 3L: `Janela` com `icone`/`acaoTopo`/`semFechar`. */
export function DemoJanela3L() {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <Botao variante="secundario" onClick={() => setAberta(true)}>Abrir Janela (icone + acaoTopo + semFechar)</Botao>
      <Janela
        aberta={aberta}
        aoFechar={() => setAberta(false)}
        titulo="Editar"
        icone="campaign"
        semFechar
        acaoTopo={<button type="button" aria-label="Excluir" className={estiloAcao.perigo}>Excluir</button>}
      >
        <p className="text-sm text-vg-muted">Sem o "close" do topo (semFechar); só Esc fecha (clique fora, não).</p>
        <div className="mt-4 text-right">
          <Botao variante="secundario" onClick={() => setAberta(false)}>Fechar</Botao>
        </div>
      </Janela>
    </>
  );
}

/** Demo da Etapa 3L: `SegmentoRadio larguraTotal` (editor de mensagens, direita). */
export function DemoSegmentoRadio3L() {
  const [valor, setValor] = useState<"padrao" | "largura">("largura");
  return <SegmentoRadio legenda="Opções de envio" opcoes={[{ valor: "padrao", rotulo: "Padrão" }, { valor: "largura", rotulo: "Largura total" }]} valor={valor} aoMudar={setValor} larguraTotal />;
}
