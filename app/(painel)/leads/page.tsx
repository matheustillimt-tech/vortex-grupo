import Link from "next/link";
import { redirect } from "next/navigation";
import { filtrosVisaoGeralParaQuery, filtrosVisaoGeralParaRpc, lerFiltrosVisaoGeral, OPCOES_POR_PAGINA_LEADS } from "@/src/lib/regras/filtros-leads";
import { camposParaTexto, type LeadLinha } from "@/src/lib/regras/leads";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Abas } from "../_componentes/abas";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina, Selo, Tabela } from "../_componentes/ui";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { CadastrarLead } from "./cadastrar";
import { ABAS_LEADS, nomeDaTag, urlVisaoGeral, type TagLinha } from "./comum";
import { ExportarMenu } from "./exportar-menu";
import { FiltrosVisaoGeralBar } from "./filtros-visao-geral";
import { BotaoCopiarNumeros, MenuLinhaLead } from "./menu-linha";

export const dynamic = "force-dynamic";

/** Aba "Visão geral" de Leads (Etapa 3I, Tarefa 1): o cadastro, uma linha por
 *  pessoa (união de quem já passou por um grupo e de quem foi cadastrado à mão em `contatos`). A aba
 *  "Participações" (`/leads/participacoes`) continua com a lista de hoje, sem mudar. */
export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("leads");
  if (b) return b;
  const f = lerFiltrosVisaoGeral(await searchParams);
  const db = await dbUsuario();
  const args = filtrosVisaoGeralParaRpc(f);
  const inicio = (f.pagina - 1) * f.por;
  const [lista, total, tags] = await Promise.all([
    db.rpc("listar_leads", { ...args, p_limite: f.por, p_deslocamento: inicio }),
    db.rpc("contar_leads", args),
    db.from("tags").select("id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)").order("nome"),
  ]);
  if (lista.error) throw new Error(`Não foi possível carregar os leads: ${lista.error.message}`);
  if (total.error) throw new Error(`Não foi possível contar os leads: ${total.error.message}`);
  const linhas = (lista.data ?? []) as LeadLinha[];
  const quantos = Number(total.data ?? 0);
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!linhas.length && f.pagina > 1) redirect(urlVisaoGeral(f, { pagina: 1 }));

  const qExportar = filtrosVisaoGeralParaQuery({ ...f, pagina: 1 });
  const exportarLeads = qExportar ? `/api/exportar/leads?${qExportar}` : "/api/exportar/leads";
  const opcoesTag = ((tags.data ?? []) as unknown as TagLinha[])
    .map((t) => ({ id: t.id, nome: nomeDaTag(t) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ate = inicio + linhas.length;

  const paginacao = (
    <Paginacao
      de={quantos ? inicio + 1 : 0}
      ate={ate}
      total={quantos}
      porPagina={f.por}
      opcoesPorPagina={OPCOES_POR_PAGINA_LEADS}
      parametroPorPagina="por"
      anterior={f.pagina > 1 ? urlVisaoGeral(f, { pagina: f.pagina - 1 }) : undefined}
      proxima={ate < quantos ? urlVisaoGeral(f, { pagina: f.pagina + 1 }) : undefined}
    />
  );

  return (
    // título "Leads" + EXPORTAR LEADS no topo (sem o contador "N leads" no subtítulo — ele volta como
    // subtítulo da aba, embaixo).
    <Pagina titulo="Leads" acoes={<ExportarMenu leadsHref={exportarLeads} participacoesHref="/api/exportar/pessoas" />}>
      <Abas itens={ABAS_LEADS} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[15px] font-medium text-vg-text">Leads</h2>
        <CadastrarLead tags={opcoesTag} />
      </div>
      <FiltrosVisaoGeralBar filtros={f} tags={opcoesTag} />
      <div className="flex justify-end">
        <BotaoCopiarNumeros telefones={linhas.map((l) => l.telefone)} />
      </div>
      {paginacao}
      <Tabela colunas={["Nome", "Número", "Campos", "Tags", ""]} vazio={linhas.length ? undefined : "Nenhum lead com esses filtros."}>
        {linhas.map((l) => (
          <tr key={l.telefone}>
            <td className="px-3 py-2.5">{l.nome ?? <span className="text-vg-muted">—</span>}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
              <Link href={`/leads/${l.telefone}`} className="text-vg-accent transition-colors hover:text-vg-accent-3">{telefoneLegivel(l.telefone)}</Link>
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">{camposParaTexto(l.campos) || "—"}</td>
            <td className="px-3 py-2.5">
              <span className="flex flex-wrap gap-1">{l.tags.map((t) => <Selo key={t} cor="neutro" semPonto>{t}</Selo>)}</span>
            </td>
            <td className="px-3 py-2.5"><MenuLinhaLead telefone={l.telefone} /></td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
