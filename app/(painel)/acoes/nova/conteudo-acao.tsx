"use client";
import { useEffect, useId, useState } from "react";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import {
  ACOES_ASSISTENTE,
  AVISO_DESATIVAR_COMUNIDADE,
  DIAS_RELATORIO,
  ehTipoExecucaoAssistente,
  estadoDaSeguinte,
  MAXIMO_EXECUCOES_RELATORIO,
  MAXIMO_SEGUINTES,
  NOTA_ENTRAR_GRUPO,
  NOTA_RELATORIO_STATUS,
  novaSeguinte,
  rotuloAcaoAssistente,
  telefonesDoTexto,
  type CampanhaDoAssistente,
  type EstadoAcao,
  type TipoAcaoAssistente,
} from "@/src/lib/regras/assistente-acao";
import type { ConteudoConfiguracao } from "@/src/lib/regras/conteudo";
import { paraV2, type ConteudoV2 } from "@/src/lib/regras/conteudo-v2";
import { PROVA } from "@/src/lib/zapbot/prova";
import { CampoImagemGrupo } from "../../_componentes/campo-imagem-grupo";
import { ConteudoEditor, type Valor } from "../../_componentes/conteudo-editor";
import { EditorMensagens, type ModeloParaEditor } from "../../_componentes/editor-mensagens";
import { SegmentoRadio } from "../../_componentes/editor-mensagens/segmento-radio";
import { Icone } from "../../_componentes/icone";
import { estiloBotao, estiloInput, Vazio } from "../../_componentes/ui";
import { listarExecucoesRelatorio, type ExecucaoDoRelatorio } from "../actions";

type TriEstado = "manter" | "sim" | "nao";
const OPCOES_TRI: { valor: TriEstado; rotulo: string }[] = [
  { valor: "manter", rotulo: "Não mudar" },
  { valor: "sim", rotulo: "Sim" },
  { valor: "nao", rotulo: "Não" },
];

/** Só os 3 campos booleanos de `ConteudoConfiguracao` (o 4º, `temporarias`, é um select — Etapa 3E, sem lugar
 *  neste passo "sem conteúdo"/tri-estado). */
type ChaveConfiguracaoBooleana = "so_admins_enviam" | "so_admins_editam" | "aprovacao_entrada";

const CONFIGURACOES: { chave: ChaveConfiguracaoBooleana; rotulo: string }[] = [
  { chave: "so_admins_enviam", rotulo: "Só admins enviam mensagens" },
  { chave: "so_admins_editam", rotulo: "Só admins editam o grupo" },
  { chave: "aprovacao_entrada", rotulo: "Aprovar entrada de novos participantes" },
];

/** Linha de confirmação das ações sem conteúdo. */
const SEM_CONTEUDO: Partial<Record<TipoAcaoAssistente, string>> = {
  abrir: "Os grupos escolhidos ficam abertos: todo mundo pode mandar mensagem.",
  fechar: "Os grupos escolhidos ficam fechados: só admins mandam mensagem.",
  atualizar_links: "Os links de convite dos grupos escolhidos são lidos de novo no WhatsApp.",
  redefinir_link: "Os grupos escolhidos ganham um link de convite novo; o antigo para de funcionar.",
  desativar_comunidade: "Desativa a comunidade de cada campanha escolhida.",
};

/** Passo "Conteúdo" do assistente: editor completo para "Enviar mensagem" e formulário simples para os outros. */
/** Selo "BETA" + motivo da "Privacidade Avançada na Conversa" enquanto a prova em grupo não confirmou (`PROVA`). */
export function SeloBeta() {
  if (PROVA.privacidadeEmGrupo) return null;
  return (
    <span title={PROVA.privacidadeMotivo} className="rounded border border-vg-aviso/60 px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-vg-aviso">
      BETA
    </span>
  );
}

