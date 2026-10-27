import { redirect } from "next/navigation";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { urlSemSegredo } from "@/src/lib/regras/inicio";
import { ROTULO_EVENTO, type Evento } from "@/src/lib/regras/webhooks";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { Abas } from "../../_componentes/abas";
import { Paginacao } from "../../_componentes/paginacao";
import { BotaoLink, Pagina, Selo, Tabela, type CorSelo } from "../../_componentes/ui";
import { ABAS_HOOKS, TEXTO_HOOKS, type EntregaHistorico } from "../comum";

export const dynamic = "force-dynamic";

const POR_PAGINA = 20;
const ROTULO_STATUS: Record<string, string> = { ok: "Entregue", fila: "Na fila", processando: "Enviando", erro: "Erro" };
const COR_STATUS: Record<string, CorSelo> = { ok: "ok", fila: "neutro", processando: "neutro", erro: "erro" };

function urlHistorico(pagina: number): string {
  return pagina > 1 ? `/hooks/historico?pagina=${pagina}` : "/hooks/historico";
}

function rotuloEvento(evento: string | null): string {
  if (!evento) return "—";
  if (evento === "teste") return "Teste";
  return ROTULO_EVENTO[evento as Evento] ?? evento;
}

/** Aba "Histórico" dos Hooks: todas as entregas de `eventos_saida`, das mais novas pras mais antigas. */
export default async function HooksHistorico({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const sp = await searchParams;
  const bruto = Number.parseInt(String(Array.isArray(sp.pagina) ? sp.pagina[0] : sp.pagina ?? ""), 10);
  const pagina = Number.isFinite(bruto) && bruto > 0 ? bruto : 1;
  const inicio = (pagina - 1) * POR_PAGINA;
  const db = await dbUsuario();
  const { data, count, error } = await db
    .from("eventos_saida")
    .select("id, created_at, status, tentativas, erro, url, evento:payload->>evento, webhook_id, webhooks(nome)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(inicio, inicio + POR_PAGINA - 1);
  if (error) throw new Error(`Não foi possível carregar o histórico de envios: ${error.message}`);
  const itens = (data ?? []) as unknown as EntregaHistorico[];
  const total = count ?? 0;
  if (!itens.length && pagina > 1) redirect(urlHistorico(1));
  const ate = inicio + itens.length;

  return (
    <Pagina subtitulo={TEXTO_HOOKS} acoes={<BotaoLink href="/hooks/arquivadas" variante="secundario">Arquivados</BotaoLink>}>
      <Abas itens={ABAS_HOOKS} />
      <Tabela colunas={["Quando", "Webhook", "Evento", "Status", "Tentativas", "Erro"]} vazio={itens.length ? undefined : "Nenhum envio ainda."}>
        {itens.map((e) => (
          <tr key={e.id}>
            <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{dataHoraCompleta(e.created_at)}</td>
            <td className="max-w-xs px-3 py-2.5">
              <p className="truncate font-medium">{e.webhooks?.nome ?? (e.webhook_id ? "—" : "Webhook da campanha")}</p>
              <p className="truncate text-xs text-vg-muted">{urlSemSegredo(e.url)}</p>
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">{rotuloEvento(e.evento)}</td>
            <td className="px-3 py-2.5">
              <Selo cor={COR_STATUS[e.status] ?? "neutro"}>{ROTULO_STATUS[e.status] ?? e.status}</Selo>
            </td>
            <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{e.tentativas}</td>
            <td className="max-w-xs truncate px-3 py-2.5 text-vg-erro" title={e.erro ?? undefined}>{e.erro ?? ""}</td>
          </tr>
        ))}
      </Tabela>
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={pagina > 1 ? urlHistorico(pagina - 1) : undefined}
        proxima={ate < total ? urlHistorico(pagina + 1) : undefined}
      />
    </Pagina>
  );
}
