/**
 * Regras puras da aba "Campanhas" do detalhe da conta (`numeros/[id]/campanhas-conta.tsx`, revisão
 * final). "Selecionar todas"/"Desmarcar todas" têm que agir só sobre a lista FILTRADA (busca atual) na tela —
 * não a lista inteira — e nunca podem marcar/desmarcar a campanha onde esta conta é a criadora (ela já vem
 * marcada e travada à parte, por um checkbox `disabled`).
 */

export type CampanhaSelecionavel = { id: string; criadora: boolean };

export function selecionarTodasFiltradas(marcadas: Set<string>, filtradas: CampanhaSelecionavel[]): Set<string> {
  const s = new Set(marcadas);
  for (const c of filtradas) if (!c.criadora) s.add(c.id);
  return s;
}

export function desmarcarTodasFiltradas(marcadas: Set<string>, filtradas: CampanhaSelecionavel[]): Set<string> {
  const s = new Set(marcadas);
  for (const c of filtradas) if (!c.criadora) s.delete(c.id);
  return s;
}
