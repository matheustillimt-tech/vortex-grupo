"use client";
import { useState } from "react";
import { Avatar, COR_BOLINHA } from "./avatar";

/** Avatar com a foto real do grupo (Etapa 3M). Sem `foto` (ou foto que não é `https://`) = exatamente o `Avatar` de
 *  letra. Com foto: imagem redonda no mesmo tamanho e com a mesma bolinha; se a imagem falhar (a URL do WhatsApp
 *  expira — a conferência regrava), volta pra letra e só tenta de novo quando `foto` mudar. `<img>` simples (sem o
 *  `next/image`, que exigiria liberar o domínio do WhatsApp) e sem mandar o Referer pro CDN. */
export function AvatarFoto({ nome, foto, ativo = false, cor, tamanho = 40 }: { nome: string; foto?: string | null; ativo?: boolean; cor?: "ok" | "erro" | "neutro"; tamanho?: number }) {
  const [falhou, setFalhou] = useState<string | null>(null);
  const valida = typeof foto === "string" && foto.startsWith("https://") ? foto : null;
  if (!valida || falhou === valida) return <Avatar nome={nome} ativo={ativo} cor={cor} tamanho={tamanho} />;
  const bolinha = cor ?? (ativo ? "ok" : null);
  return (
    <span className="relative inline-block shrink-0 rounded-full bg-vg-pilula" style={{ width: tamanho, height: tamanho }} aria-hidden>
      <img
        src={valida}
        alt=""
        width={tamanho}
        height={tamanho}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFalhou(valida)}
        className="size-full rounded-full object-cover"
      />
      {bolinha && <span className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-vg-bg ${COR_BOLINHA[bolinha]}`} />}
    </span>
  );
}
