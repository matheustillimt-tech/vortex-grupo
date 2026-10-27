import {
  ABAS_CONTAS,
  filtrarContas,
  lerAbaContas,
  lerOrdemContas,
  type AbaContas,
  type ContaLista,
} from "@/src/lib/regras/contas";
import { papeisDasContas } from "@/src/lib/regras/contingencia";
import { paginar } from "@/src/lib/regras/campanhas";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { CartaoConta } from "../_componentes/cartao-conta";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina, Vazio, estiloCartao } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { NovaConta } from "./nova-conta";
import { EnviarAoMudar } from "./ordenacao";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

const ORDEM_PADRAO = "criacao" as const;
const ABA_PADRAO: AbaContas = "todas";
const POR_PAGINA = 12;

export default async function Numeros({
  searchParams,
}: {
  searchParams: Promise<{ aba?: string; ordem?: string; q?: string; pagina?: string; nova?: string }>;
}) {
  const b = await bloqueio("contas");
  if (b) return b;
  const sp = await searchParams;
  const podeEditar = await permitido("contas", "editar");
  const aba = lerAbaContas(sp.aba);
  const ordem = lerOrdemContas(sp.ordem);
  const q = sp.q ?? "";
  const paginaAtual = Math.max(1, Number(sp.pagina) || 1);

  /** Preserva os outros parâmetros (omitindo os padrões) e volta para a página 1 quando muda filtro. */
  function url(mudar: Record<string, string | number | undefined>): string {
    const atuais: Record<string, string | number | undefined> = { aba, ordem, q, pagina: paginaAtual };
    const proxima = { ...atuais, ...mudar };
    if (!("pagina" in mudar)) proxima.pagina = 1;
    const params = new URLSearchParams();
    if (proxima.aba && proxima.aba !== ABA_PADRAO) params.set("aba", String(proxima.aba));
    if (proxima.ordem && proxima.ordem !== ORDEM_PADRAO) params.set("ordem", String(proxima.ordem));
    if (proxima.q) params.set("q", String(proxima.q));
    if (proxima.pagina && Number(proxima.pagina) !== 1) params.set("pagina", String(proxima.pagina));
    const s = params.toString();
    return s ? `?${s}` : "?";
  }

  const db = await dbUsuario();
  const { data, error } = await db
    .from("conexoes")
    .select("id, nome, telefone, status, created_at, ultimo_erro, pausado_ate, projeto_id, projetos(nome)")
    .order("created_at");
  if (error) throw new Error("Não foi possível carregar as conexões.");
  const [{ data: campanhasAtivas }, { data: associacoes }] = await Promise.all([
    db.from("campanhas").select("id, nome, conexao_criadora_id").eq("arquivada", false),
    db.from("campanha_conexoes").select("campanha_id, conexao_id"),
  ]);
  const papeis = papeisDasContas(campanhasAtivas ?? [], associacoes ?? []);

  const lista: ContaLista[] = ((data ?? []) as unknown as (ContaLista & { projetos: { nome: string } | null })[]).map((c) => ({
    ...c,
    projeto_nome: c.projetos?.nome ?? null,
    papel: papeis.get(c.id),
  }));
  const filtradas = filtrarContas(lista, { aba, busca: q, ordem });
  const { itens, de, ate, total, pagina, paginas } = paginar(filtradas, paginaAtual, POR_PAGINA);

  return (
    <Pagina
      titulo="Conexões"
      acoes={
        <>
          <NovaConta abrirDeInicio={sp.nova === "1"} />
        </>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Abas
          itens={ABAS_CONTAS.map((a) => ({ href: url({ aba: a.valor }), rotulo: a.rotulo, ativo: aba === a.valor }))}
        />
        <form method="get" className="flex items-center gap-2 text-sm text-vg-text">
          {aba !== ABA_PADRAO && <input type="hidden" name="aba" value={aba} />}
          {q && <input type="hidden" name="q" value={q} />}
          <label className="flex items-center gap-2">
            <span>Ordenação</span>
            <EnviarAoMudar ordem={ordem} />
          </label>
        </form>
      </div>

      <form method="get" className="flex items-center gap-2">
        {aba !== ABA_PADRAO && <input type="hidden" name="aba" value={aba} />}
        {ordem !== ORDEM_PADRAO && <input type="hidden" name="ordem" value={ordem} />}
        <CampoBusca valorInicial={q} rotulo="Buscar conexões" />
      </form>

      <Paginacao
        de={de}
        ate={ate}
        total={total}
        anterior={pagina > 1 ? url({ pagina: pagina - 1 }) : undefined}
        proxima={pagina < paginas ? url({ pagina: pagina + 1 }) : undefined}
      />

      {itens.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {itens.map((c) => (
            <CartaoConta key={c.id} conta={c} href={`/numeros/${c.id}`} podeEditar={podeEditar} />
          ))}
        </div>
      )}
    </Pagina>
  );
}
