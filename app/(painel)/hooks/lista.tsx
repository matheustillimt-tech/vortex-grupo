"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import { ROTULO_EVENTO, textoEventos, type Evento } from "@/src/lib/regras/webhooks";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { MenuCartao, type ItemMenuCartao } from "../_componentes/menu-cartao";
import { urlWebhooks, type BaseHooks, type EntregaLinha, type FiltrosWebhooks, type WebhookLinha } from "./comum";
import { alternarWebhook, arquivarWebhook, enviarTeste, excluirWebhook, regerarSegredo } from "./actions";
import { estiloBotao, estiloCartaoDestaque, estiloInput, Selo, Vazio, type CorSelo } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";

// ---------- Busca + ordenação ----------

export function FiltrosWebhooksBarra({ filtros, base }: { filtros: FiltrosWebhooks; base: BaseHooks }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosWebhooks>) => router.push(urlWebhooks(base, filtros, mudar), { scroll: false });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form
        className="w-full max-w-xs"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar webhooks pelo nome ou URL" />
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Ordenação</span>
        <select value={filtros.ordem} onChange={(e) => ir({ ordem: e.target.value === "antigos" ? "antigos" : "recentes" })} className={`${estiloInput} w-auto`}>
          <option value="recentes">Mais novos</option>
          <option value="antigos">Mais antigos</option>
        </select>
      </label>
    </div>
  );
}

// ---------- Segredo de assinatura (mostrado uma vez só, em "Gerar novo segredo de assinatura") ----------

function JanelaSegredo({ segredo, aoFechar }: { segredo: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Segredo de assinatura">
      <div className="space-y-4">
        <p className={`${estiloCartaoDestaque} p-3 text-sm`}>Guarde agora: ele não aparece de novo.</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 px-3 py-2 text-xs text-vg-text-2">{segredo}</code>
          <button
            type="button"
            className={estiloBotao("secundario")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(segredo);
                setCopiado(true);
              } catch {
                // sem permissão de clipboard: a pessoa seleciona e copia à mão (o código já tem select-all)
              }
            }}
          >
            {copiado ? "Copiado!" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-vg-muted">
          Cada envio leva o cabeçalho <code className="text-vg-text-2">X-Vortex-Grupo-Assinatura: sha256=&lt;HMAC do corpo com o segredo&gt;</code>, pra você conferir que veio do Vórtex Grupo.
        </p>
        <div className="flex justify-end">
          <button type="button" className={estiloBotao()} onClick={aoFechar}>FECHAR</button>
        </div>
      </div>
    </Janela>
  );
}

// ---------- Status das entregas ----------

const ROTULO_STATUS: Record<string, string> = { ok: "Entregue", fila: "Na fila", processando: "Na fila", erro: "Erro" };
const COR_STATUS: Record<string, CorSelo> = { ok: "ok", fila: "neutro", processando: "neutro", erro: "erro" };

// ---------- Popover "info": URL sem segredo, eventos, última entrega ----------

