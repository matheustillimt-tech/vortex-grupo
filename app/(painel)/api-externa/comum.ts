import type { EscopoApi, TipoChave } from "@/src/lib/api/chaves";

/** Linha de `api_chaves` como a tela lê (sem o hash: `authenticated` nem tem select nessa coluna). Compartilhada
 *  pelas telas API (`/api-externa`, tipo "api") e MCP (`/mcp`, tipo "mcp" — ali chamada de "conexão"). */
export type ChaveLinha = {
  id: string;
  created_at: string;
  nome: string;
  prefixo: string;
  escopo: EscopoApi;
  tipo: TipoChave;
  ultimo_uso: string | null;
  revogada_em: string | null;
};

export const COLUNAS_CHAVE = "id, created_at, nome, prefixo, escopo, tipo, ultimo_uso, revogada_em";

export const ROTULO_ESCOPO: Record<EscopoApi, string> = { leitura: "Leitura", envio: "Leitura e envio" };

/** Endereço de exemplo: só entra quando `NEXT_PUBLIC_SITE_URL` não está definida (ex.: alguns testes/preview). */
export const SITE_URL_PADRAO = "https://seu-dominio.com.br";

// ---------- Acessos de atendentes (Etapa 3K, Tarefa 7) ----------

export type StatusAcessoLinha = "aguardando" | "aprovado" | "recusado" | "revogado";

/** Linha da seção "Acessos de atendentes" (só Administrador). Nunca traz chave nem token. */
export type AcessoLinha = {
  id: string;
  created_at: string;
  atendente: string;
  contato: string;
  chave: string;
  motivo: string | null;
  status: StatusAcessoLinha;
};

/** Linha de "Meus acessos" (o próprio atendente). `prefixo`: da chave filha valendo agora (null = ainda não gerou). */
export type MeuAcessoLinha = {
  id: string;
  created_at: string;
  chave: string;
  escopo: EscopoApi;
  status: StatusAcessoLinha;
  chaveRevogada: boolean;
  prefixo: string | null;
};

export const ROTULO_STATUS_ACESSO: Record<StatusAcessoLinha, string> = {
  aguardando: "Aguardando aprovação",
  aprovado: "Aprovada",
  recusado: "Recusada",
  revogado: "Revogada",
};
