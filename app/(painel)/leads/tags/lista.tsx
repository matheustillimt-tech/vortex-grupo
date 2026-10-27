"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { estiloAcao, estiloBotao, estiloInput, Selo, Tabela } from "../../_componentes/ui";
import { criarTag, excluirTag, renomearTag } from "../actions";
import { ROTULO_TIPO_TAG, type TipoTag } from "../comum";

export type TagMostrada = { id: string; nome: string; tipo: TipoTag; pessoas: number };

/** Janela com um campo de nome (criar ou renomear tag manual). */
function JanelaNome({ aberta, aoFechar, titulo, inicial, botao, salvar }: {
  aberta: boolean;
  aoFechar: () => void;
  titulo: string;
  inicial: string;
  botao: string;
  salvar: (nome: string) => Promise<{ erro?: string }>;
}) {
  const router = useRouter();
  const [nome, setNome] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idCampo = useId();
  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo={titulo}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setErro(null);
          iniciar(async () => {
            const r = await salvar(nome);
            if (r.erro) return setErro(r.erro);
            aoFechar();
            router.refresh();
          });
        }}
      >
        <label htmlFor={idCampo} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome da tag</span>
          <input id={idCampo} className={estiloInput} value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: VIP" />
          <span className="block text-xs text-vg-muted">Até 40 letras. Não pode repetir o nome de outra tag manual.</span>
        </label>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>CANCELAR</button>
          <button type="submit" className={estiloBotao("principal")} disabled={ocupado || !nome.trim()}>{botao}</button>
        </div>
      </form>
    </Janela>
  );
}

/** Botão do cabeçalho: cria uma tag manual. */
export function NovaTag() {
  const [aberta, setAberta] = useState(false);
  // `key` recria a janela a cada abertura, pra começar com o campo vazio.
  const [vez, setVez] = useState(0);
  return (
    <>
      <button type="button" className={estiloBotao("principal")} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        <Icone nome="add" />
        ADICIONAR
      </button>
      <JanelaNome key={vez} aberta={aberta} aoFechar={() => setAberta(false)} titulo="Nova tag" inicial="" botao="CRIAR" salvar={criarTag} />
    </>
  );
}

export function ListaTags({ tags }: { tags: TagMostrada[] }) {
  const router = useRouter();
  const [renomeando, setRenomeando] = useState<TagMostrada | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function excluir(t: TagMostrada) {
    const aviso = t.pessoas
      ? `Excluir a tag "${t.nome}"? Ela sai de ${t.pessoas} lead(s). Não dá pra desfazer.`
      : `Excluir a tag "${t.nome}"? Não dá pra desfazer.`;
    if (!window.confirm(aviso)) return;
    setErro(null);
    iniciar(async () => {
      const r = await excluirTag(t.id);
      if (r.erro) return setErro(r.erro);
      router.refresh();
    });
  }

  return (
    <>
      {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
      <Tabela colunas={["Nome", "Tipo", "Leads", ""]} vazio={tags.length ? undefined : "Nenhuma tag ainda."}>
        {tags.map((t) => (
          <tr key={t.id}>
            <td className="px-3 py-2.5">{t.nome}</td>
            <td className="px-3 py-2.5">
              <Selo cor={t.tipo === "manual" ? "destaque" : "neutro"} semPonto={t.tipo !== "manual"}>{ROTULO_TIPO_TAG[t.tipo] ?? t.tipo}</Selo>
            </td>
            <td className="px-3 py-2.5 tabular-nums">
              <Link href={`/leads?tag=${t.id}`} className="text-vg-accent transition-colors hover:text-vg-accent-3">{t.pessoas.toLocaleString("pt-BR")}</Link>
            </td>
            <td className="px-3 py-2.5 text-right">
              {t.tipo === "manual" ? (
                <span className="inline-flex items-center gap-3">
                  <button type="button" className={estiloAcao.normal} disabled={ocupado} onClick={() => setRenomeando(t)}>renomear</button>
                  <button type="button" className={estiloAcao.perigo} disabled={ocupado} onClick={() => excluir(t)}>excluir</button>
                </span>
              ) : (
                <span className="text-xs text-vg-muted">automática</span>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      {renomeando && (
        <JanelaNome
          key={renomeando.id}
          aberta
          aoFechar={() => setRenomeando(null)}
          titulo="Renomear tag"
          inicial={renomeando.nome}
          botao="SALVAR"
          salvar={(nome) => renomearTag(renomeando.id, nome)}
        />
      )}
    </>
  );
}
