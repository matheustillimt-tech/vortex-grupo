/** DDDs que existem no Brasil. */
const DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77, 79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92,
  93, 94, 95, 96, 97, 98, 99,
]);

/** 10 ou 11 dígitos que formam um número brasileiro sem DDI: DDD que existe e, com 11 dígitos, celular (9 depois do DDD). */
function nacionalBrasileiro(d: string): boolean {
  if (d.length !== 10 && d.length !== 11) return false;
  if (!DDDS.has(Number(d.slice(0, 2)))) return false;
  return d.length === 10 || d[2] === "9";
}

/** Só dígitos com DDI. Com "+" ou "00" na frente o DDI já veio e fica como está ("+61 430 780 810"). Número brasileiro
 *  sem DDI (10 ou 11 dígitos, com ou sem o 0 antes do DDD) ganha 55; 11 a 15 dígitos que não são brasileiros já
 *  trazem o DDI ("61430780810"). Número de fora sem DDI (checkout que tira o código
 *  do país: "0430 780 810" da Austrália, "965 181 353" de Portugal) não tem como virar número completo aqui: `null`
 *  (a venda tenta achar a pessoa nos grupos pelo final do número, `digitosSemDdi`). */
export function normalizarTelefone(bruto: string): string | null {
  const t = bruto.trim();
  let d = t.replace(/\D/g, "");
  if (t.startsWith("+") || d.startsWith("00")) {
    d = d.replace(/^00/, "");
    return d.length >= 11 && d.length <= 15 ? d : null;
  }
  // 0 na frente é prefixo de ligação nacional: depois dele nunca vem DDI.
  const nacional = d.startsWith("0");
  if (nacional) d = d.slice(1);
  if (nacionalBrasileiro(d)) return "55" + d;
  if (nacional || d.length < 11) return null;
  return d.length <= 15 ? d : null;
}

/** Número sem DDI que `normalizarTelefone` não completa: só os dígitos, sem os zeros da frente, se tiver de 8 a 11
 *  (ex.: "0430 780 810" → "430780810"). Serve pra procurar a pessoa pelo final do número. */
export function digitosSemDdi(bruto: string): string | null {
  const d = bruto.replace(/\D/g, "").replace(/^0+/, "");
  return d.length >= 8 && d.length <= 11 ? d : null;
}

/** O WhatsApp normaliza o nono dígito: compare sempre com as duas formas. */
export function variantesTelefone(tel: string): string[] {
  if (tel.startsWith("55") && tel.length === 13 && tel[4] === "9") return [tel, tel.slice(0, 4) + tel.slice(5)];
  if (tel.startsWith("55") && tel.length === 12) return [tel, tel.slice(0, 4) + "9" + tel.slice(4)];
  return [tel];
}

/** Mesma pessoa com e sem o nono dígito dá a mesma chave (para comparar listas). */
export function chaveTelefone(tel: string): string {
  return [...variantesTelefone(tel)].sort()[0];
}

/** Para tela e planilha: número puro de 13 dígitos vira notação científica no Excel. */
export function telefoneLegivel(tel: string): string {
  if (tel.startsWith("55") && tel.length === 13) return `55 ${tel.slice(2, 4)} ${tel.slice(4, 9)}-${tel.slice(9)}`;
  if (tel.startsWith("55") && tel.length === 12) return `55 ${tel.slice(2, 4)} ${tel.slice(4, 8)}-${tel.slice(8)}`;
  return tel;
}

/** Para a API e o MCP: nunca o número inteiro. Brasileiro → `+55 •• •••• 1234`; outro → `+•• •••• 1234`. */
export function mascararTelefone(tel: string | null | undefined): string | null {
  const d = (tel ?? "").replace(/\D/g, "");
  if (d.length < 8) return null;
  const fim = d.slice(-4);
  return d.startsWith("55") ? `+55 •• •••• ${fim}` : `+•• •••• ${fim}`;
}
