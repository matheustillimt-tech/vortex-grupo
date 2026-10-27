"use client";
import { usePathname } from "next/navigation";
import { Abas } from "../../_componentes/abas";
import { DefinirTrilha } from "../../_componentes/trilha";
import { abaDaCampanha, ABAS_CAMPANHA } from "@/src/lib/regras/topo";

/** Caminho na barra do topo (Campanhas › nome › aba) + as abas. Sem título, selo nem link
 *  (vão para a Visão geral na Task 5). `abaAtiva` força a aba (vitrine). `foto` (Etapa 3M, só a URL): avatar de
 *  20 px antes do nome na migalha (sem foto = letra). */
export function CabecalhoCampanha({ id, nome, foto = null, abaAtiva }: { id: string; nome: string; foto?: string | null; abaAtiva?: string }) {
  const caminho = usePathname();
  // "Importar grupos" não mostra a faixa de abas da campanha (o assistente de 3 passos ocupa o lugar).
  // A migalha ainda aparece (termina em "Importar", via `abaDaCampanha`).
  const semAbas = caminho.slice(`/campanhas/${id}`.length).startsWith("/grupos/importar");
  return (
    <div className="mx-auto max-w-[1200px] px-4 md:px-6">
      <DefinirTrilha
        itens={[
          { rotulo: "Campanhas", href: "/campanhas" },
          { rotulo: nome, href: `/campanhas/${id}`, avatar: true, foto },
          { rotulo: abaDaCampanha(caminho, id) },
        ]}
      />
      {!semAbas && (
        <Abas
          menu
          itens={ABAS_CAMPANHA.map((a) => ({
            href: `/campanhas/${id}${a.seg}`,
            rotulo: a.rotulo,
            exato: a.seg === "",
            ativo: abaAtiva === undefined ? undefined : abaAtiva === a.seg,
          }))}
        />
      )}
    </div>
  );
}
