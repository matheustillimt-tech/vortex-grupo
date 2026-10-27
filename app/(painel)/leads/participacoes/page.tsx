import Link from "next/link";
import { redirect } from "next/navigation";
import { dataCsv } from "@/src/lib/regras/csv";
import { filtrosParaQuery, filtrosParaRpc, lerFiltros } from "@/src/lib/regras/filtros-pessoas";
import { ROTULO_MOTIVO, type PessoaLinha } from "@/src/lib/regras/pessoas";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Abas } from "../../_componentes/abas";
import { Paginacao } from "../../_componentes/paginacao";
import { Pagina, Selo, Tabela } from "../../_componentes/ui";
import { ABAS_LEADS, nomeDaTag, urlLeads, type TagLinha } from "../comum";
import { ExportarMenu } from "../exportar-menu";
import { FiltrosLeads } from "./filtros";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;
const BASE = "/leads/participacoes";

/** Aba "Participações" (a lista de hoje, sem mudar): uma linha por participação (Campanha, Grupo, Entrou, Saiu,
 *  Tags). A aba "Visão geral" (`/leads`) é o cadastro — uma linha por pessoa, com nome e campos. */
export default async function Participacoes({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("leads");
  if (b) return b;
  const f = lerFiltros(await searchParams);
  const db = await dbUsuario();
  const args = filtrosParaRpc(f);
  const inicio = (f.pagina - 1) * POR_PAGINA;
  const [lista, total, campanhas, grupos, tags] = await Promise.all([
    db.rpc("listar_pessoas", { ...args, p_limite: POR_PAGINA, p_deslocamento: inicio }),
    db.rpc("contar_pessoas", args),
    db.from("campanhas").select("id, nome").order("nome"),
    f.campanha
      ? db.from("grupos").select("id, nome").eq("campanha_id", f.campanha).order("numero")
      : Promise.resolve({ data: [] as { id: string; nome: string }[], error: null }),
    db.from("tags").select("id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)").order("nome"),
  ]);
  if (lista.error) throw new Error(`Não foi possível carregar os leads: ${lista.error.message}`);
  if (total.error) throw new Error(`Não foi possível contar os leads: ${total.error.message}`);
  const linhas = (lista.data ?? []) as PessoaLinha[];
  const quantos = Number(total.data ?? 0);
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!linhas.length && f.pagina > 1) redirect(urlLeads(f, { pagina: 1 }, BASE));

  const qExportar = filtrosParaQuery({ ...f, pagina: 1 });
  const exportarParticipacoes = qExportar ? `/api/exportar/pessoas?${qExportar}` : "/api/exportar/pessoas";
  const opcoesTag = ((tags.data ?? []) as unknown as TagLinha[])
    .map((t) => ({ id: t.id, nome: nomeDaTag(t) }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const ate = inicio + linhas.length;

  return (
    <Pagina
      titulo="Leads"
      subtitulo={`${quantos.toLocaleString("pt-BR")} participaç${quantos === 1 ? "ão" : "ões"}`}
      acoes={<ExportarMenu leadsHref="/api/exportar/leads" participacoesHref={exportarParticipacoes} />}
    >
      <Abas itens={ABAS_LEADS} />
      <FiltrosLeads filtros={f} campanhas={campanhas.data ?? []} grupos={grupos.data ?? []} tags={opcoesTag} />
      <Paginacao
        de={quantos ? inicio + 1 : 0}
        ate={ate}
        total={quantos}
        porPagina={POR_PAGINA}
        anterior={f.pagina > 1 ? urlLeads(f, { pagina: f.pagina - 1 }, BASE) : undefined}
        proxima={ate < quantos ? urlLeads(f, { pagina: f.pagina + 1 }, BASE) : undefined}
      />
      <Tabela colunas={["Número", "Campanha", "Grupo", "Entrou", "Saiu", "Tags"]} vazio={linhas.length ? undefined : "Nenhum lead com esses filtros."}>
        {linhas.map((p) => (
          <tr key={p.participante_id}>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
              <Link href={`/leads/${p.telefone}`} className="text-vg-accent transition-colors hover:text-vg-accent-3">{telefoneLegivel(p.telefone)}</Link>
            </td>
            <td className="px-3 py-2.5">{p.campanha}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{p.grupo}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(p.entrou_em)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">
              {p.saiu_em ? (
                <>
                  {dataCsv(p.saiu_em)}
                  {p.motivo_saida && <span className="block text-xs text-vg-muted">{ROTULO_MOTIVO[p.motivo_saida]}</span>}
                </>
              ) : (
                "—"
              )}
            </td>
            <td className="px-3 py-2.5">
              <span className="flex flex-wrap gap-1">{p.tags.map((t) => <Selo key={t} cor="neutro" semPonto>{t}</Selo>)}</span>
            </td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
