import Link from "next/link";
import { chaveOrdemInicio } from "@/src/lib/regras/inicio";
import { ROTULO_PLATAFORMA } from "@/src/lib/regras/integracoes";
import type { CampanhaLista, Resumo } from "@/src/lib/regras/campanhas";
import type { ContaLista } from "@/src/lib/regras/contas";
import { CartaoCampanha } from "./cartao-campanha";
import { CartaoConta } from "./cartao-conta";
import { ColunaBusca, type ItemColunaBusca } from "./coluna-busca";
import { Icone } from "./icone";
import { TarjaConexoes, type ConexaoCaida } from "./tarja-conexoes";
import { estiloCartao, Vazio } from "./ui";

export type ContaInicio = Pick<ContaLista, "id" | "nome" | "telefone" | "status" | "ultimo_erro" | "pausado_ate" | "papel">;
export type CampanhaInicio = Pick<CampanhaLista, "id" | "nome" | "descricao" | "arquivada" | "foto" | "nomeGrupo"> & { resumo: Resumo };
/** Webhook de checkout (entrada) na coluna "Webhooks": nome e plataforma (Etapa 3H). */
export type WebhookInicio = { id: string; nome: string; plataforma: string };

/** Blocos que a pessoa vê (Etapa 2K): cada um depende de "ver" na área. Ausente = todos (vitrine). */
export type BlocosInicio = { contas: boolean; campanhas: boolean; webhooks: boolean; metricas: boolean; equipe: boolean };

const TODOS_BLOCOS: BlocosInicio = { contas: true, campanhas: true, webhooks: true, metricas: true, equipe: true };

/** `null` em qualquer lista = a consulta daquele bloco falhou (coluna mostra erro só nela). */
export type DadosInicio = {
  email: string;
  contas: ContaInicio[] | null;
  campanhas: CampanhaInicio[] | null;
  webhooks: WebhookInicio[] | null;
  blocos?: BlocosInicio;
  /** "Desconectar" no popover do cartão de conta (revisão final) só aparece com "contas"/"editar".
   *  Padrão `true` pra não quebrar a vitrine (`app/dev/vitrine`), que não passa permissão nenhuma. */
  podeEditarContas?: boolean;
  /** Números fora do ar, pra tarja vermelha em cima dos cartões; ausente (vitrine) = sem tarja. */
  caidas?: ConexaoCaida[];
};

function TituloColuna({ titulo, total, hrefLista, hrefAdicionar }: { titulo: string; total: React.ReactNode; hrefLista: string; hrefAdicionar: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <h2 className="text-[17px] font-medium">
        <Link href={hrefLista} className="transition-colors hover:text-white">
          {titulo}
        </Link>{" "}
        <span className="text-vg-muted">{total}</span>
      </h2>
      <Link href={hrefAdicionar} aria-label={`Adicionar em ${titulo}`} className="text-vg-accent transition-opacity hover:opacity-80">
        <Icone nome="add_circle_outline" tamanho={22} />
      </Link>
    </div>
  );
}

