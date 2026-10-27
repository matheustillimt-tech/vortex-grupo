"use client";
import { useMemo, useState } from "react";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { textoConfirmarDesativarGrupos } from "@/src/lib/regras/interacao";
import { AvatarFoto } from "../../../_componentes/avatar-foto";
import type { ModeloLinha } from "../../../_componentes/escolher-modelo";
import { BotaoFaixa, ESTILO_BOTAO_FAIXA_CHEIO, FaixaBotoes } from "../../../_componentes/faixa-botoes";
import { Icone } from "../../../_componentes/icone";
import { Janela } from "../../../_componentes/janela";
import { ItemMenuCartao, MenuCartao } from "../../../_componentes/menu-cartao";
import { estiloInput, Vazio } from "../../../_componentes/ui";
import { CopiarLink } from "../copiar-link";
import { AtualizarLeadsBotao } from "./atualizar-leads-botao";
import { ExportarLeadsMenu } from "./exportar-leads-menu";
import {
  atualizarLinkConviteGrupo,
  atualizarLinksGrupos,
  desativarGrupos,
  marcarCheioManual,
  redefinirLinkConviteGrupo,
  type InformacoesCriacaoEntrada,
  type AlterarEmLoteEntrada,
} from "./actions";
import type { ContaParaAdmin } from "./administradores";
import { AlterarGruposEmLote } from "./alterar";
import { CriacaoDeGrupos } from "./criacao";
import { Detalhes } from "./detalhes";
import { GruposDuplicados, ParticipantesDuplicados } from "./duplicados";
import { EditarNome } from "./editar-nome";
import { VariaveisGrupo } from "./variaveis-grupo";

export type GrupoLinha = {
  id: string;
  groupId: string;
  nome: string;
  numero: number;
  participantes: number;
  cheio: boolean;
  /** null = automático (a conferência decide); true/false = marcado à mão. */
  cheioManual: boolean | null;
  ativo: boolean;
  /** O WhatsApp tirou o grupo do ar (banido/indisponível): fica junto com `ativo: false`. */
  suspenso: boolean;
  link_convite: string | null;
  created_at: string;
  conferido_em: string | null;
  conexao: string;
  /** Foto real do grupo (`grupos.foto_url`, Etapa 3M); sem foto = letra. */
  foto?: string | null;
  cliques: number;
  cliquesReais: number;
  admins: number;
  leads: number;
};

/** Métrica da linha do grupo: rótulo pequeno em cima, ícone + valor embaixo — mostra "Redirect"
 *  `ads_click`, "Cliques reais" `mouse`, "Participantes" `group`, "Administradores" `admin_panel_settings` e
 *  "Leads" `person`. */
function MetricaGrupo({ rotulo, icone, valor }: { rotulo: string; icone: string; valor: string | number }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-[11px] leading-4 text-vg-text-3">{rotulo}</span>
      <span className="flex items-center gap-1 text-[14px] font-medium tabular-nums text-vg-text">
        <Icone nome={icone} tamanho={15} />
        {valor}
      </span>
    </span>
  );
}

/** Uma das 3 janelas por linha (Detalhes / Valores das variáveis / Editar nome). */
type JanelaLinha = { tipo: "detalhes" | "variaveis" | "editar"; grupo: GrupoLinha } | null;

/**
 * Faixa de ações (criar, alterar em lote, importar, atualizar links), o que vier em `children` (filtros, busca,
 * duplicados) e a lista de grupos com seleção. A seleção é compartilhada com a janela "Alterar grupos em lote".
 */
