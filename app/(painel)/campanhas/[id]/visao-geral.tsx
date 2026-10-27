import Link from "next/link";
import { PERIODOS, cartoesDoResumo, percentual, tempoDesde, type Resumo } from "@/src/lib/regras/campanhas";
import type { CampanhaTipo } from "@/src/lib/regras/campanha-tipo";
import type { MetricaDia } from "@/src/lib/regras/metricas";
import { SECOES_CAMPANHA, lerSecao, type SecaoCampanha } from "@/src/lib/regras/secoes-campanha";
import { serieDaMetrica, totalDaMetrica, type Metrica } from "@/src/lib/regras/serie-metrica";
import { AvatarFoto } from "../../_componentes/avatar-foto";
import { GraficoMetrica } from "../../_componentes/grafico-metrica";
import { Icone } from "../../_componentes/icone";
import { GradeNumeros, Informativo } from "../../_componentes/numeros";
import { SeletorPeriodo } from "../../_componentes/periodo";
import { SeletorIntervalo } from "../../_componentes/seletor-intervalo";
import { CopiarLink } from "./copiar-link";
import { MenuConfiguracoes } from "./menu-configuracoes";
import { MetricasTelaCheia } from "./metricas-tela-cheia";

export const PERIODOS_GRAFICO = [7, 14, 21, 28] as const;

/** Menu de seções e leitura de `?secao=` moram em `src/lib/regras/secoes-campanha.ts` (Etapa 3J). */
export const SECOES = SECOES_CAMPANHA;
export type Secao = SecaoCampanha;
export { lerSecao };

/** Dentro da campanha os rótulos ficam sem o "(total)". */
const ROTULO_NA_CAMPANHA: Record<string, string> = { "Participantes (total)": "Participantes", "Grupos (total)": "Grupos" };

const GRAFICOS: { metrica: Metrica; titulo: string; sufixo?: string }[] = [
  { metrica: "cliques", titulo: "Clicks" },
  { metrica: "entradas", titulo: "Entraram" },
  { metrica: "pct_entrada", titulo: "Percentual de entrada", sufixo: "%" },
  { metrica: "saidas", titulo: "Sairam" },
  { metrica: "pct_saida", titulo: "Percentual de Saída", sufixo: "%" },
];

export type CampanhaVisao = {
  id: string;
  nome: string;
  descricao: string | null;
  created_at: string;
  arquivada: boolean;
  fixada: boolean;
  slug: string;
  padrao_nome: string;
  fechado: boolean;
  limite_por_grupo: number;
  folga: number;
  conexao_criadora_id: string;
  usar_comunidade: boolean;
  crm_webhook_url: string;
  projeto_id: string | null;
  tipo: CampanhaTipo;
  /** `<input type="datetime-local">` (Brasília), ou "" quando a campanha não termina. */
  termina_em: string;
  link_apos_termino: string;
  admins: string[];
};
export type Estado = { dias: number; grafico: number; secao: Secao };

/** Monta `?dias=&grafico=&secao=` omitindo os padrões (90, 7, metricas). */
export function urlVisaoGeral(e: Estado, mudar: Partial<Estado>): string {
  const p = { ...e, ...mudar };
  const params = new URLSearchParams();
  if (p.dias !== 90) params.set("dias", String(p.dias));
  if (p.grafico !== 7) params.set("grafico", String(p.grafico));
  if (p.secao !== "metricas") params.set("secao", p.secao);
  const s = params.toString();
  return s ? `?${s}` : "?";
}

/** Visão geral da campanha: 8 números, caixa da campanha, link de convite, menu de seções e
 *  o conteúdo da seção (`conteudo`; na seção Métricas, os 5 gráficos a partir de `metricas`). Só apresentação. */