/** Tela inicial ("Visão geral"). Só apresentação: a página carrega os dados (e a vitrine passa dados de mentira). */
export function PainelInicio({ email, contas, campanhas, webhooks, blocos = TODOS_BLOCOS, podeEditarContas = true, caidas }: DadosInicio) {
  const colunas = [blocos.contas, blocos.campanhas, blocos.webhooks].filter(Boolean).length;
  const itensContas: ItemColunaBusca[] = (contas ?? []).map((c) => ({
    chave: c.id,
    busca: `${c.nome} ${c.telefone ?? ""}`,
    conteudo: <CartaoConta conta={{ ...c, created_at: "" }} href={`/numeros/${c.id}`} podeEditar={podeEditarContas} />,
  }));

  const itensCampanhas: ItemColunaBusca[] = (campanhas ?? []).map((c) => ({
    chave: c.id,
    busca: `${c.nome} ${c.descricao}`,
    conteudo: <CartaoCampanha campanha={c} resumo={c.resumo} />,
  }));

  const itensWebhooks: ItemColunaBusca[] = (webhooks ?? []).map((w) => {
    const plataforma = ROTULO_PLATAFORMA[w.plataforma as keyof typeof ROTULO_PLATAFORMA] ?? w.plataforma;
    return {
      chave: w.id,
      busca: `${w.nome} ${plataforma}`,
      conteudo: (
        <Link href={`/webhooks/${w.id}`} className={`${estiloCartao} flex items-center gap-3 p-3 transition-colors hover:border-vg-line-2`}>
          <span className="relative grid size-9 shrink-0 place-items-center rounded-full bg-white/5">
            <Icone nome="webhook" tamanho={20} className="text-vg-accent" />
            <span aria-hidden className="absolute bottom-0 right-0 size-2 rounded-full bg-vg-ok ring-2 ring-vg-bg" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{w.nome}</p>
            <p className="truncate text-xs text-vg-muted">{plataforma}</p>
          </div>
          <Icone nome="arrow_forward" tamanho={18} className="shrink-0 text-vg-text-3" />
        </Link>
      ),
    };
  });

  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 md:px-6">
      {caidas && <TarjaConexoes inicial={caidas} />}
      {/* Contas / Campanhas / Webhooks */}
      {colunas > 0 && (
        <div className={`grid gap-4 ${colunas === 3 ? "lg:grid-cols-3" : colunas === 2 ? "lg:grid-cols-2" : ""}`}>
          {blocos.contas && (
            <div className={`${estiloCartao} min-h-[480px] space-y-3 p-4`}>
              <TituloColuna titulo="Conexões" total={contas === null ? "—/—" : `${contas.length}/${contas.length}`} hrefLista="/numeros" hrefAdicionar="/numeros?nova=1" />
              {contas === null ? (
                <Vazio compacto texto="Não foi possível carregar as conexões." />
              ) : (
                <ColunaBusca itens={itensContas} rotulo="Buscar conexões" vazio={<Vazio compacto texto="Nenhum registro encontrado" />} chaveOrdem={chaveOrdemInicio("inicio-ordem-contas", email)} />
              )}
            </div>
          )}

          {blocos.campanhas && (
            <div className={`${estiloCartao} min-h-[480px] space-y-3 p-4`}>
              <TituloColuna
                titulo="Campanhas"
                total={
                  campanhas === null ? (
                    <>
                      —/<Icone nome="all_inclusive" tamanho={18} className="inline align-text-bottom" />
                    </>
                  ) : (
                    <>
                      {campanhas.length} / <Icone nome="all_inclusive" tamanho={18} className="inline align-text-bottom" />
                    </>
                  )
                }
                hrefLista="/campanhas"
                hrefAdicionar="/campanhas/nova"
              />
              {campanhas === null ? (
                <Vazio compacto texto="Não foi possível carregar as campanhas." />
              ) : (
                <ColunaBusca itens={itensCampanhas} rotulo="Buscar campanhas" vazio={<Vazio compacto texto="Nenhum registro encontrado" />} chaveOrdem={chaveOrdemInicio("inicio-ordem-campanhas", email)} />
              )}
            </div>
          )}

          {blocos.webhooks && (
            <div className={`${estiloCartao} min-h-[480px] space-y-3 p-4`}>
              <TituloColuna titulo="Webhooks" total={webhooks === null ? "—" : String(webhooks.length)} hrefLista="/webhooks" hrefAdicionar="/webhooks" />
              {webhooks === null ? (
                <Vazio compacto texto="Não foi possível carregar os webhooks." />
              ) : (
                <ColunaBusca itens={itensWebhooks} rotulo="Buscar webhooks" vazio={<Vazio compacto texto="Nenhum registro encontrado" />} chaveOrdem={chaveOrdemInicio("inicio-ordem-webhooks", email)} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
