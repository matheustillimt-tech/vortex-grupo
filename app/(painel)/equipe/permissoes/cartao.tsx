"use client";
import { useId, useState, useTransition } from "react";
import { AREAS_PERMISSAO, NIVEIS, ROTULO_NIVEL, type AreaPermissao, type Nivel } from "@/src/lib/regras/permissoes";
import { estiloBotao } from "../../_componentes/ui";
import { salvarPermissoes } from "../actions";

export function CartaoPermissoes({
  usuarioId,
  nome,
  permissoesIniciais,
}: {
  usuarioId: string;
  nome: string;
  permissoesIniciais: Record<AreaPermissao, Nivel>;
}) {
  const [valores, setValores] = useState(permissoesIniciais);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idBase = useId();

  function salvar() {
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await salvarPermissoes(usuarioId, valores);
        setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Permissões salvas.", erro: false });
      } catch {
        setMsg({ texto: "Não foi possível salvar. Tente de novo.", erro: true });
      }
    });
  }

  return (
    <section className="rounded-xl border border-vg-line bg-vg-bg p-4">
      <h2 className="mb-3 text-[15px] font-medium">{nome}</h2>
      <div className="space-y-3">
        {AREAS_PERMISSAO.map((area) => (
          <fieldset key={area.chave} className="flex flex-wrap items-center justify-between gap-2 border-b border-vg-line pb-2 last:border-0 last:pb-0">
            <legend className="text-[13.3px] text-[#e3e9e5]">{area.rotulo}</legend>
            <div role="radiogroup" aria-label={area.rotulo} className="flex gap-3">
              {NIVEIS.map((nivel) => (
                <label key={nivel} className="flex items-center gap-1.5 text-[13px] text-vg-text-2">
                  <input
                    type="radio"
                    name={`${idBase}-${area.chave}`}
                    checked={valores[area.chave] === nivel}
                    disabled={area.soVer && nivel === "editar"}
                    onChange={() => setValores((v) => ({ ...v, [area.chave]: nivel }))}
                  />
                  {ROTULO_NIVEL[nivel]}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <p role="status" className={`mt-3 text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
      <div className="mt-3 flex justify-end">
        <button type="button" className={estiloBotao()} disabled={ocupado} onClick={salvar}>
          {ocupado ? "Salvando…" : "SALVAR"}
        </button>
      </div>
    </section>
  );
}
