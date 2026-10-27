"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { dbNavegador } from "@/src/lib/supabase/navegador";
import { Botao, Campo, estiloInput } from "../(painel)/_componentes/ui";
import { Logo } from "../(painel)/_componentes/logo";
import { BannerLogin } from "./banner";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);
    setErro(null);
    const { error } = await dbNavegador().auth.signInWithPassword({ email, password: senha });
    setCarregando(false);
    if (error) return setErro("E-mail ou senha incorretos.");
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <BannerLogin />
      <div className="flex items-center justify-center bg-[radial-gradient(60%_45%_at_50%_0%,rgba(15,169,104,0.1),transparent)] px-4 py-12">
        <form onSubmit={entrar} className="w-full max-w-sm space-y-6">
          <div className="space-y-5">
            <Logo tamanho={40} className="lg:hidden" />
            <div className="space-y-1">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">Entrar</h1>
              <p className="text-sm text-vg-muted">Use o acesso da equipe Vórtex.</p>
            </div>
          </div>
          <div className="space-y-3">
            <Campo rotulo="E-mail">
              <input className={estiloInput} type="email" placeholder="voce@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Campo>
            <Campo rotulo="Senha">
              <input className={estiloInput} type="password" placeholder="Senha" value={senha} onChange={(e) => setSenha(e.target.value)} required />
            </Campo>
          </div>
          {erro && <p className="text-sm text-vg-erro">{erro}</p>}
          <Botao disabled={carregando} className="w-full">{carregando ? "Entrando…" : "Entrar"}</Botao>
        </form>
      </div>
    </main>
  );
}
