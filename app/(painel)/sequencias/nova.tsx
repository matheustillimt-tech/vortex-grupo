"use client";
import { useState } from "react";
import { Botao, estiloInput } from "../_componentes/ui";
import { criarSequencia } from "./actions";

export function NovaSequencia() {
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  return (
    <div className="max-w-xl space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input className={estiloInput} placeholder="Ex.: Webinário padrão" value={nome} onChange={(e) => setNome(e.target.value)} />
        <Botao onClick={async () => setErro((await criarSequencia(nome))?.erro ?? null)}>Criar</Botao>
      </div>
      {erro && <p className="text-sm text-vg-erro">{erro}</p>}
    </div>
  );
}
