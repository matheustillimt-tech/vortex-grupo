import {
  CABECALHO_NUMEROS_AUTOMACAO,
  CABECALHO_NUMEROS_AUTOMACAO_STATUS,
  dataDoArquivo,
  linhaNumeroAutomacao,
  linhaNumeroAutomacaoStatus,
  montarCsv,
} from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PAGINA = 1000;
const MAXIMO_LINHAS = 50_000;

type LinhaRemocao = { telefone: string; status: string };

/**
 * "Exportar números" / "… com status" / "… com falhas" (menu `more_vert` da lista de automações): os
 * telefones alvo das ações de remoção (`acoes`, `tipo = 'remover'`) que essa automação gerou —
 * é onde o telefone de uma ação de pessoa mora (a execução de mensagem só tem o grupo). Paginado em blocos de
 * 1000 e limitado a 50.000 linhas, pra não travar numa automação com histórico enorme.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ehUuid(id)) return new Response("Automação inválida.", { status: 400 });

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("automacoes", "ver"))) return new Response("sem permissão", { status: 403 });
  if (!(await permitido("leads", "ver"))) return new Response("sem permissão", { status: 403 });

  const { data: automacao, error: erroAutomacao } = await db.from("automacoes").select("id").eq("id", id).maybeSingle();
  if (erroAutomacao) return new Response(`Não foi possível carregar a automação: ${erroAutomacao.message}`, { status: 500 });
  if (!automacao) return new Response("Automação não encontrada.", { status: 404 });

  const tipoBruto = new URL(req.url).searchParams.get("tipo");
  const tipo = tipoBruto === "com_status" ? "com_status" : tipoBruto === "falhas" ? "falhas" : "todos";

  const linhas: LinhaRemocao[] = [];
  for (let de = 0; linhas.length < MAXIMO_LINHAS; de += PAGINA) {
    let consulta = db.from("acoes").select("telefone, status").eq("automacao_id", id).eq("tipo", "remover").order("created_at", { ascending: true }).range(de, de + PAGINA - 1);
    if (tipo === "falhas") consulta = consulta.eq("status", "erro");
    const { data, error } = await consulta;
    if (error) return new Response(`Não foi possível carregar os números: ${error.message}`, { status: 500 });
    const pagina = (data ?? []) as LinhaRemocao[];
    linhas.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  const limitadas = linhas.slice(0, MAXIMO_LINHAS);

  let cabecalho: string[];
  let corpo: string[][];
  let sufixo: string;
  if (tipo === "com_status") {
    cabecalho = CABECALHO_NUMEROS_AUTOMACAO_STATUS;
    corpo = limitadas.map(linhaNumeroAutomacaoStatus);
    sufixo = "com-status";
  } else {
    cabecalho = CABECALHO_NUMEROS_AUTOMACAO;
    const vistos = new Set<string>();
    corpo = [];
    for (const l of limitadas) {
      if (vistos.has(l.telefone)) continue;
      vistos.add(l.telefone);
      corpo.push(linhaNumeroAutomacao(l.telefone));
    }
    sufixo = tipo === "falhas" ? "falhas" : "numeros";
  }

  return new Response(montarCsv(cabecalho, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="automacao-${sufixo}-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
