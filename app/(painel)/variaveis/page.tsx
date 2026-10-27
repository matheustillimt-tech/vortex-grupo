import { redirect } from "next/navigation";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Icone } from "../_componentes/icone";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina } from "../_componentes/ui";
import { BuscaVariaveis, NovaVariavel, TabelaVariaveis, type VariavelGlobal } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;

/** `%`, `_` e `\` contam como curinga no ILIKE: escapa pra buscar o texto como foi digitado (o `_` é comum nas chaves). */
const escaparBusca = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

function url(q: string, pagina: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (pagina > 1) p.set("pagina", String(pagina));
  const s = p.toString();
  return `/variaveis${s ? `?${s}` : ""}`;
}

export default async function Variaveis({ searchParams }: { searchParams: Promise<{ q?: string; pagina?: string }> }) {
  const b = await bloqueio("variaveis");
  if (b) return b;
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const pagina = Math.max(1, Math.floor(Number(sp.pagina)) || 1);
  const inicio = (pagina - 1) * POR_PAGINA;

  const db = await dbUsuario();
  let consulta = db.from("variaveis_globais").select("id, chave, tipo, categoria", { count: "exact" });
  if (q) consulta = consulta.ilike("chave", `%${escaparBusca(q)}%`);
  const [{ data, count, error }, { data: todasCategorias, error: erroCategorias }] = await Promise.all([
    consulta.order("chave").range(inicio, inicio + POR_PAGINA - 1),
    db.from("variaveis_globais").select("categoria").not("categoria", "is", null),
  ]);
  if (error) throw new Error(`Não foi possível carregar as variáveis: ${error.message}`);
  if (erroCategorias) throw new Error(`Não foi possível carregar as categorias: ${erroCategorias.message}`);
  if (!data?.length && pagina > 1) redirect(url(q, 1));
  const total = count ?? 0;
  const variaveis = (data ?? []) as VariavelGlobal[];
  const categorias = [...new Set((todasCategorias ?? []).map((c) => c.categoria as string))];
  const ate = inicio + variaveis.length;

  return (
    <Pagina
      subtitulo={
        // Exemplos em snake_case (a regra da chave aqui).
        'As variáveis permitem padronizar informações que se repetem em várias campanhas. Você define aqui o nome e o tipo; o valor é preenchido dentro de cada campanha antes do envio (ex.: cupom, link_checkout, data_oferta). Assim, você evita editar mensagens uma a uma e mantém tudo coerente (ex.: nome_da_empresa, telefone_suporte, link_site).'
      }
      acoes={
        <div className="flex items-center gap-2">
          <BuscaVariaveis q={q} />
          <NovaVariavel categorias={categorias} />
        </div>
      }
    >
      <TabelaVariaveis variaveis={variaveis} categorias={categorias} />
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={pagina > 1 ? url(q, pagina - 1) : undefined}
        proxima={ate < total ? url(q, pagina + 1) : undefined}
      />
      <p className="flex items-start gap-2 text-sm text-vg-muted">
        <Icone nome="lightbulb" tamanho={18} className="text-vg-accent" />
        <span>
          Dica: use nomes simples, sem espaços e fáceis de reconhecer (ex.: nome_da_empresa). Os valores são definidos na própria campanha, na seção
          &quot;Variáveis&quot;.
        </span>
      </p>
    </Pagina>
  );
}
