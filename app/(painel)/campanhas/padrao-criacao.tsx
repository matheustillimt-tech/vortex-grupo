"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PadraoCampanha, PadraoCampanhaEntrada } from "@/src/lib/regras/padrao-campanha";
import { OPCOES_TEMPORARIAS, type OpcaoTemporarias } from "@/src/lib/regras/conteudo-v2";
import { CampoImagemGrupo } from "../_componentes/campo-imagem-grupo";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Botao, Campo, estiloBotao, estiloInput, Segmentos } from "../_componentes/ui";
import { AbaAdministradoresComNumeros, camposAdminsNumeros, type ContaParaAdmin } from "./[id]/grupos/administradores";
import { aplicarPadraoEmCampanhas, copiarPadraoDeCampanha, salvarPadraoCampanha } from "./actions";

export type ConexaoOpcao = ContaParaAdmin;
export type CampanhaOpcao = { id: string; nome: string };

const ROTULO_TEMPORARIAS: Record<OpcaoTemporarias, string> = { nao: "Desativado", "24h": "24 horas", "7d": "7 dias", "90d": "90 dias" };

/** Texto do `confirm` de "Aplicar padrão": deixa claro o que muda (TODAS as opções do padrão sobrescrevem as das
 *  campanhas, inclusive as desligadas; contas associadas; nome dos próximos grupos) e o que não muda (grupos que já
 *  existem não são renomeados; imagem e descrição). */
export function textoConfirmacaoAplicar(quantas: number, comContas: boolean): string {
  return [
    `Aplicar este padrão em ${quantas} campanha(s)?`,
    "Todas as opções do padrão substituem as das campanhas, inclusive as que estão desligadas no padrão, como \"Não criar grupos ou comunidades\" e \"Atualização periódica de links\": o que estiver desligado aqui será desligado nas campanhas.",
    comContas
      ? "As conexões associadas de cada campanha serão substituídas pelas conexões de administrador do padrão (a conexão que cria os grupos continua)."
      : "As conexões associadas não mudam (o padrão não tem conexões de administrador).",
    "Os administradores por número do padrão são acrescentados; os que a campanha já tem continuam.",
    "O padrão de nome passa a valer para os próximos grupos criados; os grupos que já existem não são renomeados.",
    "Imagem e descrição dos grupos não mudam.",
  ].join("\n\n");
}

const PADRAO_VAZIO: PadraoCampanhaEntrada = {
  ativo: false,
  fechado: true,
  limite_por_grupo: 350,
  folga: 1,
  padrao_nome: "GRUPO #{n}",
  usar_comunidade: false,
  admins: [],
  admins_numeros: [],
  cookie_redirecionamento: true,
  checar_duplicados: true,
  deep_linking: false,
  verificacao_colaboradores: false,
  atualizar_links_banimento: false,
  links_periodicos: false,
  links_por_dia: 1,
  redefinir_link_cheio: false,
  aprovacao_entrada: false,
  mensagens_temporarias: "nao",
  inicio_contagem: 1,
  caractere_numeracao: "",
  numero_no_inicio: false,
  nao_criar_grupos: false,
  limite_cliques_sem_criar: null,
  modo_criacao: "normal",
  criar_aberto_fechar_24h: false,
  imagem_grupo_url: null,
  recusar_bloqueados: false,
};

/** Mescla o padrão salvo com `PADRAO_VAZIO`: chave ausente ou `undefined` (padrão salvo antes da Etapa 3K, ou
 *  nunca usado) mantém o default do sistema — nunca fica `undefined` no formulário. */
function comDefaults(inicial: PadraoCampanha | null): PadraoCampanhaEntrada {
  const base: PadraoCampanhaEntrada = { ...PADRAO_VAZIO };
  if (!inicial) return base;
  for (const [chave, valor] of Object.entries(inicial)) {
    if (valor !== undefined) (base as Record<string, unknown>)[chave] = valor;
  }
  return base;
}

/** Interruptor "Ativado/Desativado" reaproveitado neste diálogo: quando `desabilitado`, mostra a nota honesta em
 *  vez de deixar a pessoa mudar algo que não tem efeito nenhum no Vórtex Grupo. */
