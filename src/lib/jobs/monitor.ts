import "server-only";
import { paraZapbot, type ConexaoLinha } from "../conexoes";
import { eventoContaDeslogada } from "../regras/webhooks";
import { dbAdmin } from "../supabase/admin";
import { criarEmissor, type Emissor } from "../webhooks";
import { zapbot } from "../zapbot/client";
import { alertar } from "./alertas";
import { diagnosticar, mensagemAvisoQueda, precisaDiagnostico, type DiagnosticoQueda } from "../regras/queda";
import { env } from "../env";
import { ORCAMENTO_TROCA_MS, trocaDeDonoVencida, trocarDonoECorrigirLinks } from "./links";
import { restante, type Prazo } from "./tipos";

const INTERVALO_MS = 2 * 60_000;

/** Para cada número cuja vez chegou: confere o status no Zapbot e atualiza conectado/desconectado,
 *  com uma tentativa de reconexão sem QR quando um número que estava conectado cai.
 *  Pendente com instância no Zapbot também é conferido (pareamento por código feito com a tela fechada):
 *  vira conectado se conectou, e nunca é marcado como desconectado. */
export async function monitorarConexoes(prazo: Prazo): Promise<number> {
  const db = dbAdmin();
  const { data, error } = await db
    .from("conexoes")
    .select("*")
    .or("status.neq.pendente,zapbot_id.not.is.null")
    .lte("proximo_status_em", new Date().toISOString())
    .order("proximo_status_em")
    .limit(10);
  if (error) throw new Error(`Não foi possível ler os números: ${error.message}`);
  // Hook "Conta deslogada": juntos e enfileirados no fim da rodada (uma leitura de webhooks, só se houver).
  const emissor = criarEmissor(db);
  try {
    return await monitorar(db, data ?? [], prazo, emissor);
  } finally {
    // Mesmo se a rodada lançar no meio, o que já foi juntado (ex.: conta deslogada) sai.
    await emissor.enviar();
  }
}

