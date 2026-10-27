import "server-only";
import { permitido } from "@/src/lib/permissoes";
import type { AreaOuEquipe } from "@/src/lib/regras/permissoes";
import { SemAcesso } from "./sem-acesso";

/** Guarda por página (não no layout: o layout do App Router não renderiza de novo na navegação entre as páginas
 *  filhas). Chamar no topo da página, antes de qualquer consulta:
 *  `const b = await bloqueio("leads"); if (b) return b;` */
export async function bloqueio(area: AreaOuEquipe): Promise<React.ReactNode | null> {
  if (await permitido(area, "ver")) return null;
  return <SemAcesso />;
}