function Interruptor({ rotulo, nota, checked, onChange, desabilitado }: {
  rotulo: string;
  nota?: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  desabilitado?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          disabled={desabilitado}
          onChange={(e) => onChange?.(e.target.checked)}
        />
        <span className={desabilitado ? "text-vg-text-3" : undefined}>{rotulo}</span>
      </label>
      {nota && <p className="pl-6 text-xs text-vg-text-3">{nota}</p>}
    </div>
  );
}

/**
 * Diálogo "Padrão de criação de campanhas" (botão `tune` da lista). Completo na Etapa 3K,
 * Tarefa 2: seções "Configurações" (interruptores da campanha, Etapa 3J), "Criação de grupos" (campos da Etapa
 * 3E, mesmos componentes) e "Administradores" (contas de hoje + números por telefone da Tarefa 1). "Recusar automaticamente números bloqueados" funciona
 * desde a Etapa 3M (Tarefa 4).
 */
export function PadraoCriacao({ inicial, conexoes, campanhas }: { inicial: PadraoCampanha | null; conexoes: ConexaoOpcao[]; campanhas: CampanhaOpcao[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [f, setF] = useState<PadraoCampanhaEntrada>(() => comDefaults(inicial));
  const [camposNumeros, setCamposNumeros] = useState(() => camposAdminsNumeros(f.admins_numeros ?? []));
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [campanhaParaCopiar, setCampanhaParaCopiar] = useState(campanhas[0]?.id ?? "");
  const [copiando, setCopiando] = useState(false);

  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [aplicando, setAplicando] = useState(false);
  const [adminsConta, setAdminsConta] = useState<Set<string>>(new Set(f.admins));

  const set = <K extends keyof PadraoCampanhaEntrada>(k: K, v: PadraoCampanhaEntrada[K]) => setF((atual) => ({ ...atual, [k]: v }));

  function fechar() {
    setAberta(false);
    setErro(null);
    setAviso(null);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setAviso(null);
    setSalvando(true);
    const entrada: PadraoCampanhaEntrada = { ...f, admins: [...adminsConta], admins_numeros: camposNumeros.map((c) => c.valor) };
    const r = await salvarPadraoCampanha(entrada);
    setSalvando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setAviso("Padrão salvo.");
    router.refresh();
  }

  async function copiar() {
    if (!campanhaParaCopiar) return;
    setErro(null);
    setAviso(null);
    setCopiando(true);
    const r = await copiarPadraoDeCampanha(campanhaParaCopiar);
    setCopiando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    if (r.valor) {
      setF((atual) => ({ ...atual, ...r.valor }));
      setAdminsConta(new Set(r.valor.admins));
      setCamposNumeros(camposAdminsNumeros(r.valor.admins_numeros ?? []));
    }
  }

  function alternarSelecionada(id: string) {
    setSelecionadas((atual) => {
      const novo = new Set(atual);
      if (novo.has(id)) novo.delete(id);
      else novo.add(id);
      return novo;
    });
  }

  async function aplicarEmSelecionadas() {
    if (selecionadas.size === 0) return;
    if (!confirm(textoConfirmacaoAplicar(selecionadas.size, adminsConta.size > 0))) return;
    setErro(null);
    setAviso(null);
    setAplicando(true);
    const { ativo: _ativo, ...resto } = f;
    const campos = { ...resto, admins: [...adminsConta], admins_numeros: camposNumeros.map((c) => c.valor) };
    const r = await aplicarPadraoEmCampanhas(campos, [...selecionadas]);
    setAplicando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setAviso(`Padrão aplicado em ${r.aplicadas} campanha(s).${r.aviso ? ` ${r.aviso}` : ""}`);
    setSelecionadas(new Set());
    router.refresh();
  }

  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={estiloBotao("contorno")}>
        <Icone nome="tune" /> Padrão de criação
      </button>
      <Janela aberta={aberta} aoFechar={fechar} titulo="Padrão de criação de campanhas" largura="lg">
        <form className="grid gap-5" onSubmit={salvar}>
          <div className="space-y-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={f.ativo} onChange={(e) => set("ativo", e.target.checked)} />
              Usar padrão ao criar novas campanhas
            </label>
            <p className="text-xs text-vg-text-2">
              {f.ativo ? "Ativado — novas campanhas usam os valores abaixo." : "Desativado — novas campanhas usam os padrões do sistema."}
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-vg-line p-4">
            <h3 className="text-[13.3px] font-medium">Copiar de campanha existente</h3>
            <div className="flex flex-wrap items-end gap-2">
              <select className={`${estiloInput} max-w-xs`} value={campanhaParaCopiar} onChange={(e) => setCampanhaParaCopiar(e.target.value)} aria-label="Escolha uma campanha">
                <option value="">Escolha uma campanha</option>
                {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
              <Botao type="button" variante="secundario" onClick={copiar} disabled={!campanhaParaCopiar || copiando}>
                Copiar
              </Botao>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-vg-line p-4">
            <h3 className="text-[13.3px] font-medium">Aplicar em campanhas existentes</h3>
            <p className="text-xs text-vg-text-2">Aplica o padrão configurado abaixo nas campanhas selecionadas. Nome, imagem e descrição dos grupos não são alterados.</p>
            <p className="text-xs text-vg-text-3">Números já cadastrados nas campanhas são mantidos.</p>
            <select
              multiple
              className={`${estiloInput} h-32`}
              aria-label="Selecione as campanhas"
              value={[...selecionadas]}
              onChange={(e) => setSelecionadas(new Set([...e.target.selectedOptions].map((o) => o.value)))}
            >
              {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </select>
            <div>
              <Botao type="button" variante="secundario" onClick={aplicarEmSelecionadas} disabled={selecionadas.size === 0 || aplicando}>
                Aplicar padrão
              </Botao>
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-vg-line p-4">
            <h3 className="text-[13.3px] font-medium">Configurações</h3>
            <Interruptor rotulo="Cookie de redirecionamento" checked={f.cookie_redirecionamento!} onChange={(v) => set("cookie_redirecionamento", v)} />
            <Interruptor rotulo="Checar participantes duplicados" checked={f.checar_duplicados!} onChange={(v) => set("checar_duplicados", v)} />
            <Interruptor rotulo="Deep Linking" checked={f.deep_linking!} onChange={(v) => set("deep_linking", v)} />
            <Interruptor rotulo="Verificação de Colaboradores" checked={f.verificacao_colaboradores!} onChange={(v) => set("verificacao_colaboradores", v)} />
            <Interruptor
              rotulo="Gestão de comunidades"
              checked={f.usar_comunidade}
              onChange={(v) => set("usar_comunidade", v)}
              nota="Cria comunidades ao invés de grupos normais. Remover comentários não está disponível: o WhatsApp não avisa o Vórtex Grupo sobre comentários."
            />
            <Interruptor rotulo="Atualização de links" checked={f.atualizar_links_banimento!} onChange={(v) => set("atualizar_links_banimento", v)} />
            <div className="space-y-2">
              <Interruptor rotulo="Atualização periódica de links" checked={f.links_periodicos!} onChange={(v) => set("links_periodicos", v)} />
              {f.links_periodicos && (
                <Campo rotulo="Quantidade de atualizações por dia">
                  <input
                    type="number"
                    min={1}
                    max={24}
                    className={estiloInput}
                    value={f.links_por_dia}
                    onChange={(e) => set("links_por_dia", Number(e.target.value))}
                  />
                </Campo>
              )}
            </div>
            <Interruptor rotulo="Redefinir link de convite" checked={f.redefinir_link_cheio!} onChange={(v) => set("redefinir_link_cheio", v)} />
          </div>

          <div className="space-y-3 rounded-xl border border-vg-line p-4">
            <h3 className="text-[13.3px] font-medium">Criação de grupos</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.fechado} onChange={(e) => set("fechado", e.target.checked)} /> Apenas admins podem enviar mensagem
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.aprovacao_entrada!} onChange={(e) => set("aprovacao_entrada", e.target.checked)} /> Exigir aprovação de admin para novos participantes
            </label>
            <Interruptor
              rotulo="Recusar automaticamente números bloqueados (antispam, antispam global e blacklist)"
              checked={f.recusar_bloqueados === true}
              onChange={(v) => set("recusar_bloqueados", v)}
            />
            <Campo rotulo="Mensagens temporarias">
              <select className={estiloInput} value={f.mensagens_temporarias} onChange={(e) => set("mensagens_temporarias", e.target.value as OpcaoTemporarias)}>
                {OPCOES_TEMPORARIAS.map((o) => <option key={o} value={o}>{ROTULO_TEMPORARIAS[o]}</option>)}
              </select>
            </Campo>
            <CampoImagemGrupo
              rotulo="Imagem do grupo"
              valor={{ url: f.imagem_grupo_url ?? "" }}
              onChange={(v) => set("imagem_grupo_url", v.url || null)}
              pasta="padrao-campanha"
              nota="Vale para as campanhas criadas com o padrão. Aplicar em campanhas existentes não muda a imagem."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Início da contagem">
                <input type="number" min={0} className={estiloInput} value={f.inicio_contagem} onChange={(e) => set("inicio_contagem", Number(e.target.value))} />
              </Campo>
              <Campo rotulo="Caractere da numeração" dica="Caractere exibido antes ou depois do número do grupo. Ex.: # para eventos ativos, ! para grupos reaproveitados.">
                <input className={estiloInput} maxLength={3} value={f.caractere_numeracao} onChange={(e) => set("caractere_numeracao", e.target.value)} />
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Quantidade de grupos sempre disponíveis">
                <input type="number" min={1} max={10} className={estiloInput} value={f.folga} onChange={(e) => set("folga", Number(e.target.value))} />
              </Campo>
              <Campo rotulo="Limite de pessoas">
                <input type="number" min={10} max={1024} className={estiloInput} value={f.limite_por_grupo} onChange={(e) => set("limite_por_grupo", Number(e.target.value))} />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.numero_no_inicio!} onChange={(e) => set("numero_no_inicio", e.target.checked)} /> Número de contagem no início
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.nao_criar_grupos!} onChange={(e) => set("nao_criar_grupos", e.target.checked)} /> Não criar grupos ou comunidades
            </label>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={f.limite_cliques_sem_criar !== null && f.limite_cliques_sem_criar !== undefined}
                  onChange={(e) => set("limite_cliques_sem_criar", e.target.checked ? 50 : null)}
                />
                Não criar novos grupos por cliques altos
              </label>
              {/* "Quando ativar?" sempre visível, só desabilitado. */}
              <Campo rotulo="Quando ativar?" dica="Cliques na última hora a partir dos quais a criação automática para.">
                <input
                  type="number"
                  min={1}
                  disabled={f.limite_cliques_sem_criar === null || f.limite_cliques_sem_criar === undefined}
                  className={estiloInput}
                  value={f.limite_cliques_sem_criar ?? 50}
                  onChange={(e) => set("limite_cliques_sem_criar", Number(e.target.value))}
                />
              </Campo>
            </div>
            <Interruptor rotulo="Criar comunidades ao invés de grupos normais" checked={f.usar_comunidade} onChange={(v) => set("usar_comunidade", v)} nota="Mesmo ajuste de Gestão de comunidades." />
            <Campo rotulo="Modo de criação dos grupos">
              <Segmentos
                opcoes={[{ valor: "normal" as const, rotulo: "NORMAL" }, { valor: "seguro" as const, rotulo: "SEGURO" }]}
                valor={f.modo_criacao!}
                aoMudar={(v) => set("modo_criacao", v)}
              />
            </Campo>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.criar_aberto_fechar_24h!} onChange={(e) => set("criar_aberto_fechar_24h", e.target.checked)} /> Criar grupo aberto e fechar depois de 24h
            </label>
            <Interruptor
              rotulo="Ativar remoção automática de participantes duplicados"
              checked={f.checar_duplicados!}
              onChange={(v) => set("checar_duplicados", v)}
              nota="Mesmo ajuste de Checar participantes duplicados."
            />
          </div>

          <div className="space-y-2 rounded-xl border border-vg-line p-4">
            <h3 className="text-[13.3px] font-medium">Administradores</h3>
            <AbaAdministradoresComNumeros
              contas={conexoes}
              criadoraId={null}
              marcados={adminsConta}
              onChange={setAdminsConta}
              campos={camposNumeros}
              aoMudarCampos={setCamposNumeros}
              iniciais={f.admins_numeros ?? []}
              rotuloBotao="Adicionar administrador"
            />
          </div>

          <div className="space-y-3 rounded-xl border border-vg-line p-4">
            <Campo rotulo="Nome dos grupos" dica="{n} vira o número do grupo: AULÃO #{n} → AULÃO #01.">
              <input className={estiloInput} value={f.padrao_nome} onChange={(e) => set("padrao_nome", e.target.value)} />
            </Campo>
          </div>

          {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
          {aviso && <p className="text-sm text-vg-ok">{aviso}</p>}
          <div><Botao type="submit" disabled={salvando}>Salvar</Botao></div>
        </form>
      </Janela>
    </>
  );
}
