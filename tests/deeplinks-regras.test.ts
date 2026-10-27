import { describe, expect, it } from "vitest";
import {
  filtrarDeeplinks,
  pastasDeDeeplinks,
  sugerirSlugDeeplink,
  validarDeeplink,
  validarPastaDeeplink,
  validarSlugDeeplink,
  type DeeplinkLista,
} from "@/src/lib/regras/deeplinks";
import { slugDaUrl } from "@/app/(painel)/deeplinks/filtros";

describe("validarDeeplink", () => {
  it("nome e destino (https, até 500) são obrigatórios", () => {
    expect(validarDeeplink({ nome: "", destino: "https://x" })).toEqual({ ok: false, erro: "Dê um nome de até 60 caracteres." });
    expect(validarDeeplink({ nome: "a".repeat(61), destino: "https://x" }).ok).toBe(false);
    expect(validarDeeplink({ nome: "Bio", destino: "http://x" })).toEqual({ ok: false, erro: "O link precisa começar com https://" });
    expect(validarDeeplink({ nome: "Bio", destino: `https://x/${"a".repeat(500)}` }).ok).toBe(false);
  });

  it("trima nome e destino", () => {
    const r = validarDeeplink({ nome: "  Bio do Instagram  ", destino: "  https://chat.whatsapp.com/ABC  " });
    expect(r).toEqual({ ok: true, valor: { nome: "Bio do Instagram", destino: "https://chat.whatsapp.com/ABC" } });
  });
});

describe("validarSlugDeeplink", () => {
  it("aceita [a-z0-9-]{3,40}, minúsculo", () => {
    expect(validarSlugDeeplink("Bio-2")).toEqual({ ok: true, slug: "bio-2" });
    expect(validarSlugDeeplink("ab").ok).toBe(false); // menor que 3
    expect(validarSlugDeeplink("a".repeat(41)).ok).toBe(false); // maior que 40
    expect(validarSlugDeeplink("bio incrível").ok).toBe(false); // espaço e acento
  });

  it("recusa as palavras reservadas (api, admin, l, d)", () => {
    // "api" e "admin" têm 3+ letras: passam pela regex e caem na checagem de reserva.
    for (const r of ["api", "admin"]) {
      expect(validarSlugDeeplink(r)).toEqual({ ok: false, erro: "Esse endereço é reservado; escolha outro." });
    }
    // "l" e "d" nem chegam lá: já são curtos demais pra regex (mínimo 3) — reservados por tabela, não por nome.
    expect(validarSlugDeeplink("l").ok).toBe(false);
    expect(validarSlugDeeplink("d").ok).toBe(false);
    expect(validarSlugDeeplink("lxx").ok).toBe(true); // perto de "l" mas não é a palavra reservada
  });
});

describe("sugerirSlugDeeplink", () => {
  it("usa a regra de baseSlug, com o mínimo de 3 (em vez de 2)", () => {
    expect(sugerirSlugDeeplink("Bio do Instagram")).toBe("bio-do-instagram");
    expect(sugerirSlugDeeplink("!!!")).toBe("xxx"); // baseSlug devolve "xx" (mínimo 2); aqui o mínimo é 3
    expect(sugerirSlugDeeplink("ia")).toBe("iax"); // baseSlug devolve "ia" (2); completa até 3
  });
});

describe("validarPastaDeeplink", () => {
  it("1 a 40 caracteres depois do trim", () => {
    expect(validarPastaDeeplink("  ")).toEqual({ ok: false, erro: "Nome da pasta com 1 a 40 caracteres." });
    expect(validarPastaDeeplink("a".repeat(41)).ok).toBe(false);
    expect(validarPastaDeeplink("  Bio  ")).toEqual({ ok: true, nome: "Bio" });
  });
});

const LISTA: DeeplinkLista[] = [
  { id: "1", created_at: "2026-10-01T00:00:00Z", nome: "Bio do Instagram", destino: "https://a", slug: "bio", pasta: "Redes", cliques: 10 },
  { id: "2", created_at: "2026-10-02T00:00:00Z", nome: "Link da bio TikTok", destino: "https://b", slug: "tiktok", pasta: "Redes", cliques: 3 },
  { id: "3", created_at: "2026-10-03T00:00:00Z", nome: "Grupo VIP", destino: "https://c", slug: "vip", pasta: null, cliques: 0 },
];

describe("pastasDeDeeplinks", () => {
  it("conexão por pasta (ignora quem não tem pasta), ordem alfabética pt-BR", () => {
    expect(pastasDeDeeplinks(LISTA)).toEqual([{ nome: "Redes", total: 2 }]);
  });
});

describe("filtrarDeeplinks", () => {
  it("busca pelo nome sem acento/case, filtra pasta e ordena por created_at", () => {
    expect(filtrarDeeplinks(LISTA, { busca: "", pasta: null, ordem: "recentes" }).map((d) => d.id)).toEqual(["3", "2", "1"]);
    expect(filtrarDeeplinks(LISTA, { busca: "", pasta: null, ordem: "antigos" }).map((d) => d.id)).toEqual(["1", "2", "3"]);
    expect(filtrarDeeplinks(LISTA, { busca: "", pasta: "Redes", ordem: "recentes" }).map((d) => d.id)).toEqual(["2", "1"]);
    expect(filtrarDeeplinks(LISTA, { busca: "bio", pasta: null, ordem: "recentes" }).map((d) => d.id)).toEqual(["2", "1"]);
    expect(filtrarDeeplinks(LISTA, { busca: "vip", pasta: null, ordem: "recentes" }).map((d) => d.id)).toEqual(["3"]);
  });

  it("também casa com o slug inteiro, mesmo quando o slug não aparece no nome (botão 'Pesquisar deeplink por url')", () => {
    const comSlugDiferente: DeeplinkLista[] = [
      ...LISTA,
      { id: "4", created_at: "2026-10-04T00:00:00Z", nome: "Oferta especial", destino: "https://d", slug: "promo99", pasta: null, cliques: 0 },
    ];
    expect(filtrarDeeplinks(comSlugDiferente, { busca: "promo99", pasta: null, ordem: "recentes" }).map((d) => d.id)).toEqual(["4"]);
    // Slug é inteiro, não trecho: "promo" não casa com "promo99".
    expect(filtrarDeeplinks(comSlugDiferente, { busca: "promo", pasta: null, ordem: "recentes" })).toEqual([]);
  });
});

describe("slugDaUrl", () => {
  it("extrai o slug de /d/{slug}, com ou sem protocolo/host, barra ou segmentos depois", () => {
    expect(slugDaUrl("https://seu-dominio.com.br/d/bio-2")).toBe("bio-2");
    expect(slugDaUrl("seu-dominio.com.br/d/bio-2/")).toBe("bio-2");
    expect(slugDaUrl("/d/bio-2?utm=x")).toBe("bio-2");
    expect(slugDaUrl("Bio-2")).toBe("bio-2"); // slug puro, sem URL
  });

  it("devolve null quando não reconhece um slug válido", () => {
    expect(slugDaUrl("")).toBeNull();
    expect(slugDaUrl("https://outro-site.com/pagina")).toBeNull();
    expect(slugDaUrl("/d/api")).toBeNull(); // reservado
    expect(slugDaUrl("/d/ab")).toBeNull(); // menor que 3
  });
});
