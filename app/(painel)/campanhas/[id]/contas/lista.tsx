"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MENSAGEM_NAO_REMOVE_CRIADORA } from "@/src/lib/regras/contas-associadas";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import { CampoBusca } from "../../../_componentes/campo-busca";
import { Icone } from "../../../_componentes/icone";
import { Janela } from "../../../_componentes/janela";
import { Botao, estiloBotao, estiloCartao, estiloInput, Selo, Vazio } from "../../../_componentes/ui";
import { associarConta, definirReassociarAcoes, removerConta } from "./actions";

export type ContaAssociada = { id: string; nome: string; telefone: string | null; status: string; criadora: boolean };
export type ContaDisponivel = { id: string; nome: string; telefone: string | null; status: string };

/** Botão + diálogo "Associe uma conta": escolhe, entre as contas conectadas que ainda não estão na
 *  campanha, qual associar. */
function AssociarConta({ campanhaId, disponiveis }: { campanhaId: string; disponiveis: ContaDisponivel[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [escolhida, setEscolhida] = useState(disponiveis[0]?.id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function associar(e: React.FormEvent) {
    e.preventDefault();
    if (!escolhida) return;
    setEnviando(true);
    const r = await associarConta(campanhaId, escolhida);
    setEnviando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setAberta(false);
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => { setAberta(true); setErro(null); }} className={estiloBotao("contorno")} disabled={disponiveis.length === 0}>
        Associe uma conexão
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Associar conexão">
        {disponiveis.length === 0 ? (
          <p className="text-sm text-vg-text-2">Todas as conexões conectadas já estão associadas a esta campanha.</p>
        ) : (
          <form className="grid gap-4" onSubmit={associar}>
            <label className="block space-y-1.5">
              <span className="text-[13.3px] text-[#e3e9e5]">Conexão</span>
              <select className={estiloInput} value={escolhida} onChange={(e) => setEscolhida(e.target.value)}>
                {disponiveis.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} {c.telefone ? `(${formatarTelefone(c.telefone)})` : ""}
                  </option>
                ))}
              </select>
            </label>
            {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
            <div><Botao type="submit" disabled={enviando}>Associar</Botao></div>
          </form>
        )}
      </Janela>
    </>
  );
}

/** Bloco "Configurações": interruptor "Reassociar ações automaticamente ao remover conta" + os dois
 *  parágrafos de explicação. */
function ConfiguracaoReassociar({ campanhaId, inicial, podeEditar }: { campanhaId: string; inicial: boolean; podeEditar: boolean }) {
  const [valor, setValor] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function alternar(novo: boolean) {
    setValor(novo);
    setSalvando(true);
    const r = await definirReassociarAcoes(campanhaId, novo);
    setSalvando(false);
    if (r.erro) {
      setErro(r.erro);
      setValor(!novo);
    } else {
      setErro(null);
    }
  }

  return (
    <div className={`${estiloCartao} space-y-3 p-4`}>
      <h2 className="text-[15px] font-medium">Configurações</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={valor}
          disabled={!podeEditar || salvando}
          onChange={(e) => alternar(e.target.checked)}
        />
        Reassociar ações automaticamente ao remover conexão
      </label>
      <p className="text-sm text-vg-text-2">
        Quando ativado, ao remover uma conexão associada, as ações agendadas pendentes que usavam essa conexão são redistribuídas entre as
        conexões que restarem na campanha.
      </p>
      <p className="text-sm text-vg-text-2">
        Quando desativado, as ações ficam sem conexão válida até você associar uma nova conexão e escolher manualmente quais ações devem
        usá-la.
      </p>
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
    </div>
  );
}

