"use client";
import { useState } from "react";
import { conteudoInicial, ROTULO_TIPO, TIPOS_MASSA, type TipoMassa } from "@/src/lib/regras/conteudo";
import { ConteudoEditor, type Valor } from "../../../_componentes/conteudo-editor";
import { EscolherModelo, type ModeloLinha } from "../../../_componentes/escolher-modelo";
import { Botao, Campo, estiloInput } from "../../../_componentes/ui";
import { criarAcaoEmMassa, moverGrupos } from "./actions";

type Acao = TipoMassa | "mover";

/**
 * Formulário das ações em lote (janela "Alterar grupos em lote"). Age nos grupos marcados ou, sem marcados, em todos
 * os ativos (`ativos`): nas ações do WhatsApp isso vira `grupos: null` (ativos na hora de executar).
 */
export function FormularioAcaoEmMassa({ campanhaId, marcados, ativos, campanhas, telefones, modelos, aoConcluir }: {
  campanhaId: string;
  marcados: string[];
  /** Ids dos grupos ativos da campanha (para "mover" sem marcados). */
  ativos: string[];
  campanhas: { id: string; nome: string }[];
  telefones: { nome: string; telefone: string }[];
  modelos: ModeloLinha[];
  aoConcluir: (mensagem: string) => void;
}) {
  const [acao, setAcao] = useState<Acao>("nome");
  const [conteudo, setConteudo] = useState<Valor>(conteudoInicial("nome") as Valor);
  const [destino, setDestino] = useState("");
  const [agendar, setAgendar] = useState(false);
  const [quando, setQuando] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const soMarcados = marcados.length > 0;
  const alvoTexto = soMarcados ? `Vale para os ${marcados.length} grupo(s) marcado(s).` : `Nenhum grupo marcado: vale para todos os ${ativos.length} grupo(s) ativo(s).`;

  async function executar() {
    if (acao === "mover" && !soMarcados && destino) {
      const nome = campanhas.find((c) => c.id === destino)?.nome ?? "a outra campanha";
      if (!window.confirm(`Mover todos os ${ativos.length} grupo(s) ativo(s) para ${nome}?`)) return;
    }
    setOcupado(true);
    setErro(null);
    try {
      const r = acao === "mover"
        ? await moverGrupos(campanhaId, soMarcados ? marcados : null, destino)
        : await criarAcaoEmMassa(campanhaId, { tipo: acao, conteudo, grupos: soMarcados ? marcados : null, quando: agendar ? quando : "agora" });
      if (r.erro) return setErro(r.erro);
      aoConcluir(acao === "mover" ? "Grupos movidos." : agendar ? "Ação agendada." : "Começa em até 1 minuto.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-vg-line px-3 py-2 text-[13px] text-vg-text-2">{alvoTexto}</p>
      <div className="flex flex-wrap items-end gap-3">
        <Campo rotulo="Ação">
          <select className={estiloInput} value={acao} onChange={(e) => { const a = e.target.value as Acao; setAcao(a); if (a !== "mover") setConteudo(conteudoInicial(a) as Valor); }}>
            {TIPOS_MASSA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            <option value="mover">Mover para outra campanha</option>
          </select>
        </Campo>
        {acao !== "mover" && <EscolherModelo tipo={acao} modelos={modelos} aoEscolher={setConteudo} />}
      </div>
      {acao === "mover" ? (
        <Campo rotulo="Mover para a campanha">
          <select className={estiloInput} value={destino} onChange={(e) => setDestino(e.target.value)}>
            <option value="">Escolha…</option>
            {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </Campo>
      ) : (
        <>
          <ConteudoEditor tipo={acao} valor={conteudo} onChange={setConteudo} pasta={campanhaId} telefones={telefones} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agendar} onChange={(e) => setAgendar(e.target.checked)} /> Agendar</label>
          {agendar && <Campo rotulo="Data e hora (Brasília)"><input type="datetime-local" className={estiloInput} value={quando} onChange={(e) => setQuando(e.target.value)} /></Campo>}
        </>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Botao disabled={ocupado} onClick={executar}>{acao === "mover" ? "Mover agora" : agendar ? "Agendar ação" : "Executar agora"}</Botao>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      </div>
    </div>
  );
}
