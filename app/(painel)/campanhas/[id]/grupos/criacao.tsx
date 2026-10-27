"use client";
import { useState } from "react";
import { OPCOES_TEMPORARIAS, type OpcaoTemporarias } from "@/src/lib/regras/conteudo-v2";
import type { OpcoesCriacao } from "@/src/lib/regras/criacao-grupos";
import { CampoImagemGrupo } from "../../../_componentes/campo-imagem-grupo";
import { Botao, Campo, estiloInput, Segmentos } from "../../../_componentes/ui";
import { AbaAdministradoresComNumeros, camposAdminsNumeros, type ContaParaAdmin } from "./administradores";
import { criarGrupoAgora, salvarCriacaoDeGrupos, type InformacoesCriacaoEntrada } from "./actions";

const ROTULO_TEMPORARIAS: Record<OpcaoTemporarias, string> = { nao: "Desativado", "24h": "24 horas", "7d": "7 dias", "90d": "90 dias" };

type Aba = "informacoes" | "administradores";

/**
 * Diálogo "Criação de grupos" (CRIAR GRUPOS): abas "Informações" / "Administradores". Só
 * grava as opções da campanha — não cria grupo nenhum (quem cria é "Criar grupo agora", botão secundário aqui
 * mesmo). Vale só pra grupos novos, por isso a nota do rodapé.
 */
