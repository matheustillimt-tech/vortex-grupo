export type AbaContas = "todas" | "conectadas" | "desconectadas" | "sem_sessao";

export const ABAS_CONTAS: { valor: AbaContas; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "conectadas", rotulo: "Conectadas" },
  { valor: "desconectadas", rotulo: "Desconectadas" },
  { valor: "sem_sessao", rotulo: "Sem sessão" },
];

export function lerAbaContas(v?: string): AbaContas {
  return ABAS_CONTAS.some((a) => a.valor === v) ? (v as AbaContas) : "todas";
}

/** Abas do detalhe da conta (`numeros/[id]`). "contatos" é a primeira à esquerda
 *  (Etapa 3K, Tarefa 4.17); a aba aberta por padrão é "Ações" (Etapa 3L, Tarefa 6,
 *  revisão final); links antigos com `?aba=grupos` continuam abrindo a aba Grupos. */
export type AbaDetalheConta = "contatos" | "grupos" | "campanhas" | "webhooks" | "criacao_grupos" | "acoes";

export const ABA_DETALHE_CONTA_PADRAO: AbaDetalheConta = "acoes";

const ABAS_DETALHE_CONTA: AbaDetalheConta[] = ["contatos", "grupos", "campanhas", "webhooks", "criacao_grupos", "acoes"];

/** `?aba=` do detalhe da conta → uma aba válida, com "Grupos" como padrão. "webhooks" só é válida com
 *  `permitido("webhooks", "ver")` (revisão final): sem a permissão, ela nem aparece na lista de abas nem é
 *  aceita via URL direta — cai na aba padrão, igual a qualquer valor inválido. */
export function lerAbaDetalheConta(v: string | undefined, podeVerWebhooks: boolean): AbaDetalheConta {
  const validas = podeVerWebhooks ? ABAS_DETALHE_CONTA : ABAS_DETALHE_CONTA.filter((a) => a !== "webhooks");
  return (validas as string[]).includes(v ?? "") ? (v as AbaDetalheConta) : ABA_DETALHE_CONTA_PADRAO;
}

export type ContaLista = {
  id: string;
  nome: string;
  telefone: string | null;
  status: string;
  created_at: string;
  ultimo_erro: string | null;
  pausado_ate: string | null;
  /** Pasta da conta (Etapa 3G, Tarefa 3 — `conexoes.projeto_id`). `undefined` nas telas que não carregam o
   *  projeto (ex.: coluna "Contas" do Início): trate como "sem pasta" pra ordenação/filtro. */
  projeto_id?: string | null;
  /** Nome do projeto, só pra ordenar "Por projeto" (join feito por quem chama; `null`/`undefined` = sem pasta). */
  projeto_nome?: string | null;
  /** Etiquetas "principal"/"reserva" por campanha (`papeisDasContas`); ausente = sem etiqueta. */
  papel?: { papel: "principal" | "reserva"; campanha: string }[];
};

/** Opções de "Ordenação" da lista de contas: mesmos 4 rótulos, mas o Vórtex Grupo
 *  não tem coluna própria de "atualizado em" nem posição manual — "Data de atualização" e "Posição" caem na
 *  mesma ordem de "Data de criação" até existir esse dado (ver `filtrarContas`). "Por projeto" é real: nome do
 *  projeto, depois nome da conta. */
export type OrdemContas = "criacao" | "atualizacao" | "posicao" | "projeto" | "nome";

/** "Nome" (revisão final): existia antes de chegarem "Data de atualização"/"Posição"/"Por projeto" e
 *  tinha caído da lista nessa troca — volta aqui, junto com as opções novas. */
export const OPCOES_ORDEM_CONTAS: { valor: OrdemContas; rotulo: string }[] = [
  { valor: "criacao", rotulo: "Data de criação" },
  { valor: "atualizacao", rotulo: "Data de atualização" },
  { valor: "posicao", rotulo: "Posição" },
  { valor: "projeto", rotulo: "Por projeto" },
  { valor: "nome", rotulo: "Nome" },
];

export function lerOrdemContas(v: string | undefined): OrdemContas {
  return OPCOES_ORDEM_CONTAS.some((o) => o.valor === v) ? (v as OrdemContas) : "criacao";
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

export function filtrarContas(l: ContaLista[], f: { aba: AbaContas; busca: string; ordem: OrdemContas }): ContaLista[] {
  const busca = f.busca.trim();
  const digitosBusca = soDigitos(busca);
  const buscaSemAcento = semAcento(busca);
  return l
    .filter((c) =>
      f.aba === "todas"
        ? true
        : f.aba === "conectadas"
          ? c.status === "conectado"
          : f.aba === "desconectadas"
            ? c.status === "desconectado"
            : c.status === "pendente",
    )
    .filter((c) => {
      if (!busca) return true;
      if (digitosBusca && (c.telefone ?? "").includes(digitosBusca)) return true;
      return semAcento(c.nome).includes(buscaSemAcento);
    })
    .sort((a, b) => {
      if (f.ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      if (f.ordem === "projeto") {
        const pa = a.projeto_nome ?? "";
        const pb = b.projeto_nome ?? "";
        if (pa !== pb) {
          if (!pa) return 1; // sem pasta sempre por último
          if (!pb) return -1;
          return pa.localeCompare(pb, "pt-BR");
        }
        return a.nome.localeCompare(b.nome, "pt-BR");
      }
      return a.created_at.localeCompare(b.created_at);
    });
}

export function validarNomeConexao(nome: string): { ok: true; nome: string } | { ok: false; erro: string } {
  const n = nome.trim();
  if (!n || n.length > 40) return { ok: false, erro: "Dê um nome de até 40 caracteres." };
  return { ok: true, nome: n };
}

/** Se o WhatsApp limitou a conta até `pausadoAte` (selo "pausado" no cartão e no cabeçalho da conta). */
export function estaPausado(pausadoAte: string | null, agora: Date = new Date()): boolean {
  return !!pausadoAte && new Date(pausadoAte) > agora;
}

/** Aba "Webhooks" do detalhe da conta: um webhook "vale" para a conta quando ele se aplica
 *  a pelo menos uma das campanhas dela (`webhooks.campanhas = null` vale para todas as campanhas). */
export function webhookValeParaCampanhas(webhookCampanhas: string[] | null, campanhaIds: string[]): boolean {
  if (webhookCampanhas === null) return true;
  return webhookCampanhas.some((c) => campanhaIds.includes(c));
}
