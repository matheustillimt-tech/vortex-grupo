"use client";
import type { Criterio } from "@/src/lib/regras/leadscore";
import { Icone } from "../../../_componentes/icone";
import { Paginacao } from "../../../_componentes/paginacao";
import { Tabela as TabelaBase } from "../../../_componentes/ui";

export type LinhaDesempenho = {
  grupo_id: string;
  numero: number;
  nome: string;
  group_id: string;
  participantes: number;
  geral: number;
  visualizacao: number;
  reproducao: number;
  recebimento: number;
};

const COLUNAS: { chave: Criterio; icone: string; rotulo: string }[] = [
  { chave: "geral", icone: "leaderboard", rotulo: "Geral" },
  { chave: "visualizacao", icone: "visibility", rotulo: "Visualização" },
  { chave: "reproducao", icone: "play_circle", rotulo: "Reprodução" },
  { chave: "recebimento", icone: "mark_email_read", rotulo: "Recebimento" },
];

const valorPt = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Tabela "Desempenho por grupo" abaixo do gráfico: "#", "Grupo" (nome + o
 *  `group_id` embaixo, em cinza), e os 4 sinais ponderados, com a coluna do critério ativo destacada. Client, só
 *  dados: a página de servidor já monta os hrefs da paginação (sem passar função nenhuma). */
export function Tabela({
  linhas,
  criterio,
  de,
  busca,
  paginacao,
}: {
  linhas: LinhaDesempenho[];
  criterio: Criterio;
  /** Deslocamento (linha 1 = `de + 1`) só para o rótulo da paginação. */
  de: number;
  /** `true` quando há busca ativa, para trocar o texto do vazio. */
  busca: boolean;
  paginacao: { ate: number; total: number; porPagina: number; primeira?: string; anterior?: string; proxima?: string; ultima?: string };
}) {
  return (
    <div className="space-y-3">
      <TabelaBase
        colunas={["#", "Grupo", ...COLUNAS.map((c) => c.rotulo)]}
        vazio={linhas.length === 0 ? (busca ? "Nenhum grupo encontrado" : "Nenhum grupo nesta campanha") : undefined}
      >
        {linhas.map((l, i) => (
          <tr key={l.grupo_id}>
            <td className="px-3 py-2.5 tabular-nums text-vg-muted">{de + i + 1}</td>
            <td className="px-3 py-2.5">
              <span className="block truncate" title={l.nome}>{l.nome}</span>
              <span className="block truncate text-xs text-vg-text-3" title={l.group_id}>{l.group_id}</span>
            </td>
            {COLUNAS.map((c) => (
              <td
                key={c.chave}
                className={`px-3 py-2.5 tabular-nums ${c.chave === criterio ? "font-semibold text-vg-accent" : "text-vg-text"}`}
              >
                {valorPt(l[c.chave])}
              </td>
            ))}
          </tr>
        ))}
      </TabelaBase>
      {paginacao.total > 0 && (
        <Paginacao
          de={de + 1}
          ate={paginacao.ate}
          total={paginacao.total}
          porPagina={paginacao.porPagina}
          opcoesPorPagina={[10, 25, 50]}
          parametroPorPagina="linhas"
          parametroPagina="pagina"
          primeira={paginacao.primeira}
          anterior={paginacao.anterior}
          proxima={paginacao.proxima}
          ultima={paginacao.ultima}
          rotuloDe="of"
        />
      )}
      <p className="flex items-start gap-1.5 text-[12px] text-vg-muted">
        <Icone nome="info_outline" tamanho={14} className="mt-[1px] shrink-0" />
        A pontuação é calculada a partir de sinais ponderados (recebimento, visualização, reprodução e interação).
      </p>
    </div>
  );
}
