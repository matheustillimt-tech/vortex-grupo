import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// `/api/v1/` e `/api/mcp`: públicas no middleware; a própria rota confere a chave de API (`autenticarApi`).
const PUBLICAS = ["/login", "/l/", "/d/", "/api/cron/", "/api/webhooks/", "/api/v1/", "/api/mcp"];

export function rotaPublica(pathname: string): boolean {
  // Prefixo com "/" no fim casa tudo abaixo; sem "/" (ex.: "/api/mcp") casa só ele mesmo e o que vem depois de "/".
  return PUBLICAS.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

/** Vitrine de componentes (/dev/…): abre sem login só no `next dev`. Em produção cai no login (e a página dá 404). */
export function rotaDeDesenvolvimento(pathname: string, ambiente: string | undefined = process.env.NODE_ENV): boolean {
  return ambiente === "development" && (pathname === "/dev" || pathname.startsWith("/dev/"));
}

export async function middleware(req: NextRequest) {
  if (rotaPublica(req.nextUrl.pathname) || rotaDeDesenvolvimento(req.nextUrl.pathname)) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const db = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        lista.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await db.auth.getUser();
  if (!data.user) {
    if (req.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "não autenticado" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return res;
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"] };