export function ConteudoAcao({ estado, aoMudar, campanhasDaAcao, campanhas, modelos, variaveis, telefones, pasta }: {
  estado: EstadoAcao;
  aoMudar: (p: Partial<EstadoAcao>) => void;
  campanhasDaAcao: string[];
  campanhas: CampanhaDoAssistente[];
  modelos: ModeloParaEditor[];
  variaveis: string[] | undefined;
  telefones: { nome: string; telefone: string }[];
  pasta: string;
}) {
  const idTelefones = useId();
  const idDestino = useId();
  const idLink = useId();
  const idInicio = useId();
  const idFim = useId();
  const tipo = estado.tipo;
  if (!tipo) return null;
  const c = (estado.conteudo ?? {}) as Record<string, unknown>;

  switch (tipo) {
    case "mensagem":
      return <EditorMensagens valor={paraV2(estado.conteudo)} onChange={(v: ConteudoV2) => aoMudar({ conteudo: v })} variaveis={variaveis} modelos={modelos} pasta={pasta} />;
    case "nome":
    case "descricao":
    case "admin_add":
    case "admin_remover":
      return <ConteudoEditor tipo={tipo} valor={c as Valor} onChange={(v) => aoMudar({ conteudo: v })} pasta={pasta} telefones={telefones} />;
    case "imagem":
      return (
        <CampoImagemGrupo
          rotulo="Imagem do grupo"
          valor={{ url: typeof c.url === "string" ? c.url : "", nome_arquivo: typeof c.nome_arquivo === "string" ? c.nome_arquivo : null }}
          onChange={(v) => aoMudar({ conteudo: v })}
          pasta={pasta}
        />
      );
    case "configuracao": {
      const valor = c as ConteudoConfiguracao;
      const tri = (v: boolean | undefined): TriEstado => (v === undefined ? "manter" : v ? "sim" : "nao");
      const mudar = (chave: ChaveConfiguracaoBooleana, t: TriEstado) => {
        const novo: ConteudoConfiguracao = { ...valor };
        if (t === "manter") delete novo[chave];
        else novo[chave] = t === "sim";
        aoMudar({ conteudo: novo });
      };
      return (
        <div className="space-y-4">
          {CONFIGURACOES.map((k) => (
            <SegmentoRadio<TriEstado> key={k.chave} legenda={k.rotulo} opcoes={OPCOES_TRI} valor={tri(valor[k.chave])} aoMudar={(t) => mudar(k.chave, t)} />
          ))}
        </div>
      );
    }
    case "remover_participantes": {
      const { telefones: lista, invalidos } = telefonesDoTexto(estado.telefonesTexto);
      return (
        <div className="space-y-2">
          <label htmlFor={idTelefones} className="block text-[13.3px] text-[#e3e9e5]">Telefones (um por linha)</label>
          <textarea
            id={idTelefones}
            rows={8}
            value={estado.telefonesTexto}
            onChange={(e) => aoMudar({ telefonesTexto: e.target.value })}
            className={`${estiloInput} font-mono`}
            placeholder={"11 9 1234-5678\n21 9 8765-4321"}
          />
          <p className="text-xs text-vg-muted">
            DDD + número; o mesmo número com e sem o 9 conta uma vez. Até 500 telefones. {lista.length} {lista.length === 1 ? "telefone válido" : "telefones válidos"}.
          </p>
          {invalidos.length > 0 && <p role="alert" className="text-xs text-vg-erro">Inválido: {invalidos.slice(0, 5).join(", ")}{invalidos.length > 5 ? "…" : ""}</p>}
        </div>
      );
    }
    case "mover_grupos": {
      const destinos = campanhas.filter((x) => !campanhasDaAcao.includes(x.id));
      const destino = typeof c.campanha_destino === "string" ? c.campanha_destino : "";
      return (
        <div className="max-w-md space-y-1.5">
          <label htmlFor={idDestino} className="block text-[13.3px] text-[#e3e9e5]">Campanha de destino</label>
          <select id={idDestino} value={destinos.some((d) => d.id === destino) ? destino : ""} onChange={(e) => aoMudar({ conteudo: { campanha_destino: e.target.value } })} className={estiloInput}>
            <option value="" disabled>Escolha…</option>
            {destinos.map((d) => <option key={d.id} value={d.id}>{d.nome}</option>)}
          </select>
          <p className="text-xs text-vg-muted">Os grupos escolhidos saem da campanha atual e entram nesta, com os próximos números dela.</p>
        </div>
      );
    }
    case "privacidade_avancada": {
      const valor = typeof c.valor === "boolean" ? c.valor : null;
      const botao = (v: boolean, rotulo: string, icone: string) => (
        <button type="button" aria-pressed={valor === v} onClick={() => aoMudar({ conteudo: { valor: v } })} className={estiloBotao(valor === v ? "principal" : "contorno")}>
          <Icone nome={icone} tamanho={18} />
          {rotulo}
        </button>
      );
      return (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-vg-text-2">
            Liga ou desliga a privacidade avançada da conversa em cada grupo escolhido. <SeloBeta />
          </p>
          <div className="flex flex-wrap gap-3">
            {botao(true, "ATIVAR", "lock")}
            {botao(false, "DESATIVAR", "lock_open")}
          </div>
          {!PROVA.privacidadeEmGrupo && <p className="text-xs text-vg-aviso">{PROVA.privacidadeMotivo}</p>}
        </div>
      );
    }
    case "entrar_grupo":
      return (
        <div className="max-w-xl space-y-2">
          <label htmlFor={idLink} className="block text-[13.3px] text-[#e3e9e5]">Link de convite</label>
          <input
            id={idLink}
            type="url"
            inputMode="url"
            value={typeof c.link === "string" ? c.link : ""}
            onChange={(e) => aoMudar({ conteudo: { link: e.target.value } })}
            placeholder="https://chat.whatsapp.com/…"
            className={estiloInput}
          />
          <p className="flex items-start gap-2 text-xs text-vg-muted">
            <Icone nome="info" tamanho={16} className="mt-px shrink-0" />
            {NOTA_ENTRAR_GRUPO}
          </p>
        </div>
      );
    case "relatorio_status":
      return <EscolherExecucoes campanhasDaAcao={campanhasDaAcao} marcadas={Array.isArray(c.execucoes) ? (c.execucoes as string[]) : []} aoMudar={(ids) => aoMudar({ conteudo: { execucoes: ids } })} />;
    case "historico_enviadas":
      return (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1.5">
              <label htmlFor={idInicio} className="block text-[13.3px] text-[#e3e9e5]">Inicio do intervalo</label>
              <input id={idInicio} type="date" value={typeof c.inicio === "string" ? c.inicio : ""} onChange={(e) => aoMudar({ conteudo: { ...c, inicio: e.target.value } })} className={estiloInput} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor={idFim} className="block text-[13.3px] text-[#e3e9e5]">Fim do intervalo</label>
              <input id={idFim} type="date" value={typeof c.fim === "string" ? c.fim : ""} onChange={(e) => aoMudar({ conteudo: { ...c, fim: e.target.value } })} className={estiloInput} />
            </div>
          </div>
          <p className="text-xs text-vg-muted">
            Até {DIAS_RELATORIO} dias, pelo horário da ação (Brasília). Uma linha por envio de mensagem ou enquete das {campanhasDaAcao.length}{" "}
            {campanhasDaAcao.length === 1 ? "campanha escolhida" : "campanhas escolhidas"}.
          </p>
        </div>
      );
    default:
      return (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm text-vg-text-2">
            <Icone nome="info" tamanho={18} className="text-vg-text-3" />
            {SEM_CONTEUDO[tipo] ?? "Sem conteúdo: só a ação no grupo."}
          </p>
          {tipo === "desativar_comunidade" && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-vg-erro/50 bg-vg-erro/10 px-3 py-2 text-sm font-semibold text-vg-erro">
              <Icone nome="warning" tamanho={18} />
              {AVISO_DESATIVAR_COMUNIDADE}
            </p>
          )}
        </div>
      );
  }
}

