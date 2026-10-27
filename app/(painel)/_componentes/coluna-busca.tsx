"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { aplicarOrdem } from "@/src/lib/regras/inicio";
import { CampoBusca } from "./campo-busca";
import { Icone } from "./icone";

/** Remove acentos e baixa a caixa, pra comparar sem diferenciar maiúsculas/acentos. */
function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Lê a ordem salva no navegador (Etapa 3N: por pessoa, em `localStorage`). Sem acesso (modo privado,
 *  bloqueio do navegador) ou conteúdo inválido, volta `[]` — cai na ordem padrão (`aplicarOrdem` já cobre isso). */
function lerOrdemSalva(chave: string): string[] {
  try {
    const bruto = localStorage.getItem(chave);
    const v = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function salvarOrdemLocal(chave: string, ids: string[]) {
  try {
    localStorage.setItem(chave, JSON.stringify(ids));
  } catch {
    // Sem localStorage: a ordem não persiste entre visitas, mas a tela continua funcionando (ordem padrão).
  }
}

export type ItemColunaBusca = { chave: string; busca: string; conteudo: React.ReactNode };

/** Campo "Buscar" que filtra uma lista no navegador. Recebe os itens já prontos como dados (texto de busca +
 *  conteúdo já renderizado) — nada de função, pra poder vir de um componente de servidor. Mesmo visual de
 *  campo contornado com rótulo flutuante "Buscar" do `CampoBusca`, sem lupa (Início):
 *  o filtro em memória não muda.
 *
 *  Com `chaveOrdem` (Etapa 3N: Início — contas, campanhas e webhooks), cada item ganha uma alça
 *  `drag_indicator` à esquerda: arrastar solta na posição; com o foco na alça, ↑/↓ move um lugar. A ordem é
 *  salva por pessoa no navegador (`aplicarOrdem` sobre `localStorage`) e só se aplica à lista sem busca — com um
 *  termo digitado a alça fica desligada (não faz sentido arrastar dentro de um recorte). */
export function ColunaBusca({ itens, rotulo, vazio, chaveOrdem }: { itens: ItemColunaBusca[]; rotulo: string; vazio: React.ReactNode; chaveOrdem?: string }) {
  const [termo, setTermo] = useState("");
  const idsAtuais = useMemo(() => itens.map((i) => i.chave), [itens]);
  const idsChave = idsAtuais.join(",");
  const [ordem, setOrdem] = useState<string[]>(idsAtuais);
  const carregou = useRef(false);

  // Lê a ordem salva uma vez por `chaveOrdem` (montagem do componente).
  useEffect(() => {
    if (!chaveOrdem) return;
    setOrdem(aplicarOrdem(idsAtuais, lerOrdemSalva(chaveOrdem)));
    carregou.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveOrdem]);
  // Lista do servidor mudou (item novo, removido): reaplica sobre a ordem já em memória, sem reler o localStorage.
  useEffect(() => {
    if (!chaveOrdem || !carregou.current) return;
    setOrdem((o) => aplicarOrdem(idsAtuais, o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsChave]);

  const porChave = useMemo(() => new Map(itens.map((i) => [i.chave, i])), [itens]);
  const ordenados = chaveOrdem ? ordem.map((c) => porChave.get(c)).filter((i): i is ItemColunaBusca => !!i) : itens;

  const busca = normalizar(termo.trim());
  const filtrados = busca ? ordenados.filter((i) => normalizar(i.busca).includes(busca)) : ordenados;
  const arrastavel = !!chaveOrdem && !busca;

  const arrastando = useRef<string | null>(null);
  const focarApos = useRef<string | null>(null);
  const alcas = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!focarApos.current) return;
    alcas.current[focarApos.current]?.focus();
    focarApos.current = null;
  }, [ordem]);

  function mover(chave: string, destino: number) {
    const i = ordem.indexOf(chave);
    if (i < 0) return;
    const j = Math.max(0, Math.min(ordem.length - 1, destino));
    if (i === j) return;
    const nova = [...ordem];
    nova.splice(i, 1);
    nova.splice(j, 0, chave);
    setOrdem(nova);
    if (chaveOrdem) salvarOrdemLocal(chaveOrdem, nova);
    focarApos.current = chave;
  }

  function soltarEm(chaveDestino: string) {
    const origem = arrastando.current;
    arrastando.current = null;
    if (!origem || origem === chaveDestino) return;
    mover(origem, ordem.indexOf(chaveDestino));
  }

  return (
    <>
      <CampoBusca icone="nenhum" nome="busca" rotulo={rotulo} valor={termo} aoMudar={setTermo} />
      {filtrados.length === 0 ? (
        vazio
      ) : (
        <ul className="space-y-2">
          {filtrados.map((i) => (
            <li
              key={i.chave}
              draggable={arrastavel}
              onDragStart={() => { if (arrastavel) arrastando.current = i.chave; }}
              onDragOver={(e) => arrastavel && e.preventDefault()}
              onDrop={(e) => {
                if (!arrastavel) return;
                e.preventDefault();
                soltarEm(i.chave);
              }}
              className="flex items-start gap-1"
            >
              {chaveOrdem && (
                <button
                  type="button"
                  ref={(el) => { alcas.current[i.chave] = el; }}
                  aria-label="Reordenar"
                  title="Arrastar para reordenar"
                  disabled={!!busca}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      mover(i.chave, ordem.indexOf(i.chave) - 1);
                    } else if (e.key === "ArrowDown") {
                      e.preventDefault();
                      mover(i.chave, ordem.indexOf(i.chave) + 1);
                    }
                  }}
                  className="mt-3 grid size-6 shrink-0 cursor-grab touch-none place-items-center rounded text-vg-text-3 transition-colors hover:text-vg-text disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Icone nome="drag_indicator" tamanho={18} />
                </button>
              )}
              <div className="min-w-0 flex-1">{i.conteudo}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
