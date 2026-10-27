import { notFound } from "next/navigation";
import { inicioDoPeriodo, somarResumos, type CartaoNumero } from "@/src/lib/regras/campanhas";
import { formatarNumero } from "@/src/lib/regras/inicio";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { CartaoCampanha } from "../../_componentes/cartao-campanha";
import { Icone } from "../../_componentes/icone";
import { GradeNumeros } from "../../_componentes/numeros";
import { DefinirTrilha } from "../../_componentes/trilha";
import { BotaoLink, Pagina, Vazio, estiloCartao } from "../../_componentes/ui";
import { carregarCampanhasComResumo, comFotos, RESUMO_ZERO } from "../../campanhas/dados";
import { UUID } from "@/src/lib/regras/uuid";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

/** Página do projeto (spec "Projetos"): migalha Projetos › nome; números (Campanhas, Grupos, Leads — de
 *  `resumo_projetos`, igual à grade da lista — e Cliques 30 dias, pela mesma tabela `cliques` que
 *  `cliques_por_campanha`/`resumo_campanhas` usam); e as campanhas do projeto com o mesmo cartão e as mesmas
 *  contagens da tela `/campanhas` (`carregarCampanhasComResumo`, extraído de lá). */
export default async function ProjetoDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("projetos");
  if (b) return b;
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const db = await dbUsuario();
  const [{ data: projeto, error: erroProjeto }, { data: linhasResumo, error: erroResumo }] = await Promise.all([
    db.from("projetos").select("id, nome, descricao, cor").eq("id", id).maybeSingle(),
    db.rpc("resumo_projetos", { ids: [id] }),
  ]);
  if (erroProjeto || erroResumo) throw new Error("Não foi possível carregar o projeto.");
  if (!projeto) notFound();

  const linha = (linhasResumo ?? [])[0] as Record<string, unknown> | undefined;
  const campanhasDoProjeto = Number(linha?.campanhas ?? 0);
  const gruposDoProjeto = Number(linha?.grupos ?? 0);
  const leadsDoProjeto = Number(linha?.leads ?? 0);

  // Cliques dos últimos 30 dias: mesma janela e mesma contagem (tabela `cliques`) de `resumo_campanhas` /
  // `cliques_por_campanha` — e já dá o resumo pra cada cartão de campanha abaixo, numa chamada só.
  const desde = inicioDoPeriodo(30);
  const { campanhas, resumos } = await carregarCampanhasComResumo(db, { desde, filtro: { tipo: "projeto", id } });
  const ativas = await comFotos(db, campanhas.filter((c) => !c.arquivada));
  const cliques30 = somarResumos(ativas.map((c) => resumos.get(c.id) ?? RESUMO_ZERO)).cliques;

  const cartoes: CartaoNumero[] = [
    { icone: "campaign", rotulo: "Campanhas", valor: formatarNumero(campanhasDoProjeto) },
    { icone: "groups", rotulo: "Grupos", valor: formatarNumero(gruposDoProjeto) },
    { icone: "people", rotulo: "Leads", valor: formatarNumero(leadsDoProjeto) },
    { icone: "ads_click", rotulo: "Cliques 30 dias", valor: formatarNumero(cliques30) },
  ];

  return (
    <Pagina
      titulo={projeto.nome}
      subtitulo={projeto.descricao || undefined}
      trilha={[{ rotulo: "Projetos", href: "/projetos" }]}
      acoes={
        <BotaoLink href={`/campanhas/nova?projeto=${id}`} variante="contorno" icone={<Icone nome="add" />}>
          Campanha
        </BotaoLink>
      }
    >
      <DefinirTrilha itens={[{ rotulo: "Projetos", href: "/projetos" }, { rotulo: projeto.nome }]} />

      <GradeNumeros cartoes={cartoes} />

      {ativas.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio texto="Nenhuma campanha neste projeto" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ativas.map((c) => (
            <CartaoCampanha key={c.id} campanha={c} resumo={resumos.get(c.id) ?? RESUMO_ZERO} />
          ))}
        </div>
      )}
    </Pagina>
  );
}
