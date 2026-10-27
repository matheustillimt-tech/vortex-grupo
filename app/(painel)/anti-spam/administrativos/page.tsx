import { permitido } from "@/src/lib/permissoes";
import { AJUDA_ADMINISTRATIVOS, type AdministrativoLinha } from "@/src/lib/regras/administrativos";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Abas } from "../../_componentes/abas";
import { Cartao, Pagina, Selo, Tabela, type CorSelo } from "../../_componentes/ui";
import { ABAS_ANTISPAM } from "../comum";
import { ListaAdministrativos } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const ROTULO_STATUS: Record<string, string> = { conectado: "Conectado", pendente: "Pendente", desconectado: "Desconectado" };
const COR_STATUS: Record<string, CorSelo> = { conectado: "ok", pendente: "aviso", desconectado: "erro" };

type ConexaoLinha = { id: string; nome: string; telefone: string | null; status: string };

/** Teto de números lidos pra tela (busca e ordenação no navegador). */
const PAGINA = 1000;
const MAXIMO = 20_000;

/** Aba "Números administrativos" (Etapa 3K, Tarefa 6): as contas conectadas (sempre protegidas, só leitura) e a
 *  lista manual (ADICIONAR, ADICIONAR CSV, EXPORTAR, busca, ordenação, excluir). Todos nunca são removidos dos
 *  grupos pelo anti-spam, duplicado, campanha anterior nem remoção em massa, nunca são bloqueados e não disparam
 *  automações de pessoa (`telefonesProtegidos` em `dispararAutomacoes`). */
export default async function NumerosAdministrativos() {
  const b = await bloqueio("antispam");
  if (b) return b;
  const db = await dbUsuario();
  const [{ data, error }, podeEditar] = await Promise.all([
    db.from("conexoes").select("id, nome, telefone, status").order("nome"),
    permitido("antispam", "editar"),
  ]);
  if (error) throw new Error(`Não foi possível carregar os números administrativos: ${error.message}`);
  const contas = (data ?? []) as ConexaoLinha[];

  const manuais: AdministrativoLinha[] = [];
  for (let de = 0; de < MAXIMO; de += PAGINA) {
    const { data: pagina, error: erro } = await db
      .from("numeros_administrativos")
      .select("telefone, nome, created_at")
      .order("telefone")
      .range(de, de + PAGINA - 1);
    if (erro) throw new Error(`Não foi possível carregar os números administrativos: ${erro.message}`);
    manuais.push(...((pagina ?? []) as AdministrativoLinha[]));
    if ((pagina ?? []).length < PAGINA) break;
  }

  return (
    <Pagina titulo="Anti-spam" subtitulo={AJUDA_ADMINISTRATIVOS}>
      <Abas itens={ABAS_ANTISPAM} />
      <div className="space-y-6">
        <ListaAdministrativos itens={manuais} podeEditar={podeEditar} />
        <Cartao titulo="Conexões conectadas">
          <p className="mb-3 text-sm text-vg-muted">Sempre protegidas: os números conectados ao sistema também nunca são removidos nem bloqueados.</p>
          <Tabela colunas={["Nome", "Telefone", "Status"]} vazio={contas.length ? undefined : "Nenhum registro encontrado"}>
            {contas.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2.5">{c.nome}</td>
                <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{c.telefone ? telefoneLegivel(c.telefone) : "—"}</td>
                <td className="px-3 py-2.5"><Selo cor={COR_STATUS[c.status] ?? "neutro"}>{ROTULO_STATUS[c.status] ?? c.status}</Selo></td>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      </div>
    </Pagina>
  );
}
