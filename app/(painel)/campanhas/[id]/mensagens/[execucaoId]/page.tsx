import { notFound } from "next/navigation";
import { situacaoDaExecucao } from "@/src/lib/regras/calendario";
import { ROTULO_TIPO, resumoConteudo, type TipoExecucao } from "@/src/lib/regras/conteudo";
import { textoEntrega, type PlacarEntrega } from "@/src/lib/regras/entregas";
import { isoParaBrasilia } from "@/src/lib/regras/horario";
import { resumoDasExecucoes } from "@/src/lib/resumo-execucoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { PROVA } from "@/src/lib/zapbot/prova";
import { reexecutarFalhas } from "../../../../_acoes/execucoes";
import { ROTULO_ORIGEM, SeloSituacao } from "../../../../_componentes/situacao";
import { Icone } from "../../../../_componentes/icone";
import { Botao, Cartao, Numero, Pagina, Selo, Tabela } from "../../../../_componentes/ui";
import { ResultadoEnquete } from "./enquete";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";

export const dynamic = "force-dynamic";

export default async function DetalheExecucao({ params }: { params: Promise<{ id: string; execucaoId: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const podeEditar = await permitido("campanhas", "editar");
  const { id, execucaoId } = await params;
  const db = await dbUsuario();
  const { data: e, error: erroExec } = await db.from("execucoes").select("id, tipo, origem, status, motivo, agendada_para, conteudo, conteudo_final").eq("id", execucaoId).eq("campanha_id", id).maybeSingle();
  if (erroExec) throw new Error(`Não foi possível carregar a execução: ${erroExec.message}`);
  if (!e) notFound();
  const tipo = e.tipo as TipoExecucao;
  const resumo = (await resumoDasExecucoes(db, [e.id])).get(e.id);
  const s = situacaoDaExecucao(e.status, resumo);
  const { data: tarefas, error: erroTarefas } = await db.from("tarefas").select("id, status, erro, enviado_em, grupos(nome, numero)").eq("execucao_id", e.id).order("enviar_apos").limit(500);
  if (erroTarefas) throw new Error(`Não foi possível carregar os grupos desta execução: ${erroTarefas.message}`);
  // Seção "Confirmação de entrega" ligada: linha "Entrega confirmada: N/M grupos" (erro na leitura = sem a linha).
  let entrega: string | null = null;
  if (tipo === "mensagem" || tipo === "enquete") {
    const { data: camp } = await db.from("campanhas").select("confirmar_entrega").eq("id", id).maybeSingle();
    if ((camp as { confirmar_entrega?: boolean } | null)?.confirmar_entrega) {
      const { data: placar, error: erroPlacar } = await db.rpc("entregas_das_execucoes", { p_ids: [e.id] });
      if (!erroPlacar) entrega = textoEntrega(((placar ?? []) as PlacarEntrega[])[0]);
    }
  }
  return (
    <Pagina titulo={ROTULO_TIPO[tipo]} trilha={[{ rotulo: "Mensagens", href: `/campanhas/${id}/mensagens` }]}>
      <Cartao>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm tabular-nums text-vg-muted">{isoParaBrasilia(e.agendada_para)} · {ROTULO_ORIGEM[e.origem]}</p>
          <SeloSituacao situacao={s.situacao} detalhe={s.detalhe} />
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{resumoConteudo(tipo, e.conteudo_final ?? e.conteudo)}</p>
        {e.motivo && <p className="mt-2 text-sm text-vg-erro">{e.motivo}</p>}
      </Cartao>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Numero rotulo="Grupos" valor={resumo?.total ?? 0} />
        <Numero rotulo="Enviado" valor={`${resumo?.feitas ?? 0}/${resumo?.total ?? 0}`} />
        <Numero rotulo="Com erro" valor={resumo?.erros ?? 0} tom={(resumo?.erros ?? 0) > 0 ? "erro" : "neutro"} />
        <Numero rotulo="Na fila" valor={resumo?.pendentes ?? 0} />
      </div>
      {(tipo === "mensagem" || tipo === "enquete") && (resumo?.feitas ?? 0) > 0 && (
        <p className="text-sm text-vg-muted">
          {PROVA.recibosEmGrupo
            ? `Enviado em ${resumo!.feitas}/${resumo!.total} grupos · entregue em ${resumo!.entregues} pessoa(s) · lido por ${resumo!.lidos} (aproximado: o WhatsApp pode repetir um aviso)`
            : `Enviado em ${resumo!.feitas}/${resumo!.total} grupos (confirmado pelo Zapbot). Entrega e leitura em grupo não ficam disponíveis${PROVA.recibosMotivo ? `: ${PROVA.recibosMotivo}` : "."}`}
        </p>
      )}
      {entrega && (
        <p className="flex items-center gap-2 text-sm text-vg-muted">
          <Icone nome="mark_chat_read" tamanho={16} />
          <span className="tabular-nums">{entrega}</span>
        </p>
      )}
      {tipo === "enquete" && (
        <ResultadoEnquete db={db} execucaoId={e.id} opcoes={((e.conteudo_final ?? e.conteudo) as { opcoes?: string[] }).opcoes ?? []} />
      )}
      {podeEditar && (resumo?.erros ?? 0) > 0 && e.status !== "enviando" && (
        <form action={reexecutarFalhas.bind(null, e.id, id)}><Botao variante="secundario">Reenviar falhas</Botao></form>
      )}
      <Tabela colunas={["Grupo", "Situação", "Quando", "Erro"]} vazio={tarefas?.length ? undefined : "Nenhum grupo nesta execução."}>
        {(tarefas ?? []).map((t) => {
          const g = t.grupos as unknown as { nome: string; numero: number } | null;
          return (
            <tr key={t.id}>
              <td className="px-3 py-2.5">{g ? `#${g.numero} ${g.nome}` : "—"}</td>
              <td className="px-3 py-2.5"><Selo cor={t.status === "enviado" ? "ok" : t.status === "erro" ? "erro" : "aviso"}>{t.status}</Selo></td>
              <td className="px-3 py-2.5 text-xs tabular-nums text-vg-muted">{t.enviado_em ? isoParaBrasilia(t.enviado_em) : ""}</td>
              <td className="px-3 py-2.5 text-xs text-vg-erro">{t.erro}</td>
            </tr>
          );
        })}
      </Tabela>
    </Pagina>
  );
}
