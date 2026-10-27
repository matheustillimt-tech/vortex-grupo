import { chaveTelefone, normalizarTelefone } from "../telefone";

export type ItemLista = { telefone: string; motivo: string | null };

/** Separa a linha nas células, respeitando aspas duplas: dentro de `"..."` o separador não corta e `""` vira `"`.
 *  As células voltam sem as aspas e sem espaços nas pontas. */
function celulas(linha: string, separador: (c: string) => boolean): string[] {
  const out: string[] = [];
  let atual = "";
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const c = linha[i];
    if (entreAspas) {
      if (c === '"' && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else if (c === '"') entreAspas = false;
      else atual += c;
    } else if (c === '"') entreAspas = true;
    else if (separador(c)) {
      out.push(atual.trim());
      atual = "";
    } else atual += c;
  }
  out.push(atual.trim());
  return out;
}

const PONTO_E_VIRGULA_OU_TAB = (c: string) => c === ";" || c === "\t";

/** Células de uma linha de CSV com o mesmo leitor do CSV de bloqueados: separador `;` ou tab (o que o Excel
 *  brasileiro exporta); linha sem nenhum dos dois é separada por vírgula. Aspas duplas respeitadas. */
export function celulasDaLinha(linha: string): string[] {
  const porPontoEVirgula = celulas(linha, PONTO_E_VIRGULA_OU_TAB);
  if (porPontoEVirgula.length > 1) return porPontoEVirgula;
  return celulas(linha, (c) => c === ",");
}

/** Telefone e motivo da linha. Separador é `;` ou tab (o que o Excel brasileiro exporta). Compatibilidade com
 *  "telefone,motivo": linha sem `;`/tab cuja primeira célula antes da vírgula é um telefone válido — o resto da linha
 *  (com as vírgulas) é o motivo. Fora isso a vírgula é texto (ex.: dentro do motivo). */
function lerLinha(linha: string): [string, string] {
  const porPontoEVirgula = celulas(linha, PONTO_E_VIRGULA_OU_TAB);
  if (porPontoEVirgula.length > 1) return [porPontoEVirgula[0], porPontoEVirgula[1]];
  const [primeira, ...resto] = celulas(linha, (c) => c === ",");
  if (resto.length && normalizarTelefone(primeira)) {
    // Motivo = o resto da linha, com as vírgulas: relê a partir da primeira vírgula fora de aspas.
    return [primeira, celulas(linhaDepoisDaPrimeiraVirgula(linha), () => false)[0]];
  }
  return [porPontoEVirgula[0], ""];
}

function linhaDepoisDaPrimeiraVirgula(linha: string): string {
  let entreAspas = false;
  for (let i = 0; i < linha.length; i++) {
    if (linha[i] === '"') entreAspas = !entreAspas;
    else if (linha[i] === "," && !entreAspas) return linha.slice(i + 1);
  }
  return "";
}

/** Texto colado (um por linha) ou CSV (telefone; motivo opcional, separado por `;` ou tab, células entre aspas
 *  podem ter `;` e `,`). Linha cuja primeira coluna não tem número (cabeçalho, linha vazia) é ignorada; o mesmo
 *  número com e sem o 9 entra uma vez só. */
export function lerListaDeTelefones(texto: string): { validos: ItemLista[]; invalidos: string[] } {
  const validos: ItemLista[] = [];
  const invalidos: string[] = [];
  const vistos = new Set<string>();
  for (const linha of texto.split(/\r?\n/)) {
    const [bruto, motivo] = lerLinha(linha);
    if (!/\d/.test(bruto)) continue;
    const telefone = normalizarTelefone(bruto);
    if (!telefone) {
      invalidos.push(bruto);
      continue;
    }
    const chave = chaveTelefone(telefone);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    validos.push({ telefone, motivo: motivo || null });
  }
  return { validos, invalidos };
}
