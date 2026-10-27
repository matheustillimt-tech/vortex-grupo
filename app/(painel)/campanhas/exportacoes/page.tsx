import { redirect } from "next/navigation";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { hrefBaixarDeNovo, nomeGeradaPor, resumoFiltros, ROTULO_EXPORTACAO, TIPOS_EXPORTACAO, tiposVisiveis, type TipoExportacao } from "@/src/lib/exportacoes";
import { permitido } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "../../_componentes/guarda";
import { Icone } from "../../_componentes/icone";
import { Paginacao } from "../../_componentes/paginacao";
import { Pagina, Tabela } from "../../_componentes/ui";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;

type LinhaExportacao = { id: string; created_at: string; criada_por: string | null; tipo: string; filtros: unknown; linhas: number; nome_arquivo: string };

/** "Ver exportações" (Etapa 3K): os CSVs já gerados (Leads, Relatório de status, Histórico de mensagens), 12 por
 *  página. Só os metadados ficam guardados: "BAIXAR" gera o arquivo de novo com os dados de hoje (a rota confere a
 *  permissão de cada tipo). */
export default async function Exportacoes({ searchParams }: { searchParams: Promise<{ pagina?: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const pagina = Math.max(1, Math.floor(Number((await searchParams).pagina)) || 1);
  const inicio = (pagina - 1) * POR_PAGINA;
  // Leads e Relatório de status têm telefone: sem Leads/ver, nem aparecem na lista.
  const veLeads = await permitido("leads", "ver");
  const db = await dbUsuario();
  const admin = dbAdmin();
  const [{ data, count, error }, { data: usuarios }, { data: membros }] = await Promise.all([
    db
      .from("exportacoes")
      .select("id, created_at, criada_por, tipo, filtros, linhas, nome_arquivo", { count: "exact" })
      .in("tipo", tiposVisiveis(veLeads))
      .order("created_at", { ascending: false })
      .range(inicio, inicio + POR_PAGINA - 1),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    // `membros` só deixa ler a própria linha pelo RLS: os nomes vêm pelo serviço (só nome, nada mais).
    admin.from("membros").select("usuario_id, nome"),
  ]);
  if (error) throw new Error(`Não foi possível carregar as exportações: ${error.message}`);
  const linhas = (data ?? []) as LinhaExportacao[];
  const total = count ?? 0;
  if (!linhas.length && pagina > 1) redirect("/campanhas/exportacoes");
  const emails = new Map(((usuarios?.users ?? []) as { id: string; email?: string | null }[]).map((u) => [u.id, u.email ?? null]));
  const nomes = new Map(((membros ?? []) as { usuario_id: string; nome: string }[]).map((m) => [m.usuario_id, m.nome]));
  const ate = inicio + linhas.length;
  const url = (p: number) => (p > 1 ? `/campanhas/exportacoes?pagina=${p}` : "/campanhas/exportacoes");

  return (
    <Pagina titulo="Exportações" trilha={[{ rotulo: "Campanhas", href: "/campanhas" }]}>
      <p className="text-sm text-vg-text-2">Baixar de novo gera o arquivo com os dados de hoje; a coluna Linhas mostra a contagem da primeira vez.</p>
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={pagina > 1 ? url(pagina - 1) : undefined}
        proxima={ate < total ? url(pagina + 1) : undefined}
      />
      <Tabela colunas={["Data", "Tipo", "Filtros", "Linhas", "Gerada por", ""]} vazio={linhas.length ? undefined : "Nenhuma exportação ainda"}>
        {linhas.map((l) => {
          const tipo = (TIPOS_EXPORTACAO as readonly string[]).includes(l.tipo) ? (l.tipo as TipoExportacao) : null;
          return (
            <tr key={l.id}>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataHoraCompleta(l.created_at)}</td>
              <td className="px-3 py-2.5">{tipo ? ROTULO_EXPORTACAO[tipo] : l.tipo}</td>
              <td className="max-w-[280px] truncate px-3 py-2.5 text-vg-text-2" title={resumoFiltros(l.filtros)}>{resumoFiltros(l.filtros)}</td>
              <td className="px-3 py-2.5 tabular-nums">{l.linhas}</td>
              <td className="px-3 py-2.5 text-vg-text-2">{l.criada_por ? nomeGeradaPor(nomes.get(l.criada_por), emails.get(l.criada_por)) : "—"}</td>
              <td className="px-3 py-2.5 text-right">
                {tipo && (
                  <a href={hrefBaixarDeNovo(tipo, l.id)} className="inline-flex items-center gap-1 text-[13px] font-medium text-vg-accent hover:underline">
                    <Icone nome="download" tamanho={16} /> BAIXAR
                  </a>
                )}
              </td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
