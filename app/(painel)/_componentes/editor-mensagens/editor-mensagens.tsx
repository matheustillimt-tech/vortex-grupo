"use client";
import { useRef, useState } from "react";
import type { ConteudoV2, FormatoMensagemV2, MensagemV2, OpcoesEnvio } from "@/src/lib/regras/conteudo-v2";
import { DicaVariaveis } from "../dica-variaveis";
import { BolhaMensagemV2 } from "../previa-mensagem";
import { estiloAcao, estiloInput } from "../ui";
import { Icone } from "../icone";
import { BarraFormatacao, useFormatacao } from "./barra-formatacao";
import { CampoRascunho } from "./campo-rascunho";
import { BOTOES_TIPO } from "./formatos";
import { MenuCartao, type ItemMenuCartao } from "../menu-cartao";
import { OpcoesEnvioColuna, type ChaveOpcao } from "./opcoes-envio";
import { mensagemDeRascunho, rascunhoDeMensagem, rascunhoVazio, type Rascunho } from "./rascunho";
import { SeletorEmoji } from "./seletor-emoji";

/** Papel de parede do WhatsApp: padrão SVG inline leve, sem imagem externa — um grid de
 *  losangos bem sutis sobre o `bg-[#0b141a]` de sempre. */
const PAPEL_DE_PAREDE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='52' height='52' viewBox='0 0 52 52'%3E%3Cg fill='none' stroke='%23ffffff' stroke-opacity='0.035'%3E%3Cpath d='M26 2 L50 26 L26 50 L2 26 Z'/%3E%3C/g%3E%3C/svg%3E";

export type ModeloParaEditor = { id: string; nome: string; mensagens: MensagemV2[] };

/** Formatos com um campo de texto livre (corpo ou legenda) — ganham a barra de formatação, o textarea e o emoji
 *  nele. Áudio e figurinha não têm legenda no WhatsApp; os outros 3 (`contato`, `evento`, `enquete`) são só
 *  formulário, sem texto livre pra formatar. */
const TEM_TEXTO_LIVRE: ReadonlySet<FormatoMensagemV2> = new Set(["texto", "botoes", "imagem", "video", "gif", "documento"]);

/**
 * Editor de mensagens completo (Etapa 3C): 3 colunas — esquerda com a lista de mensagens já adicionadas e
 * os botões redondos de tipo; centro com o formulário da mensagem em edição (texto, mídia, contato, evento,
 * botões ou enquete) e a barra de formatação/emoji/modelos/variáveis; direita com as opções de envio. Produz e lê
 * sempre `ConteudoV2` — quem chama decide se guarda isso direto (ação/automação/sequência) ou converte pra outro
 * formato na borda (ex.: nenhum caller atual faz isso, mas a função existe pra isso: `limitarA1`).
 */
