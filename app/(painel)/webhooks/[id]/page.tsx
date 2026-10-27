import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Provedor } from "@/src/lib/checkout/parsers";
import { env } from "@/src/lib/env";
import { permitido } from "@/src/lib/permissoes";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import {
  corteFalhaSemProcessar,
  corteFila,
  detalheDaVenda,
  duracaoProcessamento,
  lerAbaDetalhe,
  lerFiltrosEventos,
  limitesDatas,
  linkIntegracao,
  regrasImportantes,
  RESULTADO_FALHA,
  ROTULO_PLATAFORMA,
  ROTULO_STATUS_EVENTOS,
  STATUS_EVENTOS,
  statusDaVenda,
  urlEventos,
  type AbaDetalhe,
  type FiltrosEventos,
  type StatusEventos,
} from "@/src/lib/regras/integracoes";
import { ehUuid } from "@/src/lib/regras/uuid";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { lerFiltrosAutomacoes, urlAutomacoes } from "@/app/(painel)/automacoes/abas";
import { carregarAutomacoes, carregarCampanhasParaImportar } from "@/app/(painel)/automacoes/comum";
import { BotaoImportarJson, FiltrosAutomacoes, ListaAutomacoes, SelecaoAutomacoes } from "@/app/(painel)/automacoes/lista";
import { Abas } from "../../_componentes/abas";
import { CampoBusca } from "../../_componentes/campo-busca";
import { DataEnviar } from "../../_componentes/campos-auto-enviar";
import { Icone } from "../../_componentes/icone";
import { Paginacao } from "../../_componentes/paginacao";
import { DefinirTrilha } from "../../_componentes/trilha";
import { BotaoLink, estiloBotao, estiloCartao, estiloCartaoDestaque, estiloInput, Pagina, Selo, Vazio, type CorSelo } from "../../_componentes/ui";
import { BotaoArquivarIntegracao, BotaoExcluirIntegracao, BotoesEvento, LinkIntegracao } from "../detalhe";

export const dynamic = "force-dynamic";

const POR_PAGINA = 12;

type Integracao = { id: string; created_at: string; nome: string; plataforma: Provedor; arquivada: boolean };
type DB = Awaited<ReturnType<typeof dbUsuario>>;

/** Detalhe do webhook de checkout: abas Visão geral, Automações e Eventos (por `?aba=`). */
export default async function WebhookDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const { id } = await params;
  if (!ehUuid(id)) notFound();
  const sp = await searchParams;
  const aba = lerAbaDetalhe(sp.aba);
  const db = await dbUsuario();
  const { data, error } = await db.from("integracoes_checkout").select("id, created_at, nome, plataforma, arquivada").eq("id", id).maybeSingle();
  if (error) throw new Error(`Não foi possível carregar o webhook: ${error.message}`);
  if (!data) notFound();
  const integracao = data as Integracao;
  const plataforma = ROTULO_PLATAFORMA[integracao.plataforma] ?? integracao.plataforma;

  const abas: { chave: AbaDetalhe; rotulo: string; href: string }[] = [
    { chave: "visao", rotulo: "Visão geral", href: `/webhooks/${id}` },
    { chave: "contas", rotulo: "Conexões associadas", href: `/webhooks/${id}?aba=contas` },
    { chave: "automacoes", rotulo: "Automações", href: `/webhooks/${id}?aba=automacoes` },
    { chave: "eventos", rotulo: "Eventos", href: `/webhooks/${id}?aba=eventos` },
  ];

  let conteudo: React.ReactNode;
  if (aba === "contas") conteudo = await AbaContasAssociadas({ db, plataforma: integracao.plataforma, busca: (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "" });
  else if (aba === "automacoes") conteudo = await AbaAutomacoes({ id, db, plataforma: integracao.plataforma, searchParams: sp });
  else if (aba === "eventos") conteudo = await AbaEventos({ db, id, filtros: lerFiltrosEventos(sp) });
  else conteudo = await AbaVisaoGeral({ integracao, plataforma });

  return (
    <Pagina titulo={integracao.nome} sobretitulo="Webhook" subtitulo={integracao.arquivada ? `${plataforma} · arquivado` : plataforma}>
      <DefinirTrilha itens={[{ rotulo: "Webhooks", href: "/webhooks" }, { rotulo: integracao.nome }]} />
      <Abas itens={abas.map((a) => ({ href: a.href, rotulo: a.rotulo, ativo: a.chave === aba }))} />
      {conteudo}
    </Pagina>
  );
}

// ---------- Visão geral ----------

