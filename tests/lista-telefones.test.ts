import { describe, expect, it } from "vitest";
import { lerListaDeTelefones } from "@/src/lib/regras/lista-telefones";

describe("lerListaDeTelefones", () => {
  it("um por linha, com ou sem +55, espaços e traços", () => {
    const r = lerListaDeTelefones("(37) " + "98000-1001\n+55 11 " + "98888-7777\n\n  ");
    expect(r).toEqual({ validos: [{ telefone: "5537" + "980001001", motivo: null }, { telefone: "5511" + "988887777", motivo: null }], invalidos: [] });
  });

  it("CSV: segunda coluna é o motivo (; ou tab), cabeçalho sem número é ignorado, aspas saem", () => {
    const r = lerListaDeTelefones('telefone;motivo\n"5537' + '980001001";"spam de link"\n11' + '988887777\tgolpe\r\n');
    expect(r.validos).toEqual([{ telefone: "5537" + "980001001", motivo: "spam de link" }, { telefone: "5511" + "988887777", motivo: "golpe" }]);
  });

  it("vírgula no motivo não corta a coluna", () => {
    const r = lerListaDeTelefones("5537" + "980001001;golpe, link e áudio\n11" + "988887777\tspam, de novo");
    expect(r.validos).toEqual([
      { telefone: "5537" + "980001001", motivo: "golpe, link e áudio" },
      { telefone: "5511" + "988887777", motivo: "spam, de novo" },
    ]);
  });

  it("célula entre aspas pode ter ; e vírgula (e \"\" vira aspas)", () => {
    const r = lerListaDeTelefones('5537' + '980001001;"golpe; mandou link, pediu pix";extra\n"11' + '988887777";"disse ""oi"""');
    expect(r.validos).toEqual([
      { telefone: "5537" + "980001001", motivo: "golpe; mandou link, pediu pix" },
      { telefone: "5511" + "988887777", motivo: 'disse "oi"' },
    ]);
  });

  it("compatível com telefone,motivo quando a linha não tem ; nem tab e a primeira célula é telefone", () => {
    const r = lerListaDeTelefones('11' + '988887777,golpe\n5537' + '980001001,spam, de novo\n5521' + '977776666,"motivo, com aspas"');
    expect(r.validos).toEqual([
      { telefone: "5511" + "988887777", motivo: "golpe" },
      { telefone: "5537" + "980001001", motivo: "spam, de novo" },
      { telefone: "5521" + "977776666", motivo: "motivo, com aspas" },
    ]);
  });

  it("linha com vírgula cuja primeira célula não é telefone vale inteira (inválida)", () => {
    const r = lerListaDeTelefones("123,456");
    expect(r).toEqual({ validos: [], invalidos: ["123,456"] });
  });

  it("repete o mesmo número (com e sem 9) uma vez só", () => {
    const r = lerListaDeTelefones("5537" + "980001001\n553780001001");
    expect(r.validos.map((v) => v.telefone)).toEqual(["5537" + "980001001"]);
  });

  it("lista os inválidos", () => {
    expect(lerListaDeTelefones("123\n5537" + "980001001").invalidos).toEqual(["123"]);
  });
});
