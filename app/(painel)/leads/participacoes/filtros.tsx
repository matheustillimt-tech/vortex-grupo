"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FiltrosPessoas } from "@/src/lib/regras/filtros-pessoas";
import { CampoBusca } from "../../_componentes/campo-busca";
import { estiloAcao, estiloInput } from "../../_componentes/ui";
import { urlLeads } from "../comum";

type Opcao = { id: string; nome: string };

const BASE = "/leads/participacoes";

/** Busca por telefone + filtros que já aplicam ao trocar (o grupo só aparece depois de escolher a campanha). */
export function FiltrosLeads({ filtros, campanhas, grupos, tags }: { filtros: FiltrosPessoas; campanhas: Opcao[]; grupos: Opcao[]; tags: Opcao[] }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosPessoas>) => router.push(urlLeads(filtros, mudar, BASE), { scroll: false });
  const algum = filtros.busca || filtros.campanha || filtros.grupo || filtros.situacao || filtros.tag;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <form
        className="w-full max-w-xs"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = String(new FormData(e.currentTarget).get("q") ?? "").replace(/\D/g, "");
          ir({ busca: q || null });
        }}
      >
        <CampoBusca nome="q" valorInicial={filtros.busca ?? ""} key={filtros.busca ?? ""} inputMode="numeric" rotulo="Buscar lead pelo número" />
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Campanha</span>
        <select value={filtros.campanha ?? ""} onChange={(e) => ir({ campanha: e.target.value || null })} className={`${estiloInput} w-auto max-w-[220px]`}>
          <option value="">Todas</option>
          {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      {filtros.campanha && (
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Grupo</span>
          <select value={filtros.grupo ?? ""} onChange={(e) => ir({ grupo: e.target.value || null })} className={`${estiloInput} w-auto max-w-[220px]`}>
            <option value="">Todos</option>
            {grupos.map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
          </select>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Situação</span>
        <select value={filtros.situacao ?? ""} onChange={(e) => ir({ situacao: (e.target.value || null) as FiltrosPessoas["situacao"] })} className={`${estiloInput} w-auto`}>
          <option value="">Todas</option>
          <option value="dentro">No grupo</option>
          <option value="saiu">Saiu</option>
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Tag</span>
        <select value={filtros.tag ?? ""} onChange={(e) => ir({ tag: e.target.value || null })} className={`${estiloInput} w-auto max-w-[220px]`}>
          <option value="">Qualquer</option>
          {tags.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
      </label>
      {algum && <Link href={BASE} scroll={false} className={estiloAcao.neutro}>Limpar filtros</Link>}
    </div>
  );
}
