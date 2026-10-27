"use client";
import { useState } from "react";
import { Segmentos } from "@/app/(painel)/_componentes/ui";

export function DemoSegmentos() {
  const [valor, setValor] = useState<"mensagem" | "enquete">("mensagem");
  return <Segmentos opcoes={[{ valor: "mensagem", rotulo: "Mensagem" }, { valor: "enquete", rotulo: "Enquete" }]} valor={valor} aoMudar={setValor} />;
}

/** Seletor de período (7/14/21/28/90 dias). */
export function DemoPeriodo() {
  const [valor, setValor] = useState("7");
  return (
    <Segmentos
      opcoes={[
        { valor: "7", rotulo: "7 Dias" },
        { valor: "14", rotulo: "14 Dias" },
        { valor: "21", rotulo: "21 Dias" },
        { valor: "28", rotulo: "28 Dias" },
        { valor: "90", rotulo: "90 Dias" },
      ]}
      valor={valor}
      aoMudar={setValor}
    />
  );
}
