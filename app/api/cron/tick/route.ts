import { NextResponse } from "next/server";
import { env } from "@/src/lib/env";
import { processarAcoes } from "@/src/lib/jobs/acoes";
import { conferirGrupos } from "@/src/lib/jobs/conferir-grupos";
import { conferirEntregas } from "@/src/lib/jobs/entregas";
import { processarEventos } from "@/src/lib/jobs/eventos";
import { liberarEncadeadas } from "@/src/lib/jobs/encadeadas";
import { iniciarExecucoesVencidas } from "@/src/lib/jobs/execucoes";
import { enviarMetricasHook } from "@/src/lib/jobs/metricas-hook";
import { atualizarLinksPeriodicos } from "@/src/lib/jobs/links";
import { monitorarConexoes } from "@/src/lib/jobs/monitor";
import { garantirFolga } from "@/src/lib/jobs/novos-grupos";
import { materializarSequencias } from "@/src/lib/jobs/sequencias";
import { processarTarefas } from "@/src/lib/jobs/tarefas";
import { autorizado, type Prazo } from "@/src/lib/jobs/tipos";
import { processarVendas } from "@/src/lib/jobs/vendas";

export const dynamic = "force-dynamic";
// O prazo interno dos passos é 55 s; o teto da função fica bem acima pra chamada em andamento (Zapbot com
// retentativas, POST do CRM) terminar sem a Vercel matar o tick no meio.
export const maxDuration = 120;

/** Ordem: o que é urgente (sequências, execuções e vendas) antes do que pode esperar. Cada passo isolado: um erro
 *  não para os outros. `execucoes2` pega o que nasceu no meio do tick (gatilhos de grupo novo). */
export async function GET(req: Request) {
  if (!autorizado(req.headers.get("authorization"), env("CRON_SECRET"))) return new NextResponse(null, { status: 401 });
  const prazo: Prazo = { ate: Date.now() + 55_000 };
  const relatorio: Record<string, number | string> = {};
  const passo = async (nome: string, f: () => Promise<number>) => {
    try {
      relatorio[nome] = await f();
    } catch (e) {
      relatorio[nome] = `erro: ${e instanceof Error ? e.message : e}`;
      console.error(`[tick] ${nome}`, e);
    }
  };
  // Um mapa só pro tick inteiro: o intervalo de 3–8 s por número vale entre `tarefas` e `tarefas2` também.
  const proximoPermitido = new Map<string, number>();
  await passo("sequencias", () => materializarSequencias());
  // "Adicionar outra ação": solta (ou cancela) as que esperam a anterior, antes de iniciar as vencidas.
  await passo("encadeadas", () => liberarEncadeadas());
  await passo("execucoes", () => iniciarExecucoesVencidas());
  await passo("vendas", processarVendas);
  await passo("acoes", () => processarAcoes(prazo));
  await passo("tarefas", () => processarTarefas({ ate: Date.now() + Math.min(35_000, prazo.ate - Date.now() - 15_000) }, proximoPermitido));
  await passo("folga", garantirFolga);
  // Seções da campanha (Etapa 3J): só campanhas com "Atualização periódica de links" ligada.
  await passo("links", () => atualizarLinksPeriodicos(prazo));
  await passo("conferencia", () => conferirGrupos(prazo));
  await passo("monitor", () => monitorarConexoes(prazo));
  // Hooks de métricas (7h, 12h e 17h de Brasília; fora disso devolve 0 sem ler nada). Antes de "eventos" pra
  // sair no mesmo tick.
  await passo("hooks", () => enviarMetricasHook());
  await passo("eventos", () => processarEventos(prazo));
  // Confirmação de entrega: só campanhas com a seção ligada (filtro no banco).
  await passo("entregas", () => conferirEntregas(prazo));
  await passo("execucoes2", () => iniciarExecucoesVencidas());
  await passo("tarefas2", () => processarTarefas(prazo, proximoPermitido));
  return NextResponse.json(relatorio);
}