export function EditorMensagens({
  valor,
  onChange,
  variaveis,
  modelos = [],
  limitarA1 = false,
  semOpcoes = false,
  opcoesVisiveis,
  pasta,
  rotuloIntervaloGrupos,
  ocultarDicaVariaveis = false,
}: {
  valor: ConteudoV2;
  onChange: (v: ConteudoV2) => void;
  variaveis?: string[];
  modelos?: ModeloParaEditor[];
  limitarA1?: boolean;
  semOpcoes?: boolean;
  opcoesVisiveis?: ChaveOpcao[];
  pasta: string;
  rotuloIntervaloGrupos?: string;
  /** Quando a tela já mostra a dica de variáveis uma vez fora do editor (ex.: vários passos/ações na mesma
   *  página), evita repetir a mesma dica em cada instância. */
  ocultarDicaVariaveis?: boolean;
}) {
  const mensagens = valor.mensagens;
  const opcoes = valor.opcoes;

  const [formato, setFormato] = useState<FormatoMensagemV2>("texto");
  const [rascunho, setRascunho] = useState<Rascunho>(rascunhoVazio());
  const [editando, setEditando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const refTextarea = useRef<HTMLTextAreaElement>(null);

  const valorTextoAtual = formato === "texto" || formato === "botoes" ? rascunho.texto : rascunho.legenda;
  const setTextoAtual = (v: string) => setRascunho({ ...rascunho, [formato === "texto" || formato === "botoes" ? "texto" : "legenda"]: v });
  const { aplicar, aoTeclar } = useFormatacao(refTextarea, valorTextoAtual, setTextoAtual);

  function mudarMensagens(novas: MensagemV2[]) {
    onChange({ ...valor, mensagens: novas });
  }

  function mudarOpcoes(novas: OpcoesEnvio) {
    onChange({ ...valor, opcoes: novas });
  }

  // Sem botão "Texto": texto é o padrão; clicar de novo no tipo já marcado volta pra ele.
  function escolherTipo(f: FormatoMensagemV2) {
    setFormato(f === formato ? "texto" : f);
    setRascunho(rascunhoVazio());
    setEditando(null);
    setErro(null);
  }

  function editar(i: number) {
    const m = mensagens[i];
    if (!m) return;
    setFormato(m.formato);
    setRascunho(rascunhoDeMensagem(m));
    setEditando(i);
    setErro(null);
  }

  function salvar() {
    const r = mensagemDeRascunho(formato, rascunho);
    if (!r.ok) return setErro(r.erro);
    setErro(null);
    if (editando !== null) {
      mudarMensagens(mensagens.map((m, k) => (k === editando ? r.valor : m)));
    } else if (limitarA1) {
      mudarMensagens([r.valor]);
    } else {
      if (mensagens.length >= 10) return setErro("No máximo 10 mensagens.");
      mudarMensagens([...mensagens, r.valor]);
    }
    setRascunho(rascunhoVazio());
    setFormato("texto");
    setEditando(null);
  }

  function remover(i: number) {
    mudarMensagens(mensagens.filter((_, k) => k !== i));
    if (editando === i) {
      setEditando(null);
      setRascunho(rascunhoVazio());
      setFormato("texto");
    }
  }

  function mover(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= mensagens.length) return;
    const novas = [...mensagens];
    [novas[i], novas[j]] = [novas[j], novas[i]];
    mudarMensagens(novas);
  }

  function limpar() {
    if (mensagens.length && !window.confirm("Remover todas as mensagens?")) return;
    mudarMensagens([]);
    setEditando(null);
    setRascunho(rascunhoVazio());
    setFormato("texto");
  }

  function inserirModelo(m: ModeloParaEditor) {
    if (!m.mensagens.length) return;
    mudarMensagens(limitarA1 ? [m.mensagens[0]] : [...mensagens, ...m.mensagens].slice(0, 10));
  }

  function inserirEmoji(emoji: string) {
    const el = refTextarea.current;
    if (!el || !TEM_TEXTO_LIVRE.has(formato)) {
      setTextoAtual(`${valorTextoAtual}${emoji}`);
      return;
    }
    const inicio = el.selectionStart ?? valorTextoAtual.length;
    const fim = el.selectionEnd ?? valorTextoAtual.length;
    const novo = valorTextoAtual.slice(0, inicio) + emoji + valorTextoAtual.slice(fim);
    setTextoAtual(novo);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(inicio + emoji.length, inicio + emoji.length);
    });
  }

  const podeAdicionarMais = !limitarA1 || mensagens.length === 0 || editando !== null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)_minmax(0,220px)]">
      {/* Esquerda: prévia + lista + tipos — cartão alto com o papel de parede do WhatsApp. */}
      <div
        className="flex min-h-[420px] flex-col gap-2 rounded-xl border border-vg-line bg-[#0b141a] p-3"
        style={{ backgroundImage: `url("${PAPEL_DE_PAREDE}")` }}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-medium text-white/90">Enviar mensagens</h3>
          {mensagens.length > 0 && (
            <button type="button" title="Remover todas" aria-label="Remover todas as mensagens" onClick={limpar} className="grid size-7 place-items-center rounded-md text-white/60 hover:bg-white/10 hover:text-white">
              <Icone nome="delete" tamanho={16} />
            </button>
          )}
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto">
          {mensagens.length === 0 ? (
            <p className="px-1 py-4 text-center text-[12.5px] text-white/50">Nenhuma mensagem ainda.</p>
          ) : (
            <ol className="space-y-2">
              {mensagens.map((m, i) => {
                const itensReordenar: ItemMenuCartao[] = [
                  { rotulo: "Subir", icone: "arrow_upward", desabilitado: i === 0, onClick: () => mover(i, -1) },
                  { rotulo: "Descer", icone: "arrow_downward", desabilitado: i === mensagens.length - 1, onClick: () => mover(i, 1) },
                ];
                return (
                  <li key={i} className="group relative">
                    <button type="button" onClick={() => editar(i)} aria-label={`Editar mensagem ${i + 1}`} className="block w-full text-left">
                      <BolhaMensagemV2 mensagem={m} mencionarTodos={opcoes.mencionar_todos} />
                    </button>
                    <div className="mt-1 flex items-center justify-end gap-1">
                      <MenuCartao itens={itensReordenar} icone="unfold_more" rotulo={`Reordenar mensagem ${i + 1}`} />
                      <button type="button" title="Apagar" aria-label={`Apagar mensagem ${i + 1}`} onClick={() => remover(i)} className="grid size-6 place-items-center rounded text-white/60 hover:bg-vg-erro/20 hover:text-vg-erro">
                        <Icone nome="delete" tamanho={14} />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {podeAdicionarMais && (
          <div role="group" aria-label="Tipo da mensagem" className="flex flex-wrap gap-2">
            {BOTOES_TIPO.map((b) => (
              <button
                key={b.formato}
                type="button"
                title={b.rotulo}
                aria-label={b.rotulo}
                aria-pressed={formato === b.formato}
                onClick={() => escolherTipo(b.formato)}
                className={`grid size-9 place-items-center rounded-full transition-colors ${
                  formato === b.formato ? "bg-vg-primario text-white" : "bg-vg-accent/15 text-vg-accent hover:bg-vg-accent/25"
                }`}
              >
                <Icone nome={b.icone} tamanho={18} />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Centro: formulário da mensagem em edição */}
      <div className="space-y-3">
        {TEM_TEXTO_LIVRE.has(formato) && (
          <>
            <BarraFormatacao aoAplicar={aplicar} />
            <textarea
              ref={refTextarea}
              rows={6}
              placeholder={formato === "texto" || formato === "botoes" ? "Escreva a sua mensagem" : "Legenda (opcional)"}
              aria-label={formato === "texto" || formato === "botoes" ? "Escreva a sua mensagem" : "Legenda"}
              className={estiloInput}
              value={valorTextoAtual}
              onChange={(e) => setTextoAtual(e.target.value)}
              onKeyDown={aoTeclar}
            />
          </>
        )}
        <CampoRascunho formato={formato} rascunho={rascunho} setRascunho={setRascunho} pasta={pasta} />

        <div className="flex flex-wrap items-center gap-2">
          <SeletorEmoji aoEscolher={inserirEmoji} />
          {/* "MODELOS" sempre visível: sem modelo cadastrado, só desabilita. */}
          <label
            className="inline-flex items-center gap-1.5 text-xs has-[select:disabled]:opacity-40"
            title={modelos.length === 0 ? "Nenhum modelo cadastrado" : undefined}
          >
            <Icone nome="speaker_notes" tamanho={16} className="text-vg-text-3" />
            <select
              className={`${estiloInput} w-auto max-w-[180px] !py-1 text-xs`}
              value=""
              disabled={modelos.length === 0}
              aria-label="Usar modelo"
              onChange={(e) => {
                const m = modelos.find((x) => x.id === e.target.value);
                if (m) inserirModelo(m);
              }}
            >
              <option value="">MODELOS…</option>
              {modelos.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </select>
          </label>
          {erro && <p role="alert" className="text-xs text-vg-erro">{erro}</p>}
          <button
            type="button"
            disabled={!mensagemDeRascunho(formato, rascunho).ok}
            className={`inline-flex items-center gap-1.5 ${estiloAcao.normal} ml-auto !text-[13px] font-semibold disabled:pointer-events-none disabled:opacity-40`}
            onClick={salvar}
          >
            <Icone nome="send" tamanho={16} />
            SALVAR
          </button>
        </div>
        {!ocultarDicaVariaveis && <DicaVariaveis personalizadas={variaveis ?? []} />}
      </div>

      {/* Direita: opções de envio */}
      {!semOpcoes && (
        <div>
          <OpcoesEnvioColuna valor={opcoes} onChange={mudarOpcoes} visiveis={opcoesVisiveis} rotuloIntervaloGrupos={rotuloIntervaloGrupos} />
        </div>
      )}
    </div>
  );
}
