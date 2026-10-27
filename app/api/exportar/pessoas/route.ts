import { filtrosDaRequisicao, registrarExportacao } from "@/src/lib/exportacoes";
import { CABECALHO_PESSOAS, dataDoArquivo, linhaCsvPessoa, montarCsv } from "@/src/lib/regras/csv";
import { filtrosParaRpc, lerCampanhasMultiplas, lerFiltros } from "@/src/lib/regras/filtros-pessoas";
import type { PessoaLinha } from "@/src/lib/regras/pessoas";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;

/** Todas as páginas de `listar_pessoas` pra um conjunto de argumentos (sem o teto de linhas do PostgREST). */
async function todasAsPaginas(db: SupabaseClient, args: Record<string, unknown>): Promise<PessoaLinha[] | { erro: string }> {
  const linhas: PessoaLinha[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await db.rpc("listar_pessoas", { ...args, p_limite: PAGINA, p_deslocamento: de });
    if (error) return { erro: error.message };
    const pagina = (data ?? []) as PessoaLinha[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return linhas;
}

/** Planilha com os mesmos filtros da tela Leads, lida em páginas de 1000 (sem o teto de linhas do PostgREST).
 *  Só pra quem está logado no painel (sem sessão → 401) e vê Leads (sem "ver" → 403). `listar_pessoas` só
 *  filtra por UMA campanha (`p_campanha`): a exportação em massa da lista de campanhas
 *  manda `?campanhas=a,b,c` (uuids, até 50; nenhum válido → 400) e a rota chama a RPC uma vez por campanha, juntando as páginas —
 *  cada linha é a participação de uma pessoa numa campanha só, então não duplica ao juntar.
 *  "Ver exportações" (Etapa 3K): cada download grava os filtros em `exportacoes` (tipo `leads`); `?exportacao={id}`
 *  gera de novo com os filtros guardados, sem gravar outra linha. O CSV é o mesmo de antes. */
export async function GET(req: Request) {
  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const url = new URL(req.url);
  const pedido = await filtrosDaRequisicao(db, url, "leads");
  if ("erro" in pedido) return new Response("Exportação não encontrada.", { status: 404 });
  const sp = pedido.reexportacao ? pedido.filtros : Object.fromEntries(url.searchParams);
  const campanhas = lerCampanhasMultiplas(sp.campanhas);
  // `?campanhas=` veio mas sem nenhum id válido: recusa em vez de cair no "exportar tudo".
  if (campanhas && campanhas.length === 0) return new Response("Nenhuma campanha válida em ?campanhas=.", { status: 400 });

  const grupos: PessoaLinha[][] = [];
  if (campanhas) {
    for (const campanhaId of campanhas) {
      const args = filtrosParaRpc({ ...lerFiltros(sp), campanha: campanhaId });
      const r = await todasAsPaginas(db, args);
      if ("erro" in r) return new Response(`Não foi possível gerar a planilha: ${r.erro}`, { status: 500 });
      grupos.push(r);
    }
  } else {
    const r = await todasAsPaginas(db, filtrosParaRpc(lerFiltros(sp)));
    if ("erro" in r) return new Response(`Não foi possível gerar a planilha: ${r.erro}`, { status: 500 });
    grupos.push(r);
  }

  const linhas = grupos.flat().map(linhaCsvPessoa);
  const nomeArquivo = `pessoas-${dataDoArquivo()}.csv`;
  if (!pedido.reexportacao) await registrarExportacao(db, { tipo: "leads", filtros: pedido.filtros, linhas: linhas.length, nomeArquivo, usuario: sessao.user });
  return new Response(montarCsv(CABECALHO_PESSOAS, linhas), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${nomeArquivo}"`,
      "cache-control": "no-store",
    },
  });
}
