import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import { redirect } from "next/navigation";
import { env } from "../env";

export async function dbUsuario() {
  const jar = await cookies();
  return createServerClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          // chamado de Server Component: o middleware renova a sessão
        }
      },
    },
  });
}

/** Uma ida ao Auth por renderização (`cache`): layout, página e guarda reaproveitam o mesmo usuário. */
export const exigirUsuario = cache(async () => {
  const db = await dbUsuario();
  const { data } = await db.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
});