async function monitorar(db: ReturnType<typeof dbAdmin>, linhas: unknown[], prazo: Prazo, emissor: Emissor): Promise<number> {
  let n = 0;
  for (const c of linhas as (ConexaoLinha & { proximo_status_em: string; caiu_em?: string | null; grupos_trocados_em?: string | null; diagnostico_em?: string | null; diagnostico_queda?: DiagnosticoQueda | null; aviso_queda_enviado_em?: string | null })[]) {
    if (restante(prazo) < 20_000) break;
    // Reivindica a conexão de forma atômica: só segue se ninguém mudou `proximo_status_em` desde a leitura
    // acima (outro tick do cron já pode ter pego essa mesma conexão entre a leitura e aqui).
    const proximo = new Date(Date.now() + INTERVALO_MS).toISOString();
    const { data: tomada, error: erroReivindicar } = await db
      .from("conexoes")
      .update({ proximo_status_em: proximo })
      .eq("id", c.id)
      .eq("proximo_status_em", c.proximo_status_em)
      .select("id");
    if (erroReivindicar) {
      console.error(`Monitor: não foi possível reivindicar a conexão ${c.id}:`, erroReivindicar.message);
      continue;
    }
    if (!tomada?.length) continue;
    try {
      const z = paraZapbot(c);
      const st = await zapbot().status(z);
      if (st.connected) {
        const { error } = await db
          .from("conexoes")
          .update({
            status: "conectado",
            telefone: st.phone || c.telefone,
            ...(c.status !== "conectado" ? { ultimo_erro: null } : {}),
            // Voltou: a queda acabou (a "Atualização de links" só olha conta caída há 10 min sem voltar).
            ...(c.caiu_em ? { caiu_em: null } : {}),
            ...(c.diagnostico_em ? { diagnostico_queda: null, diagnostico_em: null } : {}),
            ...(c.aviso_queda_enviado_em ? { aviso_queda_enviado_em: null } : {}),
          })
          .eq("id", c.id);
        if (error) console.error(`Monitor: não foi possível atualizar a conexão ${c.id} para conectado:`, error.message);
      } else if (c.status !== "pendente") {
        if (c.status === "conectado") await zapbot().reiniciar(z).catch(() => {}); // uma tentativa de reconectar sem QR
        // Desconectou ou foi banido? Pergunta ao WhatsApp por outro número (na queda e a cada 30 min depois).
        const diagnostico = precisaDiagnostico(c, new Date()) ? await diagnosticarQueda(db, c) : null;
        const { error } = await db
          .from("conexoes")
          .update({
            status: "desconectado",
            ultimo_erro: st.error ?? "Desconectado do WhatsApp: abra a conexão e clique em PAREAR pra ler o QR de novo",
            // Início da queda (a "Atualização de links" espera `MINIMO_CAIDA_MS` a partir daqui).
            ...(c.status === "conectado" ? { caiu_em: new Date().toISOString() } : {}),
            ...(diagnostico ? { diagnostico_queda: diagnostico, diagnostico_em: new Date().toISOString() } : {}),
          })
          .eq("id", c.id);
        if (error) console.error(`Monitor: não foi possível atualizar a conexão ${c.id} para desconectado:`, error.message);
        // Aviso no privado (seção "Aviso de chip caído" das campanhas do chip): uma vez por queda.
        if (!c.aviso_queda_enviado_em) await avisarQuedaPorWhatsapp(db, c, diagnostico ?? c.diagnostico_queda ?? "indefinido");
        if (c.status === "conectado") {
          await alertar({ tipo: "numero_caiu", texto: `Número ${c.nome} caiu: ${diagnostico === "banido" ? "possível banimento (o WhatsApp não encontra mais o número)" : st.error ?? "desconectado do WhatsApp"}`, campanhaId: null, avisarCampanhas: await campanhasDoNumero(c.id), conexaoId: c.id }, db);
          emissor.adicionar(eventoContaDeslogada({ conexaoId: c.id, nome: c.nome, telefone: c.telefone ?? null, motivo: st.error ?? "Número desconectado do WhatsApp" }));
        } else if (trocaDeDonoVencida(c, new Date())) {
          // Continua caída (acabou de conferir no Zapbot) há 10 min ou mais: os grupos das campanhas com
          // "Atualização de links" ligada passam para outra conta admin. Nunca derruba o monitor.
          await trocarDonoDaCaida(c.id, prazo);
        }
      }
    } catch (e) {
      const { error } = await db
        .from("conexoes")
        .update({ ultimo_erro: `Monitor: ${e instanceof Error ? e.message : e}` })
        .eq("id", c.id);
      if (error) console.error(`Monitor: não foi possível salvar o erro da conexão ${c.id}:`, error.message);
    }
    n++;
  }
  return n;
}

/** Pergunta ao WhatsApp, por outro número conectado, se o número caído ainda tem conta (banido = deixou de
 *  existir). Nunca lança: sem outro número ou sem resposta, devolve "indefinido". */
async function diagnosticarQueda(db: ReturnType<typeof dbAdmin>, c: ConexaoLinha): Promise<DiagnosticoQueda> {
  if (!c.telefone) return "indefinido";
  try {
    const { data } = await db.from("conexoes").select("*").eq("status", "conectado").neq("id", c.id).not("zapbot_id", "is", null).limit(3);
    for (const outra of (data ?? []) as ConexaoLinha[]) {
      try {
        const existe = await zapbot().numeroExiste(paraZapbot(outra), c.telefone);
        if (existe !== null) return diagnosticar(existe);
      } catch {
        // tenta o próximo número conectado
      }
    }
  } catch (e) {
    console.error(`Monitor: diagnóstico da queda de ${c.id} falhou:`, e instanceof Error ? e.message : e);
  }
  return "indefinido";
}

/** Manda, por outro chip conectado, a mensagem de chip caído no privado dos telefones das campanhas do chip.
 *  Prefere um chip das mesmas campanhas (o reserva). Marca `aviso_queda_enviado_em` quando mandou pra todos (ou não
 *  há ninguém pra avisar); sem chip conectado, tenta de novo na próxima volta do monitor. Nunca lança. */
