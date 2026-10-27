"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { desconectarConexao } from "@/app/(painel)/numeros/actions";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import type { ContaLista } from "@/src/lib/regras/contas";
import { Icone } from "./icone";
import { estiloBotao } from "./ui";

/**
 * Engrenagem do cartão de conta: abre um popover com nome, telefone, última
 * conexão (`leak_add` — ver nota do cabeçalho da conta sobre não haver coluna própria ainda) e os botões
 * "DESCONECTAR" e "CONFIGURAÇÕES" (`chevron_right`, leva ao detalhe). Fecha no clique fora ou Esc, como os
 * outros menus/popovers do painel. `podeEditar` (revisão final, padrão `true`): sem "contas"/"editar" some o
 * "DESCONECTAR" — "CONFIGURAÇÕES" continua (só navega ao detalhe, que já escode as próprias ações de edição).
 * Desde que o cartão inteiro virou link, este componente para a propagação
 * do clique (`onClick` no `<div>` de fora) pra não navegar pelo cartão ao abrir o popover ou clicar nos botões
 * de dentro dele; "CONFIGURAÇÕES" usa `router.push` (não `<Link>`) pra não aninhar `<a>` dentro do `<a>` do cartão.
 */
export function PopoverConta({ conta, href, podeEditar = true }: { conta: Pick<ContaLista, "id" | "nome" | "telefone" | "status" | "created_at">; href: string; podeEditar?: boolean }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    }
    window.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  async function desconectar() {
    if (!confirm("Desconectar este número? Vai precisar ler o QR Code de novo para voltar a enviar.")) return;
    setDesconectando(true);
    setErro(null);
    const r = await desconectarConexao(conta.id);
    setDesconectando(false);
    if (r.erro) {
      setErro(r.erro);
      return;
    }
    setAberto(false);
    router.refresh();
  }

  return (
    <div ref={caixa} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={`Configurar ${conta.nome}`}
        className="text-vg-text-3 transition-colors hover:text-white"
      >
        <Icone nome="settings" tamanho={18} />
      </button>
      {aberto && (
        <div role="dialog" aria-label={`Conexão ${conta.nome}`} className="absolute right-0 top-full z-40 mt-2 w-64 space-y-3 rounded-lg border border-vg-line bg-vg-panel p-4 shadow-lg">
          <div>
            <p className="font-medium">{conta.nome}</p>
            {conta.telefone && <p className="text-xs text-vg-muted">{formatarTelefone(conta.telefone)}</p>}
            {conta.created_at && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-vg-text-3">
                <Icone nome="leak_add" tamanho={14} />
                {dataHoraCompleta(conta.created_at)}
              </p>
            )}
          </div>
          {erro && <p role="alert" className="text-xs text-vg-erro">{erro}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {podeEditar && conta.status === "conectado" && (
              <button type="button" onClick={desconectar} disabled={desconectando} className={estiloBotao("secundario")}>
                {desconectando ? "DESCONECTANDO…" : "DESCONECTAR"}
              </button>
            )}
            <button type="button" onClick={() => router.push(href)} className={`${estiloBotao("principal")} ml-auto`}>
              CONFIGURAÇÕES
              <Icone nome="chevron_right" tamanho={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
