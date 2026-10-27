"use client";
import { useState } from "react";
import {
  OPCOES_FIXAR,
  OPCOES_TEMPORARIAS,
  PRESETS_INTERVALO,
  type IntervaloGrupos,
  type OpcaoFixar,
  type OpcaoTemporarias,
  type OpcoesEnvio,
  type PresetIntervaloGrupos,
} from "@/src/lib/regras/conteudo-v2";
import { Icone } from "../icone";
import { estiloInput } from "../ui";
import { SegmentoRadio } from "./segmento-radio";

const ROTULO_TEMPORARIAS: Record<OpcaoTemporarias, string> = { nao: "NÃO", "24h": "24H", "7d": "7D", "90d": "90D" };
const ROTULO_FIXAR: Record<OpcaoFixar, string> = { nao: "NÃO", "24h": "24H", "7d": "7D", "30d": "30D" };
const ROTULO_PRESET: Record<PresetIntervaloGrupos, string> = { nao: "NÃO", rapida: "RÁPIDA", normal: "NORMAL", lenta: "LENTA" };
const ROTULO_SIMNAO = { nao: "NÃO", sim: "SIM" } as const;

export type ChaveOpcao = keyof OpcoesEnvio;
export const TODAS_OPCOES: ChaveOpcao[] = ["mencionar_todos", "temporarias", "fixar", "intervalo_grupos", "intervalo_mensagens"];

/** Coluna direita do editor de mensagens: botões segmentados pras opções de envio. `visiveis` restringe
 *  quais aparecem (ex.: modelos escondem "mencionar_todos" e "fixar"); `rotuloIntervaloGrupos` troca o nome em
 *  automação ("entre destinatários" em vez de "entre grupos"). */
export function OpcoesEnvioColuna({ valor, onChange, visiveis = TODAS_OPCOES, rotuloIntervaloGrupos = "Intervalo de envio entre grupos" }: {
  valor: OpcoesEnvio;
  onChange: (v: OpcoesEnvio) => void;
  visiveis?: ChaveOpcao[];
  rotuloIntervaloGrupos?: string;
}) {
  const mostrar = (k: ChaveOpcao) => visiveis.includes(k);
  const set = <K extends keyof OpcoesEnvio>(k: K, v: OpcoesEnvio[K]) => onChange({ ...valor, [k]: v });

  const presetAtual: PresetIntervaloGrupos = typeof valor.intervalo_grupos === "string" ? valor.intervalo_grupos : "nao";
  const [customSegundos, setCustomSegundos] = useState(typeof valor.intervalo_grupos === "object" ? valor.intervalo_grupos.segundos : 10);
  const custom = typeof valor.intervalo_grupos === "object";

  function escolherIntervalo(opcao: PresetIntervaloGrupos | "custom") {
    const novo: IntervaloGrupos = opcao === "custom" ? { segundos: customSegundos } : opcao;
    set("intervalo_grupos", novo);
  }

  return (
    <div className="space-y-4">
      {mostrar("mencionar_todos") && (
        <SegmentoRadio
          legenda="Marcar todos os participantes"
          info={
            <span title="Menciona todos sem mostrar a lista de nomes" className="inline-flex">
              <Icone nome="info_outline" tamanho={14} className="text-vg-text-3" />
            </span>
          }
          opcoes={[{ valor: "nao" as const, rotulo: ROTULO_SIMNAO.nao }, { valor: "sim" as const, rotulo: ROTULO_SIMNAO.sim }]}
          valor={valor.mencionar_todos ? "sim" : "nao"}
          aoMudar={(v) => set("mencionar_todos", v === "sim")}
          larguraTotal
        />
      )}
      {mostrar("temporarias") && (
        <SegmentoRadio
          legenda="Mensagens temporarias"
          opcoes={OPCOES_TEMPORARIAS.map((o) => ({ valor: o, rotulo: ROTULO_TEMPORARIAS[o] }))}
          valor={valor.temporarias}
          aoMudar={(v) => set("temporarias", v)}
          larguraTotal
        />
      )}
      {mostrar("fixar") && (
        <SegmentoRadio
          legenda="Fixar mensagem"
          opcoes={OPCOES_FIXAR.map((o) => ({ valor: o, rotulo: ROTULO_FIXAR[o] }))}
          valor={valor.fixar}
          aoMudar={(v) => set("fixar", v)}
          larguraTotal
        />
      )}
      {mostrar("intervalo_grupos") && (
        <div className="space-y-1.5">
          <SegmentoRadio
            legenda={rotuloIntervaloGrupos}
            opcoes={[...PRESETS_INTERVALO.map((o) => ({ valor: o, rotulo: ROTULO_PRESET[o] })), { valor: "custom" as const, rotulo: "CUSTOM" }]}
            valor={custom ? "custom" : presetAtual}
            aoMudar={(v) => escolherIntervalo(v)}
            larguraTotal
          />
          {custom && (
            <label className="flex items-center gap-2 text-[12.5px] text-vg-text-2">
              Segundos
              <input
                type="number"
                min={1}
                max={600}
                className={`${estiloInput} w-24`}
                value={customSegundos}
                onChange={(e) => {
                  const s = Number(e.target.value);
                  setCustomSegundos(s);
                  set("intervalo_grupos", { segundos: s });
                }}
              />
            </label>
          )}
        </div>
      )}
      {mostrar("intervalo_mensagens") && (
        <SegmentoRadio
          legenda="Intervalo de envio entre mensagens"
          opcoes={[{ valor: "nao" as const, rotulo: ROTULO_SIMNAO.nao }, { valor: "sim" as const, rotulo: ROTULO_SIMNAO.sim }]}
          valor={valor.intervalo_mensagens ? "sim" : "nao"}
          aoMudar={(v) => set("intervalo_mensagens", v === "sim")}
          larguraTotal
        />
      )}
    </div>
  );
}
