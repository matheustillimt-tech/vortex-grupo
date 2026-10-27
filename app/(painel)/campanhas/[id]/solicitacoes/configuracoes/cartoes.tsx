"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Icone } from "../../../../_componentes/icone";
import { Botao, estiloCartao } from "../../../../_componentes/ui";
import { aplicarAprovacaoEmTodos } from "../actions";

/** Peças dos cartões da aba Configurações (Etapa 3N, cartões). Só recebem dados (ids, textos, hrefs). */

export function CartaoConfig({ icone, titulo, texto, children }: { icone: string; titulo: string; texto?: string; children?: React.ReactNode }) {
  return (
    <section className={`${estiloCartao} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full border border-vg-line-2 bg-vg-panel-3 text-vg-text-2">
          <Icone nome={icone} tamanho={18} />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className="text-[15px] font-medium text-vg-text">{titulo}</h3>
          {texto && <p className="text-[13px] text-vg-text-2">{texto}</p>}
        </div>
      </div>
      {children && <div className="space-y-2 pl-12">{children}</div>}
    </section>
  );
}

/** Interruptor (botão `role="switch"`) com o estado ao lado: ícone + texto do ligado/desligado. */
export function InterruptorEstado({ rotulo, ligado, desabilitado, aoMudar, ligadoTexto, desligadoTexto, ligadoIcone, desligadoIcone, ajuda }: {
  rotulo: string;
  ligado: boolean;
  desabilitado?: boolean;
  aoMudar: (v: boolean) => void;
  ligadoTexto?: string;
  desligadoTexto?: string;
  ligadoIcone?: string;
  desligadoIcone?: string;
  ajuda?: string;
}) {
  const idAjuda = useId();
  const texto = ligado ? ligadoTexto : desligadoTexto;
  const icone = ligado ? ligadoIcone : desligadoIcone;
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          role="switch"
          aria-checked={ligado}
          aria-label={rotulo}
          aria-describedby={ajuda ? idAjuda : undefined}
          disabled={desabilitado}
          onClick={() => aoMudar(!ligado)}
          className="flex shrink-0 items-center disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${ligado ? "bg-vg-accent/60" : "bg-white/20"}`}>
            <span className={`absolute top-0.5 size-4 rounded-full transition-all ${ligado ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
          </span>
        </button>
        {texto ? (
          <span className={`inline-flex items-center gap-1.5 text-sm ${ligado ? "text-vg-text" : "text-vg-text-3"}`}>
            {icone && <Icone nome={icone} tamanho={16} />}
            {texto}
          </span>
        ) : (
          <span className={`text-sm ${desabilitado ? "text-vg-text-3" : "text-vg-text"}`}>{rotulo}</span>
        )}
      </div>
      {ajuda && <p id={idAjuda} className="text-xs text-vg-text-3">{ajuda}</p>}
    </div>
  );
}

export type TagOpcao = { id: string; nome: string; tipo: string };

/** Multi-select de tags com chips (até `maximo`). */
export function SeletorTags({ tags, selecionadas, aoMudar, desabilitado, maximo }: {
  tags: readonly TagOpcao[];
  selecionadas: readonly string[];
  aoMudar: (ids: string[]) => void;
  desabilitado?: boolean;
  maximo: number;
}) {
  const id = useId();
  const porId = new Map(tags.map((t) => [t.id, t]));
  const livres = tags.filter((t) => !selecionadas.includes(t.id));
  const cheio = selecionadas.length >= maximo;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {selecionadas.map((tid) => (
          <span key={tid} className="inline-flex items-center gap-1 rounded-full border border-vg-line-2 px-2 py-0.5 text-[12px] text-vg-text-2">
            {porId.get(tid)?.nome ?? "Tag apagada"}
            {!desabilitado && (
              <button type="button" aria-label={`Tirar ${porId.get(tid)?.nome ?? "tag"}`} onClick={() => aoMudar(selecionadas.filter((x) => x !== tid))} className="text-vg-text-3 hover:text-vg-text">
                <Icone nome="close" tamanho={14} />
              </button>
            )}
          </span>
        ))}
        {!selecionadas.length && <span className="text-[12px] text-vg-text-3">Nenhuma tag selecionada</span>}
      </div>
      <label htmlFor={id} className="sr-only">Adicionar tag</label>
      <select
        id={id}
        value=""
        disabled={desabilitado || cheio || !livres.length}
        onChange={(e) => e.target.value && aoMudar([...selecionadas, e.target.value])}
        className="w-full max-w-xs rounded-lg border border-vg-line bg-transparent px-3 py-1.5 text-sm text-vg-text disabled:opacity-50"
      >
        <option value="">{cheio ? `No máximo ${maximo} tags` : "Adicionar tag…"}</option>
        {livres.map((t) => (
          <option key={t.id} value={t.id} className="bg-vg-panel">
            {t.nome}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Cartão "Solicitações de entrada nos grupos": os dois botões gravam `aprovacao_entrada` e aplicam em todos os grupos
 *  (execução `configuracao` em massa), com confirmação. */
export function BotoesAprovacaoTodos({ campanhaId, podeEditar, ligada }: { campanhaId: string; podeEditar: boolean; ligada: boolean }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  async function aplicar(ligar: boolean) {
    const texto = ligar
      ? "Ativar a aprovação de solicitações de entrada em todos os grupos da campanha?"
      : "Desativar a aprovação de solicitações de entrada em todos os grupos da campanha? As aprovações automáticas também são desligadas.";
    if (!window.confirm(texto)) return;
    setEnviando(true);
    setErro(null);
    setMensagem(null);
    try {
      const r = await aplicarAprovacaoEmTodos(campanhaId, ligar);
      if (r.erro) setErro(r.erro);
      else {
        setMensagem(r.mensagem ?? null);
        router.refresh();
      }
    } catch {
      setErro("Não foi possível aplicar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="inline-flex items-center gap-1.5 text-sm text-vg-text-2">
        <Icone nome={ligada ? "lock_person" : "group_add"} tamanho={16} />
        {ligada ? "Aprovação ligada" : "Aprovação desligada"}
      </p>
      <div className="flex flex-wrap gap-2">
        <Botao type="button" variante="secundario" disabled={!podeEditar || enviando} onClick={() => aplicar(true)}>
          <Icone nome="lock_person" tamanho={18} /> Ativar em todos os grupos
        </Botao>
        <Botao type="button" variante="secundario" disabled={!podeEditar || enviando} onClick={() => aplicar(false)}>
          <Icone nome="group_add" tamanho={18} /> Desativar em todos os grupos
        </Botao>
      </div>
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      {mensagem && <p role="status" className="text-sm text-vg-text-2">{mensagem}</p>}
    </div>
  );
}

/** Cartão "Integrações e atalhos": cada linha é um link com `chevron_right`. */
export function LinhasAtalhos({ itens }: { itens: readonly { icone: string; rotulo: string; href: string }[] }) {
  return (
    <ul className="divide-y divide-vg-line overflow-hidden rounded-lg border border-vg-line">
      {itens.map((i) => (
        <li key={i.href}>
          <Link href={i.href} className="flex items-center gap-3 px-3 py-2.5 text-sm text-vg-text transition-colors hover:bg-white/[0.03]">
            <Icone nome={i.icone} tamanho={18} className="text-vg-text-3" />
            <span className="min-w-0 flex-1">{i.rotulo}</span>
            <Icone nome="chevron_right" tamanho={18} className="text-vg-text-3" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
