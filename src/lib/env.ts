export type VarObrigatoria =
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_ANON_KEY"
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "ZAPBOT_API_URL"
  | "ZAPBOT_EMAIL"
  | "ZAPBOT_PASSWORD"
  | "CRYPTO_KEY"
  | "CRON_SECRET"
  | "NEXT_PUBLIC_SITE_URL";

export function envOpcional(nome: string): string | undefined {
  const v = process.env[nome];
  return v ? v : undefined;
}

export function env(nome: VarObrigatoria): string {
  const v = envOpcional(nome);
  if (!v) throw new Error(`Variável de ambiente ausente: ${nome}`);
  return v;
}