/** Passo Conteúdo do "Relatório de status de mensagens": ações de mensagem/enquete enviadas das campanhas escolhidas
 *  (últimos 90 dias), até 50 marcadas. */
function EscolherExecucoes({ campanhasDaAcao, marcadas, aoMudar }: { campanhasDaAcao: string[]; marcadas: string[]; aoMudar: (ids: string[]) => void }) {
  const [lista, setLista] = useState<{ execucoes: ExecucaoDoRelatorio[] } | { erro: string } | null>(null);
  const chave = campanhasDaAcao.join(",");
  useEffect(() => {
    let vivo = true;
    setLista(null);
    listarExecucoesRelatorio(chave ? chave.split(",") : []).then(
      (r) => vivo && setLista(r),
      () => vivo && setLista({ erro: "Não foi possível carregar as ações." }),
    );
    return () => {
      vivo = false;
    };
  }, [chave]);

  if (lista === null) return <p className="text-sm text-vg-muted">Carregando ações…</p>;
  if ("erro" in lista) return <p role="alert" className="text-sm text-vg-erro">{lista.erro}</p>;
  if (!lista.execucoes.length) return <div className="rounded-xl border border-vg-line"><Vazio texto={`Nenhuma mensagem enviada nos últimos ${DIAS_RELATORIO} dias`} compacto /></div>;
  const cheio = marcadas.length >= MAXIMO_EXECUCOES_RELATORIO;
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-[13px] text-vg-text-2">
        Ações de mensagem e enquete dos últimos {DIAS_RELATORIO} dias ({marcadas.length}/{MAXIMO_EXECUCOES_RELATORIO} marcadas)
      </legend>
      <ul className="divide-y divide-vg-line rounded-xl border border-vg-line">
        {lista.execucoes.map((e) => {
          const marcado = marcadas.includes(e.id);
          return (
            <li key={e.id}>
              <label className={`flex items-center gap-3 px-4 py-2.5 text-[13.3px] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-vg-accent/50 ${!marcado && cheio ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-white/[0.03]"}`}>
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={marcado}
                  disabled={!marcado && cheio}
                  onChange={(ev) => aoMudar(ev.target.checked ? [...marcadas, e.id] : marcadas.filter((m) => m !== e.id))}
                />
                <Icone nome={e.tipo === "enquete" ? "poll" : "send"} tamanho={18} className="text-vg-text-3" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{e.resumo || (e.tipo === "enquete" ? "Enquete" : "Mensagem")}</span>
                  <span className="block text-xs tabular-nums text-vg-text-3">{dataHoraCompleta(e.agendada_para)}</span>
                </span>
                <Icone nome={marcado ? "check_box" : "check_box_outline_blank"} className={marcado ? "text-vg-accent" : "text-vg-text-3"} />
              </label>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-vg-muted">{NOTA_RELATORIO_STATUS}</p>
    </fieldset>
  );
}

type PropsConteudo = Omit<Parameters<typeof ConteudoAcao>[0], "estado" | "aoMudar">;

/** "Adicionar outra ação" (abaixo do editor do passo Conteúdo): cada ação extra vira um cartão "Ação N — rótulo" com
 *  o mesmo formulário de conteúdo da principal. Saem na ordem em que foram criadas, cada uma depois que a anterior
 *  terminar em todos os grupos, com o mesmo destino e horário. Até `MAXIMO_SEGUINTES` (5 ações por disparo). */
export function AcoesSeguintes({ estado, aoMudar, ...props }: PropsConteudo & { estado: EstadoAcao; aoMudar: (p: Partial<EstadoAcao>) => void }) {
  const [escolhendo, setEscolhendo] = useState(false);
  const idLista = useId();
  const seguintes = estado.seguintes;
  const mudarSeguinte = (i: number, p: Partial<EstadoAcao>) =>
    aoMudar({
      seguintes: seguintes.map((s, j) =>
        j !== i ? s : { ...s, ...(p.conteudo !== undefined ? { conteudo: p.conteudo } : {}), ...(p.telefonesTexto !== undefined ? { telefonesTexto: p.telefonesTexto } : {}) },
      ),
    });
  return (
    <div className="space-y-4">
      {seguintes.map((s, i) => (
        <section key={s.chave} aria-label={`Ação ${i + 2}`} className="space-y-3 rounded-xl border border-vg-line p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[14px] font-semibold">Ação {i + 2} — {rotuloAcaoAssistente(s.tipo)}</h3>
            <button
              type="button"
              aria-label={`Tirar a ação ${i + 2}`}
              title="Tirar esta ação"
              onClick={() => aoMudar({ seguintes: seguintes.filter((_, j) => j !== i) })}
              className="grid size-8 place-items-center rounded-md text-vg-text-2 hover:bg-white/5 hover:text-vg-erro"
            >
              <Icone nome="delete" tamanho={18} />
            </button>
          </div>
          <p className="text-xs text-vg-muted">Começa depois que a ação {i + 1} terminar em todos os grupos.</p>
          <ConteudoAcao {...props} estado={estadoDaSeguinte(estado, i)} aoMudar={(p) => mudarSeguinte(i, p)} />
        </section>
      ))}

      {seguintes.length < MAXIMO_SEGUINTES &&
        (escolhendo ? (
          <fieldset className="space-y-2 rounded-xl border border-vg-line p-4">
            <legend id={idLista} className="px-1 text-sm text-vg-text-2">Escolha a próxima ação</legend>
            <ul aria-labelledby={idLista} className="grid gap-2 sm:grid-cols-2">
              {ACOES_ASSISTENTE.filter((a) => ehTipoExecucaoAssistente(a.tipo)).map((a) => (
                <li key={a.tipo}>
                  <button
                    type="button"
                    onClick={() => {
                      aoMudar({ seguintes: [...seguintes, novaSeguinte(a.tipo)] });
                      setEscolhendo(false);
                    }}
                    className="flex w-full items-center gap-3 rounded-xl border border-vg-line px-4 py-2.5 text-left text-[14px] hover:border-vg-line-2 hover:bg-white/[0.03]"
                  >
                    <Icone nome={a.icone} tamanho={18} className="text-vg-accent" />
                    {a.rotulo}
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="text-sm text-vg-text-2 underline-offset-4 hover:text-vg-text hover:underline" onClick={() => setEscolhendo(false)}>
              Cancelar
            </button>
          </fieldset>
        ) : (
          <button type="button" className={estiloBotao("contorno")} onClick={() => setEscolhendo(true)}>
            <Icone nome="add" tamanho={18} />
            Adicionar outra ação
          </button>
        ))}
    </div>
  );
}
