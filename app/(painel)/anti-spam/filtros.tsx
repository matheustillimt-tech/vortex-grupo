"use client";
import { useRouter } from "next/navigation";
import { urlBloqueados, type FiltrosBloqueados } from "@/src/lib/regras/filtros-bloqueados";
import { estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";

/** Busca por telefone + intervalo de data de criação + ordenação, aplicados ao trocar. */
export function FiltrosBloqueadosBarra({ filtros }: { filtros: FiltrosBloqueados }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosBloqueados>) => router.push(urlBloqueados(filtros, mudar), { scroll: false });
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
        <CampoBusca key={filtros.busca ?? ""} valorInicial={filtros.busca ?? ""} inputMode="numeric" rotulo="Buscar bloqueado pelo número" />
        <p className="mt-1 text-xs text-vg-muted">A busca é feita com base nos filtros de data e quantidade de itens por pagina. Altere esses parametros para buscar mais números</p>
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Inicio do intervalo</span>
        <input type="date" value={filtros.inicio ?? ""} onChange={(e) => ir({ inicio: e.target.value || null })} className={`${estiloInput} w-auto`} />
      </label>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Fim do intervalo</span>
        <input type="date" value={filtros.fim ?? ""} onChange={(e) => ir({ fim: e.target.value || null })} className={`${estiloInput} w-auto`} />
      </label>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Ordenação</span>
        <select value={filtros.ordem} onChange={(e) => ir({ ordem: e.target.value === "antigos" ? "antigos" : "recentes" })} className={`${estiloInput} w-auto`}>
          <option value="recentes">Data de criação (mais novos)</option>
          <option value="antigos">Data de criação (mais antigos)</option>
        </select>
      </label>
    </div>
  );
}
