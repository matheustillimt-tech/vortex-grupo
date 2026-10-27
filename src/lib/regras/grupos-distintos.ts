/** "Grupos distintos de WhatsApp" dos cartões de Campanhas e da Visão geral: o mesmo grupo do WhatsApp pode aparecer em mais de uma campanha (grupo reaproveitado) — aqui conta
 *  cada `group_id` uma vez só e soma `participantes` uma vez por grupo, em vez de somar o total por campanha
 *  (que contaria o grupo de novo a cada campanha). Puro: a leitura paginada de `grupos` mora em `dados.ts`. */

export type LinhaGrupoDistintos = { group_id: string | null; participantes: number; campanha_id: string };

export type Distintos = { grupos: number; participantes: number };

export function gruposDistintos(linhas: LinhaGrupoDistintos[]): Distintos {
  const vistos = new Map<string, number>();
  for (const l of linhas) {
    if (!l.group_id) continue;
    if (!vistos.has(l.group_id)) vistos.set(l.group_id, l.participantes);
  }
  let participantes = 0;
  for (const v of vistos.values()) participantes += v;
  return { grupos: vistos.size, participantes };
}
