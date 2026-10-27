"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Vazio, estiloBotao } from "../_componentes/ui";
import { verificarMidiasExpiradas, type ModeloMidiaExpirada } from "./midias";

/** Botão "Mídias expirando ou expiradas": checa no servidor até 50 modelos com mídia e mostra os que não
 *  responderam, com link direto pra editar cada um. */
export function BotaoMidiasExpiradas() {
  const [aberta, setAberta] = useState(false);
  const [checado, setChecado] = useState(false);
  const [expiradas, setExpiradas] = useState<ModeloMidiaExpirada[]>([]);
  const [naoVerificadas, setNaoVerificadas] = useState<ModeloMidiaExpirada[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function abrir() {
    setAberta(true);
    setErro(null);
    setChecado(false);
    iniciar(async () => {
      try {
        const r = await verificarMidiasExpiradas();
        if ("erro" in r) {
          setErro(r.erro);
          return;
        }
        setExpiradas(r.expiradas);
        setNaoVerificadas(r.naoVerificadas);
      } catch {
        setErro("Não foi possível checar as mídias. Tente de novo.");
      } finally {
        setChecado(true);
      }
    });
  }

  return (
    <>
      <button type="button" className={estiloBotao("secundario")} onClick={abrir}>
        <Icone nome="link_off" tamanho={18} />
        Mídias expirando ou expiradas
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Mídias expirando ou expiradas">
        <div className="space-y-3">
          {ocupado && <p className="text-sm text-vg-muted">Checando os endereços das mídias…</p>}
          {!ocupado && erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
          {!ocupado && !erro && checado && expiradas.length === 0 && naoVerificadas.length === 0 && (
            <Vazio texto="Nenhuma mídia expirada por enquanto" />
          )}
          {!ocupado && !erro && expiradas.length > 0 && (
            <ul className="divide-y divide-vg-line">
              {expiradas.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0 truncate text-[13.5px]" title={m.nome}>{m.nome}</span>
                  <Link href={`/modelos/${m.id}`} className={estiloBotao("contorno")} onClick={() => setAberta(false)}>
                    Editar
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {!ocupado && !erro && naoVerificadas.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-vg-muted">Não verificado (tempo esgotado):</p>
              <ul className="divide-y divide-vg-line">
                {naoVerificadas.map((m) => (
                  <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 truncate text-[13.5px]" title={m.nome}>{m.nome}</span>
                    <Link href={`/modelos/${m.id}`} className={estiloBotao("contorno")} onClick={() => setAberta(false)}>
                      Editar
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Janela>
    </>
  );
}