export function PainelVisaoGeral({ campanha, foto = null, projetos, link, resumo, metricas, estado, conteudo }: {
  campanha: CampanhaVisao;
  /** Foto da campanha (`fotoDaCampanha`, Etapa 3M); null = letra. */
  foto?: string | null;
  projetos: { id: string; nome: string }[];
  link: string;
  resumo: Resumo;
  metricas: MetricaDia[];
  estado: Estado;
  conteudo?: React.ReactNode;
}) {
  // Dentro da campanha os cartões "Participantes"/"Grupos" não levam o detalhe "… em grupos distintos de
  // WhatsApp" (só faz sentido comparando várias campanhas, na lista.1): por
  // isso `cartoesDoResumo` é chamado sem `distintos` aqui.
  const cartoesBrutos = cartoesDoResumo(resumo);
  const cartoes = cartoesBrutos.map((c) => ({ ...c, rotulo: ROTULO_NA_CAMPANHA[c.rotulo] ?? c.rotulo }));
  // "N Total" dos gráficos: o valor do cartão correspondente dos 8 números de cima, no período
  // maior da página (`estado.dias`) — nos de percentual também. "Percentual de Saída" não tem
  // cartão próprio lá em cima: calcula na hora com os mesmos totais do período.
  const totalGeralPorRotulo = new Map<string, string>(cartoesBrutos.map((c) => [c.rotulo, c.valor]));
  totalGeralPorRotulo.set("Percentual de Saída", percentual(resumo.saidas, resumo.entradas));
  const url = (mudar: Partial<Estado>) => urlVisaoGeral(estado, mudar);
  const titulo = SECOES.find((s) => s.valor === estado.secao)!.rotulo;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Informativo>Cliques, entradas e saídas dos últimos {estado.dias} dias. Participantes e grupos: total atual.</Informativo>
        <SeletorPeriodo atual={estado.dias} opcoes={PERIODOS} href={(d) => url({ dias: d })} />
      </div>

      <GradeNumeros cartoes={cartoes} />

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-vg-line p-4">
          <AvatarFoto nome={campanha.nome} foto={foto} ativo={!campanha.arquivada} tamanho={48} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold">{campanha.nome}</h1>
            {campanha.descricao && <p className="truncate text-[11px] text-vg-text-2">{campanha.descricao}</p>}
            <p className="text-xs text-vg-muted">{tempoDesde(campanha.created_at)}</p>
          </div>
          <span aria-hidden className="hidden h-12 w-px bg-vg-line sm:block" />
          <MenuConfiguracoes campanha={campanha} projetos={projetos} />
        </div>

        <div className="space-y-3 rounded-xl border border-vg-line p-4">
          <h2 className="text-[15px] font-semibold">Link de convite</h2>
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 truncate text-[13px] text-vg-muted" title={link}>{link}</span>
            <Link href={`/campanhas/${campanha.id}/configuracoes`} className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-white hover:text-vg-accent">
              <Icone nome="edit" tamanho={16} /> EDITAR
            </Link>
            <CopiarLink url={link} soBotao variante="texto" semIcone />
          </div>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Seções da campanha" className="self-start rounded-xl border border-vg-line py-3">
          <ul>
            {SECOES.map((s) => {
              const ativo = s.valor === estado.secao;
              return (
                <li key={s.valor}>
                  <Link
                    href={url({ secao: s.valor })}
                    scroll={false}
                    aria-current={ativo ? "page" : undefined}
                    className={`block border-l-4 px-5 py-3 text-[13px] transition-colors ${ativo ? "border-vg-accent font-medium text-vg-accent" : "border-transparent text-vg-text hover:bg-white/5"}`}
                  >
                    {s.rotulo}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <section aria-label={titulo} className="min-w-0 rounded-xl border border-vg-line p-4 md:p-6">
          {estado.secao === "metricas" ? (
            <div id="vg-metricas" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg">Métricas</h2>
                <div className="flex flex-wrap items-center gap-1">
                  <SeletorPeriodo atual={estado.grafico} opcoes={PERIODOS_GRAFICO} sufixo="" href={(d) => url({ grafico: d })} />
                  <SeletorIntervalo parametroInicio="de" parametroFim="ate" />
                  <MetricasTelaCheia idAlvo="vg-metricas" />
                </div>
              </div>
              {GRAFICOS.map((g, i) => (
                <GraficoMetrica
                  key={g.metrica}
                  titulo={g.titulo}
                  total={totalDaMetrica(metricas, g.metrica)}
                  sufixoTotal={g.sufixo}
                  totalGeral={totalGeralPorRotulo.get(g.titulo)}
                  atualizar={i === 0}
                  serie={serieDaMetrica(metricas, g.metrica)}
                  idGradiente={`vg-metrica-${g.metrica}`}
                />
              ))}
            </div>
          ) : (
            conteudo
          )}
        </section>
      </div>
    </div>
  );
}

/** Título + subtítulo das seções de configuração dentro da Visão geral. */
export function TituloSecao({ titulo, subtitulo }: { titulo: string; subtitulo?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg">{titulo}</h2>
      {subtitulo && <p className="text-[13px] text-vg-text-2">{subtitulo}</p>}
    </div>
  );
}