export function CriacaoDeGrupos({ campanhaId, inicial, contas, criadoraId, adminsIniciais, adminsNumerosIniciais, aoFechar, aoConcluir }: {
  campanhaId: string;
  inicial: InformacoesCriacaoEntrada;
  contas: ContaParaAdmin[];
  criadoraId: string | null;
  adminsIniciais: string[];
  /** Administradores por número salvos (`campanha_admins_numeros`), Etapa 3K. */
  adminsNumerosIniciais: string[];
  /** "FECHAR" do rodapé: mesmo fechamento do "close"/Esc do topo, sem salvar nada. */
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [aba, setAba] = useState<Aba>("informacoes");
  const [f, setF] = useState(inicial);
  const [admins, setAdmins] = useState<Set<string>>(new Set(adminsIniciais));
  const [camposNumeros, setCamposNumeros] = useState(() => camposAdminsNumeros(adminsNumerosIniciais));
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [criando, setCriando] = useState(false);
  const set = <K extends keyof InformacoesCriacaoEntrada>(k: K, v: InformacoesCriacaoEntrada[K]) => setF({ ...f, [k]: v });

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await salvarCriacaoDeGrupos(campanhaId, f, [...admins], camposNumeros.map((c) => c.valor));
      if (r.erro) return setErro(r.erro);
      aoConcluir("Opções de criação salvas.");
    } finally {
      setSalvando(false);
    }
  }

  async function criarAgora() {
    if (!window.confirm("Criar um grupo novo agora?")) return;
    setErro(null);
    setCriando(true);
    try {
      const r = await criarGrupoAgora(campanhaId);
      if (r.erro) setErro(r.erro);
      else aoConcluir("Grupo entrou na fila de criação (até 1 min).");
    } finally {
      setCriando(false);
    }
  }

  return (
    <div className="space-y-4">
      <Segmentos opcoes={[{ valor: "informacoes" as Aba, rotulo: "Informações" }, { valor: "administradores" as Aba, rotulo: "Administradores" }]} valor={aba} aoMudar={setAba} />

      {aba === "informacoes" ? (
        <div className="space-y-4">
          <Campo rotulo="Nome dos grupos *" dica="{n} vira o número do grupo: AULÃO #{n} → AULÃO #01." contador={`${Array.from(f.padrao_nome).length}/95`}>
            <input className={estiloInput} maxLength={95} value={f.padrao_nome} onChange={(e) => set("padrao_nome", e.target.value)} />
          </Campo>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fechado} onChange={(e) => set("fechado", e.target.checked)} /> Apenas admins podem enviar mensagem</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.aprovacao_entrada} onChange={(e) => set("aprovacao_entrada", e.target.checked)} /> Exigir aprovação de admin para novos participantes</label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.recusar_bloqueados} onChange={(e) => set("recusar_bloqueados", e.target.checked)} /> Recusar automaticamente números bloqueados (antispam, antispam global e blacklist)
          </label>
          <Campo rotulo="Mensagens temporarias">
            <select className={estiloInput} value={f.mensagens_temporarias} onChange={(e) => set("mensagens_temporarias", e.target.value as typeof f.mensagens_temporarias)}>
              {OPCOES_TEMPORARIAS.map((o) => <option key={o} value={o}>{ROTULO_TEMPORARIAS[o]}</option>)}
            </select>
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Início da contagem *"><input type="number" min={0} className={estiloInput} value={f.inicio_contagem} onChange={(e) => set("inicio_contagem", Number(e.target.value))} /></Campo>
            <Campo rotulo="Caractere da numeração" dica="Caractere exibido antes ou depois do número do grupo. Ex.: # para eventos ativos, ! para grupos reaproveitados.">
              <input className={estiloInput} maxLength={3} value={f.caractere_numeracao} onChange={(e) => set("caractere_numeracao", e.target.value)} />
            </Campo>
          </div>
          <CampoImagemGrupo
            rotulo="Imagem do grupo"
            valor={{ url: f.imagem_grupo_url ?? "" }}
            onChange={(v) => set("imagem_grupo_url", v.url || null)}
            pasta={`campanhas/${campanhaId}`}
          />
          <Campo rotulo="Descrição fixa do grupo *" contador={`${Array.from(f.descricao).length}/2048`}>
            <textarea className={estiloInput} rows={3} maxLength={2048} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </Campo>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Quantidade de grupos sempre disponíveis *"><input type="number" min={1} max={10} className={estiloInput} value={f.folga} onChange={(e) => set("folga", Number(e.target.value))} /></Campo>
            <Campo rotulo="Limite de pessoas *"><input type="number" min={10} max={1024} className={estiloInput} value={f.limite_por_grupo} onChange={(e) => set("limite_por_grupo", Number(e.target.value))} /></Campo>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.numero_no_inicio} onChange={(e) => set("numero_no_inicio", e.target.checked)} /> Número de contagem no início (sem {"{n}"} no padrão)
          </label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.nao_criar_grupos} onChange={(e) => set("nao_criar_grupos", e.target.checked)} /> Não criar grupos ou comunidades</label>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.limite_cliques_sem_criar !== null}
                onChange={(e) => set("limite_cliques_sem_criar", e.target.checked ? 50 : null)}
              />
              Não criar novos grupos por cliques altos
            </label>
            {/* "Quando ativar?" sempre visível, só desabilitado. */}
            <Campo rotulo="Quando ativar?" dica="Cliques na última hora a partir dos quais a criação automática para.">
              <input
                type="number"
                min={1}
                disabled={f.limite_cliques_sem_criar === null}
                className={estiloInput}
                value={f.limite_cliques_sem_criar ?? 50}
                onChange={(e) => set("limite_cliques_sem_criar", Number(e.target.value))}
              />
            </Campo>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.usar_comunidade} onChange={(e) => set("usar_comunidade", e.target.checked)} /> Criar comunidades ao invés de grupos normais</label>
          <Campo rotulo="Modo de criação dos grupos">
            <Segmentos opcoes={[{ valor: "normal" as const, rotulo: "NORMAL" }, { valor: "seguro" as const, rotulo: "SEGURO" }]} valor={f.modo_criacao} aoMudar={(v) => set("modo_criacao", v)} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.criar_aberto_fechar_24h} onChange={(e) => set("criar_aberto_fechar_24h", e.target.checked)} /> Criar grupo aberto e fechar depois de 24h
          </label>
        </div>
      ) : (
        <AbaAdministradoresComNumeros
          contas={contas}
          criadoraId={criadoraId}
          marcados={admins}
          onChange={setAdmins}
          campos={camposNumeros}
          aoMudarCampos={setCamposNumeros}
          iniciais={adminsNumerosIniciais}
        />
      )}

      <p className="text-xs text-vg-text-3">
        *Alterações feitas nessa tela não serão aplicadas nos grupos já existentes desta campanha, apenas em novos grupos.
      </p>
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Botao variante="secundario" disabled={criando} onClick={criarAgora}>Criar grupo agora</Botao>
        <div className="flex items-center gap-3">
          <Botao variante="secundario" type="button" onClick={aoFechar}>FECHAR</Botao>
          <Botao disabled={salvando} onClick={salvar}>SALVAR</Botao>
        </div>
      </div>
    </div>
  );
}
