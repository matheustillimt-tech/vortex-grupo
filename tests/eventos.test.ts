import { describe, expect, it } from "vitest";
import { proximaTentativaMs } from "@/src/lib/jobs/eventos";

describe("proximaTentativaMs", () => {
  it("1, 5, 15, 60 e 240 minutos; depois desiste", () => {
    expect([1, 2, 3, 4, 5].map(proximaTentativaMs)).toEqual([60_000, 300_000, 900_000, 3_600_000, 14_400_000]);
    expect(proximaTentativaMs(6)).toBeNull();
  });
});
