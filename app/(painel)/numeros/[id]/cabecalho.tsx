"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import { estaPausado, type ContaLista } from "@/src/lib/regras/contas";
import type { ItemTrilha } from "@/src/lib/regras/topo";
import { Avatar } from "../../_componentes/avatar";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { DefinirTrilha } from "../../_componentes/trilha";
import { Botao, estiloBotao, estiloInput, Selo } from "../../_componentes/ui";
import { Conectar } from "../conectar";
import { definirProjetoConexao, desconectarConexao, excluirConexao, finalizarSessaoConexao, reconectar, renomearConexao } from "../actions";

const COR_SITUACAO: Record<string, "ok" | "erro" | "neutro"> = { conectado: "ok", desconectado: "erro" };
const ROTULO_SITUACAO: Record<string, string> = { conectado: "Conectado", desconectado: "Desconectado", pendente: "Sem sessão" };

const ITEM_MENU = "flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40";

type Conta = Pick<ContaLista, "id" | "nome" | "telefone" | "status" | "ultimo_erro" | "pausado_ate" | "created_at" | "projeto_id">;
export type ProjetoOpcao = { id: string; nome: string };

/** Cabeçalho da conta (spec "Conta"): avatar grande com bolinha, nome, telefone, situação e a "última
 *  conexão" (`leak_add`) — o Vórtex Grupo ainda não guarda o instante em que a sessão conectou de verdade, então
 *  usa `created_at` como a melhor data disponível até existir essa coluna (ver nota do relatório da Tarefa 3).
 *  À direita: PAREAR/RECONECTAR (como hoje), "DESCONECTAR" (novo) e o menu CONFIGURAÇÕES ›
 *  com Desconectar, Finalizar Sessão, Definir projeto, Renomear e Excluir. Também define a migalha do topo
 *  (Contas › nome › aba). `podeEditar` (revisão final, padrão `true`): sem "contas"/"editar" some PAREAR,
 *  RECONECTAR, DESCONECTAR e o menu CONFIGURAÇÕES inteiro (todo item dele exige editar). */
