"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { ROTULO_TIPO, type TipoModelo } from "@/src/lib/regras/conteudo";
import { paraV2, type ConteudoV2 } from "@/src/lib/regras/conteudo-v2";
import { ConteudoEditor, type Valor } from "../_componentes/conteudo-editor";
import { DicaVariaveis } from "../_componentes/dica-variaveis";
import { EditorMensagens } from "../_componentes/editor-mensagens";
import { Icone } from "../_componentes/icone";
import { Botao, Campo, Pagina, estiloInput } from "../_componentes/ui";
import { salvarModelo } from "./actions";

export type ModeloEditavel = { id: string | null; nome: string; tipo: TipoModelo; conteudo: Valor; pasta: string | null };

/** Opções de envio visíveis no editor de modelos: sem "Marcar todos" e "Fixar"; "Mensagens temporárias" e os intervalos continuam. */
const OPCOES_VISIVEIS_MODELO = ["temporarias", "intervalo_grupos", "intervalo_mensagens"] as const;

const NOVA = "__nova__";

/**
 * Página completa de criar/editar modelo: "SALVAR" no topo (com "save"),
 * "Título", "Pasta" e o editor completo de `EditorMensagens` pra modelos do tipo "mensagem" (sem "Marcar todos" e
 * "Fixar"; com "Mensagens temporárias" e intervalos). Os tipos nome/descrição/enquete continuam no formulário
 * simples de sempre (`ConteudoEditor`). Ao salvar, volta pra lista preservando a pasta escolhida.
 */
export function EditorModeloPagina({ inicial, pastas }: { inicial: ModeloEditavel; pastas: string[] }) {
  const router = useRouter();
  const [m, setM] = useState(inicial);
  const [escolha, setEscolha] = useState<string>(inicial.pasta ?? "");
  const [nova, setNova] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const idNova = useId();
  const opcoes = inicial.pasta && !pastas.includes(inicial.pasta) ? [inicial.pasta, ...pastas] : pastas;
  const pasta = escolha === NOVA ? nova.trim() : escolha || null;
  const valido = m.nome.trim().length > 0 && !(escolha === NOVA && !nova.trim());

  async function salvar() {
    setSalvando(true);
    setMsg(null);
    try {
      const r = await salvarModelo(m.id, { nome: m.nome, tipo: m.tipo, conteudo: m.conteudo, pasta });
      if (r.erro) {
        setMsg(r.erro);
        return;
      }
      router.push(`/modelos${pasta ? `?pasta=${encodeURIComponent(pasta)}` : ""}`);
    } catch {
      setMsg("Não foi possível salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  // "Tipo" some na criação (novo modelo = "mensagem", que o editor v2 cobre); num modelo antigo de outro
  // tipo (enquete/nome/descricao — legado, sem editor v2), vira texto só leitura, porque o tipo não muda depois
  // de criado (a mesma regra de hoje, só que sem oferecer um select que não faz nada).
  const tipoLegadoSoLeitura = Boolean(m.id) && m.tipo !== "mensagem";

  return (
    <Pagina
      titulo={m.id ? "Editar" : "Adicionar"}
      trilha={[{ rotulo: "Modelos", href: "/modelos" }]}
      acoes={
        <Botao icone={<Icone nome="save" />} disabled={salvando || !valido} onClick={salvar}>
          {salvando ? "Salvando…" : "SALVAR"}
        </Botao>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Titulo">
            <input className={estiloInput} value={m.nome} maxLength={60} onChange={(e) => setM({ ...m, nome: e.target.value })} autoFocus />
          </Campo>
          {tipoLegadoSoLeitura && (
            <Campo rotulo="Tipo">
              <p className={`${estiloInput} flex items-center text-vg-text-2`}>{ROTULO_TIPO[m.tipo]}</p>
            </Campo>
          )}
          <Campo rotulo="Pasta">
            <select className={estiloInput} value={escolha} onChange={(e) => setEscolha(e.target.value)}>
              <option value="">Sem pasta</option>
              {opcoes.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
              <option value={NOVA}>Nova pasta…</option>
            </select>
          </Campo>
          {escolha === NOVA && (
            <label htmlFor={idNova} className="block space-y-1.5">
              <span className="text-[13.3px] text-[#e3e9e5]">Nome da nova pasta</span>
              <input id={idNova} className={estiloInput} value={nova} maxLength={40} onChange={(e) => setNova(e.target.value)} placeholder="Ex.: Lançamento de março" />
            </label>
          )}
        </div>
        {m.tipo === "mensagem" ? (
          <EditorMensagens
            valor={paraV2(m.conteudo)}
            onChange={(c: ConteudoV2) => setM({ ...m, conteudo: c as Valor })}
            pasta="modelos"
            semOpcoes={false}
            opcoesVisiveis={[...OPCOES_VISIVEIS_MODELO]}
            rotuloIntervaloGrupos="Intervalo de envio entre destinatários"
          />
        ) : (
          <>
            <DicaVariaveis />
            <ConteudoEditor tipo={m.tipo} valor={m.conteudo} onChange={(c) => setM({ ...m, conteudo: c })} pasta="modelos" />
          </>
        )}
        <p role="status" className="text-sm text-vg-erro empty:hidden">{msg}</p>
      </div>
    </Pagina>
  );
}
