"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { analisarGrupos } from "@/app/(painel)/leads/actions";
import { AvatarFoto } from "../../_componentes/avatar-foto";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { MenuCartao } from "../../_componentes/menu-cartao";
import { Botao, estiloBotao, estiloInput, Selo, Tabela, Vazio } from "../../_componentes/ui";
import { CopiarLink } from "../../campanhas/[id]/copiar-link";
import { atualizarGruposDaConta, sairDoGrupo } from "./actions";

export type GrupoDaContaLinha = {
  groupId: string;
  nome: string;
  participantes: number;
  /** Só pros grupos que também são de campanha (`conta_grupos.group_id` casa com `grupos.group_id`): as colunas
   *  extras de hoje (Situação, Link) ficam pra eles — os demais mostram "—". `null` = não é grupo de campanha. */
  campanhaNome: string | null;
  cheio: boolean | null;
  ativo: boolean | null;
  linkConvite: string | null;
  /** Foto real (Etapa 3M): `conta_grupos.foto_url`, senão `grupos.foto_url` do mesmo `group_id`; null = letra. */
  foto?: string | null;
};

const POR_PAGINA = 25;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Busca por nome (aba "Grupos" do detalhe da conta, Etapa 3K Tarefa 4) — função pura, testável sem montar o
 *  componente. */
export function filtrarGruposDaConta(linhas: GrupoDaContaLinha[], busca: string): GrupoDaContaLinha[] {
  const b = semAcento(busca.trim());
  if (!b) return linhas;
  return linhas.filter((g) => semAcento(g.nome || g.groupId).includes(b));
}

/** Cursor da próxima chamada do "Escanear": só quando a análise foi parcial (senão recomeça do zero, com a trava). */
export function proximoCursor(resumo: { parcial: boolean; proximo?: string }): string | undefined {
  return resumo.parcial && resumo.proximo ? resumo.proximo : undefined;
}

/**
 * Aba "Grupos" do detalhe da conta: título "Grupos que a conta participa", `refresh` "Atualizar"
 * (lê TODOS os grupos da conta no Zapbot e guarda em `conta_grupos`) e `policy` "Escanear" (`analisarGrupos` só
 * dos grupos desta conta). Antes do primeiro "Atualizar" (`escaneado = false`), `linhas` já vêm com os grupos de
 * campanha de hoje (comportamento de hoje) + a dica pra atualizar. Conta desconectada: botões desabilitados.
 */