async function avisarQuedaPorWhatsapp(db: ReturnType<typeof dbAdmin>, c: ConexaoLinha, diagnostico: DiagnosticoQueda): Promise<void> {
  try {
    const ids = await campanhasDoNumero(c.id);
    const { data: camps } = ids.length ? await db.from("campanhas").select("id, telefones_aviso_queda").in("id", ids) : { data: [] };
    const telefones = [...new Set(((camps ?? []) as { telefones_aviso_queda: string[] | null }[]).flatMap((x) => x.telefones_aviso_queda ?? []))].filter((t) => t !== c.telefone);
    const marcar = () => db.from("conexoes").update({ aviso_queda_enviado_em: new Date().toISOString() }).eq("id", c.id);
    if (!telefones.length) {
      await marcar();
      return;
    }
    const { data: ligadas } = await db.from("conexoes").select("*").eq("status", "conectado").neq("id", c.id).not("zapbot_id", "is", null);
    const { data: daCampanha } = await db.from("campanha_conexoes").select("conexao_id").in("campanha_id", ids);
    const preferidas = new Set(((daCampanha ?? []) as { conexao_id: string }[]).map((x) => x.conexao_id));
    const candidatas = ((ligadas ?? []) as ConexaoLinha[]).sort((a, b) => Number(preferidas.has(b.id)) - Number(preferidas.has(a.id)));
    if (!candidatas.length) return;
    const texto = mensagemAvisoQueda({ nome: c.nome, telefone: c.telefone, diagnostico, link: `${env("NEXT_PUBLIC_SITE_URL")}/numeros/${c.id}` });
    let todos = true;
    for (const tel of telefones) {
      let foi = false;
      for (const outra of candidatas) {
        try {
          await zapbot().enviar(paraZapbot(outra), "send-text", { phone: tel, message: texto });
          foi = true;
          break;
        } catch (e) {
          console.error(`Monitor: aviso de queda pra ${tel} pelo ${outra.nome} falhou:`, e instanceof Error ? e.message : e);
        }
      }
      if (!foi) todos = false;
    }
    if (todos) await marcar();
  } catch (e) {
    console.error(`Monitor: aviso de queda de ${c.id} falhou:`, e instanceof Error ? e.message : e);
  }
}

/** "Atualização de links" da conta caída, isolada: erro só loga. Marca `grupos_trocados_em` só quando terminou
 *  (tempo do tick acabou ou falha no banco = a próxima volta do monitor continua de onde parou). */
async function trocarDonoDaCaida(conexaoId: string, prazo: Prazo): Promise<void> {
  try {
    // Orçamento próprio (15 s), sem passar dos 20 s que o resto do tick precisa.
    const r = await trocarDonoECorrigirLinks(conexaoId, { ate: Math.min(Date.now() + ORCAMENTO_TROCA_MS, prazo.ate - 20_000) });
    if (!r.completo) return;
    const { error } = await dbAdmin().from("conexoes").update({ grupos_trocados_em: new Date().toISOString() }).eq("id", conexaoId);
    if (error) console.error(`Monitor: não foi possível marcar a troca de dono da conexão ${conexaoId}:`, error.message);
  } catch (e) {
    console.error(`Monitor: troca de dono dos grupos da conexão ${conexaoId} falhou:`, e instanceof Error ? e.message : e);
  }
}

/** Campanhas que dependem do número (cria grupos, é admin ou é dono de grupo ativo): recebem o webhook de alerta.
 *  Nunca lança: se a busca falhar, loga e devolve lista vazia (o alerta ainda é gravado, só sem avisar campanhas). */
export async function campanhasDoNumero(conexaoId: string): Promise<string[]> {
  const db = dbAdmin();
  try {
    const [criadora, admin, grupos] = await Promise.all([
      db.from("campanhas").select("id").eq("conexao_criadora_id", conexaoId),
      db.from("campanha_conexoes").select("campanha_id").eq("conexao_id", conexaoId),
      db.from("grupos").select("campanha_id").eq("conexao_id", conexaoId).eq("ativo", true),
    ]);
    return [...new Set([...(criadora.data ?? []).map((c) => c.id as string), ...(admin.data ?? []).map((a) => a.campanha_id as string), ...(grupos.data ?? []).map((g) => g.campanha_id as string)])];
  } catch (e) {
    console.error(`Monitor: não foi possível ler as campanhas do número ${conexaoId}:`, e instanceof Error ? e.message : e);
    return [];
  }
}
