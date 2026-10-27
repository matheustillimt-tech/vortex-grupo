import type { EscopoApi } from "./chaves";

/** Catálogo dos endpoints da API v1 (tela API, abas "Endpoints" e "Documentação (API)"), espelhando as
 *  rotas de `app/api/v1/*`. Sem `server-only`: a tela monta a tabela e os exemplos curl só com este catálogo
 *  (nenhuma consulta própria). Atualize aqui quando uma rota em `app/api/v1` mudar. */

export type EndpointApi = {
  metodo: "GET" | "POST";
  caminho: string;
  escopo: EscopoApi;
  descricao: string;
  /** Corpo de exemplo (POST) pro `curl -d`; omitido nos GET. */
  corpoExemplo?: Record<string, unknown>;
};

export const ENDPOINTS_API: EndpointApi[] = [
  { metodo: "GET", caminho: "/api/v1/campanhas", escopo: "leitura", descricao: "Lista as campanhas ativas, com link, tipo, grupos e participantes." },
  { metodo: "GET", caminho: "/api/v1/campanhas/{id}", escopo: "leitura", descricao: "Uma campanha (inclusive arquivada) com as métricas dos últimos 7 dias." },
  { metodo: "GET", caminho: "/api/v1/campanhas/{id}/grupos", escopo: "leitura", descricao: "Grupos ativos da campanha, 50 por página (`?pagina=`)." },
  { metodo: "GET", caminho: "/api/v1/contas", escopo: "leitura", descricao: "Conexões (números) conectadas, com o telefone mascarado." },
  { metodo: "GET", caminho: "/api/v1/acoes", escopo: "leitura", descricao: "Ações por campanha e aba, 50 por página (`?campanha=&aba=&pagina=`)." },
  {
    metodo: "POST",
    caminho: "/api/v1/acoes",
    escopo: "envio",
    descricao: "Cria uma ação por campanha (mensagem, troca de nome/descrição, abrir/fechar grupos).",
    corpoExemplo: { campanhas: ["id-da-campanha"], tipo: "mensagem", conteudo: { versao: 2, mensagens: [{ formato: "texto", texto: "Olá!" }] } },
  },
];