export function GruposConta({
  contaId,
  contaNome,
  conectada,
  linhas,
  escaneado,
  podeEscanear = false,
  podeEditar = false,
}: {
  contaId: string;
  /** Nome da conta, pro texto da confirmação de "Sair do grupo" (Etapa 3M, Tarefa 5). */
  contaNome: string;
  conectada: boolean;
  linhas: GrupoDaContaLinha[];
  escaneado: boolean;
  /** Contas/editar e Anti-spam/editar: sem isso o botão "Escanear" nem aparece. */
  podeEscanear?: boolean;
  /** Contas/editar: sem isso o "⋮" de "Sair do grupo" nem aparece. */
  podeEditar?: boolean;
}) {
  const router = useRouter();
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [atualizando, setAtualizando] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  /** Análise parcial: o cursor (`proximo`) da última chamada. O próximo "Escanear" continua dali, sem a trava. */
  const [proximo, setProximo] = useState<string | undefined>(undefined);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  /** Grupo com a confirmação de "Sair do grupo" aberta (Etapa 3M, Tarefa 5). */
  const [sairAlvo, setSairAlvo] = useState<GrupoDaContaLinha | null>(null);
  const [saindo, setSaindo] = useState(false);

  async function sair() {
    if (!sairAlvo) return;
    setSaindo(true);
    const r = await sairDoGrupo(contaId, sairAlvo.groupId);
    setSaindo(false);
    if (r.erro) return setMsg({ texto: r.erro, erro: true });
    setSairAlvo(null);
    setMsg({ texto: `A conexão saiu do grupo ${sairAlvo.nome || sairAlvo.groupId}.`, erro: false });
    router.refresh();
  }

  const filtradas = useMemo(() => filtrarGruposDaConta(linhas, busca), [linhas, busca]);
  const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtradas.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);

  async function atualizar() {
    setAtualizando(true);
    setMsg(null);
    const r = await atualizarGruposDaConta(contaId);
    setAtualizando(false);
    if (r.erro) return setMsg({ texto: r.erro, erro: true });
    setMsg({ texto: `${r.atualizados ?? 0} grupo(s) atualizado(s).`, erro: false });
    router.refresh();
  }

  async function escanear() {
    setEscaneando(true);
    setMsg(null);
    const r = await analisarGrupos(proximo, contaId);
    setEscaneando(false);
    if (r.erro) return setMsg({ texto: r.erro, erro: true });
    const resumo = r.resumo!;
    setProximo(proximoCursor(resumo));
    setMsg({
      texto: `${resumo.remocoes} remoção(ões) enfileirada(s)${resumo.parcial ? " — análise parcial, clique em Continuar escaneando pra seguir de onde parou." : "."}`,
      erro: false,
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">Grupos que a conexão participa</h2>
        <div className="flex items-center gap-3">
          <span className="text-sm text-vg-text">Linhas por página <span className="ml-3 tabular-nums">{POR_PAGINA}</span></span>
          <Botao variante="secundario" icone={<Icone nome="refresh" tamanho={18} />} onClick={atualizar} disabled={!conectada || atualizando}>
            {atualizando ? "Atualizando…" : "Atualizar"}
          </Botao>
          {podeEscanear && (
            <Botao variante="secundario" icone={<Icone nome="policy" tamanho={18} />} onClick={escanear} disabled={!conectada || escaneando}>
              {escaneando ? "Escaneando…" : proximo ? "Continuar escaneando" : "Escanear"}
            </Botao>
          )}
        </div>
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}
      {!escaneado && <p className="text-sm text-vg-muted">Clique em Atualizar para ver todos os grupos da conexão.</p>}

      <label className="relative block w-full max-w-sm">
        <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
        <input
          type="search"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar"
          aria-label="Buscar grupos"
          className={`${estiloInput} pl-9`}
        />
      </label>

      {!visiveis.length ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <Tabela colunas={podeEditar ? ["", "Grupo", "Participantes", "Situação", "Link", ""] : ["", "Grupo", "Participantes", "Situação", "Link"]}>
          {visiveis.map((g) => (
            <tr key={g.groupId}>
              <td className="w-12 px-3 py-2.5"><AvatarFoto nome={g.nome || g.groupId} foto={g.foto} tamanho={32} /></td>
              <td className="px-3 py-2.5 font-medium">
                {g.nome || g.groupId}
                {g.campanhaNome && (
                  <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs font-normal text-vg-text-2">
                    <Icone nome="campaign" tamanho={14} />
                    {g.campanhaNome}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 tabular-nums">{g.participantes}</td>
              <td className="px-3 py-2.5">
                {g.ativo === null ? "—" : <Selo cor={!g.ativo ? "neutro" : g.cheio ? "aviso" : "ok"}>{!g.ativo ? "Inativo" : g.cheio ? "Cheio" : "Disponível"}</Selo>}
              </td>
              <td className="px-3 py-2.5">{g.linkConvite ? <CopiarLink url={g.linkConvite} compacto rotulo={`Link do grupo ${g.nome}`} /> : "—"}</td>
              {podeEditar && (
                <td className="w-12 px-3 py-2.5">
                  <MenuCartao
                    itens={[
                      {
                        rotulo: "Sair do grupo",
                        icone: "logout",
                        perigo: true,
                        desabilitado: g.campanhaNome !== null,
                        dica: g.campanhaNome !== null ? `Este grupo está na campanha ${g.campanhaNome}. Tire o grupo da campanha antes de sair.` : undefined,
                        onClick: () => setSairAlvo(g),
                      },
                    ]}
                  />
                </td>
              )}
            </tr>
          ))}
        </Tabela>
      )}

      {filtradas.length > POR_PAGINA && (
        <div className="flex items-center justify-end gap-3 text-sm text-vg-text-2">
          <button type="button" disabled={paginaSegura <= 1} onClick={() => setPagina((p) => p - 1)} className="font-medium text-vg-accent disabled:pointer-events-none disabled:opacity-40">
            Anterior
          </button>
          <span className="tabular-nums">{paginaSegura} / {totalPaginas}</span>
          <button type="button" disabled={paginaSegura >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="font-medium text-vg-accent disabled:pointer-events-none disabled:opacity-40">
            Próxima
          </button>
        </div>
      )}

      <Janela aberta={sairAlvo !== null} aoFechar={() => setSairAlvo(null)} titulo="Sair do grupo">
        {sairAlvo && (
          <div className="space-y-4">
            <p className="text-sm text-vg-text">
              A conexão {contaNome} vai sair do grupo {sairAlvo.nome || sairAlvo.groupId}. Para voltar, só entrando de novo pelo convite.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" className={estiloBotao("secundario")} onClick={() => setSairAlvo(null)} disabled={saindo}>
                CANCELAR
              </button>
              <button type="button" className={estiloBotao("perigo")} onClick={sair} disabled={saindo}>
                SAIR DO GRUPO
              </button>
            </div>
          </div>
        )}
      </Janela>
    </div>
  );
}
