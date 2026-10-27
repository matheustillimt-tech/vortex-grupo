"use client";
import Link from "next/link";
import { useEffect } from "react";
import { Icone } from "./_componentes/icone";
import { Botao, Pagina, Vazio, estiloBotao } from "./_componentes/ui";

/** Erro inesperado numa tela do painel (inclusive uma ação de formulário que lançou, como "sem permissão"):
 *  em vez da tela de erro do Next, mostra o aviso no estilo do painel, com "Tentar de novo" e link pro Início. */
export default function ErroPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Pagina titulo="Algo deu errado.">
      <Vazio
        icone={<Icone nome="error_outline" tamanho={16} />}
        texto="Algo deu errado. Tente de novo; se continuar, volte pro Início."
        acao={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Botao type="button" onClick={() => reset()}>
              Tentar de novo
            </Botao>
            <Link href="/" className={estiloBotao("contorno")}>
              Início
            </Link>
          </div>
        }
      />
    </Pagina>
  );
}
