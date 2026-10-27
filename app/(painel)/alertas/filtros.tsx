"use client";
import { useRouter } from "next/navigation";
import { AGRUPAR_VALORES, INFO_ALERTA, TIPOS_ALERTA, urlAlertas, type FiltrosAlertas } from "@/src/lib/regras/alertas";
import { BotaoFaixa, FaixaBotoes } from "../_componentes/faixa-botoes";
import { estiloInput } from "../_componentes/ui";

const ROTULO_AGRUPAR: Record<FiltrosAlertas["agrupar"], string> = { nenhum: "Nenhum", tipo: "Tipo", conta: "Conexão", data: "Data" };

type Conta = { id: string; nome: string };

/** Barra "Filtros" de `/alertas`: "Tipo" e "Agrupar por" como botões segmentados (caixa
 *  alta, com rolagem lateral); Conta e o intervalo de datas continuam select/input, aplicados ao trocar (sem
 *  botão "Aplicar"), como os outros filtros do painel. Mesmos parâmetros de URL de antes. */
export function FiltrosAlertasBarra({
  filtros,
  contas,
  verContas = true,
}: {
  filtros: FiltrosAlertas;
  contas: Conta[];
  /** Esconde o filtro "Conta" pra quem não tem "ver" em Contas. */
  verContas?: boolean;
}) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosAlertas>) => router.push(urlAlertas(filtros, mudar), { scroll: false });

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-vg-text">Filtros</h2>

      <div className="space-y-1.5">
        <span className="block text-xs text-vg-text-3">Tipo</span>
        <div className="overflow-x-auto">
          <FaixaBotoes>
            <BotaoFaixa ativo={!filtros.tipo} onClick={() => ir({ tipo: "" })}>
              TODOS
            </BotaoFaixa>
            {TIPOS_ALERTA.map((t) => (
              <BotaoFaixa key={t} ativo={filtros.tipo === t} onClick={() => ir({ tipo: t })}>
                {INFO_ALERTA[t].rotulo.toUpperCase()}
              </BotaoFaixa>
            ))}
          </FaixaBotoes>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {verContas && (
          <div className="relative">
            <select
              value={filtros.conta}
              onChange={(e) => ir({ conta: e.target.value })}
              aria-label="Conexão"
              className="w-auto min-w-40 rounded border border-vg-line-2 bg-transparent px-3 pb-2 pt-5 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent"
            >
              <option value="">Todas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute left-3 top-1.5 text-[11px] text-vg-text-2">Conexão</span>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Data de início</span>
          <input type="date" value={filtros.inicio ?? ""} onChange={(e) => ir({ inicio: e.target.value || null })} className={`${estiloInput} w-auto`} />
        </label>

        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Data de fim</span>
          <input type="date" value={filtros.fim ?? ""} onChange={(e) => ir({ fim: e.target.value || null })} className={`${estiloInput} w-auto`} />
        </label>

        <div className="flex items-center gap-2 text-sm text-vg-text">
          <span>Agrupar por</span>
          <div className="overflow-x-auto">
            <FaixaBotoes>
              {AGRUPAR_VALORES.map((a) => (
                <BotaoFaixa key={a} ativo={filtros.agrupar === a} onClick={() => ir({ agrupar: a })}>
                  {ROTULO_AGRUPAR[a].toUpperCase()}
                </BotaoFaixa>
              ))}
            </FaixaBotoes>
          </div>
        </div>
      </div>
    </div>
  );
}
