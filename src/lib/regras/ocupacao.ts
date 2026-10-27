/** Taxa de entrada estimada (cliques que viram entrada): em campanhas reais fica entre 56 e 60%. */
export const TAXA_ENTRADA = 0.6;

export function ocupacaoEstimada(participantes: number, cliquesRecentes: number): number {
  return participantes + Math.ceil(cliquesRecentes * TAXA_ENTRADA);
}

/** `reservados` (Etapa 3N, "Reservar vaga para solicitações pendentes"): pedidos pendentes que seguram vaga. Só é
 *  passado contra o limite da campanha (nunca contra `LIMITE_WHATSAPP`); 0 = a conta de antes. */
export function estaCheio(participantes: number, cliquesRecentes: number, limite: number, reservados = 0): boolean {
  const r = Number.isFinite(reservados) ? Math.max(0, Math.floor(reservados)) : 0;
  return ocupacaoEstimada(participantes, cliquesRecentes) + r >= limite;
}

export function precisaGrupoNovo(gruposComVaga: number, folga: number, criacaoNaFila: boolean): boolean {
  return !criacaoNaFila && gruposComVaga < folga;
}

/** Limite do WhatsApp: grupo com isso de gente não aceita mais ninguém, mesmo marcado "não cheio" à mão. */
export const LIMITE_WHATSAPP = 1024;

/** "Encheu" (alerta e automações de grupo cheio) só vale pra lotação automática: com `cheio_manual` definido
 *  (true ou false), a lotação foi decidida à mão e nada dispara. Mesma regra no link e na conferência. */
export function avisaQueEncheu(cheioManual: boolean | null | undefined): boolean {
  return cheioManual === null || cheioManual === undefined;
}

/** Valor final de `grupos.cheio`. `cheioManual` null = automático (como antes: estimativa contra o limite da
 *  campanha); true/false = marcado à mão e mantido. Acima de tudo, um grupo no limite do WhatsApp (pela mesma
 *  estimativa) é sempre cheio: um convite pra grupo lotado falha e a pessoa se perde. */
export function cheioFinal(
  cheioManual: boolean | null | undefined,
  participantes: number,
  cliquesRecentes: number,
  limite: number,
  /** Pedidos pendentes reservados (só com a reserva ligada; 0 = a conta de antes). Só contra o limite da campanha. */
  reservados = 0,
): boolean {
  if (estaCheio(participantes, cliquesRecentes, LIMITE_WHATSAPP)) return true;
  if (cheioManual === true || cheioManual === false) return cheioManual;
  return estaCheio(participantes, cliquesRecentes, limite, reservados);
}
