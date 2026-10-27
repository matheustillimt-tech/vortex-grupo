import type { SupabaseClient } from "@supabase/supabase-js";
import { placarEnquete } from "@/src/lib/regras/enquete";
import { PROVA } from "@/src/lib/zapbot/prova";
import { Cartao, Tabela } from "../../../../_componentes/ui";

/** Resultado somando todos os grupos (plano completo) ou o aviso do plano B. */
export async function ResultadoEnquete({ db, execucaoId, opcoes }: { db: Pick<SupabaseClient, "from" | "rpc">; execucaoId: string; opcoes: string[] }) {
  if (!PROVA.enqueteEmGrupo) {
    return (
      <Cartao titulo="Resultado da enquete">
        <p className="text-sm">Resultado disponível só no WhatsApp.</p>
        {PROVA.enqueteMotivo && <p className="mt-1 text-xs text-vg-muted">{PROVA.enqueteMotivo}</p>}
      </Cartao>
    );
  }
  const [{ data: linhas, error }, { count: pessoas }, { data: votos }] = await Promise.all([
    db.rpc("resultado_enquete", { p_execucao: execucaoId }),
    db.from("enquete_votos").select("telefone", { count: "exact", head: true }).eq("execucao_id", execucaoId),
    db.from("enquete_votos").select("telefone, opcoes, grupos(nome, numero)").eq("execucao_id", execucaoId).order("votado_em", { ascending: false }).limit(200),
  ]);
  if (error) throw new Error(`Não foi possível carregar o resultado: ${error.message}`);
  const placar = placarEnquete(opcoes, (linhas ?? []) as { opcao: string; votos: number }[], pessoas ?? 0);
  return (
    <Cartao titulo={`Resultado da enquete · ${pessoas ?? 0} pessoa(s) votaram (atualiza a cada 5 min)`}>
      <ul className="space-y-2 text-sm">
        {placar.map((p) => (
          <li key={p.opcao}>
            <div className="flex justify-between"><span>{p.opcao}</span><span className="text-vg-muted">{p.votos} · {p.pct}%</span></div>
            <div className="mt-1.5 h-1.5 rounded-full bg-vg-panel-2"><div className="h-1.5 rounded-full bg-linear-to-r from-vg-accent to-vg-accent-2" style={{ width: `${Math.min(p.pct, 100)}%` }} /></div>
          </li>
        ))}
      </ul>
      {(votos ?? []).length > 0 && (
        <div className="mt-4">
          <Tabela colunas={["Telefone", "Grupo", "Votou em"]}>
            {(votos ?? []).map((v) => {
              const g = v.grupos as unknown as { nome: string; numero: number } | null;
              return (
                <tr key={`${v.telefone}-${g?.numero}`}>
                  <td className="px-3 py-2">{v.telefone}</td>
                  <td className="px-3 py-2">{g ? `#${g.numero} ${g.nome}` : "—"}</td>
                  <td className="px-3 py-2">{(v.opcoes as string[]).join(", ")}</td>
                </tr>
              );
            })}
          </Tabela>
        </div>
      )}
    </Cartao>
  );
}
