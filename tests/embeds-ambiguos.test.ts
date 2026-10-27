import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `campanhas` tem 4 chaves pra `tags` (tag_entrou_adicionar etc.), então embutir `campanhas(...)` a partir de `tags`
 * fica ambíguo no PostgREST (erro PGRST201, tela quebrada). Partindo de `tags`, sempre nomear a chave:
 * `campanhas!tags_campanha_id_fkey(...)`.
 */
const raiz = resolve(__dirname, "..");
function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

/** Problemas de chave estrangeira nova (Etapa 3N) num SQL de migração: `references campanhas|grupos|tags` numa coluna de
 *  `campanhas` (alter table campanhas … ou create table campanhas …): uma segunda chave entre as mesmas duas tabelas
 *  deixa o embed `campanhas(...)` ambíguo, erro PGRST201. */
export function fksProibidas(sql: string): string[] {
  const semComentario = sql.replace(/--[^\n]*/g, "");
  const problemas: string[] = [];
  for (const bruto of semComentario.split(";")) {
    const st = bruto.replace(/\s+/g, " ").trim();
    const alvo = /^(?:alter|create) table (?:if (?:not )?exists )?(?:only )?(?:public\.)?"?(\w+)"?/i.exec(st)?.[1]?.toLowerCase();
    if (!alvo) continue;
    if (alvo === "campanhas") {
      for (const m of st.matchAll(/references (?:public\.)?"?(campanhas|grupos|tags)"?/gi)) problemas.push(`campanhas → ${m[1].toLowerCase()}: ${st.slice(0, 120)}`);
    }
  }
  return problemas;
}

describe("embeds ambíguos", () => {
  it("tags → campanhas sempre com a chave nomeada", () => {
    const problemas: string[] = [];
    for (const f of [...arquivos(join(raiz, "app")), ...arquivos(join(raiz, "src"))]) {
      const t = readFileSync(f, "utf8");
      for (const m of t.matchAll(/from\("tags"\)\.select\("([^"]*)"\)|tags\(([^)]*\([^)]*\)[^)]*)\)/g)) {
        const sel = m[1] ?? m[2] ?? "";
        if (/\bcampanhas\(/.test(sel)) problemas.push(`${f.slice(raiz.length + 1)}: ${sel}`);
      }
    }
    expect(problemas).toEqual([]);
  });
});

describe("FKs novas que deixariam embeds ambíguos (Etapa 3N)", () => {
  const pasta = join(raiz, "supabase/migrations");
  const novas = readdirSync(pasta).filter((f) => f.endsWith(".sql") && f >= "20261017240000").sort();

  it("nenhuma migração a partir de 20261017240000 cria FK de campanhas pra campanhas/grupos/tags", () => {
    expect(novas.length).toBeGreaterThan(0);
    const tudo = novas.map((f) => readFileSync(join(pasta, f), "utf8")).join(";\n");
    expect(fksProibidas(tudo)).toEqual([]);
  });

  it("a regra pega os casos proibidos (e deixa passar os permitidos)", () => {
    expect(fksProibidas("alter table campanhas add column outra_campanha_id uuid references campanhas (id);")).toHaveLength(1);
    expect(fksProibidas("ALTER TABLE public.campanhas ADD COLUMN g uuid REFERENCES grupos(id);")).toHaveLength(1);
    expect(fksProibidas("alter table campanhas\n  add column t uuid\n  references tags (id) on delete set null;")).toHaveLength(1);
    expect(fksProibidas("alter table campanhas add column grupo_fixo_id uuid; -- sem FK: references grupos não\n")).toEqual([]);
    expect(fksProibidas("alter table grupos add column x uuid references campanhas (id);")).toEqual([]);
  });
});
