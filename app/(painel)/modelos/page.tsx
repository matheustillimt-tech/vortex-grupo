import { redirect } from "next/navigation";
import { filtrarModelos, pastasDe, type ModeloLista } from "@/src/lib/regras/modelos";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import type { Valor } from "../_componentes/conteudo-editor";
import { Paginacao } from "../_componentes/paginacao";
import { Pagina } from "../_componentes/ui";
import { lerFiltrosModelos, urlModelos } from "./filtros";
import { BotaoNovaPasta, BotaoNovoModelo, FaixaPastas, FiltrosModelos, ListaArquivados, ListaModelos, ProvedorModelos, type ModeloCartao } from "./lista";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;
/** Teto de modelos ativos lidos de uma vez (busca, pastas e ordenação são feitas aqui, em memória). */
const MAXIMO_ATIVOS = 1000;
const MAXIMO_ARQUIVADOS = 100;
const COLUNAS = "id, nome, tipo, conteudo, pasta, arquivado, created_at, updated_at";

const paraCartao = (m: ModeloLista): ModeloCartao => ({ id: m.id, nome: m.nome, tipo: m.tipo, conteudo: m.conteudo as Valor, pasta: m.pasta });

export default async function Modelos({ searchParams }: { searchParams: Promise<{ q?: string; pasta?: string; ordem?: string; pagina?: string }> }) {
  const b = await bloqueio("modelos");
  if (b) return b;
  const filtros = lerFiltrosModelos(await searchParams);
  const db = await dbUsuario();
  const [ativos, arquivados] = await Promise.all([
    db.from("modelos").select(COLUNAS).eq("arquivado", false).order("updated_at", { ascending: false }).limit(MAXIMO_ATIVOS),
    db.from("modelos").select(COLUNAS).eq("arquivado", true).order("updated_at", { ascending: false }).limit(MAXIMO_ARQUIVADOS + 1),
  ]);
  const erro = ativos.error ?? arquivados.error;
  if (erro) throw new Error(`Não foi possível carregar os modelos: ${erro.message}`);

  const listaAtivos = (ativos.data ?? []) as ModeloLista[];
  const listaArquivados = ((arquivados.data ?? []) as ModeloLista[]).slice(0, MAXIMO_ARQUIVADOS);
  const maisArquivados = (arquivados.data ?? []).length > MAXIMO_ARQUIVADOS;

  const pastas = pastasDe(listaAtivos);
  const filtrados = filtrarModelos(listaAtivos, { busca: filtros.q, pasta: filtros.pasta, ordem: filtros.ordem, arquivados: false });
  const total = filtrados.length;
  const inicio = (filtros.pagina - 1) * POR_PAGINA;
  const daPagina = filtrados.slice(inicio, inicio + POR_PAGINA);
  // Página além do fim (a lista encolheu): volta pra primeira.
  if (!daPagina.length && filtros.pagina > 1) redirect(urlModelos(filtros, { pagina: 1 }));
  const arquivadosMostrados = filtrarModelos(listaArquivados, { busca: filtros.q, pasta: null, ordem: filtros.ordem, arquivados: true });

  const de = total ? inicio + 1 : 0;
  const ate = inicio + daPagina.length;

  return (
    <ProvedorModelos ids={daPagina.map((m) => m.id)} pastasBanco={pastas.map((p) => p.nome)}>
      <Pagina
        acoes={
          <>
            <BotaoNovaPasta />
            <BotaoNovoModelo pastaAtual={filtros.pasta} />
          </>
        }
      >
        <FiltrosModelos filtros={filtros} />
        <FaixaPastas pastas={pastas} filtros={filtros} />
        <Paginacao
          de={de}
          ate={ate}
          total={total}
          porPagina={POR_PAGINA}
          anterior={filtros.pagina > 1 ? urlModelos(filtros, { pagina: filtros.pagina - 1 }) : undefined}
          proxima={ate < total ? urlModelos(filtros, { pagina: filtros.pagina + 1 }) : undefined}
        />
        <ListaModelos modelos={daPagina.map(paraCartao)} />
        {listaAtivos.length >= MAXIMO_ATIVOS && (
          <p className="px-1 text-xs text-vg-text-3">Mostrando os {MAXIMO_ATIVOS} modelos atualizados mais recentemente.</p>
        )}

        <section aria-labelledby="titulo-arquivado" className="space-y-3 border-t border-vg-line pt-5">
          <h2 id="titulo-arquivado" className="flex items-center gap-2 text-[17px] font-medium">
            Arquivado
            <span className="text-sm font-normal text-vg-text-3">({arquivadosMostrados.length})</span>
          </h2>
          {maisArquivados && <p className="px-1 text-xs text-vg-text-3">Mostrando os {MAXIMO_ARQUIVADOS} mais recentes.</p>}
          <ListaArquivados modelos={arquivadosMostrados.map(paraCartao)} />
        </section>
      </Pagina>
    </ProvedorModelos>
  );
}