export function CabecalhoConta({ conta, aba, projetos, podeEditar = true }: { conta: Conta; aba: ItemTrilha; projetos: ProjetoOpcao[]; podeEditar?: boolean }) {
  const router = useRouter();
  const idMenu = useId();
  const [parear, setParear] = useState(false);
  const [renomear, setRenomear] = useState(false);
  const [definirProjeto, setDefinirProjeto] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [nome, setNome] = useState(conta.nome);
  const [projetoEscolhido, setProjetoEscolhido] = useState(conta.projeto_id ?? "");
  const [erro, setErro] = useState<string | null>(null);
  const [erroRenomear, setErroRenomear] = useState<string | null>(null);
  const [erroProjeto, setErroProjeto] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [finalizando, setFinalizando] = useState(false);
  const [msgReconectar, setMsgReconectar] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const botaoMenu = useRef<HTMLButtonElement>(null);

  // Fecha o menu CONFIGURAÇÕES no clique fora ou Esc (idêntico ao menu da campanha).
  useEffect(() => {
    if (!menuAberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setMenuAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuAberto(false);
        botaoMenu.current?.focus();
      }
    }
    window.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [menuAberto]);

  const pausado = estaPausado(conta.pausado_ate);

  async function salvarNome() {
    setEnviando(true);
    const r = await renomearConexao(conta.id, nome);
    setEnviando(false);
    if (r.erro) {
      setErroRenomear(r.erro);
      return;
    }
    setErroRenomear(null);
    setRenomear(false);
    router.refresh();
  }

  async function salvarProjeto() {
    setEnviando(true);
    const r = await definirProjetoConexao(conta.id, projetoEscolhido || null);
    setEnviando(false);
    if (r.erro) {
      setErroProjeto(r.erro);
      return;
    }
    setErroProjeto(null);
    setDefinirProjeto(false);
    router.refresh();
  }

  async function iniciarReconectar() {
    setReconectando(true);
    setMsgReconectar(null);
    const r = await reconectar(conta.id);
    setReconectando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setErro(null);
    setMsgReconectar("Reconexão iniciada.");
    router.refresh();
  }

  async function desconectar() {
    setMenuAberto(false);
    if (!confirm("Desconectar este número? Vai precisar ler o QR Code de novo para voltar a enviar.")) return;
    setDesconectando(true);
    const r = await desconectarConexao(conta.id);
    setDesconectando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setErro(null);
    router.refresh();
  }

  async function finalizarSessao() {
    setMenuAberto(false);
    if (!confirm("Finalizar a sessão? A conexão será desconectada e a sessão apagada no Zapbot: será preciso parear de novo com QR ou código.")) return;
    setFinalizando(true);
    const r = await finalizarSessaoConexao(conta.id);
    setFinalizando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setErro(null);
    router.refresh();
  }

  async function excluir() {
    setMenuAberto(false);
    if (!confirm("Excluir este número? Ele será desconectado do sistema.")) return;
    setEnviando(true);
    const r = await excluirConexao(conta.id);
    setEnviando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    router.push("/numeros");
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-3 px-4 pt-6 md:px-6">
      <DefinirTrilha itens={[{ rotulo: "Conexões", href: "/numeros" }, { rotulo: conta.nome, href: `/numeros/${conta.id}` }, aba]} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span title={ROTULO_SITUACAO[conta.status] ?? conta.status}>
            <Avatar nome={conta.nome} cor={COR_SITUACAO[conta.status] ?? "neutro"} tamanho={56} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{conta.nome}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-vg-muted">
              {conta.telefone && <span>{formatarTelefone(conta.telefone)}</span>}
              {pausado && <Selo cor="aviso">pausado</Selo>}
            </div>
            {/* Data (`leak_add`): sem coluna própria de "última conexão" ainda, usa `created_at` (ver
             *  comentário no topo). Sem o rótulo "Última conexão:". */}
            <p className="mt-1 flex items-center gap-1.5 text-xs text-vg-text-3">
              <Icone nome="leak_add" tamanho={14} />
              {dataHoraCompleta(conta.created_at)}
            </p>
            {conta.ultimo_erro && <p className="mt-1 truncate text-xs text-vg-erro" title={conta.ultimo_erro}>{conta.ultimo_erro}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {podeEditar && conta.status !== "conectado" && <Botao variante="secundario" onClick={() => setParear(true)}>PAREAR</Botao>}
          {podeEditar && conta.status === "desconectado" && (
            <Botao variante="secundario" onClick={iniciarReconectar} disabled={reconectando}>
              {reconectando ? "RECONECTANDO…" : "RECONECTAR"}
            </Botao>
          )}
          {podeEditar && conta.status === "conectado" && (
            <Botao variante="secundario" onClick={desconectar} disabled={desconectando}>
              {desconectando ? "DESCONECTANDO…" : "DESCONECTAR"}
            </Botao>
          )}
          {msgReconectar && <p role="status" className="text-sm text-vg-ok">{msgReconectar}</p>}
          {podeEditar && (
            <div ref={caixa} className="relative">
              <button
                ref={botaoMenu}
                type="button"
                onClick={() => setMenuAberto((v) => !v)}
                aria-expanded={menuAberto}
                aria-controls={menuAberto ? idMenu : undefined}
                disabled={enviando}
                className={estiloBotao("principal")}
              >
                CONFIGURAÇÕES
                <Icone nome="chevron_right" tamanho={18} />
              </button>
              {menuAberto && (
                <div id={idMenu} className="absolute right-0 top-full z-40 mt-2 min-w-52 rounded-lg border border-vg-line bg-vg-panel py-1 shadow-lg">
                  <div className="border-b border-vg-line px-4 py-2">
                    <p className="truncate text-[13px] font-medium text-vg-text">{conta.nome}</p>
                    {conta.telefone && <p className="text-xs text-vg-text-2">{formatarTelefone(conta.telefone)}</p>}
                  </div>
                  <button type="button" onClick={desconectar} disabled={desconectando || conta.status !== "conectado"} className={ITEM_MENU}>
                    Desconectar
                  </button>
                  <button type="button" onClick={finalizarSessao} disabled={finalizando} className={ITEM_MENU}>
                    Finalizar Sessão
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAberto(false);
                      setProjetoEscolhido(conta.projeto_id ?? "");
                      setErroProjeto(null);
                      setDefinirProjeto(true);
                    }}
                    className={ITEM_MENU}
                  >
                    Definir projeto
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuAberto(false);
                      setNome(conta.nome);
                      setErroRenomear(null);
                      setRenomear(true);
                    }}
                    className={ITEM_MENU}
                  >
                    Editar
                  </button>
                  <button type="button" onClick={excluir} className={`${ITEM_MENU} text-vg-erro`}>
                    Excluir
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}

      <Janela
        aberta={parear}
        aoFechar={() => {
          setParear(false);
          router.refresh();
        }}
        titulo="Conectar número"
      >
        <Conectar conexaoId={conta.id} />
      </Janela>

      <Janela
        aberta={renomear}
        aoFechar={() => {
          setRenomear(false);
          setErroRenomear(null);
        }}
        titulo="Renomear conexão"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            salvarNome();
          }}
        >
          <input
            className={estiloInput}
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Nome do número"
            maxLength={40}
            aria-label="Nome do número"
            autoFocus
          />
          {erroRenomear && <p role="alert" className="text-sm text-vg-erro">{erroRenomear}</p>}
          <Botao type="submit" disabled={enviando}>Salvar</Botao>
        </form>
      </Janela>

      <Janela
        aberta={definirProjeto}
        aoFechar={() => {
          setDefinirProjeto(false);
          setErroProjeto(null);
        }}
        titulo="Definir projeto"
      >
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            salvarProjeto();
          }}
        >
          <select
            className={estiloInput}
            value={projetoEscolhido}
            onChange={(e) => setProjetoEscolhido(e.target.value)}
            aria-label="Projeto"
            autoFocus
          >
            <option value="">Nenhum (sem pasta)</option>
            {projetos.map((p) => (
              <option key={p.id} value={p.id}>{p.nome}</option>
            ))}
          </select>
          {erroProjeto && <p role="alert" className="text-sm text-vg-erro">{erroProjeto}</p>}
          <Botao type="submit" disabled={enviando}>Salvar</Botao>
        </form>
      </Janela>
    </div>
  );
}
