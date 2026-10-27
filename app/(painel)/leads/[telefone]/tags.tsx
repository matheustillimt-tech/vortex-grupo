"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icone } from "../../_componentes/icone";
import { estiloBotao, estiloInput, Selo } from "../../_componentes/ui";
import { porTagNaPessoa, tirarTagDaPessoa } from "../actions";

type TagDaPessoa = { tagId: string; campanhaId: string | null; nome: string };

/** Tags do número: tirar qualquer uma; pôr uma existente (manual ou Comprador) ou criar uma manual nova. */
export function TagsDaPessoa({ telefone, tags, opcoes }: { telefone: string; tags: TagDaPessoa[]; opcoes: { id: string; nome: string }[] }) {
  const router = useRouter();
  const [escolhida, setEscolhida] = useState("");
  const [nova, setNova] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function tirar(t: TagDaPessoa) {
    setErro(null);
    iniciar(async () => {
      try {
        await tirarTagDaPessoa(telefone, t.tagId, t.campanhaId);
        router.refresh();
      } catch {
        setErro("Não foi possível tirar a tag.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && <span className="text-sm text-vg-muted">Sem tags.</span>}
        {tags.map((t) => (
          <span key={`${t.tagId}-${t.campanhaId ?? ""}`} className="inline-flex items-center gap-0.5">
            <Selo cor="neutro" semPonto>{t.nome}</Selo>
            <button
              type="button"
              aria-label={`Tirar a tag ${t.nome}`}
              disabled={ocupado}
              onClick={() => tirar(t)}
              className="grid size-6 place-items-center rounded-full text-vg-muted transition-colors hover:bg-white/5 hover:text-vg-erro"
            >
              <Icone nome="close" tamanho={14} />
            </button>
          </span>
        ))}
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setErro(null);
          iniciar(async () => {
            const r = await porTagNaPessoa(telefone, escolhida || null, nova);
            if (r.erro) return setErro(r.erro);
            setEscolhida("");
            setNova("");
            router.refresh();
          });
        }}
      >
        <select aria-label="Tag existente" className={`${estiloInput} w-48`} value={escolhida} onChange={(e) => { setEscolhida(e.target.value); setNova(""); }}>
          <option value="">Tag existente…</option>
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
        <span className="text-xs text-vg-muted">ou</span>
        <input aria-label="Nova tag" className={`${estiloInput} w-48`} placeholder="Nova tag" maxLength={40} value={nova} onChange={(e) => { setNova(e.target.value); setEscolhida(""); }} />
        <button type="submit" className={estiloBotao("contorno")} disabled={ocupado || (!escolhida && !nova.trim())}>
          <Icone nome="sell" />
          PÔR TAG
        </button>
      </form>
      {erro && <p role="alert" className="text-xs text-vg-erro">{erro}</p>}
    </div>
  );
}
