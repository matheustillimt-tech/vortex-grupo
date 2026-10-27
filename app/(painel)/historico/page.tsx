import { redirect } from "next/navigation";
import { escaparBuscaIlike } from "@/src/lib/regras/busca";
import {
  agruparPorDia, horaDoRegistro, lerFiltrosHistorico, linkDoRegistro, nomeOuEmailHistorico, urlHistorico,
  ICONE_ACAO_HISTORICO, COR_ACAO_HISTORICO, ROTULO_ACAO_HISTORICO, rotuloAreaHistorico, type LinhaHistorico,
} from "@/src/lib/regras/historico";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { montarListaMembros, type LinhaMembroDb, type UsuarioAuthResumo } from "../equipe/comum";
import { Paginacao } from "../_componentes/paginacao";
import { BotaoLink, estiloCartao, Pagina, Vazio } from "../_componentes/ui";
import { BarraFiltrosHistorico } from "./filtros";
import { BotaoDetalheHistorico } from "./detalhe";
import { Icone } from "../_componentes/icone";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { ABAS_MENSAGENS } from "@/src/lib/regras/abas-mensagens";
import { permitido } from "@/src/lib/permissoes";
import { SubAbas } from "../_acoes/filtros";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
const COLUNAS = "id, created_at, usuario_id, usuario_email, acao, area, resumo, ref_id";

export default async function Historico({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("historico");
  if (b) return b;
  const f = lerFiltrosHistorico(await searchParams);
  const db = await dbUsuario();
  const podeEditarAcoes = await permitido("campanhas", "editar");
  const inicio = (f.pagina - 1) * POR_PAGINA;

  let consulta = db.from("historico").select(COLUNAS, { count: "exact" });
  if (f.area) consulta = consulta.eq("area", f.area);
  if (f.acao) consulta = consulta.eq("acao", f.acao);
  if (f.membroId) consulta = consulta.eq("usuario_id", f.membroId);
  if (f.desde) consulta = consulta.gte("created_at", `${f.desde}T00:00:00-03:00`);
  if (f.ate) consulta = consulta.lte("created_at", `${f.ate}T23:59:59-03:00`);
  if (f.refId) consulta = consulta.eq("ref_id", f.refId);
  if (f.q) {
    const v = escaparBuscaIlike(f.q);
    consulta = consulta.or(`resumo.ilike.${v},usuario_email.ilike.${v}`);
  }
  consulta = consulta.order("created_at", { ascending: false }).order("id", { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);

  // Lista de membros pro filtro "Equipe": mesma junção de `auth.users` + `membros` da tela Equipe.
  const [{ data, count, error }, { data: usuarios }, { data: membrosDb }] = await Promise.all([
    consulta,
    dbAdmin().auth.admin.listUsers({ page: 1, perPage: 1000 }),
    db.from("membros").select("usuario_id, nome, papel"),
  ]);
  if (error) throw new Error(`Não foi possível carregar o histórico: ${error.message}`);

  const membros = montarListaMembros((usuarios?.users ?? []) as UsuarioAuthResumo[], (membrosDb ?? []) as LinhaMembroDb[]).filter(
    (m) => m.temAcesso,
  );

  const linhas = (data ?? []) as LinhaHistorico[];
  const total = count ?? 0;
  if (!linhas.length && f.pagina > 1) redirect(urlHistorico(f, { pagina: 1 }));

  const ate = inicio + linhas.length;
  const grupos = agruparPorDia(linhas);
  // Nome do membro, por `usuario_id` em `membros` (não só os com acesso hoje: um ex-membro ainda aparece
  // com o nome que tinha); sem membro, cai pro e-mail gravado na hora (`nomeOuEmailHistorico`).
  const membrosParaNome = ((membrosDb ?? []) as LinhaMembroDb[]).map((m) => ({ usuario_id: m.usuario_id, nome: m.nome }));

  const paginacao = (
    <Paginacao
      de={total ? inicio + 1 : 0}
      ate={ate}
      total={total}
      porPagina={POR_PAGINA}
      anterior={f.pagina > 1 ? urlHistorico(f, { pagina: f.pagina - 1 }) : undefined}
      proxima={ate < total ? urlHistorico(f, { pagina: f.pagina + 1 }) : undefined}
    />
  );

  return (
    // Mora dentro de Ações (19/10/2026): mesmo título e sub-abas, com "Histórico" acesa depois de Falhas.
    <Pagina
      titulo="Ações"
      acoes={podeEditarAcoes ? <BotaoLink href="/acoes/nova" icone={<Icone nome="add" tamanho={18} />}>ADICIONAR</BotaoLink> : undefined}
    >
      <div className="border-b border-vg-line">
        <SubAbas
          itens={[
            ...ABAS_MENSAGENS.map((a) => ({ href: a.valor === "todas" ? "/acoes" : `/acoes?aba=${a.valor}`, rotulo: a.rotulo, ativo: false })),
            { href: "/historico", rotulo: "Histórico", ativo: true },
          ]}
        />
      </div>

      <BarraFiltrosHistorico filtros={f} membros={membros.map((m) => ({ id: m.id, nome: m.nome }))} />

      {paginacao}

      {!grupos.length ? (
        <div className={estiloCartao}>
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <div className="space-y-5">
          {grupos.map((g) => (
            <section key={g.dia} className="space-y-2">
              <h2 className="text-xs font-medium tracking-wide text-vg-muted">{g.rotulo}</h2>
              <div className={`${estiloCartao} divide-y divide-vg-line`}>
                {g.linhas.map((l) => (
                  <div key={l.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 sm:flex-nowrap sm:items-center">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="w-[62px] shrink-0 pt-0.5 text-xs tabular-nums text-vg-muted">{horaDoRegistro(l.created_at)}</span>
                      <Icone nome={ICONE_ACAO_HISTORICO[l.acao]} className={`${COR_ACAO_HISTORICO[l.acao]} mt-0.5 shrink-0`} />
                      <p className="min-w-0 text-sm text-vg-text">
                        <span className="font-semibold">
                          {ROTULO_ACAO_HISTORICO[l.acao]} {rotuloAreaHistorico(l.area)}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 pl-[86px] sm:pl-0">
                      <span className="text-xs text-vg-muted">{nomeOuEmailHistorico(l.usuario_id, l.usuario_email, membrosParaNome)}</span>
                      <BotaoDetalheHistorico linha={l} link={linkDoRegistro(l.area, l.ref_id)} />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Pagina>
  );
}
