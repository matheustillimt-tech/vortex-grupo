"use client";
import { useState } from "react";
import { OPCOES_TEMPORARIAS, type OpcaoTemporarias } from "@/src/lib/regras/conteudo-v2";
import type { ModeloLinha } from "../../../_componentes/escolher-modelo";
import { CampoImagemGrupo } from "../../../_componentes/campo-imagem-grupo";
import { NOTA_TIRAR_IMAGEM } from "@/src/lib/regras/imagem-grupo";
import { Botao, Campo, estiloInput, Segmentos } from "../../../_componentes/ui";
import { AbaAdministradoresComNumeros, camposAdminsNumeros, numerosTirados, type ContaParaAdmin } from "./administradores";
import { salvarAlterarGruposEmLote, type AlterarEmLoteEntrada } from "./actions";
import { FormularioAcaoEmMassa } from "./massa";

const ROTULO_TEMPORARIAS: Record<OpcaoTemporarias, string> = { nao: "Desativado", "24h": "24 horas", "7d": "7 dias", "90d": "90 dias" };

type Aba = "informacoes" | "administradores";

/**
 * Diálogo "Alterar grupos em lote" (ALTERAR GRUPOS): abas "Informações" / "Administradores". SALVAR grava
 * as opções na campanha (valem pros grupos futuros) e cria as execuções em massa pros grupos ativos de hoje, só
 * nos campos que mudaram (nome, descrição, configuração, mensagens temporárias e imagem do grupo). As ações de sempre
 * (abrir/fechar/admins/mover/redefinir) continuam por "Mais ações".
 */
export function AlterarGruposEmLote({ campanhaId, inicial, contas, criadoraId, adminsIniciais, adminsNumerosIniciais, marcados, ativos, campanhas, telefones, modelos, aoFechar, aoConcluir }: {
  campanhaId: string;
  inicial: AlterarEmLoteEntrada;
  contas: ContaParaAdmin[];
  criadoraId: string | null;
  adminsIniciais: string[];
  /** Administradores por número salvos (`campanha_admins_numeros`), Etapa 3K. */
  adminsNumerosIniciais: string[];
  /** Grupos marcados na lista (passados pro "Mais ações": sem marcados, as ações de lá valem pra todos os ativos). */
  marcados: string[];
  ativos: string[];
  campanhas: { id: string; nome: string }[];
  telefones: { nome: string; telefone: string }[];
  modelos: ModeloLinha[];
  /** "FECHAR" do rodapé: mesmo fechamento do "close"/Esc do topo, sem salvar nada. */
  aoFechar: () => void;
  aoConcluir: (mensagem: string) => void;
}) {
  const [aba, setAba] = useState<Aba>("informacoes");
  const [f, setF] = useState(inicial);
  const [admins, setAdmins] = useState<Set<string>>(new Set(adminsIniciais));
  const [camposNumeros, setCamposNumeros] = useState(() => camposAdminsNumeros(adminsNumerosIniciais));
  const [rebaixar, setRebaixar] = useState<Set<string>>(new Set());
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [maisAcoes, setMaisAcoes] = useState(false);
  const set = <K extends keyof AlterarEmLoteEntrada>(k: K, v: AlterarEmLoteEntrada[K]) => setF({ ...f, [k]: v });

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const r = await salvarAlterarGruposEmLote(
        campanhaId,
        f,
        [...admins],
        camposNumeros.map((c) => c.valor),
        numerosTirados(adminsNumerosIniciais, camposNumeros).filter((t) => rebaixar.has(t)),
      );
      if (r.erro) return setErro(r.erro);
      aoConcluir("Opções salvas; os grupos ativos já recebem as mudanças.");
    } finally {
      setSalvando(false);
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
          <Campo rotulo="Mensagens temporarias">
            <select className={estiloInput} value={f.mensagens_temporarias} onChange={(e) => set("mensagens_temporarias", e.target.value as OpcaoTemporarias)}>
              {OPCOES_TEMPORARIAS.map((o) => <option key={o} value={o}>{ROTULO_TEMPORARIAS[o]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Caractere da numeração" dica="Caractere exibido antes ou depois do número do grupo. Ex.: # para eventos ativos, ! para grupos reaproveitados.">
            <input className={estiloInput} maxLength={3} value={f.caractere_numeracao} onChange={(e) => set("caractere_numeracao", e.target.value)} />
          </Campo>
          <CampoImagemGrupo
            rotulo="Imagem do grupo"
            valor={{ url: f.imagem_grupo_url ?? "", nome_arquivo: f.imagem_nome_arquivo ?? null }}
            onChange={(v) => setF({ ...f, imagem_grupo_url: v.url || null, imagem_nome_arquivo: v.url ? v.nome_arquivo ?? null : null })}
            pasta={`campanhas/${campanhaId}`}
            nota={NOTA_TIRAR_IMAGEM}
          />
          <Campo rotulo="Descrição fixa do grupo *" contador={`${Array.from(f.descricao).length}/2048`}>
            <textarea className={estiloInput} rows={3} maxLength={2048} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={f.forcar} onChange={(e) => set("forcar", e.target.checked)} />
            Aplicar aos grupos existentes mesmo sem mudança
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
          rebaixar={rebaixar}
          aoRebaixar={setRebaixar}
        />
      )}

      <p className="text-xs text-vg-text-3">
        *Alterações feitas nessa tela serão aplicadas em todos os grupos desta campanha existentes e nos que estão por vir.
      </p>
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setMaisAcoes((m) => !m)} className="text-sm font-medium text-vg-accent hover:underline">
          {maisAcoes ? "Ocultar mais ações" : "Mais ações (abrir, fechar, admins, mover, redefinir link…)"}
        </button>
        <div className="flex items-center gap-3">
          <Botao variante="secundario" type="button" onClick={aoFechar}>FECHAR</Botao>
          <Botao disabled={salvando} onClick={salvar}>SALVAR</Botao>
        </div>
      </div>

      {maisAcoes && (
        <div className="space-y-2 rounded-lg border border-vg-line p-3">
          <FormularioAcaoEmMassa
            campanhaId={campanhaId}
            marcados={marcados}
            ativos={ativos}
            campanhas={campanhas}
            telefones={telefones}
            modelos={modelos}
            aoConcluir={aoConcluir}
          />
        </div>
      )}
    </div>
  );
}
