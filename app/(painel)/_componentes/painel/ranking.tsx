import Link from "next/link";
import { Avatar } from "@/app/(painel)/_componentes/avatar";
import { Vazio } from "@/app/(painel)/_componentes/ui";

export type ItemRanking = { chave: string; nome: string; linha2: string; valor: string; tom?: "erro" | "neutro"; href?: string };

function Linha({ posicao, item, semAvatar }: { posicao: number; item: ItemRanking; semAvatar: boolean }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="w-5 shrink-0 text-right text-xs text-vg-muted tabular-nums">{posicao}</span>
      {!semAvatar && <Avatar nome={item.nome} tamanho={32} />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-vg-text">{item.nome}</p>
        <p className="truncate text-xs text-vg-muted">{item.linha2}</p>
      </div>
      {item.tom === "erro" ? (
        <span className="shrink-0 rounded-full bg-[#f26d68]/15 px-2 py-0.5 text-[11px] font-medium text-[#f4aaa8]">{item.valor}</span>
      ) : (
        <span className="shrink-0 text-sm font-medium text-vg-text tabular-nums">{item.valor}</span>
      )}
    </div>
  );
}

/** Lista ordenada (top campanhas, maior churn…): posição, avatar, nome + linha secundária, valor à direita.
 *  `semAvatar` (opcional): tira o avatar de letra (Destaques); padrão `false` = hoje. */
export function Ranking({ itens, vazio, semAvatar = false }: { itens: ItemRanking[]; vazio: string; semAvatar?: boolean }) {
  if (itens.length === 0) return <Vazio texto={vazio} compacto />;
  return (
    <div className="divide-y divide-vg-line">
      {itens.map((item, i) =>
        item.href ? (
          <Link key={item.chave} href={item.href} className="block transition-colors hover:bg-white/[0.03]">
            <Linha posicao={i + 1} item={item} semAvatar={semAvatar} />
          </Link>
        ) : (
          <div key={item.chave}>
            <Linha posicao={i + 1} item={item} semAvatar={semAvatar} />
          </div>
        ),
      )}
    </div>
  );
}
