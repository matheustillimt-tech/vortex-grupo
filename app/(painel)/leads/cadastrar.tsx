"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { MAXIMO_CAMPOS } from "@/src/lib/regras/leads";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Campo, estiloBotao, estiloInput } from "../_componentes/ui";
import { cadastrarLead } from "./actions";

type Opcao = { id: string; nome: string };
type LinhaCampo = { chave: string; valor: string };

/** Botão "ADICIONAR" + diálogo "Cadastrar": grava em `contatos` e, se marcar
 *  tags, em `pessoa_tags`. Um contato cadastrado à mão aparece na Visão geral mesmo sem nunca ter entrado num
 *  grupo (a RPC `listar_leads` já faz a união). */
export function CadastrarLead({ tags }: { tags: Opcao[] }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  // `key` recria o formulário a cada abertura, pra começar sempre em branco.
  const [vez, setVez] = useState(0);
  return (
    <>
      <button type="button" className={estiloBotao("principal")} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        <Icone nome="add" />
        ADICIONAR
      </button>
      <FormularioCadastro key={vez} aberta={aberta} aoFechar={() => setAberta(false)} tags={tags} aoSalvar={() => router.refresh()} />
    </>
  );
}

function FormularioCadastro({ aberta, aoFechar, tags, aoSalvar }: { aberta: boolean; aoFechar: () => void; tags: Opcao[]; aoSalvar: () => void }) {
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [campos, setCampos] = useState<LinhaCampo[]>([]);
  const [rascunhoCampo, setRascunhoCampo] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [novaTag, setNovaTag] = useState("");
  const [rascunhoTag, setRascunhoTag] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();
  const idNumero = useId();

  function mudarCampo(i: number, patch: Partial<LinhaCampo>) {
    setCampos((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  /** "Novo campo" + "Salvar": adiciona a mesma linha nome/valor que o botão de hoje adicionava direto. */
  function adicionarCampo() {
    const chave = rascunhoCampo.trim();
    if (!chave || campos.length >= MAXIMO_CAMPOS) return;
    setCampos((cs) => [...cs, { chave, valor: "" }]);
    setRascunhoCampo("");
  }

  const tagsEscolhidas = tags.filter((t) => tagIds.includes(t.id));
  const tagsDisponiveis = tags.filter((t) => !tagIds.includes(t.id));

  function tirarTagEscolhida(id: string) {
    setTagIds((ids) => ids.filter((x) => x !== id));
  }

  function salvar() {
    setErro(null);
    iniciar(async () => {
      const r = await cadastrarLead({ telefone: numero, nome, campos, tagIds, novaTag });
      if (r.erro) return setErro(r.erro);
      aoFechar();
      aoSalvar();
    });
  }

  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo="Cadastrar" semFechar>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <Campo rotulo="Nome">
          <input id={idNome} className={estiloInput} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Nome do lead" />
        </Campo>
        <Campo rotulo="Número do WhatsApp *" dica="Com DDD, ex.: (11) 9 1234-5678.">
          <div className="flex gap-2">
            {/* seletor de país — só "BR +55" por agora, desabilitado (o normalizador continua o de hoje). */}
            <select aria-label="País" disabled className={`${estiloInput} w-28 shrink-0 opacity-70`} defaultValue="BR">
              <option value="BR">BR +55</option>
            </select>
            <input
              id={idNumero}
              className={estiloInput}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="(11) 9 1234-5678"
              aria-required="true"
              required
            />
          </div>
        </Campo>

        <div className="space-y-2">
          <span className="text-[13.3px] text-[#e3e9e5]">Campos personalizados</span>
          <div className="flex gap-2">
            <input
              className={estiloInput}
              value={rascunhoCampo}
              maxLength={40}
              placeholder="Novo campo"
              aria-label="Novo campo"
              disabled={campos.length >= MAXIMO_CAMPOS}
              onChange={(e) => setRascunhoCampo(e.target.value)}
            />
            <button type="button" className={estiloBotao("secundario")} disabled={!rascunhoCampo.trim() || campos.length >= MAXIMO_CAMPOS} onClick={adicionarCampo}>
              Salvar
            </button>
          </div>
          {campos.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input
                className={estiloInput}
                value={c.chave}
                maxLength={40}
                placeholder="Nome do campo"
                aria-label={`Nome do campo ${i + 1}`}
                onChange={(e) => mudarCampo(i, { chave: e.target.value })}
              />
              <input
                className={estiloInput}
                value={c.valor}
                maxLength={200}
                placeholder="Valor"
                aria-label={`Valor do campo ${i + 1}`}
                onChange={(e) => mudarCampo(i, { valor: e.target.value })}
              />
              <button
                type="button"
                aria-label={`Remover campo ${i + 1}`}
                onClick={() => setCampos((cs) => cs.filter((_, idx) => idx !== i))}
                className="grid size-9 shrink-0 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-vg-erro"
              >
                <Icone nome="close" tamanho={16} />
              </button>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <span className="block text-[13.3px] text-[#e3e9e5]">Tags</span>
          <div className="flex flex-wrap gap-1.5 empty:hidden">
            {tagsEscolhidas.map((t) => (
              <span key={t.id} className="inline-flex items-center gap-1 rounded-full border border-vg-line-2 bg-vg-panel-3 px-2.5 py-1 text-xs text-vg-text">
                {t.nome}
                <button type="button" aria-label={`Tirar a tag ${t.nome}`} onClick={() => tirarTagEscolhida(t.id)} className="grid size-4 place-items-center rounded-full text-vg-muted hover:text-vg-erro">
                  <Icone nome="close" tamanho={12} />
                </button>
              </span>
            ))}
            {novaTag && (
              <span className="inline-flex items-center gap-1 rounded-full border border-vg-accent/50 bg-vg-accent/10 px-2.5 py-1 text-xs text-vg-accent">
                {novaTag}
                <button type="button" aria-label={`Tirar a tag ${novaTag}`} onClick={() => setNovaTag("")} className="grid size-4 place-items-center rounded-full hover:text-vg-erro">
                  <Icone nome="close" tamanho={12} />
                </button>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {tagsDisponiveis.length > 0 && (
              <select
                aria-label="Tag existente"
                className={`${estiloInput} w-auto`}
                value=""
                onChange={(e) => {
                  if (e.target.value) setTagIds((ids) => [...ids, e.target.value]);
                }}
              >
                <option value="">Tag existente…</option>
                {tagsDisponiveis.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
              </select>
            )}
            <input aria-label="Nova tag" className={estiloInput} value={rascunhoTag} maxLength={40} placeholder="Nova tag" onChange={(e) => setRascunhoTag(e.target.value)} />
            <button
              type="button"
              className={estiloBotao("secundario")}
              disabled={!rascunhoTag.trim()}
              onClick={() => {
                setNovaTag(rascunhoTag.trim());
                setRascunhoTag("");
              }}
            >
              Salvar
            </button>
          </div>
        </div>

        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>Fechar</button>
          <button type="submit" className={estiloBotao("principal")} disabled={ocupado || !numero.trim()}>Salvar</button>
        </div>
      </form>
    </Janela>
  );
}
