"use client";
import { useRouter } from "next/navigation";
import { estiloInput } from "../_componentes/ui";

/** Select "Projeto" do "Funil de campanhas": filtra os cartões daquele bloco (e o CSV) pelo projeto
 *  escolhido, navegando ao trocar (sem botão "Aplicar"), como os outros selects do painel. Rótulo flutuante
 *  "Projeto" e opção vazia (= todos) sem texto.21. */
/** `hrefs` vem pronto do servidor (projeto → endereço; "" = todos): função não pode ser passada a componente
 *  cliente. */
export function SeletorProjetoMetricas({ atual, projetos, hrefs }: { atual: string; projetos: { id: string; nome: string }[]; hrefs: Record<string, string> }) {
  const router = useRouter();
  return (
    <label className="relative block w-auto">
      <span className="pointer-events-none absolute -top-2 left-2 z-10 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Projeto</span>
      <select
        value={atual}
        disabled={!projetos.length}
        onChange={(e) => router.push(hrefs[e.target.value] ?? hrefs[""], { scroll: false })}
        className={`${estiloInput} w-auto`}
        aria-label="Filtrar o funil de campanhas por projeto"
      >
        <option value="" />
        {projetos.map((p) => (
          <option key={p.id} value={p.id}>{p.nome}</option>
        ))}
      </select>
    </label>
  );
}
