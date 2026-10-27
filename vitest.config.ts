import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Imagem do grupo só vale no bucket `midias` deste Supabase (`prefixoMidias`): os testes usam este host.
    env: { NEXT_PUBLIC_SUPABASE_URL: "https://exemplo.supabase.co" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
});
