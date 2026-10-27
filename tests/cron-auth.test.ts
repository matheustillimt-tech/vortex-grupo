import { describe, expect, it } from "vitest";
import { autorizado } from "@/src/lib/jobs/tipos";

describe("autorizado", () => {
  it("aceita só Bearer com o segredo exato", () => {
    expect(autorizado("Bearer s3", "s3")).toBe(true);
    expect(autorizado("Bearer s4", "s3")).toBe(false);
    expect(autorizado(null, "s3")).toBe(false);
    expect(autorizado("s3", "s3")).toBe(false);
  });
});