async function AbaVisaoGeral({ integracao, plataforma }: { integracao: Integracao; plataforma: string }) {
  // O segredo (que forma o link) só sai do banco pra quem pode editar webhooks, e só pelo service role:
  // `authenticated` não lê a coluna.
  const podeEditar = await permitido("webhooks", "editar");
  let link: string | null = null;
  if (podeEditar) {
    const { data, error } = await dbAdmin().from("integracoes_checkout").select("segredo").eq("id", integracao.id).maybeSingle();
    if (error) throw new Error(`Não foi possível carregar o link do webhook: ${error.message}`);
    if (data) link = linkIntegracao(env("NEXT_PUBLIC_SITE_URL"), integracao.plataforma, (data as { segredo: string }).segredo);
  }
  return (
    <div className="space-y-4">
      <section className={`${estiloCartao} space-y-4 p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Icone nome="webhook" tamanho={28} className="shrink-0 text-vg-accent" />
            <div className="min-w-0">
              <p className="truncate text-[15px] font-semibold">{integracao.nome}</p>
              <p className="truncate text-sm text-vg-muted">{plataforma}</p>
            </div>
          </div>
          {podeEditar && (
            <div className="flex items-start gap-1">
              <BotaoArquivarIntegracao id={integracao.id} nome={integracao.nome} arquivada={integracao.arquivada} />
              <BotaoExcluirIntegracao id={integracao.id} nome={integracao.nome} />
            </div>
          )}
        </div>
        {integracao.arquivada && (
          <p className={`${estiloCartaoDestaque} p-3 text-sm`}>Arquivado: o link não recebe vendas até você desarquivar.</p>
        )}
        {link ? (
          <LinkIntegracao id={integracao.id} link={link} />
        ) : (
          <p className="text-sm text-vg-muted">Só quem pode editar webhooks vê o link.</p>
        )}
      </section>
      <section className={`${estiloCartaoDestaque} space-y-2 p-4`}>
        <h2 className="flex items-center gap-2 text-[15px] font-semibold">
          <Icone nome="info" tamanho={20} />
          Importante
        </h2>
        <ol className="list-decimal space-y-1.5 pl-5 text-sm">
          {regrasImportantes(integracao.plataforma).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </section>
    </div>
  );
}

// ---------- Contas associadas ----------

type ContaLinha = { id: string; nome: string; telefone: string | null; status: string };

async function AbaContasAssociadas({ db, plataforma, busca }: { db: DB; plataforma: Provedor; busca: string }) {
  const { data: automacoes, error: erroAutomacoes } = await db
    .from("automacoes")
    .select("campanha_id")
    .eq("gatilho", "checkout")
    .or(`provedor.eq.${plataforma},provedor.is.null`);
  if (erroAutomacoes) throw new Error(`Não foi possível carregar as automações: ${erroAutomacoes.message}`);
  const idsCampanha = [...new Set((automacoes ?? []).map((a) => a.campanha_id as string | null).filter((v): v is string => !!v))];

  const idsConta = new Set<string>();
  if (idsCampanha.length) {
    const [{ data: campanhas, error: erroCampanhas }, { data: associadas, error: erroAssociadas }] = await Promise.all([
      db.from("campanhas").select("conexao_criadora_id").in("id", idsCampanha),
      db.from("campanha_conexoes").select("conexao_id").in("campanha_id", idsCampanha),
    ]);
    if (erroCampanhas) throw new Error(`Não foi possível carregar as campanhas: ${erroCampanhas.message}`);
    if (erroAssociadas) throw new Error(`Não foi possível carregar as conexões associadas: ${erroAssociadas.message}`);
    for (const c of campanhas ?? []) if (c.conexao_criadora_id) idsConta.add(c.conexao_criadora_id as string);
    for (const a of associadas ?? []) idsConta.add(a.conexao_id as string);
  }

  let contas: ContaLinha[] = [];
  if (idsConta.size) {
    const { data, error } = await db.from("conexoes").select("id, nome, telefone, status").in("id", [...idsConta]).order("nome");
    if (error) throw new Error(`Não foi possível carregar as conexões: ${error.message}`);
    contas = (data ?? []) as ContaLinha[];
  }

  const termo = busca.trim().toLowerCase();
  const filtradas = termo ? contas.filter((c) => c.nome.toLowerCase().includes(termo) || (c.telefone ?? "").toLowerCase().includes(termo)) : contas;

  return (
    <div className="space-y-4">
      <p className="text-sm text-vg-muted">Conexões usadas pelas automações deste webhook.</p>
      <form method="get" className="w-full max-w-xs" role="search">
        <input type="hidden" name="aba" value="contas" />
        <CampoBusca nome="q" valorInicial={busca} rotulo="Buscar conexões associadas pelo nome ou telefone" />
      </form>
      <p className="text-sm text-vg-text-2">
        {filtradas.length}/{contas.length} conexão
      </p>
      {filtradas.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhuma conexão associada encontrada." />
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtradas.map((c) => (
            <div key={c.id} className={`${estiloCartao} space-y-2 p-4`}>
              <p className="truncate font-medium">{c.nome}</p>
              <p className="truncate text-sm text-vg-text-2">{c.telefone ? formatarTelefone(c.telefone) : "—"}</p>
              <Selo cor={c.status === "conectado" ? "ok" : "neutro"}>{c.status}</Selo>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- Automações ----------

async function AbaAutomacoes({
  id,
  db,
  plataforma,
  searchParams,
}: {
  id: string;
  db: DB;
  plataforma: Provedor;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const base = `/webhooks/${id}?aba=automacoes`;
  const filtros = lerFiltrosAutomacoes(searchParams as { q?: string; gatilho?: string; provedor?: string; pasta?: string; estado?: string; pagina?: string });
  const { automacoes, pastas, total } = await carregarAutomacoes(db, { filtros, plataformaWebhook: plataforma });
  const podeEditarAutomacoes = await permitido("automacoes", "editar");
  const campanhasImportar = podeEditarAutomacoes ? await carregarCampanhasParaImportar(db) : [];

  const porPagina = 12;
  const inicio = (filtros.pagina - 1) * porPagina;
  const de = total ? inicio + 1 : 0;
  const ate = inicio + automacoes.length;

  return (
    <SelecaoAutomacoes ids={automacoes.map((a) => a.id)}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {podeEditarAutomacoes && (
            <div className="flex items-center gap-2">
              <BotaoLink href="/automacoes/nova" icone={<Icone nome="add" />}>ADICIONAR</BotaoLink>
              <BotaoImportarJson campanhas={campanhasImportar} />
            </div>
          )}
          <FiltrosAutomacoes filtros={filtros} pastas={pastas} base={base} />
        </div>
        {automacoes.length === 0 ? (
          <div className="rounded-xl border border-vg-line">
            <Vazio texto="Nenhuma automação de checkout." acao={<Link href="/automacoes/nova" className={estiloBotao("contorno")}>CRIAR AUTOMAÇÃO</Link>} />
          </div>
        ) : (
          <>
            <Paginacao
              de={de}
              ate={ate}
              total={total}
              porPagina={porPagina}
              anterior={filtros.pagina > 1 ? urlAutomacoes(base, filtros, { pagina: filtros.pagina - 1 }) : undefined}
              proxima={ate < total ? urlAutomacoes(base, filtros, { pagina: filtros.pagina + 1 }) : undefined}
            />
            <ListaAutomacoes automacoes={automacoes} />
          </>
        )}
      </div>
    </SelecaoAutomacoes>
  );
}

// ---------- Eventos ----------

type VendaLinha = {
  id: string;
  created_at: string;
  evento_id: string;
  aprovada: boolean;
  telefone: string | null;
  produtos: string[];
  processada_em: string | null;
  resultado: string | null;
};

const COR_STATUS: Record<Exclude<StatusEventos, "todos">, CorSelo> = { fila: "neutro", processando: "aviso", sucesso: "ok", falhas: "erro" };

async function AbaEventos({ db, id, filtros }: { db: DB; id: string; filtros: FiltrosEventos }) {
  const agora = new Date();
  const inicio = (filtros.pagina - 1) * POR_PAGINA;
  const { desde, antes } = limitesDatas(filtros.de, filtros.ate);
  let consulta = db
    .from("vendas")
    .select("id, created_at, evento_id, aprovada, telefone, produtos, processada_em, resultado", { count: "exact" })
    .eq("integracao_id", id);
  if (desde) consulta = consulta.gte("created_at", desde);
  if (antes) consulta = consulta.lt("created_at", antes);
  // Mesmas regras de `statusDaVenda` (testadas), em filtros do banco.
  if (filtros.status === "fila") consulta = consulta.is("processada_em", null).gte("created_at", corteFila(agora));
  else if (filtros.status === "processando") consulta = consulta.is("processada_em", null).lt("created_at", corteFila(agora)).gte("created_at", corteFalhaSemProcessar(agora));
  else if (filtros.status === "sucesso") consulta = consulta.not("processada_em", "is", null).or(`resultado.is.null,resultado.neq."${RESULTADO_FALHA}"`);
  else if (filtros.status === "falhas")
    consulta = consulta.or(`and(processada_em.not.is.null,resultado.eq."${RESULTADO_FALHA}"),and(processada_em.is.null,created_at.lt.${corteFalhaSemProcessar(agora)})`);
  const { data, count, error } = await consulta.order("created_at", { ascending: false }).range(inicio, inicio + POR_PAGINA - 1);
  if (error) throw new Error(`Não foi possível carregar os eventos: ${error.message}`);
  const itens = (data ?? []) as VendaLinha[];
  const total = count ?? 0;
  if (!itens.length && filtros.pagina > 1) redirect(urlEventos(id, filtros, { pagina: 1 }));
  const ate = inicio + itens.length;

  return (
    <div className="space-y-4">
      <nav aria-label="Situação dos eventos" className="flex flex-wrap gap-2">
        {STATUS_EVENTOS.map((s) => (
          <Link
            key={s}
            href={urlEventos(id, filtros, { status: s })}
            aria-current={filtros.status === s ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${filtros.status === s ? "border-vg-accent/60 bg-vg-accent/10 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:border-white/60"}`}
          >
            {ROTULO_STATUS_EVENTOS[s]}
          </Link>
        ))}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="aba" value="eventos" />
        {filtros.status !== "todos" && <input type="hidden" name="status" value={filtros.status} />}
        <label className="space-y-1">
          <span className="block text-xs text-vg-text-3">Inicio do intervalo</span>
          <DataEnviar name="de" defaultValue={filtros.de} ariaLabel="Inicio do intervalo" className={`${estiloInput} w-auto`} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-vg-text-3">Fim do intervalo</span>
          <DataEnviar name="ate" defaultValue={filtros.ate} ariaLabel="Fim do intervalo" className={`${estiloInput} w-auto`} />
        </label>
        {(filtros.de || filtros.ate) && (
          <Link href={urlEventos(id, filtros, { de: "", ate: "" })} className="text-sm text-vg-muted hover:text-vg-text">Limpar datas</Link>
        )}
      </form>
      {itens.length === 0 ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum evento recebido." />
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {itens.map((v) => {
            const status = statusDaVenda(v, agora);
            const duracao = duracaoProcessamento(v.created_at, v.processada_em);
            return (
              <li key={v.id} className={`${estiloCartao} space-y-2 p-4`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="flex items-center gap-2 text-sm font-medium tabular-nums">
                    <Icone nome="phone" tamanho={18} className="text-vg-text-3" />
                    {v.telefone ? formatarTelefone(v.telefone) : "Sem telefone"}
                  </p>
                  <Selo cor={COR_STATUS[status]}>{ROTULO_STATUS_EVENTOS[status]}</Selo>
                </div>
                <p className="flex items-center gap-2 text-sm text-vg-text-2">
                  <Icone nome="paid" tamanho={18} className="text-vg-text-3" />
                  {v.aprovada ? "Pago" : "Não aprovado"}
                </p>
                <p className="flex min-w-0 items-center gap-2 text-sm text-vg-text-2">
                  <Icone nome="label" tamanho={18} className="shrink-0 text-vg-text-3" />
                  <span className="truncate" title={v.evento_id}>{v.evento_id}</span>
                </p>
                <p className="flex min-w-0 items-center gap-2 text-sm text-vg-text-2">
                  <Icone nome="shopping_cart" tamanho={18} className="shrink-0 text-vg-text-3" />
                  <span className="truncate">{v.produtos?.length ? v.produtos.join(" · ") : "—"}</span>
                </p>
                {detalheDaVenda(v, status) && <p className="text-xs text-vg-muted">{detalheDaVenda(v, status)}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular-nums text-vg-text-3">
                  <span className="flex items-center gap-1" title="Recebido"><Icone nome="note_add" tamanho={14} />{dataHoraCompleta(v.created_at)}</span>
                  <span className="flex items-center gap-1" title="Processando"><Icone nome="play_arrow" tamanho={14} />{v.processada_em ? "—" : "Em andamento"}</span>
                  <span className="flex items-center gap-1" title="Processado"><Icone nome="sports_score" tamanho={14} />{v.processada_em ? dataHoraCompleta(v.processada_em) : "—"}</span>
                  <span className="flex items-center gap-1" title="Duração"><Icone nome="timelapse" tamanho={14} />{duracao ?? "—"}</span>
                </div>
                <BotoesEvento webhookHref={`/webhooks/${id}`} vendaId={v.id} />
              </li>
            );
          })}
        </ul>
      )}
      <Paginacao
        de={total ? inicio + 1 : 0}
        ate={ate}
        total={total}
        porPagina={POR_PAGINA}
        anterior={filtros.pagina > 1 ? urlEventos(id, filtros, { pagina: filtros.pagina - 1 }) : undefined}
        proxima={ate < total ? urlEventos(id, filtros, { pagina: filtros.pagina + 1 }) : undefined}
      />
    </div>
  );
}
