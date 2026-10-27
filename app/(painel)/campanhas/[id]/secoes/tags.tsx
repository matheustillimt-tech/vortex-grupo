"use client";
import { useId, useState } from "react";
import { algumBlocoSalvando } from "@/src/lib/regras/interacao";
import { algumaTagEscolhida, type TagsCampanhaEntrada } from "@/src/lib/regras/secoes-campanha";
import { Icone } from "../../../_componentes/icone";
import { estiloInput } from "../../../_componentes/ui";
import { salvarTagsCampanha } from "./actions";

type Opcao = { id: string; nome: string };

/** Select de tag com botão de limpar (vazio = nenhuma tag). */
function SelectTag({ rotulo, valor, opcoes, aoMudar, desabilitado }: {
  rotulo: string;
  valor: string;
  opcoes: Opcao[];
  aoMudar: (v: string) => void;
  desabilitado: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-[13.3px] text-[#e3e9e5]">{rotulo}</label>
      <div className="flex items-center gap-1">
        <select id={id} className={estiloInput} value={valor} disabled={desabilitado} onChange={(e) => aoMudar(e.target.value)}>
          <option value="">Nenhuma</option>
          {opcoes.map((t) => <option key={t.id} value={t.id}>{t.nome}</option>)}
        </select>
        {valor && (
          <button type="button" onClick={() => aoMudar("")} disabled={desabilitado} className="rounded p-1 text-vg-text-2 hover:text-white" aria-label={`Limpar ${rotulo}`}>
            <Icone nome="close" tamanho={16} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Dois blocos ("Quando o participante entrar"/"sair") com "Adicionar tag" e "Remover tag", sem interruptor nem
 *  "SALVAR": cada escolha (ou `clear`) já salva sozinha (Etapa 3N). `tags_ativo`
 *  é consequência de ter alguma tag escolhida (`lerTagsCampanha`, no servidor) — nunca de um botão separado.
 *  `ativo` é o `tags_ativo` de hoje: se vier `false` com alguma tag já gravada (estado de antes desta etapa, com
 *  o interruptor manual), mostra o aviso até a pessoa escolher de novo (o que já salva e liga). */
export function TagsCampanha({ campanhaId, tags, inicial, ativo }: { campanhaId: string; tags: Opcao[]; inicial: TagsCampanhaEntrada; ativo: boolean }) {
  const [valor, setValor] = useState(inicial);
  const [ligado, setLigado] = useState(ativo);
  const [salvando, setSalvando] = useState<"entrou" | "saiu" | null>(null);
  const [msg, setMsg] = useState<{ bloco: "entrou" | "saiu"; texto: string; erro: boolean } | null>(null);

  async function salvar(bloco: "entrou" | "saiu", novoValor: TagsCampanhaEntrada) {
    setSalvando(bloco);
    setMsg(null);
    try {
      const r = await salvarTagsCampanha(campanhaId, novoValor);
      if (r.erro) {
        setMsg({ bloco, texto: r.erro, erro: true });
      } else {
        setLigado(algumaTagEscolhida({
          tag_entrou_adicionar: novoValor.entrou.adicionar || null,
          tag_entrou_remover: novoValor.entrou.remover || null,
          tag_saiu_adicionar: novoValor.saiu.adicionar || null,
          tag_saiu_remover: novoValor.saiu.remover || null,
        }));
      }
    } catch {
      setMsg({ bloco, texto: "Não foi possível salvar.", erro: true });
    } finally {
      setSalvando(null);
    }
  }

  function mudar(bloco: "entrou" | "saiu", campo: "adicionar" | "remover", v: string) {
    const novo = { ...valor, [bloco]: { ...valor[bloco], [campo]: v } };
    setValor(novo);
    salvar(bloco, novo);
  }

  const blocos = [
    { chave: "entrou" as const, titulo: "Quando o participante entrar" },
    { chave: "saiu" as const, titulo: "Quando o participante sair" },
  ];
  const algumaTag = algumaTagEscolhida({
    tag_entrou_adicionar: valor.entrou.adicionar || null,
    tag_entrou_remover: valor.entrou.remover || null,
    tag_saiu_adicionar: valor.saiu.adicionar || null,
    tag_saiu_remover: valor.saiu.remover || null,
  });

  return (
    <div className="space-y-3">
      {!ligado && algumaTag && (
        <p className="rounded-lg border border-vg-line px-3 py-2 text-[13px] text-vg-aviso">Desativado: escolha a tag de novo para ativar.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {blocos.map((b) => (
          <div key={b.chave} className="space-y-3 rounded-lg border border-vg-line p-4">
            <h3 className="text-[15px] font-semibold">{b.titulo}</h3>
            {/* Enquanto qualquer bloco está salvando, os dois ficam desabilitados — não só o que está salvando
             *  (revisão final B, item m4): mudar o outro bloco no meio do caminho sobrescreveria o estado que
             *  acabou de voltar do servidor. */}
            <SelectTag
              rotulo="Adicionar tag"
              valor={valor[b.chave].adicionar}
              opcoes={tags}
              desabilitado={algumBlocoSalvando(salvando)}
              aoMudar={(v) => mudar(b.chave, "adicionar", v)}
            />
            <SelectTag
              rotulo="Remover tag"
              valor={valor[b.chave].remover}
              opcoes={tags}
              desabilitado={algumBlocoSalvando(salvando)}
              aoMudar={(v) => mudar(b.chave, "remover", v)}
            />
            {msg?.bloco === b.chave && <p role="status" className={`text-xs ${msg.erro ? "text-vg-erro" : "text-vg-ok"}`}>{msg.texto}</p>}
          </div>
        ))}
        {tags.length === 0 && <p className="text-[13px] text-vg-text-2 md:col-span-2">Nenhuma tag criada ainda. Crie tags em Leads para usar aqui.</p>}
      </div>
    </div>
  );
}
