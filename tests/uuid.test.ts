import { describe, expect, it } from "vitest";
import { ehUuid, UUID } from "@/src/lib/regras/uuid";

describe("UUID / ehUuid", () => {
  it("aceita um uuid válido (maiúsculo ou minúsculo)", () => {
    expect(UUID.test("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(ehUuid("11111111-2222-3333-4444-555555555555")).toBe(true);
    expect(ehUuid("11111111-2222-3333-4444-555555555555".toUpperCase())).toBe(true);
  });

  it("recusa não-uuid, vazio, undefined e não-string", () => {
    expect(ehUuid("não-é-um-uuid")).toBe(false);
    expect(ehUuid("")).toBe(false);
    expect(ehUuid(undefined)).toBe(false);
    expect(ehUuid(null)).toBe(false);
    expect(ehUuid(123)).toBe(false);
  });
});
