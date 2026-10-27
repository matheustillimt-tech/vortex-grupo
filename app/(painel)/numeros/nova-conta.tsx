"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao } from "../_componentes/ui";
import { Conectar } from "./conectar";

/** Botão "+ Conta" que abre a janela "Nova conta" com o formulário de conectar (nome → QR ou código).
 *  `abrirDeInicio` abre sozinha quando a URL trazia `?nova=1` (link do Início). */
export function NovaConta({ abrirDeInicio = false }: { abrirDeInicio?: boolean }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(abrirDeInicio);

  useEffect(() => {
    if (abrirDeInicio) setAberta(true);
  }, [abrirDeInicio]);

  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={estiloBotao("contorno")}>
        <Icone nome="add" />
        Conexão
      </button>
      <Janela
        aberta={aberta}
        aoFechar={() => {
          setAberta(false);
          router.refresh();
        }}
        titulo="Nova conexão"
      >
        <Conectar />
      </Janela>
    </>
  );
}
