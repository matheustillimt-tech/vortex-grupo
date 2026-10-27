"use client";
import { useRouter } from "next/navigation";
import { MenuCartao } from "../../../_componentes/menu-cartao";

/** Menu `more_vert` de cada linha da tabela de Leadscoring: "Ver lead" (`/leads/{telefone}`)
 *  e "Copiar número". Recebe só o telefone (dado, não função) — a navegação e o clipboard são feitos aqui, que
 *  já é "use client". */
export function MenuLinha({ telefone }: { telefone: string }) {
  const router = useRouter();
  return (
    <MenuCartao
      itens={[
        { rotulo: "Ver lead", icone: "person", onClick: () => router.push(`/leads/${telefone}`) },
        { rotulo: "Copiar número", icone: "content_copy", onClick: () => { void navigator.clipboard?.writeText(telefone); } },
      ]}
    />
  );
}
