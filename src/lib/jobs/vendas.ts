import "server-only";
import { dispararCheckout, type Db } from "../automacoes";
import { telefoneDoPayload } from "../checkout/parsers";
import { digitosSemDdi } from "../telefone";
import { dbAdmin } from "../supabase/admin";
import { carregarWebhooks, enfileirarEvento } from "../webhooks";
import { marcarComprador } from "./pessoas";

/** Venda sem telefone completo: checkout que manda número de fora sem o DDI (há checkout que manda "961000222" pra
 *  Portugal e "0430780810" pra Austrália). Procura nos grupos quem tem número terminado nesses dígitos (pelo menos 9)
 *  e usa o número completo de lá. Só se for uma pessoa só: duas ou mais = não arrisca tirar a pessoa errada. */
async function telefonePeloFinal(db: Db, provedor: string, payload: unknown): Promise<string | null> {
  const bruto = telefoneDoPayload(provedor, payload);
  const final = bruto ? digitosSemDdi(bruto) : null;
  if (!final || final.length < 9) return null;
  const { data, error } = await db.from("participantes").select("telefone").like("telefone", `%${final}`).limit(50);
  if (error) throw new Error(`Não foi possível procurar o número pelo final: ${error.message}`);
  const telefones = [...new Set(((data as { telefone: string }[] | null) ?? []).map((p) => p.telefone))].filter((t) => t.length > final.length);
  return telefones.length === 1 ? telefones[0] : null;
}

export async function processarVendas(): Promise<number> {
  const db = dbAdmin();
  const { data: vendas, error } = await db.from("vendas").select("id, provedor, aprovada, telefone, produtos, payload").is("processada_em", null).limit(50);
  if (error) throw new Error(`Não foi possível buscar as vendas pendentes: ${error.message}`);
  // Carregado uma vez pro lote: evita reler a tabela de webhooks a cada venda aprovada.
  const webhooksCadastrados = await carregarWebhooks(db);
  for (const v of vendas ?? []) {
    let resultado: string | undefined;
    let falhou = false;
    let telefone: string | null = v.telefone;
    let achadoPeloFinal = false;
    if (v.aprovada && !telefone) {
      try {
        telefone = await telefonePeloFinal(db, v.provedor, v.payload);
        achadoPeloFinal = !!telefone;
      } catch (e) {
        console.error(`Venda ${v.id}: ${e instanceof Error ? e.message : e}`);
        continue;
      }
    }
    if (!v.aprovada) resultado = "ignorada (não é compra aprovada)";
    else if (!telefone) resultado = "sem telefone";
    else {
      try {
        await marcarComprador(db, telefone);
      } catch (e) {
        console.error(`Venda ${v.id}: ${e instanceof Error ? e.message : e}`);
        falhou = true;
      }
      if (!falhou) {
        resultado = achadoPeloFinal ? "número sem DDI achado nos grupos · tag Comprador adicionada" : "tag Comprador adicionada";
        // Automações "Checkout - Compra aprovada". Se falhar, a venda volta na próxima rodada; as remoções já
        // criadas não se repetem (índice único por automação+venda+grupo e um "remover" aberto por grupo+telefone).
        // Tirar o comprador dos grupos da campanha ("Remover compradores") saiu em 19/10/2026 por decisão do dono:
        // é feito por webhook fora do Vórtex Grupo.
        try {
          const porAutomacao = await dispararCheckout({ vendaId: v.id, provedor: v.provedor, produtos: v.produtos ?? [], telefone });
          if (porAutomacao) resultado += ` · ${porAutomacao} remoção(ões) por automação`;
        } catch (e) {
          console.error(`Venda ${v.id}: automações de checkout não foram agendadas: ${e instanceof Error ? e.message : e}`);
          falhou = true;
        }
      }
      // Evento "compra" (sem campanha: casa só com webhooks de "todas"). Fica como último passo fallível
      // antes de marcar a venda como processada — se falhar, `falhou` vira true e nada é marcado, então a
      // próxima rodada tenta de novo sem já ter enfileirado o evento (sem duplicar o aviso).
      if (!falhou) {
        try {
          // Chave de idempotência: se o update de `processada_em` falhar depois daqui, a próxima rodada
          // reprocessa a venda e tenta enfileirar de novo, mas o upsert (índice único por webhook+chave)
          // não duplica a linha nos webhooks cadastrados.
          await enfileirarEvento(db, { evento: "compra", campanhaId: null, dados: { telefone: telefone, produtos: v.produtos ?? [] }, chave: `compra:${v.id}` }, webhooksCadastrados);
          // Leitura dos webhooks cadastrados falhou pro lote inteiro: o evento de compra desta venda não
          // teve como casar com nenhum (não há endereço legado pra "compra"), mas a venda segue marcada
          // como processada — fica só o registro, sem dado pessoal, pra quem for investigar.
          if (webhooksCadastrados === null) {
            console.error(`Venda ${v.id}: webhooks cadastrados não carregados; o evento de compra não foi enfileirado pra eles.`);
          }
        } catch (e) {
          console.error(`Venda ${v.id}: não foi possível enfileirar o evento de compra: ${e instanceof Error ? e.message : e}`);
          falhou = true;
        }
      }
    }
    // Falha ao marcar o comprador, agendar as automações ou enfileirar o evento: não marca como processada,
    // pra próxima rodada do cron tentar de novo (nada fica perdido silenciosamente).
    if (falhou) continue;
    // `.eq("aprovada", …)`: se a venda virou aprovada no meio desta rodada (registrar_venda), não marca como
    // processada com o resultado da não aprovada — fica pra próxima rodada.
    const { error: erroUpdate } = await db.from("vendas").update({ processada_em: new Date().toISOString(), resultado, ...(achadoPeloFinal ? { telefone } : {}) }).eq("id", v.id).eq("aprovada", v.aprovada);
    if (erroUpdate) console.error(`Venda ${v.id} processada (${resultado}) mas não foi possível salvar o resultado: ${erroUpdate.message}`);
  }
  return vendas?.length ?? 0;
}
