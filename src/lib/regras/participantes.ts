export type Membro = { telefone: string; admin: boolean };

export function diffParticipantes(noBanco: Membro[], noWhatsApp: Membro[]) {
  const banco = new Map(noBanco.map((m) => [m.telefone, m]));
  const whats = new Map(noWhatsApp.map((m) => [m.telefone, m]));
  const entraram = noWhatsApp.filter((m) => !banco.has(m.telefone));
  const sairam = noBanco.filter((m) => !whats.has(m.telefone)).map((m) => m.telefone);
  const adminMudou = noWhatsApp.filter((m) => banco.has(m.telefone) && banco.get(m.telefone)!.admin !== m.admin);
  return { entraram, sairam, adminMudou };
}
