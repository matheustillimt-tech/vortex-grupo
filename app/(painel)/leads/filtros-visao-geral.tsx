"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FiltrosVisaoGeral } from "@/src/lib/regras/filtros-leads";
import { estiloAcao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { urlVisaoGeral } from "./comum";

type Opcao = { id: string; nome: string };

/** Busca (dígitos do telefone ou nome) + filtro de tag da aba "Visão geral". */
export function FiltrosVisaoGeralBar({ filtros, tags }: { filtros: FiltrosVisaoGeral; tags: Opcao[] }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosVisaoGeral>) => router.push(urlVisaoGeral(filtros, mudar), { scroll: false });
  const algum = filtros.busca || filtros.tag;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="w-full max-w-xs"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
          ir({ busca: q || null });
        }}
      >
        <CampoBusca key={filtros.busca ?? ""} valorInicial={filtros.busca ?? ""} rotulo="Buscar lead pelo nome ou número" />
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Tags</span>
        <select value={filtros.tag ?? ""} onChange={(e) => ir({ tag: e.target.value || null })} className={`${estiloInput} w-auto max-w-[220px]`}>
          <option value="">Todos</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </label>
      {algum && <Link href="/leads" scroll={false} className={estiloAcao.neutro}>Limpar filtros</Link>}
    </div>
  );
}
