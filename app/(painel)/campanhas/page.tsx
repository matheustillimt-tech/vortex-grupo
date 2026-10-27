import { Informativo, GradeNumeros } from "../_componentes/numeros";
import { SeletorPeriodo } from "../_componentes/periodo";
import { Abas } from "../_componentes/abas";
import { BotaoLink, Pagina } from "../_componentes/ui";
import { Icone } from "../_componentes/icone";
import { CampoBusca } from "../_componentes/campo-busca";
import {
  PERIODOS,
  cartoesDoResumo,
  filtrarCampanhas,
  inicioDoPeriodo,
  lerOrdemCampanha,
  lerPeriodo,
  paginar,
  somarResumos,
  type Resumo,
} from "@/src/lib/regras/campanhas";
import { gruposDistintos } from "@/src/lib/regras/grupos-distintos";
import { filtroProjeto } from "@/src/lib/regras/projetos";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { carregarCampanhasComResumo, carregarGruposParaDistintos, comFotos, RESUMO_ZERO } from "./dados";
import { lerPadraoCampanhaAtual } from "./actions";
import { CriarCampanha } from "./criar-campanha";
import { ExplicacaoDados } from "./explicacao-dados";
import { ListaSelecionavel } from "./lista-selecionavel";
import { EnviarAoMudar, SeletorProjeto } from "./ordenacao";
import { PadraoCriacao } from "./padrao-criacao";
import { Paginacao } from "../_componentes/paginacao";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

type Aba = "todas" | "ativas" | "arquivadas";

const ABA_PADRAO: Aba = "todas";
const OPCOES_POR_PAGINA = [12, 48, 96, 162, 384, 768, 1536] as const;
const POR_PAGINA_PADRAO = 12;

function lerAba(v: string | undefined): Aba {
  return v === "ativas" || v === "arquivadas" ? v : ABA_PADRAO;
}

function lerPorPagina(v: string | undefined): number {
  const n = Number(v);
  return (OPCOES_POR_PAGINA as readonly number[]).includes(n) ? n : POR_PAGINA_PADRAO;
}

