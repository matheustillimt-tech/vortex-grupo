"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icone } from "../_componentes/icone";
import { MenuCartao, type ItemMenuCartao } from "../_componentes/menu-cartao";
import { estiloBotao } from "../_componentes/ui";

/** 5ª coluna da tabela de Leads: `more_vert` com "Ver lead" e "Copiar número". Sem prop de função —
 *  recebe só o telefone (dado) e navega/copia por conta própria, como os outros menus de linha do painel. */
export function MenuLinhaLead({ telefone }: { telefone: string }) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);

  const itens: ItemMenuCartao[] = [
    { rotulo: "Ver lead", icone: "visibility", onClick: () => router.push(`/leads/${encodeURIComponent(telefone)}`) },
    {
      rotulo: copiado ? "Copiado!" : "Copiar número",
      icone: "content_copy",
      onClick: async () => {
        try {
          await navigator.clipboard.writeText(telefone);
          setCopiado(true);
          setTimeout(() => setCopiado(false), 2000);
        } catch {
          // sem permissão de clipboard: nada a fazer aqui (o número já aparece na linha, pra copiar à mão).
        }
      },
    },
  ];

  return <MenuCartao itens={itens} rotulo={`Mais ações: ${telefone}`} />;
}

/** `file_copy`: copia os números da página atual, um por linha. Recebe a lista já pronta (dado), não
 *  função: continua podendo vir de um componente de servidor. */
export function BotaoCopiarNumeros({ telefones }: { telefones: string[] }) {
  const [copiado, setCopiado] = useState(false);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(telefones.join("\n"));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão de clipboard: nada a fazer aqui.
    }
  }

  return (
    <button type="button" className={estiloBotao("secundario")} onClick={copiar} disabled={!telefones.length}>
      <Icone nome="file_copy" tamanho={18} />
      {copiado ? "Copiado!" : "Copiar números"}
    </button>
  );
}
