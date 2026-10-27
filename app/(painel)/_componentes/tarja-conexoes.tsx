"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { TEXTO_DIAGNOSTICO, tempoFora, type DiagnosticoQueda } from "@/src/lib/regras/queda";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Icone } from "./icone";

export type ConexaoCaida = {
  id: string;
  nome: string;
  telefone: string | null;
  caiu_em: string | null;
  diagnostico_queda: DiagnosticoQueda | null;
};

const COLUNAS = "id, nome, telefone, caiu_em, diagnostico_queda";
const INTERVALO_MS = 60_000;

/** Tarja vermelha em cima dos cartões da Início enquanto algum número estiver fora do ar. Não fecha: some sozinha
 *  quando o número volta. A lista é conferida a cada minuto. */
export function TarjaConexoes({ inicial }: { inicial: ConexaoCaida[] }) {
  const [caidas, setCaidas] = useState(inicial);
  const [agora, setAgora] = useState(() => new Date());

  useEffect(() => {
    let vivo = true;
    async function conferir() {
      try {
        const { data, error } = await dbNavegador().from("conexoes").select(COLUNAS).eq("status", "desconectado").order("nome");
        if (vivo && !error) setCaidas((data ?? []) as ConexaoCaida[]);
      } catch {
        // mantém a última lista
      }
      if (vivo) setAgora(new Date());
    }
    const t = window.setInterval(conferir, INTERVALO_MS);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);

  if (!caidas.length) return null;

  return (
    <div role="alert" className="overflow-hidden rounded-xl border border-red-400 bg-gradient-to-r from-red-700 via-red-600 to-red-700 text-white shadow-[0_6px_24px_rgba(220,38,38,0.35)]">
      {caidas.map((c) => {
        const banido = c.diagnostico_queda === "banido";
        const fora = tempoFora(c.caiu_em, agora);
        return (
          <div key={c.id} className="flex flex-col gap-2 px-4 py-2.5 md:flex-row md:items-center md:gap-4 [&+&]:border-t [&+&]:border-white/20">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <span className="relative mt-0.5 flex shrink-0">
                <span className="absolute inset-0 animate-ping rounded-full bg-white/50" />
                <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-white text-red-600">
                  <Icone nome={banido ? "block" : "wifi_off"} tamanho={18} />
                </span>
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold uppercase tracking-wide">
                  {banido ? "Número possivelmente banido" : "Número desconectado"}: {c.nome}
                  {c.telefone ? <span className="font-medium normal-case tracking-normal text-white/80"> · +{c.telefone}</span> : null}
                  {fora ? <span className="font-medium normal-case tracking-normal text-white/80"> · fora do ar {fora}</span> : null}
                </p>
                <p className="text-[13px] text-white/90">
                  Os envios e grupos desse número estão parados. {TEXTO_DIAGNOSTICO[c.diagnostico_queda ?? "indefinido"]}
                </p>
              </div>
            </div>
            <Link
              href={`/numeros/${c.id}`}
              className="inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-lg bg-white px-3.5 py-1.5 text-[13px] font-bold text-red-700 transition-colors hover:bg-red-50 md:self-auto"
            >
              <Icone nome="qr_code_2" tamanho={18} />
              {banido ? "Abrir conexão" : "Reconectar (ler QR)"}
            </Link>
          </div>
        );
      })}
    </div>
  );
}
