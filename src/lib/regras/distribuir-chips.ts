/** Divisão de mensagens e enquetes entre os chips (20/10/2026, pedido do dono): no lançamento de 19/10 os 98 envios
 *  das 20h saíram por um chip só, um de cada vez, e a fila levou 18 min. Cada grupo vai pro chip conectado e admin
 *  dele com menos envios (na fila + já distribuídos neste tick); empate fica com o dono do grupo. Grupo sem outro
 *  chip apto continua com o dono, como antes. */
export type GrupoParaDistribuir = { grupoId: string; conexaoId: string };

export function distribuirEntreChips<T extends GrupoParaDistribuir>(
  grupos: T[],
  aptosPorGrupo: Map<string, string[]>,
  carga: Map<string, number>,
): T[] {
  return grupos.map((g) => {
    const aptos = aptosPorGrupo.get(g.grupoId) ?? [];
    const candidatos = aptos.includes(g.conexaoId) ? aptos : aptos.length ? aptos : [g.conexaoId];
    let escolhido = candidatos.includes(g.conexaoId) ? g.conexaoId : candidatos[0];
    for (const c of candidatos) if ((carga.get(c) ?? 0) < (carga.get(escolhido) ?? 0)) escolhido = c;
    carga.set(escolhido, (carga.get(escolhido) ?? 0) + 1);
    return { ...g, conexaoId: escolhido };
  });
}

/** Só o que é enviado dentro do grupo e sem contas escolhidas à mão ("só grupos destas contas"). */
export function podeDistribuir(tipo: string, alvoContas: string[] | null | undefined): boolean {
  return (tipo === "mensagem" || tipo === "enquete") && !alvoContas?.length;
}
