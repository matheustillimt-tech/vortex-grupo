import { dataCsv } from "@/src/lib/regras/csv";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Abas } from "../../_componentes/abas";
import { ColunaBusca, type ItemColunaBusca } from "../../_componentes/coluna-busca";
import { Pagina, Selo, Vazio, type CorSelo } from "../../_componentes/ui";
import { ABAS_ANTISPAM } from "../comum";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const LIMITE = 200;

const ROTULO_SITUACAO: Record<string, string> = { fila: "Na fila", processando: "Processando", ok: "Removido", erro: "Erro" };
const COR_SITUACAO: Record<string, CorSelo> = { fila: "neutro", processando: "aviso", ok: "ok", erro: "erro" };

type AcaoLinha = {
  id: string;
  telefone: string | null;
  status: string;
  created_at: string;
  grupos: { nome: string } | null;
  campanhas: { nome: string } | null;
};

/** Últimas 200 remoções da fila `acoes` com origem 'bloqueado' (quem saiu do grupo por estar bloqueado). */
export default async function EventosAntiSpam() {
  const b = await bloqueio("antispam");
  if (b) return b;
  const db = await dbUsuario();
  const { data, error } = await db
    .from("acoes")
    .select("id, telefone, status, created_at, grupos(nome), campanhas(nome)")
    .eq("origem", "bloqueado")
    .order("created_at", { ascending: false })
    .limit(LIMITE);
  if (error) throw new Error(`Não foi possível carregar os eventos: ${error.message}`);
  const itens = (data ?? []) as unknown as AcaoLinha[];

  // subtítulo que descreve só o que a tela tem de verdade (remoções; não há mensagens bloqueadas nem
  // análises de grupos registradas aqui), busca por telefone/grupo nas linhas já carregadas e vazio sem cabeçalho.
  const itensBusca: ItemColunaBusca[] = itens.map((a) => ({
    chave: a.id,
    busca: `${a.telefone ?? ""} ${a.grupos?.nome ?? ""}`,
    conteudo: (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-vg-line bg-vg-bg p-3">
        <div className="min-w-0 space-y-0.5">
          <p className="tabular-nums">{a.telefone ? telefoneLegivel(a.telefone) : "—"}</p>
          <p className="text-xs text-vg-text-2">{a.grupos?.nome ?? "—"}{a.campanhas?.nome ? ` · ${a.campanhas.nome}` : ""}</p>
        </div>
        <div className="flex items-center gap-3">
          <Selo cor={COR_SITUACAO[a.status] ?? "neutro"}>{ROTULO_SITUACAO[a.status] ?? a.status}</Selo>
          <span className="whitespace-nowrap tabular-nums text-xs text-vg-text-2">{dataCsv(a.created_at)}</span>
        </div>
      </div>
    ),
  }));

  return (
    <Pagina titulo="Eventos" subtitulo="Histórico de remoções feitas pelo anti-spam.">
      <Abas itens={ABAS_ANTISPAM} />
      <ColunaBusca
        itens={itensBusca}
        rotulo="Buscar por telefone ou grupo"
        vazio={
          <div className="rounded-xl border border-vg-line">
            <Vazio texto="Nenhum evento de anti-spam encontrado." />
          </div>
        }
      />
    </Pagina>
  );
}
