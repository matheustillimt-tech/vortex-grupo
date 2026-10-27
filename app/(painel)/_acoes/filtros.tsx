"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ROTULO_ACAO } from "@/src/lib/regras/acoes";
import { TIPOS_EXECUCAO, type TipoExecucao } from "@/src/lib/regras/conteudo";
import type { Aba } from "../_componentes/abas";
import { Icone } from "../_componentes/icone";
import { Paginacao } from "../_componentes/paginacao";
import { estiloInput } from "../_componentes/ui";
import { POR_PAGINA_ACOES, urlAcoes, type FiltrosAcoes, type OpcoesUrlAcoes } from "./tipos";

/** Campo de data num contorno só, com o ícone de calendário à direita. O `<input type="date">` continua por baixo, com `aria-label` (sem rótulo flutuante): o ícone é
 *  decorativo e o próprio campo já abre o seletor nativo ao clicar em qualquer parte dele. */
function CampoData({ rotulo, valor, aoMudar }: { rotulo: string; valor: string; aoMudar: (v: string) => void }) {
  return (
    <div className="relative block w-full sm:w-48">
      <input type="date" defaultValue={valor} onChange={(e) => aoMudar(e.target.value)} aria-label={rotulo} className={`${estiloInput} pr-9`} />
      <Icone nome="event" tamanho={18} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-vg-text-3" />
    </div>
  );
}

/** Uma sub-aba simples, sem as setas de rolagem de `<Abas>`: a barra de filtros
 *  agora desenha as sub-abas direto, com "Agrupar" na mesma linha. Exportada pra `/historico`, que é a última
 *  sub-aba de Ações e desenha a mesma faixa em cima. */
export function SubAbas({ itens }: { itens: Aba[] }) {
  return (
    <nav aria-label="Sub-abas" className="flex flex-1 flex-wrap text-[13.7px] font-medium">
      {itens.map((a) => (
        <a
          key={a.href}
          href={a.href}
          aria-current={a.ativo ? "page" : undefined}
          className={`shrink-0 whitespace-nowrap px-4 py-3 transition-colors ${a.ativo ? "text-vg-accent shadow-[inset_0_-2px_0_var(--color-vg-accent)]" : "text-[#e3e9e5] hover:text-white"}`}
        >
          {a.rotulo}
        </a>
      ))}
    </nav>
  );
}

/**
 * Barra de filtros das telas de Ações, neste layout: "Filtrar por" (largura
 * total, só onde há seletor de tipos) acima das sub-abas; sub-abas com "Agrupar" à direita na mesma linha; linha
 * de baixo com as datas à esquerda e a paginação à direita. `abas` (com `href` já prontos) é quem desenha as
 * sub-abas — a página não precisa mais de `<Abas>` em cima desta barra. `tiposFixos` esconde o seletor de tipos —
 * a aba Mensagens já filtra por tipo (mensagem/enquete) sem deixar a pessoa escolher. `paginacao` (de/ate/total e
 * os links prontos de anterior/próxima — dados, não função) é quem desenha a `Paginacao` da linha de baixo.
 */
export function FiltrosAcoesBarra({ filtros, base, tiposFixos, opcoesUrl, abas, paginacao, pontas = true, opcoesPorPagina = POR_PAGINA_ACOES }: {
  filtros: FiltrosAcoes;
  base: string;
  tiposFixos?: TipoExecucao[];
  opcoesUrl?: OpcoesUrlAcoes;
  abas: Aba[];
  paginacao: { de: number; ate: number; total: number; anterior?: string; proxima?: string; primeira?: string; ultima?: string };
  /** `false` esconde `first_page`/`last_page` (Mensagens da campanha). */
  pontas?: boolean;
  /** Opções do seletor "Linhas por página" (Mensagens usa 10/25/50, mais curto que o padrão das outras telas). */
  opcoesPorPagina?: readonly number[];
}) {
  const router = useRouter();
  const [mostrarTipos, setMostrarTipos] = useState(!!filtros.tipos?.length);
  const ir = (mudar: Partial<FiltrosAcoes>) => router.push(urlAcoes(base, filtros, mudar, opcoesUrl), { scroll: false });
  const pre = opcoesUrl?.prefixo ?? "";

  function alternarTipo(tipo: TipoExecucao, marcado: boolean) {
    const atuais = new Set(filtros.tipos ?? []);
    if (marcado) atuais.add(tipo);
    else atuais.delete(tipo);
    ir({ tipos: [...atuais] });
  }

  return (
    <div className="space-y-3">
      {!tiposFixos && (
        <div className="space-y-3">
          <label className="relative block w-full">
            <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Filtrar por</span>
            <select
              className={`${estiloInput} pt-2.5`}
              value={mostrarTipos ? "tipos" : "tudo"}
              onChange={(e) => {
                const quer = e.target.value === "tipos";
                setMostrarTipos(quer);
                if (!quer) ir({ tipos: null });
              }}
            >
              <option value="tudo">Filtrar tudo</option>
              <option value="tipos">Filtrar por tipos de ações</option>
            </select>
          </label>
          {mostrarTipos && (
            <fieldset className="flex flex-wrap items-center gap-2 rounded-lg border border-vg-line-2 p-2" aria-label="Tipos de ações">
              {TIPOS_EXECUCAO.map((tipo) => {
                const marcado = (filtros.tipos ?? []).includes(tipo);
                return (
                  <label
                    key={tipo}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors ${marcado ? "border-vg-accent/60 bg-vg-accent/10 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:border-white/60"}`}
                  >
                    <input type="checkbox" className="sr-only" checked={marcado} onChange={(e) => alternarTipo(tipo, e.target.checked)} />
                    {ROTULO_ACAO[tipo]}
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-stretch border-b border-vg-line">
        <SubAbas itens={abas} />
        <label className="relative my-auto block w-36 shrink-0">
          <span className="pointer-events-none absolute -top-2 left-2 bg-vg-bg px-1 text-[11px] leading-4 text-vg-text-2">Agrupar</span>
          <select className={`${estiloInput} pt-2.5`} value={filtros.agrupar ? "sim" : "nao"} onChange={(e) => ir({ agrupar: e.target.value !== "nao" })}>
            <option value="sim">Sim</option>
            <option value="nao">Não</option>
          </select>
        </label>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <CampoData rotulo="Inicio do intervalo" valor={filtros.inicio} aoMudar={(v) => ir({ inicio: v })} />
          <CampoData rotulo="Fim do intervalo" valor={filtros.fim} aoMudar={(v) => ir({ fim: v })} />
        </div>
        <Paginacao
          de={paginacao.de}
          ate={paginacao.ate}
          total={paginacao.total}
          anterior={paginacao.anterior}
          proxima={paginacao.proxima}
          primeira={paginacao.primeira}
          ultima={paginacao.ultima}
          pontas={pontas}
          porPagina={filtros.por}
          opcoesPorPagina={opcoesPorPagina}
          parametroPorPagina={`${pre}por`}
          parametroPagina={`${pre}pagina`}
        />
      </div>
    </div>
  );
}
