"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { criarGrupoAgora, tentarDeNovo } from "@/app/(painel)/campanhas/[id]/grupos/actions";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { Icone } from "../../_componentes/icone";
import { Botao, estiloInput, Selo, Tabela, Vazio, type CorSelo } from "../../_componentes/ui";

export type CampanhaCriadora = { id: string; nome: string };
export type AcaoCriarGrupo = { id: string; created_at: string; status: "fila" | "processando" | "ok" | "erro"; erro: string | null; campanhaId: string; campanhaNome: string };

const SITUACAO: Record<AcaoCriarGrupo["status"], { rotulo: string; cor: CorSelo }> = {
  fila: { rotulo: "Na fila", cor: "neutro" },
  processando: { rotulo: "Processando", cor: "aviso" },
  ok: { rotulo: "Feito", cor: "ok" },
  erro: { rotulo: "Erro", cor: "erro" },
};

/** Aba "Criação de grupos" do detalhe da conta: as linhas de `acoes` (tipo `criar_grupo`) das campanhas
 *  em que esta conta é a criadora (`campanhas.conexao_criadora_id`) — é assim que a fila de criação registra
 *  qual conta fica responsável, não há `conexao_id` direto em `acoes` pra esse tipo. "Criar" abre o seletor de
 *  campanha (só as que esta conta cria) e usa a mesma `criarGrupoAgora` da aba Grupos da campanha. */
export function CriacaoDeGruposConta({ acoes, campanhas, podeEditar }: { acoes: AcaoCriarGrupo[]; campanhas: CampanhaCriadora[]; podeEditar: boolean }) {
  const router = useRouter();
  const [campanhaEscolhida, setCampanhaEscolhida] = useState(campanhas[0]?.id ?? "");
  const [criando, setCriando] = useState(false);
  const [tentando, setTentando] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  async function criar() {
    if (!campanhaEscolhida) return;
    if (!window.confirm("Criar um grupo novo agora nesta campanha?")) return;
    setCriando(true);
    setMsg(null);
    const r = await criarGrupoAgora(campanhaEscolhida);
    setCriando(false);
    if (r.erro) {
      setMsg({ texto: r.erro, erro: true });
      return;
    }
    setMsg({ texto: "Grupo entrou na fila de criação (até 1 min).", erro: false });
    router.refresh();
  }

  async function tentarDeNovoAqui(acaoId: string, campanhaId: string) {
    setTentando(acaoId);
    setMsg(null);
    try {
      await tentarDeNovo(acaoId, campanhaId);
      router.refresh();
    } catch (e) {
      // tentarDeNovo lança (não devolve { erro }) — sem o catch, um erro aqui (ex.: sem permissão) quebrava a
      // tela em vez de mostrar a mensagem, idêntico ao resto da aba.
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível tentar de novo.", erro: true });
    } finally {
      setTentando(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium">Criação automatica de grupos</h2>
        {podeEditar && campanhas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <select className={`${estiloInput} max-w-xs`} value={campanhaEscolhida} onChange={(e) => setCampanhaEscolhida(e.target.value)} aria-label="Campanha">
              {campanhas.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
            <Botao variante="secundario" icone={<Icone nome="add_circle" tamanho={18} />} onClick={criar} disabled={criando}>
              {criando ? "Criando…" : "Criar"}
            </Botao>
          </div>
        )}
      </div>
      {podeEditar && campanhas.length === 0 && (
        <p className="text-sm text-vg-muted">Esta conexão não cria grupos em nenhuma campanha ativa.</p>
      )}
      {msg && <p role="status" className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}

      {acoes.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <Tabela colunas={["Campanha", "Situação", "Quando", ""]}>
          {acoes.map((a) => {
            const s = SITUACAO[a.status];
            return (
              <tr key={a.id}>
                <td className="px-3 py-2.5 font-medium">{a.campanhaNome}</td>
                <td className="px-3 py-2.5">
                  <Selo cor={s.cor}>{s.rotulo}</Selo>
                  {a.erro && <p className="mt-1 max-w-xs truncate text-xs text-vg-erro" title={a.erro}>{a.erro}</p>}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{dataHoraCompleta(a.created_at)}</td>
                <td className="px-3 py-2.5">
                  {podeEditar && a.status === "erro" && (
                    <button
                      type="button"
                      onClick={() => tentarDeNovoAqui(a.id, a.campanhaId)}
                      disabled={tentando === a.id}
                      className="inline-flex items-center gap-1 text-xs font-medium text-vg-accent transition-colors hover:text-vg-accent-3"
                    >
                      <Icone nome="replay" tamanho={14} /> Tentar de novo
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Tabela>
      )}
    </div>
  );
}
