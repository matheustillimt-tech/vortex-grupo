"use client";
import { useState } from "react";
import type { AntispamContas } from "@/src/lib/regras/antispam";
import { telefoneLegivel } from "@/src/lib/telefone";
import { CampoBusca } from "../../_componentes/campo-busca";
import { estiloCartao } from "../../_componentes/ui";
import { salvarAntispamContas } from "../actions";

export type ContaOpcao = { id: string; nome: string; telefone: string | null };

/** Interruptor "Desativado"/"Ativado" + as contas que podem executar as remoções do anti-spam — os dois salvam
 *  sozinhos ao mudar, sempre com a mesma `salvarAntispamContas` e o estado resultante (ligado + contas
 *  escolhidas), sem botão "Salvar". Busca (em memória, nas contas já carregadas) + contador "N/N conta". */
export function FormContasAntispam({ contas, inicial, podeEditar }: { contas: ContaOpcao[]; inicial: AntispamContas; podeEditar: boolean }) {
  const [ligado, setLigado] = useState(inicial.ligado);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set(inicial.contas));
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [busca, setBusca] = useState("");

  async function salvar(novoLigado: boolean, novasEscolhidas: Set<string>, anteriorLigado: boolean, anteriorEscolhidas: Set<string>) {
    setOcupado(true);
    setMsg(null);
    try {
      // Só as contas que ainda existem (uma escolhida antes pode ter sido apagada).
      const ids = contas.map((c) => c.id).filter((id) => novasEscolhidas.has(id));
      const r = await salvarAntispamContas({ ligado: novoLigado, contas: ids });
      if (r.erro) {
        // Salvar falhou: volta o interruptor/as caixinhas pro estado de antes do clique (a tela não pode
        // mostrar uma escolha que não foi salva).
        setLigado(anteriorLigado);
        setEscolhidas(anteriorEscolhidas);
        setMsg({ texto: r.erro, erro: true });
      }
    } catch {
      setLigado(anteriorLigado);
      setEscolhidas(anteriorEscolhidas);
      setMsg({ texto: "Não foi possível salvar. Tente de novo.", erro: true });
    } finally {
      setOcupado(false);
    }
  }

  function alternarLigado() {
    const anterior = ligado;
    const novo = !ligado;
    setLigado(novo);
    void salvar(novo, escolhidas, anterior, escolhidas);
  }

  function alternarConta(id: string, sim: boolean) {
    const anterior = escolhidas;
    const s = new Set(escolhidas);
    if (sim) s.add(id);
    else s.delete(id);
    setEscolhidas(s);
    void salvar(ligado, s, ligado, anterior);
  }

  const termo = busca.trim().toLowerCase();
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo) || (c.telefone ?? "").includes(termo)) : contas;

  return (
    <div className={`${estiloCartao} space-y-4 p-4`}>
      <div className="flex items-start gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label="Antispam por Conexões Associadas"
          disabled={!podeEditar || ocupado}
          onClick={alternarLigado}
          className="mt-0.5 flex items-center gap-2 disabled:opacity-50"
        >
          <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${ligado ? "bg-vg-accent/60" : "bg-white/20"}`}>
            <span className={`absolute top-0.5 size-4 rounded-full transition-all ${ligado ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
          </span>
        </button>
        <div>
          <p className="text-sm font-medium text-vg-text">{ligado ? "Ativado" : "Desativado"}</p>
          <p className="text-sm text-vg-muted">Ao habilitar essa funcionalidade, apenas as conexões associadas poderão executar ações de antispam.</p>
          <p className="mt-1 text-xs text-vg-text-3">
            Remoções de grupos de outras conexões não são feitas: viram o alerta &quot;Anti-spam sem conexão autorizada&quot; (uma vez por grupo por dia).
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar conexões associadas" className="w-full max-w-sm" />
        <p className="text-sm text-vg-text-2">
          {filtradas.length}/{contas.length} conexão
        </p>
        <fieldset className="space-y-2" disabled={!podeEditar || ocupado}>
          <legend className="sr-only">Conexões associadas</legend>
          {filtradas.length ? (
            filtradas.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm text-vg-text">
                <input type="checkbox" checked={escolhidas.has(c.id)} onChange={(e) => alternarConta(c.id, e.target.checked)} />
                <span>{c.nome}</span>
                {c.telefone && <span className="tabular-nums text-vg-muted">{telefoneLegivel(c.telefone)}</span>}
              </label>
            ))
          ) : (
            <p className="text-sm text-vg-muted">{contas.length ? "Nenhuma conexão encontrada." : "Nenhuma conexão cadastrada."}</p>
          )}
        </fieldset>
      </div>

      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
    </div>
  );
}