function PopoverInfoWebhook({ webhook, entregas }: { webhook: WebhookLinha; entregas: EntregaLinha[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const ultima = entregas[0];

  useEffect(() => {
    if (!aberto) return;
    function aoClicarFora(e: MouseEvent) {
      if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false);
    }
    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setAberto(false);
        botao.current?.focus();
      }
    }
    window.addEventListener("mousedown", aoClicarFora);
    window.addEventListener("keydown", aoTeclar);
    return () => {
      window.removeEventListener("mousedown", aoClicarFora);
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [aberto]);

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={aberto}
        aria-label={`Detalhes do webhook ${webhook.nome}`}
        className="text-vg-text-3 transition-colors hover:text-white"
      >
        <Icone nome="info" tamanho={18} />
      </button>
      {aberto && (
        <div role="dialog" aria-label={`Webhook ${webhook.nome}`} className="absolute right-0 top-full z-40 mt-2 w-72 space-y-3 rounded-lg border border-vg-line bg-vg-panel p-4 shadow-lg">
          <div>
            <p className="text-xs font-medium text-vg-text-3">URL</p>
            <p className="break-all text-xs text-vg-text-2">{webhook.url}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-vg-text-3">Eventos</p>
            <p className="text-xs text-vg-text-2">{webhook.eventos.map((ev) => ROTULO_EVENTO[ev as Evento] ?? ev).join(", ")}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-vg-text-3">Última entrega</p>
            {ultima ? (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <Selo cor={COR_STATUS[ultima.status] ?? "neutro"}>{ROTULO_STATUS[ultima.status] ?? ultima.status}</Selo>
                <span className="tabular-nums text-vg-text-3">{dataHoraCompleta(ultima.created_at)}</span>
              </p>
            ) : (
              <p className="text-xs text-vg-muted">Nenhuma entrega ainda.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Cartão de cada webhook ----------

function CartaoWebhook({ webhook, entregas }: { webhook: WebhookLinha; entregas: EntregaLinha[] }) {
  const router = useRouter();
  const [segredoNovo, setSegredoNovo] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();

  function rodar(fn: () => Promise<{ erro?: string; mensagem?: string }>) {
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await fn();
        if (r.erro) return setMsg({ texto: r.erro, erro: true });
        if (r.mensagem) setMsg({ texto: r.mensagem, erro: false });
        router.refresh();
      } catch {
        setMsg({ texto: "Não foi possível concluir. Tente de novo.", erro: true });
      }
    });
  }

  function excluir() {
    if (!window.confirm(`Excluir o webhook "${webhook.nome}"? Não dá pra desfazer; as entregas já registradas continuam no histórico.`)) return;
    rodar(() => excluirWebhook(webhook.id));
  }

  function gerarSegredo() {
    if (!window.confirm("Gerar um novo segredo de assinatura? O sistema que confere X-Vortex-Grupo-Assinatura precisa trocar pelo novo.")) return;
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await regerarSegredo(webhook.id);
        if (r.erro) return setMsg({ texto: r.erro, erro: true });
        if (r.segredo) setSegredoNovo(r.segredo);
      } catch {
        setMsg({ texto: "Não foi possível gerar um novo segredo. Tente de novo.", erro: true });
      }
    });
  }

  const itensMenu: ItemMenuCartao[] = [
    // Editar abre o assistente (token, "Gerar novo" e o passo de teste ficam lá).
    { rotulo: "Editar", icone: "edit", onClick: () => router.push(`/hooks/${webhook.id}/editar`) },
    { rotulo: "Enviar teste", icone: "send", onClick: () => rodar(() => enviarTeste(webhook.id)) },
    { rotulo: "Gerar novo segredo de assinatura", icone: "key", onClick: gerarSegredo },
    {
      rotulo: webhook.arquivado ? "Desarquivar" : "Arquivar",
      icone: webhook.arquivado ? "unarchive" : "archive",
      onClick: () => rodar(() => arquivarWebhook(webhook.id, !webhook.arquivado)),
    },
  ];

  return (
    <li className="overflow-hidden rounded-xl border border-vg-line bg-vg-bg">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4">
        <Icone nome="webhook" tamanho={22} className="mt-0.5 shrink-0 text-vg-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{webhook.nome}</p>
          <p className="text-[13px] text-vg-text-2">{textoEventos(webhook.eventos)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Selo cor="destaque" semPonto>{webhook.campanhas === null ? "Todas as campanhas" : `${webhook.campanhas.length} campanha(s)`}</Selo>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            role="switch"
            aria-checked={webhook.ativo}
            aria-label={`${webhook.nome}: ${webhook.ativo ? "ativo" : "inativo"}`}
            disabled={ocupado}
            onClick={() => rodar(() => alternarWebhook(webhook.id, !webhook.ativo))}
            className="flex items-center gap-2 disabled:opacity-50"
          >
            <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${webhook.ativo ? "bg-vg-accent/60" : "bg-white/20"}`}>
              <span className={`absolute top-0.5 size-4 rounded-full transition-all ${webhook.ativo ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
            </span>
          </button>
          <PopoverInfoWebhook webhook={webhook} entregas={entregas} />
          <button
            type="button"
            aria-label={`Excluir webhook ${webhook.nome}`}
            disabled={ocupado}
            onClick={excluir}
            className="text-vg-text-3 transition-colors hover:text-vg-erro disabled:opacity-50"
          >
            <Icone nome="delete" tamanho={18} />
          </button>
          <MenuCartao itens={itensMenu} />
        </div>
      </div>
      <p role="status" className={`px-4 pb-2 text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
      {segredoNovo && (
        <JanelaSegredo
          segredo={segredoNovo}
          aoFechar={() => {
            setSegredoNovo(null);
            router.refresh();
          }}
        />
      )}
    </li>
  );
}

export function ListaWebhooks({ webhooks, entregasPorId }: { webhooks: WebhookLinha[]; entregasPorId: Record<string, EntregaLinha[]> }) {
  if (!webhooks.length) {
    return (
      <div className="rounded-xl border border-vg-line">
        <Vazio texto="Nenhum registro encontrado" />
      </div>
    );
  }
  return (
    <ul className="grid gap-3 lg:grid-cols-2">
      {webhooks.map((w) => (
        <CartaoWebhook key={w.id} webhook={w} entregas={entregasPorId[w.id] ?? []} />
      ))}
    </ul>
  );
}
