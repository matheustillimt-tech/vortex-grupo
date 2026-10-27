import "server-only";
import { decifrar } from "./crypto";
import { dbAdmin } from "./supabase/admin";
import type { ZapbotConexao } from "./zapbot/client";

export type ConexaoLinha = {
  id: string;
  nome: string;
  telefone: string | null;
  status: "pendente" | "conectado" | "desconectado";
  zapbot_id: string | null;
  zapbot_token_enc: string | null;
  client_token_enc: string | null;
  webhook_secret: string;
  pausado_ate: string | null;
  ultimo_erro: string | null;
};

export function paraZapbot(c: ConexaoLinha): ZapbotConexao {
  if (!c.zapbot_id || !c.zapbot_token_enc || !c.client_token_enc) throw new Error(`Conexão ${c.nome} sem credenciais do Zapbot`);
  return { id: c.zapbot_id, token: decifrar(c.zapbot_token_enc), clientToken: decifrar(c.client_token_enc) };
}

export async function credenciais(conexaoId: string): Promise<ZapbotConexao> {
  const { data, error } = await dbAdmin().from("conexoes").select("*").eq("id", conexaoId).single<ConexaoLinha>();
  if (error || !data) throw new Error("Conexão não encontrada");
  return paraZapbot(data);
}