function CartaoConta({
  campanhaId,
  conta,
  podeEditar,
  aoRemover,
}: {
  campanhaId: string;
  conta: ContaAssociada;
  podeEditar: boolean;
  aoRemover: (id: string, mensagem: string | null) => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState(false);

  async function remover() {
    if (!confirm(`Remover "${conta.nome}" desta campanha?`)) return;
    setErro(null);
    setRemovendo(true);
    const r = await removerConta(campanhaId, conta.id);
    setRemovendo(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    aoRemover(conta.id, r.mensagem ?? null);
  }

  return (
    <div className={`${estiloCartao} space-y-2 p-4`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{conta.nome}</p>
          <p className="truncate text-sm text-vg-text-2">{conta.telefone ? formatarTelefone(conta.telefone) : "—"}</p>
        </div>
        <Selo cor={conta.status === "conectado" ? "ok" : "neutro"}>{conta.status}</Selo>
      </div>
      {conta.criadora ? <Selo cor="destaque">cria os grupos</Selo> : <Selo cor="neutro">reserva</Selo>}
      <p className="text-xs text-vg-text-3">
        {conta.status === "conectado"
          ? conta.criadora
            ? "Cria os grupos novos e manda as mensagens dos grupos dela."
            : "Se outra conexão cair, esta assume os grupos em que for admin e cria os grupos novos."
          : conta.criadora
            ? "Fora do ar: as conexões reserva conectadas assumem os grupos em que são admin e criam os grupos novos. Abra a conexão e clique em PAREAR pra ler o QR de novo."
            : "Fora do ar: não serve de reserva até ser pareada de novo (PAREAR, com o QR)."}
      </p>
      {conta.status !== "conectado" && (
        <Link href={`/numeros/${conta.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-vg-accent hover:underline">
          <Icone nome="qr_code_2" tamanho={14} /> Reconectar
        </Link>
      )}
      {podeEditar && (
        conta.criadora ? (
          <p className="text-xs text-vg-text-3">
            Esta conexão cria os grupos da campanha.{" "}
            <Link href={`/campanhas/${campanhaId}/configuracoes`} className="text-vg-accent hover:underline">
              Troque o número que cria os grupos
            </Link>{" "}
            antes de removê-la.
          </p>
        ) : (
          <button type="button" onClick={remover} disabled={removendo} className="inline-flex items-center gap-1 text-xs font-medium text-vg-erro transition-colors hover:text-red-300 disabled:opacity-50">
            <Icone nome="person_remove" tamanho={14} /> Remover
          </button>
        )
      )}
      {erro && erro === MENSAGEM_NAO_REMOVE_CRIADORA ? (
        <p role="alert" className="text-xs text-vg-erro">
          {erro}{" "}
          <Link href={`/campanhas/${campanhaId}/configuracoes`} className="underline">
            Ir para as configurações
          </Link>
        </p>
      ) : (
        erro && <p role="alert" className="text-xs text-vg-erro">{erro}</p>
      )}
    </div>
  );
}

/** Aba "Contas associadas": botão "Associe uma conta", bloco "Configurações" (reassociar_acoes), busca,
 *  contador "N/N conta" e os cartões. */
export function ContasAssociadas({
  campanhaId,
  contas,
  disponiveis,
  reassociarAcoes,
  podeEditar,
}: {
  campanhaId: string;
  contas: ContaAssociada[];
  disponiveis: ContaDisponivel[];
  reassociarAcoes: boolean;
  podeEditar: boolean;
}) {
  const [busca, setBusca] = useState("");
  const [removidas, setRemovidas] = useState<Set<string>>(new Set());
  // Resultado da última remoção (o cartão some, então a mensagem fica aqui em cima, com as contagens das ações).
  const [mensagem, setMensagem] = useState<string | null>(null);

  const restantes = contas.filter((c) => !removidas.has(c.id));
  const termo = busca.trim().toLowerCase();
  const filtradas = termo
    ? restantes.filter((c) => c.nome.toLowerCase().includes(termo) || (c.telefone ?? "").toLowerCase().includes(termo))
    : restantes;

  return (
    <div className="space-y-4">
      {/* Sem o título "Contas associadas":, a tela começa no botão. */}
      {podeEditar && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AssociarConta campanhaId={campanhaId} disponiveis={disponiveis} />
        </div>
      )}

      {mensagem && (
        <p role="status" className="rounded-lg border border-vg-line px-3 py-2 text-sm text-vg-text">
          {mensagem}
        </p>
      )}

      {podeEditar && <ConfiguracaoReassociar campanhaId={campanhaId} inicial={reassociarAcoes} podeEditar={podeEditar} />}

      <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar conexões associadas" className="w-full max-w-sm" />
      <p className="text-sm text-vg-text-2">
        {filtradas.length}/{restantes.length}
        <br />
        conexão
      </p>

      {filtradas.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio texto={restantes.length === 0 ? "Nenhuma conexão associada. A primeira que você associar vai criar os grupos." : "Nenhuma conexão associada encontrada."} />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtradas.map((c) => (
            <CartaoConta
              key={c.id}
              campanhaId={campanhaId}
              conta={c}
              podeEditar={podeEditar}
              aoRemover={(id, m) => {
                setRemovidas((atual) => new Set(atual).add(id));
                setMensagem(m);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
