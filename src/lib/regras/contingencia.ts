import { chaveTelefone } from "../telefone";

/** Contingência da campanha (seção "Atualização de links"): quantos grupos ativos têm, além da conexão dona, outra
 *  conexão da campanha conectada e admin do grupo — quem assume se a dona cair. Sem isso a troca automática não tem
 *  pra onde levar o grupo (queda de 19/10/2026: 4 dos 14 grupos ficaram sem envio). Pura: recebe o que a página leu. */

export type ConexaoDaCampanha = { id: string; nome: string; telefone: string | null; status: string };
export type GrupoDaCampanha = { id: string; numero: number; conexao_id: string };
export type AdminDoGrupo = { grupo_id: string; telefone: string };

export type Contingencia = {
  total: number;
  comReserva: number;
  /** Números dos grupos sem reserva, em ordem. */
  semReserva: number[];
  /** Grupos cuja conexão dona está fora do ar agora. */
  donoCaido: number[];
  /** Conexões da campanha conectadas agora. */
  conectadas: number;
};

export function resumirContingencia(grupos: GrupoDaCampanha[], conexoes: ConexaoDaCampanha[], admins: AdminDoGrupo[]): Contingencia {
  const porId = new Map(conexoes.map((c) => [c.id, c]));
  const vivas = conexoes.filter((c) => c.status === "conectado" && c.telefone);
  const adminsDoGrupo = new Map<string, Set<string>>();
  for (const a of admins) {
    const set = adminsDoGrupo.get(a.grupo_id) ?? new Set<string>();
    set.add(chaveTelefone(a.telefone));
    adminsDoGrupo.set(a.grupo_id, set);
  }
  const semReserva: number[] = [];
  const donoCaido: number[] = [];
  for (const g of [...grupos].sort((a, b) => a.numero - b.numero)) {
    const dono = porId.get(g.conexao_id);
    if (!dono || dono.status !== "conectado") donoCaido.push(g.numero);
    const set = adminsDoGrupo.get(g.id);
    const temReserva = !!set && vivas.some((c) => c.id !== g.conexao_id && set.has(chaveTelefone(c.telefone!)));
    if (!temReserva) semReserva.push(g.numero);
  }
  return { total: grupos.length, comReserva: grupos.length - semReserva.length, semReserva, donoCaido, conectadas: vivas.length };
}

/** "#01, #02 e #09" (até `max`, depois "e mais N"). */
export function listarNumeros(numeros: number[], max = 12): string {
  const fmt = numeros.slice(0, max).map((n) => `#${String(n).padStart(2, "0")}`);
  const resto = numeros.length - fmt.length;
  if (resto > 0) return `${fmt.join(", ")} e mais ${resto}`;
  if (fmt.length <= 1) return fmt.join("");
  return `${fmt.slice(0, -1).join(", ")} e ${fmt[fmt.length - 1]}`;
}

export type ConexaoCandidata = { id: string; status: string; telefone?: string | null };

/** Quem cria o grupo novo: a conexão criadora se estiver conectada; senão a primeira conexão associada conectada (a
 *  reserva cria no lugar dela; quando uma conexão caiu, a campanha parou de criar grupos). `jaEscolhida`
 *  (retomada da mesma ação) sempre vence enquanto estiver conectada: a retentativa nunca troca de número no meio. */
export function escolherCriadora(o: { criadoraId: string | null; associadas: ConexaoCandidata[]; jaEscolhida?: string | null; conexoes: ConexaoCandidata[] }): string | null {
  const porId = new Map(o.conexoes.map((c) => [c.id, c]));
  const viva = (id: string | null | undefined) => !!id && porId.get(id)?.status === "conectado";
  if (o.jaEscolhida) return viva(o.jaEscolhida) ? o.jaEscolhida : null;
  if (viva(o.criadoraId)) return o.criadoraId;
  return o.associadas.find((c) => c.id !== o.criadoraId && c.status === "conectado" && !!c.telefone)?.id ?? null;
}

/** Resposta do Zapbot de "esta conexão não está no grupo" (a conexão dona saiu, foi removida ou nunca entrou). */
export function naoParticipaDoGrupo(mensagem: string): boolean {
  return /not participating|not a participant|n[ãa]o (est[áa] no grupo|participa)/i.test(mensagem);
}

/** Texto em português do erro da conferência de um grupo (vai pro cartão da conexão). */
export function erroDaConferencia(grupoNome: string, mensagem: string): string {
  if (naoParticipaDoGrupo(mensagem)) return `Não está no grupo ${grupoNome}: coloque esta conexão (ou outra conectada da campanha) como admin dele`;
  return `Não conseguiu ler o grupo ${grupoNome}: ${mensagem}`;
}

export type PapelConta = { papel: "principal" | "reserva"; campanha: string };

/** Etiquetas da conexão nas listas (Início e Conexões), uma por campanha ativa: "principal" = cria os grupos dela;
 *  "reserva" = associada sem criar. Principal primeiro, depois por nome. Fora de campanha = sem etiqueta. */
export function papeisDasContas(campanhas: { id: string; nome: string; conexao_criadora_id: string | null }[], associacoes: { campanha_id: string; conexao_id: string }[]): Map<string, PapelConta[]> {
  const porId = new Map(campanhas.map((c) => [c.id, c]));
  const papeis = new Map<string, PapelConta[]>();
  const somar = (conexao: string, p: PapelConta) => papeis.set(conexao, [...(papeis.get(conexao) ?? []), p]);
  for (const c of campanhas) if (c.conexao_criadora_id) somar(c.conexao_criadora_id, { papel: "principal", campanha: c.nome });
  for (const a of associacoes) {
    const c = porId.get(a.campanha_id);
    if (c && c.conexao_criadora_id !== a.conexao_id) somar(a.conexao_id, { papel: "reserva", campanha: c.nome });
  }
  for (const l of papeis.values()) l.sort((x, y) => (x.papel === y.papel ? x.campanha.localeCompare(y.campanha) : x.papel === "principal" ? -1 : 1));
  return papeis;
}
