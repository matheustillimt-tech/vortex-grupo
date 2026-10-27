"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao } from "../_componentes/ui";
import { arquivarIntegracao, carregarPayloadEvento, excluirIntegracao, regerarLinkIntegracao } from "./actions";

/** "Evento" (JSON cru da venda), "webhook" (link pra Visão geral) e "Logs". O Vórtex Grupo não guarda log de servidor por evento ainda: a janela
 *  "Logs" mostra um aviso disso, em vez de inventar um log que não existe. A lista de eventos não carrega mais
 *  `payload` de cada venda (pode ser grande): "Evento" busca o payload daquela venda só quando a janela abre,
 *  via `carregarPayloadEvento` (revisão final B, item m1). Só dados e server action como prop (sem função de
 *  componente), pra não virar client component passando handler pra fora — aqui já é o componente client. */
export function BotoesEvento({ webhookHref, vendaId }: { webhookHref: string; vendaId: string }) {
  const [abertoEvento, setAbertoEvento] = useState(false);
  const [abertoLogs, setAbertoLogs] = useState(false);
  const [payload, setPayload] = useState<unknown>(undefined);
  const [erroPayload, setErroPayload] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  function abrirEvento() {
    setAbertoEvento(true);
    if (payload !== undefined || carregando) return;
    setCarregando(true);
    setErroPayload(null);
    carregarPayloadEvento(vendaId).then(
      (r) => {
        setCarregando(false);
        if (r.erro) setErroPayload(r.erro);
        else setPayload(r.payload);
      },
      () => {
        setCarregando(false);
        setErroPayload("Não foi possível carregar o evento.");
      },
    );
  }

  return (
    <>
      <div className="flex items-center gap-3 text-xs font-medium text-vg-accent">
        <button type="button" onClick={abrirEvento} className="hover:underline">Evento</button>
        <Link href={webhookHref} className="hover:underline">webhook</Link>
        <button type="button" onClick={() => setAbertoLogs(true)} className="hover:underline">Logs</button>
      </div>
      <Janela aberta={abertoEvento} aoFechar={() => setAbertoEvento(false)} titulo="Evento">
        {erroPayload ? (
          <p role="alert" className="text-sm text-vg-erro">{erroPayload}</p>
        ) : carregando ? (
          <p className="text-sm text-vg-muted">Carregando…</p>
        ) : (
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 p-3 text-xs text-vg-text-2">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}
      </Janela>
      <Janela aberta={abertoLogs} aoFechar={() => setAbertoLogs(false)} titulo="Logs de hoje">
        <p className="text-sm text-vg-muted">O Vórtex Grupo ainda não guarda um log de servidor por evento. Esta janela existe pra receber esse log quando ele existir.</p>
      </Janela>
    </>
  );
}

/** Botão `archive` da Visão geral (arquivar tira o link de uso na hora; desarquivar volta a aceitar). */
export function BotaoArquivarIntegracao({ id, nome, arquivada }: { id: string; nome: string; arquivada: boolean }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  function alternar() {
    if (!arquivada && !window.confirm(`Arquivar o webhook "${nome}"? O link dele para de receber vendas até você desarquivar.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await arquivarIntegracao(id, !arquivada);
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível concluir. Tente de novo.");
      }
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={alternar}
        disabled={ocupado}
        aria-label={arquivada ? "Desarquivar webhook" : "Arquivar webhook"}
        title={arquivada ? "Desarquivar" : "Arquivar"}
        className="grid size-9 place-items-center rounded-full text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white disabled:opacity-50"
      >
        <Icone nome={arquivada ? "unarchive" : "archive"} />
      </button>
      <p role="status" className="text-xs text-vg-erro empty:hidden">{erro}</p>
    </div>
  );
}

/** Botão `delete` da Visão geral: exclui de vez (com confirmação) e volta pra lista. As vendas ficam. */
export function BotaoExcluirIntegracao({ id, nome }: { id: string; nome: string }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  function excluir() {
    if (!window.confirm(`Excluir o webhook "${nome}" de vez? O link dele para de receber vendas e não dá pra desfazer. As vendas que já chegaram continuam no Vórtex Grupo.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await excluirIntegracao(id);
        if (r.erro) return setErro(r.erro);
        router.push("/webhooks");
        router.refresh();
      } catch {
        setErro("Não foi possível excluir. Tente de novo.");
      }
    });
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={excluir}
        disabled={ocupado}
        aria-label="Excluir webhook"
        title="Excluir"
        className="grid size-9 place-items-center rounded-full text-vg-text-2 transition-colors hover:bg-white/5 hover:text-vg-erro disabled:opacity-50"
      >
        <Icone nome="delete" />
      </button>
      <p role="status" className="text-xs text-vg-erro empty:hidden">{erro}</p>
    </div>
  );
}

/** "Link" + `file_copy` "COPIAR" e "Regerar link" (com confirmação: o link antigo para de funcionar). Só aparece
 *  pra quem tem webhooks/editar: a página só lê o segredo nesse caso. */
export function LinkIntegracao({ id, link }: { id: string; link: string }) {
  const router = useRouter();
  const [copiado, setCopiado] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();

  async function copiar() {
    try {
      await navigator.clipboard.writeText(link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // sem permissão de clipboard: a pessoa seleciona e copia à mão (o código já tem select-all)
    }
  }

  function regerar() {
    if (!window.confirm("Gerar um link novo? O link antigo para de funcionar na hora: cole o novo no checkout, senão as vendas não chegam.")) return;
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await regerarLinkIntegracao(id);
        if (r.erro) return setMsg({ texto: r.erro, erro: true });
        setMsg({ texto: "Link novo gerado. Cole ele no checkout.", erro: false });
        router.refresh();
      } catch {
        setMsg({ texto: "Não foi possível gerar um novo link. Tente de novo.", erro: true });
      }
    });
  }

  return (
    <div className="space-y-2">
      <p className="text-[13.3px] text-[#e3e9e5]">Link</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 px-3 py-2 text-xs text-vg-text-2">{link}</code>
        <button type="button" className={estiloBotao("contorno")} onClick={copiar}>
          <Icone nome="file_copy" tamanho={18} />
          {copiado ? "COPIADO!" : "COPIAR"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={estiloBotao("secundario")} onClick={regerar} disabled={ocupado}>
          <Icone nome="autorenew" tamanho={18} />
          {ocupado ? "Gerando…" : "Regerar link"}
        </button>
        <p role="status" className={`text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
      </div>
    </div>
  );
}
