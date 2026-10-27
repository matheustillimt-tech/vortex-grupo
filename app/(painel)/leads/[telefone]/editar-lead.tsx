"use client";
import { useId, useState, useTransition } from "react";
import { MAXIMO_CAMPOS } from "@/src/lib/regras/leads";
import { Icone } from "../../_componentes/icone";
import { Campo, estiloBotao, estiloInput } from "../../_componentes/ui";
import { atualizarLead } from "../actions";

type LinhaCampo = { chave: string; valor: string };

function paraLinhas(campos: Record<string, string>): LinhaCampo[] {
  return Object.entries(campos).map(([chave, valor]) => ({ chave, valor }));
}

/** Nome e campos personalizados do lead (Etapa 3I, Tarefa 1), editáveis direto na página — `leads/editar`
 *  (a permissão é checada no servidor; sem ela, salvar devolve a mensagem de erro). */
export function EditarLead({ telefone, nome, campos }: { telefone: string; nome: string | null; campos: Record<string, string> }) {
  const [valorNome, setValorNome] = useState(nome ?? "");
  const [linhas, setLinhas] = useState<LinhaCampo[]>(paraLinhas(campos));
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();

  function mudarLinha(i: number, patch: Partial<LinhaCampo>) {
    setLinhas((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function salvar() {
    setMsg(null);
    iniciar(async () => {
      const r = await atualizarLead(telefone, valorNome, linhas);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Salvo.", erro: false });
    });
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        salvar();
      }}
    >
      <Campo rotulo="Nome">
        <input id={idNome} className={estiloInput} value={valorNome} maxLength={80} onChange={(e) => setValorNome(e.target.value)} placeholder="Nome do lead" />
      </Campo>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13.3px] text-[#e3e9e5]">Campos personalizados</span>
          <button
            type="button"
            className={estiloBotao("contorno")}
            disabled={linhas.length >= MAXIMO_CAMPOS}
            onClick={() => setLinhas((ls) => [...ls, { chave: "", valor: "" }])}
          >
            <Icone nome="add" tamanho={16} />
            Novo campo
          </button>
        </div>
        {linhas.length === 0 && <p className="text-sm text-vg-muted">Sem campos personalizados.</p>}
        {linhas.map((l, i) => (
          <div key={i} className="flex gap-2">
            <input
              className={estiloInput}
              value={l.chave}
              maxLength={40}
              placeholder="Nome do campo"
              aria-label={`Nome do campo ${i + 1}`}
              onChange={(e) => mudarLinha(i, { chave: e.target.value })}
            />
            <input
              className={estiloInput}
              value={l.valor}
              maxLength={200}
              placeholder="Valor"
              aria-label={`Valor do campo ${i + 1}`}
              onChange={(e) => mudarLinha(i, { valor: e.target.value })}
            />
            <button
              type="button"
              aria-label={`Remover campo ${i + 1}`}
              onClick={() => setLinhas((ls) => ls.filter((_, idx) => idx !== i))}
              className="grid size-9 shrink-0 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-vg-erro"
            >
              <Icone nome="close" tamanho={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3">
        <p role="status" className={`text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
        <button type="submit" className={estiloBotao()} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</button>
      </div>
    </form>
  );
}
