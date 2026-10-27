"use client";
import { useState } from "react";
import { Botao, Campo, estiloInput } from "../../../_componentes/ui";
import { editarNomeGrupo } from "./actions";

/** Conteúdo da janela "Editar" do menu "⋮": troca o nome só deste grupo (vira uma execução `nome`, igual às
 *  outras ações avulsas — passa pela mesma fila do WhatsApp). */
export function EditarNome({ campanhaId, grupoId, nomeAtual, aoConcluir }: {
  campanhaId: string;
  grupoId: string;
  nomeAtual: string;
  aoConcluir: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState(nomeAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    if (!nome.trim()) return setErro("Escreva o novo nome.");
    setErro(null);
    setOcupado(true);
    try {
      const r = await editarNomeGrupo(grupoId, campanhaId, nome.trim());
      if (r.erro) return setErro(r.erro);
      aoConcluir("Nome enviado para a fila (até 1 minuto).");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <Campo rotulo="Novo nome do grupo">
        <input className={estiloInput} value={nome} maxLength={95} onChange={(e) => setNome(e.target.value)} autoFocus />
      </Campo>
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={ocupado} onClick={salvar}>{ocupado ? "Salvando…" : "Salvar"}</Botao>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      </div>
    </div>
  );
}
