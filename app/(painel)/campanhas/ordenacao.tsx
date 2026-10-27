"use client";
import type { OrdemCampanha } from "@/src/lib/regras/campanhas";
import { UUID } from "@/src/lib/regras/uuid";

const ROTULO_ORDEM: Record<OrdemCampanha, string> = { criacao: "Data de criação", atualizacao: "Data de atualização", posicao: "Posição" };

/** Select com rótulo flutuante por cima (como o `CampoBusca`), sem rótulo à esquerda.
 *  Um `<select>` sempre tem valor, então o rótulo fica sempre no topo (sem o truque de
 *  `placeholder-shown` do `CampoBusca`, que só serve para `<input>` vazio). */
function CampoSelect({ rotulo, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { rotulo: string }) {
  return (
    <div className="relative">
      <select
        {...props}
        aria-label={rotulo}
        className="w-full min-w-40 rounded border border-vg-line-2 bg-transparent px-3 pb-2 pt-5 text-[13.3px] text-vg-text outline-none transition hover:border-white/60 focus:border-vg-accent focus:ring-1 focus:ring-vg-accent"
      >
        {children}
      </select>
      <span className="pointer-events-none absolute left-3 top-1.5 text-[11px] text-vg-text-2">{rotulo}</span>
    </div>
  );
}

/** Select "Ordenação" que envia o `<form>` ao redor assim que o valor muda (sem botão "Aplicar"). */
export function EnviarAoMudar({ ordem }: { ordem: OrdemCampanha }) {
  return (
    <CampoSelect rotulo="Ordenação" name="ordem" defaultValue={ordem} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      {(Object.keys(ROTULO_ORDEM) as OrdemCampanha[]).map((o) => <option key={o} value={o}>{ROTULO_ORDEM[o]}</option>)}
    </CampoSelect>
  );
}

/** Select "Projeto" (Todos, Sem projeto, cada projeto ativo) que envia o `<form>` ao redor assim que o valor
 *  muda — idêntico ao de Ordenação. `atual` é o valor cru de `?projeto=` (vazio, "sem" ou um uuid). Quando `atual`
 *  é um uuid que não está em `projetos` (projeto arquivado), entra como opção extra pra não sumir do select —
 *  com o nome de verdade quando a página já carregou (`nomeArquivado`), senão "Projeto arquivado". */
export function SeletorProjeto({
  atual,
  projetos,
  nomeArquivado,
}: {
  atual: string;
  projetos: { id: string; nome: string }[];
  nomeArquivado?: string;
}) {
  const arquivadoFiltrado = UUID.test(atual) && !projetos.some((p) => p.id === atual) ? atual : null;
  return (
    <CampoSelect rotulo="Projeto" name="projeto" defaultValue={atual} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
      <option value="">Todos</option>
      <option value="sem">Sem projeto</option>
      {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      {arquivadoFiltrado && <option value={arquivadoFiltrado}>{nomeArquivado ?? "Projeto arquivado"}</option>}
    </CampoSelect>
  );
}
