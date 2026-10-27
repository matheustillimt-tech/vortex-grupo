import type { Aba } from "../_componentes/abas";

/** Abas do topo das telas de Segurança (Anti-spam). Blacklists entrou aqui em 19/10/2026, quando saiu do menu lateral. */
export const ABAS_ANTISPAM: Aba[] = [
  { href: "/anti-spam", rotulo: "Números bloqueados", exato: true },
  { href: "/blacklists", rotulo: "Blacklists" },
  { href: "/anti-spam/administrativos", rotulo: "Números administrativos" },
  { href: "/anti-spam/eventos", rotulo: "Eventos" },
  { href: "/anti-spam/contas", rotulo: "Conexões associadas" },
];

/** Como o bloqueio entrou (botão na pessoa, colado à mão ou importado de planilha). */
export const ROTULO_ORIGEM: Record<string, string> = { botao: "botão", manual: "à mão", csv: "planilha" };
