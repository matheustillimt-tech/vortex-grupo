"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Papel } from "@/src/lib/regras/permissoes";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloCartaoDestaque, estiloInput } from "../_componentes/ui";
import { criarAcesso } from "./actions";

/** Mostrada uma vez só, logo depois de criar o acesso: a senha não aparece de novo. */
function JanelaSenha({ email, senha, aviso, aoFechar }: { email: string; senha: string; aviso?: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Acesso criado">
      <div className="space-y-4">
        <p className={`${estiloCartaoDestaque} p-3 text-sm`}>
          Acesso criado para <strong>{email}</strong>. Guarde a senha agora: ela não aparece de novo.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 px-3 py-2 text-sm text-vg-text-2">{senha}</code>
          <button
            type="button"
            className={estiloBotao("secundario")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(senha);
                setCopiado(true);
              } catch {
                // sem permissão de clipboard: a pessoa seleciona e copia à mão (o código já tem select-all)
              }
            }}
          >
            {copiado ? "Copiado!" : "Copiar"}
          </button>
        </div>
        {aviso && <p className="text-sm text-vg-erro">{aviso}</p>}
        <div className="flex justify-end">
          <button type="button" className={estiloBotao()} onClick={aoFechar}>FECHAR</button>
        </div>
      </div>
    </Janela>
  );
}

function JanelaAdicionar({ aoFechar }: { aoFechar: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [nome, setNome] = useState("");
  const [papel, setPapel] = useState<Papel>("membro");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [criado, setCriado] = useState<{ email: string; senha: string; aviso?: string } | null>(null);

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await criarAcesso(email, nome, papel);
        if (r.erro || !r.senha) return setErro(r.erro ?? "Não foi possível criar o acesso.");
        setCriado({ email: email.trim().toLowerCase(), senha: r.senha, aviso: r.aviso });
      } catch {
        setErro("Não foi possível criar o acesso. Tente de novo.");
      }
    });
  }

  if (criado) {
    return (
      <JanelaSenha
        email={criado.email}
        senha={criado.senha}
        aviso={criado.aviso}
        aoFechar={() => {
          aoFechar();
          router.refresh();
        }}
      />
    );
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Adicionar pessoa">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">E-mail</span>
          <input className={estiloInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@exemplo.com" autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome</span>
          <input className={estiloInput} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Nome da pessoa" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-[13.3px] text-[#e3e9e5]">Papel</legend>
          <label className="flex items-center gap-2 text-sm text-vg-text">
            <input type="radio" name="papel" checked={papel === "membro"} onChange={() => setPapel("membro")} />
            Membro
          </label>
          <label className="flex items-center gap-2 text-sm text-vg-text">
            <input type="radio" name="papel" checked={papel === "admin"} onChange={() => setPapel("admin")} />
            Administrador
          </label>
        </fieldset>
        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>CANCELAR</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !email.trim() || !nome.trim()}>
            {ocupado ? "Criando…" : "CRIAR ACESSO"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function BotaoAdicionar() {
  const [aberta, setAberta] = useState(false);
  const [vez, setVez] = useState(0);
  return (
    <>
      <button
        type="button"
        className={estiloBotao()}
        onClick={() => {
          setVez((v) => v + 1);
          setAberta(true);
        }}
      >
        <Icone nome="add" />
        ADICIONAR
      </button>
      {aberta && <JanelaAdicionar key={vez} aoFechar={() => setAberta(false)} />}
    </>
  );
}