export default async function Campanhas({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string; aba?: string; ordem?: string; q?: string; projeto?: string; pagina?: string; por?: string; nova?: string }>;
}) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const sp = await searchParams;
  const dias = lerPeriodo(sp.dias);
  const aba = lerAba(sp.aba);
  const ordem = lerOrdemCampanha(sp.ordem);
  const q = sp.q ?? "";
  const projetoRaw = sp.projeto ?? "";
  const filtro = filtroProjeto(sp.projeto);
  const porPagina = lerPorPagina(sp.por);
  const paginaAtual = Math.max(1, Number(sp.pagina) || 1);

  /** Preserva os outros parâmetros (omitindo os padrões) e volta para a página 1 quando muda filtro, aba,
   *  busca, ordem ou linhas por página. */
  function url(mudar: Record<string, string | number | undefined>): string {
    const atuais: Record<string, string | number | undefined> = { dias, aba, ordem, q, projeto: projetoRaw, pagina: paginaAtual, por: porPagina };
    const proxima = { ...atuais, ...mudar };
    if (!("pagina" in mudar)) proxima.pagina = 1;
    const params = new URLSearchParams();
    if (proxima.dias && Number(proxima.dias) !== 90) params.set("dias", String(proxima.dias));
    if (proxima.aba && proxima.aba !== ABA_PADRAO) params.set("aba", String(proxima.aba));
    if (proxima.ordem && proxima.ordem !== "criacao") params.set("ordem", String(proxima.ordem));
    if (proxima.q) params.set("q", String(proxima.q));
    if (proxima.projeto) params.set("projeto", String(proxima.projeto));
    if (proxima.por && Number(proxima.por) !== POR_PAGINA_PADRAO) params.set("por", String(proxima.por));
    if (proxima.pagina && Number(proxima.pagina) !== 1) params.set("pagina", String(proxima.pagina));
    const s = params.toString();
    return s ? `?${s}` : "?";
  }

  const db = await dbUsuario();
  const desde = inicioDoPeriodo(dias);
  const [{ data: projetosAtivos }, { campanhas: lista, resumos }, podeEditar, { data: conexoes }, padrao, veProjetos] = await Promise.all([
    db.from("projetos").select("id, nome").eq("arquivado", false).order("nome"),
    carregarCampanhasComResumo(db, { desde, filtro }),
    permitido("campanhas", "editar"),
    db.from("conexoes").select("id, nome, telefone, status").order("nome"),
    lerPadraoCampanhaAtual(),
    permitido("projetos", "ver"),
  ]);

  // Projeto filtrado pode estar arquivado (não está em `projetosAtivos`): carrega o nome dele pra o select
  // mostrar o filtro de verdade, idêntico ao que `/campanhas/[id]/configuracoes` já faz pro projeto da campanha.
  let nomeArquivado: string | undefined;
  if (filtro.tipo === "projeto" && !(projetosAtivos ?? []).some((p) => p.id === filtro.id)) {
    const { data: projetoArquivado } = await db.from("projetos").select("id, nome").eq("id", filtro.id).maybeSingle();
    if (projetoArquivado) nomeArquivado = projetoArquivado.nome;
  }

  const filtradas = filtrarCampanhas(lista, { aba, busca: q, ordem });
  const resumoTotal = somarResumos(filtradas.map((c) => resumos.get(c.id) ?? RESUMO_ZERO));
  const gruposParaDistintos = await carregarGruposParaDistintos(db, filtradas.map((c) => c.id));
  const distintos = gruposDistintos(gruposParaDistintos);
  const { itens: itensSemFoto, de, ate, total, pagina, paginas } = paginar(filtradas, paginaAtual, porPagina);
  const itens = await comFotos(db, itensSemFoto);

  return (
    <Pagina
      titulo="Campanhas"
      acoes={
        <>
          {/* Projetos saiu do menu lateral (19/10/2026): entra por aqui, à esquerda de "Padrão de criação". */}
          {veProjetos && (
            <BotaoLink href="/projetos" variante="contorno" icone={<Icone nome="folder" />}>
              Projetos
            </BotaoLink>
          )}
          {podeEditar && <PadraoCriacao inicial={padrao} conexoes={conexoes ?? []} campanhas={lista.map((c) => ({ id: c.id, nome: c.nome }))} />}
          <CriarCampanha
            abrirInicial={sp.nova === "1"}
            projetos={projetosAtivos ?? []}
            projetoInicial={sp.nova === "1" && filtro.tipo === "projeto" ? filtro.id : ""}
          />
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <ExplicacaoDados />
          <Informativo semIcone>
            Cliques, entradas e saídas dos últimos {dias} dias. Participantes e grupos mostram o total atual e os grupos distintos de
            WhatsApp entre campanhas.
          </Informativo>
        </div>
        <SeletorPeriodo atual={dias} opcoes={PERIODOS} href={(d) => url({ dias: d })} />
      </div>

      <GradeNumeros cartoes={cartoesDoResumo(resumoTotal, distintos)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Abas
          itens={[
            { href: url({ aba: "todas" }), rotulo: "Campanhas", ativo: aba === "todas" },
            { href: url({ aba: "ativas" }), rotulo: "Ativas", ativo: aba === "ativas" },
            { href: url({ aba: "arquivadas" }), rotulo: "Arquivadas", ativo: aba === "arquivadas" },
          ]}
        />
        <form method="get" className="flex flex-wrap items-center gap-3 text-sm text-vg-text">
          <input type="hidden" name="dias" value={dias} />
          <input type="hidden" name="aba" value={aba} />
          <input type="hidden" name="q" value={q} />
          <input type="hidden" name="pagina" value={1} />
          {/* Select "Projeto" só aparece quando existe projeto (ativo ou o arquivado filtrado) —
           *  (Global Constraints, Decisões). */}
          {((projetosAtivos ?? []).length > 0 || nomeArquivado) && (
            <SeletorProjeto atual={projetoRaw} projetos={projetosAtivos ?? []} nomeArquivado={nomeArquivado} />
          )}
          <EnviarAoMudar ordem={ordem} />
        </form>
      </div>

      <form method="get" className="flex items-center gap-2">
        <input type="hidden" name="dias" value={dias} />
        <input type="hidden" name="aba" value={aba} />
        <input type="hidden" name="ordem" value={ordem} />
        <input type="hidden" name="projeto" value={projetoRaw} />
        <input type="hidden" name="por" value={porPagina} />
        <CampoBusca valorInicial={q} rotulo="Buscar campanhas" />
      </form>

      <Paginacao
        de={de}
        ate={ate}
        total={total}
        porPagina={porPagina}
        opcoesPorPagina={OPCOES_POR_PAGINA}
        parametroPorPagina="por"
        primeira={pagina > 1 ? url({ pagina: 1 }) : undefined}
        anterior={pagina > 1 ? url({ pagina: pagina - 1 }) : undefined}
        proxima={pagina < paginas ? url({ pagina: pagina + 1 }) : undefined}
        ultima={pagina < paginas ? url({ pagina: paginas }) : undefined}
      />

      <ListaSelecionavel itens={itens} resumos={itens.map((c): [string, Resumo] => [c.id, resumos.get(c.id) ?? RESUMO_ZERO])} />
    </Pagina>
  );
}
