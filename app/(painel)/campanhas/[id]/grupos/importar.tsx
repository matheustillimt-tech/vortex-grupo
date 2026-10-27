"use client";
import { useEffect, useState } from "react";
import { estiloInput, Vazio } from "../../../_componentes/ui";
import { Icone } from "../../../_componentes/icone";
import { mensagemSemImportaveis } from "@/src/lib/regras/importar-grupos";
import { listarImportaveis, listarGruposAtivosDaCampanha, type GrupoDeOutraCampanha, type GrupoImportavel } from "./actions";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Passo "Grupos" do assistente "Importar grupos", quando a origem é "Conta": grupos em que algum número
 * da campanha é admin (`listarImportaveis`, o que já existia antes da página de 3 passos). Busca por nome ou
 * conta; marcados ficam no estado do assistente (`marcados`/`aoMudar`), confirmados só no passo "Confirmar".
 */
export function PassoGruposDeConta({ campanhaId, marcados, aoMudar }: {
  campanhaId: string;
  marcados: Set<string>;
  aoMudar: (grupos: GrupoImportavel[], marcados: Set<string>) => void;
}) {
  const [grupos, setGrupos] = useState<GrupoImportavel[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const r = await listarImportaveis(campanhaId);
      setGrupos(r.grupos ?? []);
      setErro(r.erro ?? null);
      setAviso(r.aviso ?? null);
      aoMudar(r.grupos ?? [], new Set());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Carrega uma vez ao entrar neste passo.

  if (carregando && !grupos) return <p className="text-sm text-vg-muted">Procurando grupos…</p>;
  if (erro) return <p role="alert" className="text-sm text-vg-erro">{erro}</p>;
  if (!grupos) return null;

  const termo = semAcento(busca.trim());
  const filtrados = termo ? grupos.filter((g) => semAcento(g.nome).includes(termo) || semAcento(g.conexaoNome).includes(termo)) : grupos;

  return (
    <div className="space-y-3">
      <label className="relative block w-full max-w-sm">
        <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo ou conexão" aria-label="Buscar grupo" className={`${estiloInput} pl-9`} />
      </label>
      {filtrados.length === 0 ? (
        <Vazio texto={grupos.length ? "Nenhum grupo encontrado." : aviso ?? mensagemSemImportaveis(0, 0)} compacto />
      ) : (
        <ul className="space-y-1.5">
          {filtrados.map((g) => (
            <li key={g.groupId}>
              <label className="flex items-center gap-2 rounded-lg border border-vg-line px-3 py-2 text-sm hover:border-vg-line-2">
                <input
                  type="checkbox"
                  checked={marcados.has(g.groupId)}
                  onChange={(e) => {
                    const s = new Set(marcados);
                    if (e.target.checked) s.add(g.groupId);
                    else s.delete(g.groupId);
                    aoMudar(grupos, s);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{g.nome}</span>
                  <span className="block text-xs text-vg-text-2">{g.participantes} pessoas · {g.conexaoNome}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Passo "Grupos" do assistente, quando a origem é "Campanha": grupos ATIVOS da campanha escolhida no passo
 * "Onde" (`listarGruposAtivosDaCampanha`), pra escolher quais mover com `moverGrupos`.
 */
export function PassoGruposDeCampanha({ campanhaOrigemId, marcados, aoMudar }: {
  campanhaOrigemId: string;
  marcados: Set<string>;
  aoMudar: (grupos: GrupoDeOutraCampanha[], marcados: Set<string>) => void;
}) {
  const [grupos, setGrupos] = useState<GrupoDeOutraCampanha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    setGrupos(null);
    setErro(null);
    listarGruposAtivosDaCampanha(campanhaOrigemId).then(
      (r) => {
        setGrupos(r.grupos ?? []);
        setErro(r.erro ?? null);
        aoMudar(r.grupos ?? [], new Set());
      },
      () => setErro("Não foi possível carregar os grupos desta campanha."),
    );
  }, [campanhaOrigemId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro) return <p role="alert" className="text-sm text-vg-erro">{erro}</p>;
  if (!grupos) return <p className="text-sm text-vg-muted">Carregando grupos…</p>;

  const termo = semAcento(busca.trim());
  const filtrados = termo ? grupos.filter((g) => semAcento(g.nome).includes(termo)) : grupos;

  return (
    <div className="space-y-3">
      <label className="relative block w-full max-w-sm">
        <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
        <input type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar grupo" aria-label="Buscar grupo" className={`${estiloInput} pl-9`} />
      </label>
      {filtrados.length === 0 ? (
        <Vazio texto={grupos.length ? "Nenhum grupo encontrado." : "Essa campanha não tem grupos ativos."} compacto />
      ) : (
        <ul className="space-y-1.5">
          {filtrados.map((g) => (
            <li key={g.id}>
              <label className="flex items-center gap-2 rounded-lg border border-vg-line px-3 py-2 text-sm hover:border-vg-line-2">
                <input
                  type="checkbox"
                  checked={marcados.has(g.id)}
                  onChange={(e) => {
                    const s = new Set(marcados);
                    if (e.target.checked) s.add(g.id);
                    else s.delete(g.id);
                    aoMudar(grupos, s);
                  }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">#{g.numero} {g.nome}</span>
                  <span className="block text-xs text-vg-text-2">{g.participantes} pessoas</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
