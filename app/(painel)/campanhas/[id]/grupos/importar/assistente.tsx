"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icone } from "../../../../_componentes/icone";
import { Passos } from "../../../../_componentes/passos";
import { DefinirTrilha } from "../../../../_componentes/trilha";
import { estiloBotao, estiloCartao, estiloInput } from "../../../../_componentes/ui";
import { importarGrupos, moverGrupos, seguirPadraoNosGrupos, type GrupoDeOutraCampanha, type GrupoImportavel } from "../actions";
import { PassoGruposDeCampanha, PassoGruposDeConta } from "../importar";

type Origem = "conta" | "campanha";
type Passo = "onde" | "grupos" | "confirmar";
const ORDEM: Passo[] = ["onde", "grupos", "confirmar"];
const PASSOS: { rotulo: string; icone: string }[] = [
  { rotulo: "Importar de", icone: "compare_arrows" },
  { rotulo: "Grupos", icone: "check_box" },
  { rotulo: "Confirmar", icone: "check" },
];

/** Cartão de origem ("Conta"/"Campanha"): sem a descrição visível (vira o `title`). */
function CartaoOrigem({ icone, titulo, descricao, marcado, onClick }: { icone: string; titulo: string; descricao: string; marcado: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      title={descricao}
      onClick={onClick}
      className={`flex flex-1 items-center gap-3 rounded-xl border px-4 py-4 text-left transition-colors ${marcado ? "border-vg-accent bg-vg-accent/10" : "border-vg-line hover:border-vg-line-2 hover:bg-white/[0.03]"}`}
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-full ${marcado ? "bg-vg-primario text-white" : "bg-[#2f3a33] text-vg-text-2"}`}>
        <Icone nome={icone} tamanho={22} />
      </span>
      <span className="min-w-0 text-[15px] font-semibold">{titulo}</span>
      <Icone nome={marcado ? "radio_button_checked" : "radio_button_unchecked"} className={marcado ? "ml-auto text-vg-accent" : "ml-auto text-vg-text-3"} />
    </button>
  );
}

/**
 * Assistente "Importar grupos": 3 passos "Onde" → "Grupos" → "Confirmar". De "Conta",
 * importa grupos em que uma conta da campanha é admin (`importarGrupos`, como já existia); de "Campanha", move
 * grupos ativos de outra campanha para esta (`moverGrupos`).
 */
export function AssistenteImportar({ campanhaId, campanhas, exemploNome }: { campanhaId: string; campanhas: { id: string; nome: string }[]; exemploNome: string | null }) {
  const router = useRouter();
  const [passo, setPasso] = useState<Passo>("onde");
  const [origem, setOrigem] = useState<Origem | null>(null);
  const [campanhaOrigemId, setCampanhaOrigemId] = useState("");
  const [gruposConta, setGruposConta] = useState<GrupoImportavel[]>([]);
  const [marcadosConta, setMarcadosConta] = useState<Set<string>>(new Set());
  const [gruposCampanha, setGruposCampanha] = useState<GrupoDeOutraCampanha[]>([]);
  const [marcadosCampanha, setMarcadosCampanha] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // Os grupos que chegam já ganham o nome e a numeração desta campanha.
  const [seguirPadrao, setSeguirPadrao] = useState(exemploNome !== null);
  const tituloRef = useRef<HTMLHeadingElement>(null);

  const atual = ORDEM.indexOf(passo);
  const marcados = origem === "campanha" ? marcadosCampanha : marcadosConta;
  const nomeOrigemCampanha = campanhas.find((c) => c.id === campanhaOrigemId)?.nome ?? "";

  function pendencia(): string | null {
    if (passo === "onde") {
      if (!origem) return "Escolha de onde importar.";
      if (origem === "campanha" && !campanhaOrigemId) return "Escolha a campanha de origem.";
      return null;
    }
    if (passo === "grupos") return marcados.size ? null : "Marque pelo menos um grupo.";
    return null;
  }

  function ir(p: Passo) {
    setErro(null);
    setPasso(p);
    requestAnimationFrame(() => tituloRef.current?.focus());
  }

  async function confirmar() {
    setErro(null);
    setEnviando(true);
    try {
      const r =
        origem === "campanha"
          ? await moverGrupos(campanhaOrigemId, [...marcadosCampanha], campanhaId)
          : await importarGrupos(campanhaId, gruposConta.filter((g) => marcadosConta.has(g.groupId)).map((g) => ({ conexaoId: g.conexaoId, groupId: g.groupId })), seguirPadrao);
      if (r.erro) return setErro(r.erro);
      if (origem === "campanha" && seguirPadrao) {
        const p = await seguirPadraoNosGrupos(campanhaId, [...marcadosCampanha]);
        if (p.erro) return setErro(p.erro);
      }
      router.push(`/campanhas/${campanhaId}/grupos`);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-[900px] space-y-6 px-4 py-6 md:px-6">
      <DefinirTrilha itens={[{ rotulo: "Campanhas", href: "/campanhas" }, { rotulo: "Grupos", href: `/campanhas/${campanhaId}/grupos` }, { rotulo: "Importar" }]} />

      <Passos passos={PASSOS} atual={atual} />

      <section className={`${estiloCartao} space-y-4 p-4 md:p-6`}>
        <h2 ref={tituloRef} tabIndex={-1} className="text-lg font-medium outline-none">{PASSOS[atual].rotulo}</h2>

        {passo === "onde" && (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <CartaoOrigem
                icone="qr_code_2"
                titulo="Conexão"
                descricao="Grupos em que uma conexão desta campanha já é admin no WhatsApp."
                marcado={origem === "conta"}
                onClick={() => setOrigem("conta")}
              />
              <CartaoOrigem
                icone="campaign"
                titulo="Campanha"
                descricao="Grupos ativos de outra campanha, movidos para esta."
                marcado={origem === "campanha"}
                onClick={() => setOrigem("campanha")}
              />
            </div>
            {origem === "campanha" && (
              <label className="block max-w-sm space-y-1.5">
                <span className="text-[13.3px] text-[#e3e9e5]">Campanha de origem</span>
                <select className={estiloInput} value={campanhaOrigemId} onChange={(e) => setCampanhaOrigemId(e.target.value)}>
                  <option value="">Escolha…</option>
                  {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
            )}
          </div>
        )}

        {passo === "grupos" &&
          (origem === "campanha" ? (
            <PassoGruposDeCampanha campanhaOrigemId={campanhaOrigemId} marcados={marcadosCampanha} aoMudar={(gs, m) => { setGruposCampanha(gs); setMarcadosCampanha(m); }} />
          ) : (
            <PassoGruposDeConta campanhaId={campanhaId} marcados={marcadosConta} aoMudar={(gs, m) => { setGruposConta(gs); setMarcadosConta(m); }} />
          ))}

        {passo === "confirmar" && (
          <div className="space-y-3 text-sm">
            <p>
              {marcados.size} grupo(s) de {origem === "campanha" ? `"${nomeOrigemCampanha}"` : "conexões desta campanha"}{" "}
              {origem === "campanha" ? "serão movidos para esta campanha." : "serão importados para esta campanha."}
            </p>
            <ul className="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-vg-line p-3">
              {origem === "campanha"
                ? gruposCampanha.filter((g) => marcadosCampanha.has(g.id)).map((g) => <li key={g.id}>#{g.numero} {g.nome}</li>)
                : gruposConta.filter((g) => marcadosConta.has(g.groupId)).map((g) => <li key={g.groupId}>{g.nome} · {g.conexaoNome}</li>)}
            </ul>
            {exemploNome && (
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-vg-line p-3">
                <input type="checkbox" className="mt-0.5 size-4 accent-vg-accent" checked={seguirPadrao} onChange={(e) => setSeguirPadrao(e.target.checked)} />
                <span className="space-y-0.5">
                  <span className="block font-medium">Seguir o padrão de nome e numeração da campanha</span>
                  <span className="block text-vg-text-2">Os grupos são renomeados com o nome desta campanha e o número de cada um, ex.: {exemploNome}</span>
                </span>
              </label>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-3">
          {passo === "confirmar" ? (
            <button type="button" className={estiloBotao()} disabled={enviando} onClick={confirmar}>
              {enviando ? "Importando…" : `Importar ${marcados.size} grupo(s)`}
              <Icone nome="check" tamanho={18} />
            </button>
          ) : (
            <button type="button" className={estiloBotao()} disabled={!!pendencia()} onClick={() => ir(ORDEM[atual + 1])}>
              PRÓXIMA
              <Icone nome="east" tamanho={18} />
            </button>
          )}
        </div>
      </section>

      {erro && <p role="alert" className="rounded-lg border border-vg-erro/40 bg-vg-erro/10 px-3 py-2 text-sm text-vg-erro">{erro}</p>}

      {atual > 0 && (
        <button
          type="button"
          disabled={enviando}
          className="inline-flex items-center gap-1 rounded-md px-1 text-sm text-vg-text-2 underline-offset-4 outline-none hover:text-vg-text hover:underline focus-visible:ring-2 focus-visible:ring-vg-accent/50 disabled:opacity-50"
          onClick={() => ir(ORDEM[atual - 1])}
        >
          <Icone nome="west" tamanho={16} />
          Voltar
        </button>
      )}
    </div>
  );
}