export function ListaGrupos({
  campanhaId,
  grupos,
  totalGrupos,
  ativos,
  limite,
  tipoGrupo,
  podeVerCampanhas,
  verLeads,
  podeEditar,
  campanhas,
  telefones,
  modelos,
  globais,
  variaveisCampanha,
  informacoesCriacao,
  alterarEmLote,
  contas,
  criadoraId,
  adminsIniciais,
  adminsNumerosIniciais,
  filtros,
  busca,
}: {
  campanhaId: string;
  /** Grupos visíveis (já filtrados e paginados pela página). */
  grupos: GrupoLinha[];
  /** Total de grupos da campanha, sem filtro (para diferenciar "nenhum grupo" de "nada encontrado"). */
  totalGrupos: number;
  /** Ids de todos os grupos ativos da campanha. */
  ativos: string[];
  limite: number;
  /** "Grupo normal" ou "Comunidade" (igual pra todos os grupos da campanha, vem de `campanhas.usar_comunidade`). */
  tipoGrupo: string;
  /** Mesmas permissões de hoje pros botões "EXPORTAR GRUPOS" / "EXPORTAR LEADS" / "ATUALIZAR LEADS", que
   *  saíram do cabeçalho da página e entraram na faixa 1. */
  podeVerCampanhas: boolean;
  verLeads: boolean;
  podeEditar: boolean;
  campanhas: { id: string; nome: string }[];
  telefones: { nome: string; telefone: string }[];
  modelos: ModeloLinha[];
  globais: { chave: string; tipo: string }[];
  variaveisCampanha: { chave: string; valor: string }[];
  /** Valores de hoje pros diálogos "Criação de grupos" e "Alterar grupos em lote" (Etapa 3E, Tarefa 3). */
  informacoesCriacao: InformacoesCriacaoEntrada;
  alterarEmLote: AlterarEmLoteEntrada;
  contas: ContaParaAdmin[];
  criadoraId: string | null;
  adminsIniciais: string[];
  /** Administradores por número salvos (`campanha_admins_numeros`, Etapa 3K). */
  adminsNumerosIniciais: string[];
  /** Filtros contornados (Todos/Cheios/Não cheios/Suspenso) à direita da faixa 2. */
  filtros?: React.ReactNode;
  /** Busca, numa linha abaixo da faixa 2. */
  busca?: React.ReactNode;
}) {
  const [marcadosBrutos, setMarcados] = useState<Set<string>>(new Set());
  const [janela, setJanela] = useState<"criar" | "alterar" | "participantesDup" | "gruposDup" | null>(null);
  // Remonta `CriacaoDeGrupos` com os valores salvos de hoje (useState reinicializa do zero): o `delete` do topo
  // descarta alterações não salvas sem apagar nada no banco.
  const [resetCriacao, setResetCriacao] = useState(0);
  const [janelaLinha, setJanelaLinha] = useState<JanelaLinha>(null);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Só conta o que está na tela e ativo: trocar de filtro ou buscar não deixa grupo escondido marcado, e um
  // grupo desativado enquanto a janela estava aberta sai da seleção.
  const ativosVisiveis = useMemo(() => new Set(grupos.filter((g) => g.ativo).map((g) => g.id)), [grupos]);
  const marcados = useMemo(() => [...marcadosBrutos].filter((id) => ativosVisiveis.has(id)), [marcadosBrutos, ativosVisiveis]);
  const selecionaveis = grupos.filter((g) => g.ativo);
  const tudoMarcado = selecionaveis.length > 0 && selecionaveis.every((g) => marcadosBrutos.has(g.id));

  function alternar(id: string, sim: boolean) {
    const s = new Set(marcadosBrutos);
    if (sim) s.add(id);
    else s.delete(id);
    setMarcados(s);
  }

  async function atualizarLinks() {
    setOcupado(true);
    try {
      const r = await atualizarLinksGrupos(campanhaId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Atualização dos links pedida para todos os grupos ativos.", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  /** Desativa os grupos marcados; devolve se deu certo (`false` em erro ou se cancelou a confirmação), pra
   *  quem chama de dentro da janela "Alterar em lote" saber se já pode fechá-la. */
  async function excluir(): Promise<boolean> {
    if (!marcados.length) return false;
    if (!window.confirm(textoConfirmarDesativarGrupos(marcados.length))) return false;
    setOcupado(true);
    try {
      const r = await desativarGrupos(marcados, campanhaId);
      if (r.erro) {
        setMsg({ texto: r.erro, erro: true });
        return false;
      }
      setMarcados(new Set());
      setMsg({ texto: "Grupos desativados.", erro: false });
      return true;
    } finally {
      setOcupado(false);
    }
  }

  async function marcarCheioEmMassa(valor: boolean) {
    if (!marcados.length) return;
    setOcupado(true);
    try {
      const r = await marcarCheioManual(marcados, campanhaId, valor);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: `${marcados.length} grupo(s) marcado(s) como ${valor ? "cheio" : "não cheio"}.`, erro: false });
    } finally {
      setOcupado(false);
    }
  }

  async function mudarCheio(g: GrupoLinha, novo: "automatico" | "sim" | "nao") {
    setOcupado(true);
    try {
      const r = await marcarCheioManual([g.id], campanhaId, novo === "automatico" ? null : novo === "sim");
      if (r.erro) setMsg({ texto: r.erro, erro: true });
    } finally {
      setOcupado(false);
    }
  }

  async function remover(g: GrupoLinha) {
    if (!window.confirm(`Remover o grupo ${g.nome}? Ele para de receber pessoas e mensagens.`)) return;
    setOcupado(true);
    try {
      const r = await desativarGrupos([g.id], campanhaId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Grupo removido.", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  async function atualizarLinkConvite(g: GrupoLinha) {
    setOcupado(true);
    try {
      const r = await atualizarLinkConviteGrupo(g.id, campanhaId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Link de convite atualizado (até 1 minuto).", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  async function redefinirLinkConvite(g: GrupoLinha) {
    if (!window.confirm(`Redefinir o link de convite de ${g.nome}? O link antigo deixa de funcionar.`)) return;
    setOcupado(true);
    try {
      const r = await redefinirLinkConviteGrupo(g.id, campanhaId);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: "Novo link de convite pedido (até 1 minuto).", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  // Sem ícones nos itens, Ordem da tela (sem "Reprocessar cliques", fora no plano 3E): "Detalhes", "Marcar
  // como cheio", "Atualizar link de convite", "Redefinir link de convite", "Editar", "Remover".
  function itensMenu(g: GrupoLinha): ItemMenuCartao[] {
    return [
      { rotulo: "Detalhes", onClick: () => setJanelaLinha({ tipo: "detalhes", grupo: g }) },
      g.cheioManual === true
        ? { rotulo: "Marcar como não cheio", onClick: () => mudarCheio(g, "nao") }
        : { rotulo: "Marcar como cheio", onClick: () => mudarCheio(g, "sim") },
      { rotulo: "Atualizar link de convite", onClick: () => atualizarLinkConvite(g) },
      { rotulo: "Redefinir link de convite", onClick: () => redefinirLinkConvite(g) },
      { rotulo: "Editar", onClick: () => setJanelaLinha({ tipo: "editar", grupo: g }) },
      { rotulo: "Remover", perigo: true, desabilitado: !g.ativo, onClick: () => remover(g) },
    ];
  }

  return (
    <>
      <div className="space-y-2">
        {/* Faixa 1: EXPORTAR GRUPOS/EXPORTAR LEADS/ATUALIZAR LEADS ficam à direita, na mesma linha, a partir de
         *  telas largas (1440 px). */}
        <div className="flex flex-wrap items-center justify-between gap-2 lg:flex-nowrap">
          <FaixaBotoes>
            <BotaoFaixa icone="group" onClick={() => setJanela("criar")}>Criar grupos</BotaoFaixa>
            <BotaoFaixa icone="group" onClick={() => setJanela("alterar")}>Alterar grupos</BotaoFaixa>
            <BotaoFaixa icone="group" href={`/campanhas/${campanhaId}/grupos/importar`}>Importar grupos</BotaoFaixa>
            <BotaoFaixa icone="refresh" onClick={atualizarLinks} disabled={ocupado}>Atualizar links</BotaoFaixa>
          </FaixaBotoes>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:flex-nowrap">
            {podeVerCampanhas && (
              <a href={`/api/exportar/grupos?campanha=${encodeURIComponent(campanhaId)}`} className={ESTILO_BOTAO_FAIXA_CHEIO}>
                <Icone nome="cloud_download" />
                EXPORTAR GRUPOS
              </a>
            )}
            {verLeads && <ExportarLeadsMenu campanhaId={campanhaId} />}
            {podeEditar && <AtualizarLeadsBotao campanhaId={campanhaId} />}
          </div>
        </div>
        {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FaixaBotoes>
            <BotaoFaixa icone="dynamic_feed" onClick={() => setJanela("participantesDup")}>Participantes duplicados</BotaoFaixa>
            <BotaoFaixa icone="dynamic_feed" onClick={() => setJanela("gruposDup")}>Grupos duplicados</BotaoFaixa>
          </FaixaBotoes>
          {filtros}
        </div>
        {busca}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3 px-1">
          <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
            <input
              type="checkbox"
              checked={tudoMarcado}
              disabled={!selecionaveis.length}
              onChange={(e) => {
                const s = new Set(marcadosBrutos);
                for (const g of selecionaveis) {
                  if (e.target.checked) s.add(g.id);
                  else s.delete(g.id);
                }
                setMarcados(s);
              }}
            />
            Selecionar tudo ({marcados.length}/{selecionaveis.length})
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => marcarCheioEmMassa(true)}
              disabled={!marcados.length || ocupado}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-vg-text-2 transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icone nome="signal_cellular_4_bar" tamanho={18} />
              Marcar como cheio
            </button>
            <button
              type="button"
              onClick={() => marcarCheioEmMassa(false)}
              disabled={!marcados.length || ocupado}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-vg-text-2 transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icone nome="signal_cellular_null" tamanho={18} />
              Marcar como não cheio
            </button>
            <button
              type="button"
              onClick={excluir}
              disabled={!marcados.length || ocupado}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium text-vg-erro transition-colors hover:bg-vg-erro/10 disabled:pointer-events-none disabled:opacity-40"
            >
              <Icone nome="delete_forever" tamanho={18} />
              Excluir
            </button>
          </div>
        </div>

        {grupos.length === 0 ? (
          <div className="rounded-xl border border-vg-line">
            <Vazio texto={totalGrupos ? "Nenhum grupo encontrado." : "Nenhum grupo ainda."} compacto />
          </div>
        ) : (
          <ul className="space-y-2">
            {grupos.map((g) => (
              <li key={g.id} className={`space-y-2.5 rounded-xl border border-vg-line px-4 py-3 ${g.ativo ? "" : "opacity-50"}`}>
                {/* Nome em cima, com o `more_vert` sempre na direita. */}
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={marcadosBrutos.has(g.id)}
                    disabled={!g.ativo}
                    onChange={(e) => alternar(g.id, e.target.checked)}
                    aria-label={`Selecionar ${g.nome}`}
                  />
                  <AvatarFoto nome={g.nome} foto={g.foto} />
                  <p className="min-w-0 flex-1 truncate text-[15px] font-medium" title={g.nome}>
                    <span className="text-vg-text-3">#{g.numero}</span> {g.nome}
                    {g.suspenso && <span className="ml-2 text-xs font-normal text-vg-erro">Suspenso</span>}
                  </p>
                  <MenuCartao itens={itensMenu(g)} />
                </div>
                {/* Métricas embaixo do nome, cada uma com rótulo pequeno e ícone. */}
                <div className="flex flex-wrap items-start gap-x-5 gap-y-2 pl-10">
                  <MetricaGrupo rotulo="Redirect" icone="ads_click" valor={`${g.cliques}/${limite}`} />
                  <MetricaGrupo rotulo="Cliques reais" icone="mouse" valor={g.cliquesReais} />
                  <MetricaGrupo rotulo="Participantes" icone="group" valor={g.participantes} />
                  <MetricaGrupo rotulo="Administradores" icone="admin_panel_settings" valor={g.admins} />
                  <MetricaGrupo rotulo="Leads" icone="person" valor={g.leads} />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-10 text-[13px] text-vg-text-2">
                  {g.link_convite && <CopiarLink url={g.link_convite} soBotao variante="texto" rotulo={`Link do grupo ${g.nome}`} />}
                  <span className="flex items-center gap-1 tabular-nums" title="Criado em">
                    <Icone nome="note_add" tamanho={16} />
                    {dataHoraCompleta(g.created_at)}
                  </span>
                  <span className="flex items-center gap-1" title={tipoGrupo}>
                    <Icone nome="group" tamanho={16} />
                    {tipoGrupo}
                  </span>
                  <label className="min-w-0">
                    <span className="block text-[11px] leading-4 text-vg-text-3">Cheio</span>
                    <select
                      className={`${estiloInput} h-8 py-1 text-[13px]`}
                      aria-label={`Cheio: ${g.nome}`}
                      value={g.cheioManual === null ? "automatico" : g.cheioManual ? "sim" : "nao"}
                      disabled={ocupado}
                      onChange={(e) => mudarCheio(g, e.target.value as "automatico" | "sim" | "nao")}
                    >
                      <option value="nao">Não</option>
                      <option value="sim">Sim</option>
                      <option value="automatico">Automático</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => setJanelaLinha({ tipo: "variaveis", grupo: g })}
                    aria-label={`Valores das variáveis no grupo ${g.nome}`}
                    title="Valores das variáveis no grupo"
                    className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    <Icone nome="data_object" tamanho={18} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Janela
        aberta={janela === "criar"}
        aoFechar={() => setJanela(null)}
        titulo="Criação de grupos"
        largura="lg"
        acaoTopo={
          <button
            type="button"
            onClick={() => setResetCriacao((k) => k + 1)}
            title="Descartar alterações"
            aria-label="Descartar alterações"
            className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
          >
            <Icone nome="delete" tamanho={20} />
          </button>
        }
      >
        {janela === "criar" && (
          <CriacaoDeGrupos
            key={resetCriacao}
            campanhaId={campanhaId}
            inicial={informacoesCriacao}
            contas={contas}
            criadoraId={criadoraId}
            adminsIniciais={adminsIniciais}
            adminsNumerosIniciais={adminsNumerosIniciais}
            aoFechar={() => setJanela(null)}
            aoConcluir={(texto) => {
              setJanela(null);
              setMsg({ texto, erro: false });
            }}
          />
        )}
      </Janela>
      <Janela
        aberta={janela === "alterar"}
        aoFechar={() => setJanela(null)}
        titulo="Alterar grupos em lote"
        largura="lg"
        acaoTopo={
          <button
            type="button"
            onClick={async () => {
              // Fecha a janela "Alterar em lote" depois de desativar — senão ela continuava aberta por cima
              // dos grupos que acabaram de ser desativados, com os checkboxes marcados pra uma lista que
              // já mudou.
              if (await excluir()) setJanela(null);
            }}
            disabled={!marcados.length || ocupado}
            title="Desativar grupos marcados"
            aria-label="Desativar grupos marcados"
            className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white disabled:pointer-events-none disabled:opacity-40"
          >
            <Icone nome="delete" tamanho={20} />
          </button>
        }
      >
        {janela === "alterar" && (
          <AlterarGruposEmLote
            campanhaId={campanhaId}
            inicial={alterarEmLote}
            contas={contas}
            criadoraId={criadoraId}
            adminsIniciais={adminsIniciais}
            adminsNumerosIniciais={adminsNumerosIniciais}
            marcados={marcados}
            ativos={ativos}
            campanhas={campanhas}
            telefones={telefones}
            modelos={modelos}
            aoFechar={() => setJanela(null)}
            aoConcluir={(texto) => {
              setMarcados(new Set());
              setJanela(null);
              setMsg({ texto, erro: false });
            }}
          />
        )}
      </Janela>
      <Janela aberta={janela === "participantesDup"} aoFechar={() => setJanela(null)} titulo="Participantes duplicados" largura="lg">
        {janela === "participantesDup" && <ParticipantesDuplicados campanhaId={campanhaId} />}
      </Janela>
      <Janela aberta={janela === "gruposDup"} aoFechar={() => setJanela(null)} titulo="Grupos duplicados" largura="lg">
        {janela === "gruposDup" && <GruposDuplicados campanhaId={campanhaId} />}
      </Janela>

      <Janela aberta={janelaLinha?.tipo === "detalhes"} aoFechar={() => setJanelaLinha(null)} titulo="Detalhes do grupo">
        {janelaLinha?.tipo === "detalhes" && <Detalhes grupo={janelaLinha.grupo} tipoGrupo={tipoGrupo} />}
      </Janela>
      <Janela aberta={janelaLinha?.tipo === "variaveis"} aoFechar={() => setJanelaLinha(null)} titulo="Valores das variáveis no grupo" largura="lg">
        {janelaLinha?.tipo === "variaveis" && (
          <VariaveisGrupo
            campanhaId={campanhaId}
            grupoId={janelaLinha.grupo.id}
            grupoNome={janelaLinha.grupo.nome}
            globais={globais}
            variaveisCampanha={variaveisCampanha}
          />
        )}
      </Janela>
      <Janela aberta={janelaLinha?.tipo === "editar"} aoFechar={() => setJanelaLinha(null)} titulo="Editar grupo">
        {janelaLinha?.tipo === "editar" && (
          <EditarNome
            campanhaId={campanhaId}
            grupoId={janelaLinha.grupo.id}
            nomeAtual={janelaLinha.grupo.nome}
            aoConcluir={(texto) => {
              setJanelaLinha(null);
              setMsg({ texto, erro: false });
            }}
          />
        )}
      </Janela>
    </>
  );
}
