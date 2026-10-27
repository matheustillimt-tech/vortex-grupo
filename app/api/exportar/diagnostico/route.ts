import { CABECALHO_DIAGNOSTICO, dataDoArquivo, linhaCsvDiagnostico, montarCsv } from "@/src/lib/regras/csv";
import { ehUuid } from "@/src/lib/regras/uuid";
import { variantesTelefone } from "@/src/lib/telefone";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";

export const dynamic = "force-dynamic";

/** "Exportar CSV" por conta, na aba Diagnósticos: os grupos ativos daquela conta na campanha, com o
 *  status de admin (as duas formas do nono dígito). Até 1000 grupos. Exige ver Campanhas. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const campanha = sp.get("campanha");
  const conta = sp.get("conta");
  if (!ehUuid(campanha) || !ehUuid(conta)) return new Response("Campanha ou conexão inválida.", { status: 400 });

  const db = await dbUsuario();
  const { data: sessao } = await db.auth.getUser();
  if (!sessao.user) return new Response("não autenticado", { status: 401 });
  if (!(await permitido("campanhas", "ver"))) return new Response("sem permissão", { status: 403 });

  const [{ data: conexao, error: erroConexao }, { data: grupos, error: erroGrupos }] = await Promise.all([
    db.from("conexoes").select("id, nome, telefone").eq("id", conta).maybeSingle(),
    db.from("grupos").select("id, numero, nome, participantes, conferido_em").eq("campanha_id", campanha).eq("conexao_id", conta).eq("ativo", true).order("numero").limit(1000),
  ]);
  if (erroConexao || erroGrupos) return new Response("Não foi possível carregar o diagnóstico.", { status: 500 });
  if (!conexao) return new Response("Conexão não encontrada.", { status: 404 });

  const listaGrupos = grupos ?? [];
  let admins = new Set<string>();
  const telefone = (conexao as { telefone: string | null }).telefone;
  if (telefone && listaGrupos.length) {
    const variantes = variantesTelefone(telefone);
    const { data: participantes, error: erroParticipantes } = await db
      .from("participantes")
      .select("grupo_id")
      .in("grupo_id", listaGrupos.map((g) => g.id))
      .in("telefone", variantes)
      .eq("admin", true)
      .is("saiu_em", null);
    if (erroParticipantes) return new Response("Não foi possível carregar os administradores.", { status: 500 });
    admins = new Set((participantes ?? []).map((p) => (p as { grupo_id: string }).grupo_id));
  }

  const corpo = listaGrupos.map((g) =>
    linhaCsvDiagnostico({ nome: g.nome, numero: g.numero, participantes: g.participantes, admin: admins.has(g.id), conferido_em: g.conferido_em }),
  );
  const nomeConta = (conexao as { nome: string }).nome.replace(/[^a-z0-9-]+/gi, "-");
  return new Response(montarCsv(CABECALHO_DIAGNOSTICO, corpo), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="diagnostico-${nomeConta}-${dataDoArquivo()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
