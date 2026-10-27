"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  AJUDA_APROVAR_AUTOMATICAMENTE,
  AJUDA_APROVAR_POR_TAG,
  AJUDA_RESERVAR_VAGA,
  MAX_APROVAR_TAGS,
  TEXTO_APROVAR_POR_TAG,
  TEXTO_RESERVAR_VAGA,
} from "@/src/lib/regras/solicitacoes";
import { Botao } from "../../../../_componentes/ui";
import { salvarConfiguracoesSolicitacoes } from "../actions";
import { BotoesAprovacaoTodos, CartaoConfig, InterruptorEstado, SeletorTags, type TagOpcao } from "./cartoes";

export type InicialSolicitacoes = {
  aprovacao_entrada: boolean;
  recusar_bloqueados: boolean;
  aprovar_automaticamente: boolean;
  reservar_vaga_pendentes: boolean;
  aprovar_por_tag: boolean;
  aprovar_tags: string[];
};

/** Configurações das solicitações de entrada (Etapa 3M, Tarefa 4; cartões na Etapa 3N). Os botões do
 *  primeiro cartão aplicam a aprovação na hora (com confirmação); os interruptores e as tags são gravados no SALVAR
 *  (`salvarConfiguracoesSolicitacoes`, `campanhas`/`editar`). "Aprovar automaticamente" só habilita com a aprovação
 *  ligada; "aprovação por tag", com a aprovação ligada e ao menos uma tag. */
export function FormularioSolicitacoes({ campanhaId, inicial, podeEditar, tags }: {
  campanhaId: string;
  inicial: InicialSolicitacoes;
  podeEditar: boolean;
  tags: TagOpcao[];
}) {
  const router = useRouter();
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const set = <K extends keyof InicialSolicitacoes>(k: K, v: InicialSolicitacoes[K]) => setF((a) => ({ ...a, [k]: v }));
  // A aprovação em si muda pelos botões do primeiro cartão (gravada na hora): o formulário usa o valor gravado.
  const aprovacao = inicial.aprovacao_entrada;
  const tagHabilitada = podeEditar && aprovacao && f.aprovar_tags.length > 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);
    setMensagem(null);
    setSalvando(true);
    try {
      const r = await salvarConfiguracoesSolicitacoes(campanhaId, {
        aprovacao_entrada: aprovacao,
        recusar_bloqueados: f.recusar_bloqueados,
        aprovar_automaticamente: aprovacao && f.aprovar_automaticamente,
        reservar_vaga_pendentes: f.reservar_vaga_pendentes,
        aprovar_por_tag: aprovacao && f.aprovar_tags.length > 0 && f.aprovar_por_tag,
        aprovar_tags: f.aprovar_tags,
      });
      if (r.erro) setErro(r.erro);
      else {
        setMensagem(r.mensagem ?? "Configurações salvas.");
        router.refresh();
      }
    } catch {
      setErro("Não foi possível salvar. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <CartaoConfig icone="meeting_room" titulo="Solicitações de entrada nos grupos">
        <BotoesAprovacaoTodos campanhaId={campanhaId} podeEditar={podeEditar} ligada={aprovacao} />
      </CartaoConfig>
      <form onSubmit={salvar} className="space-y-4">
        <CartaoConfig icone="event_seat" titulo="Reservar vaga para solicitações pendentes" texto={TEXTO_RESERVAR_VAGA}>
          <InterruptorEstado
            rotulo="Reservar vaga para solicitações pendentes"
            ligado={f.reservar_vaga_pendentes}
            desabilitado={!podeEditar}
            aoMudar={(v) => set("reservar_vaga_pendentes", v)}
            ligadoIcone="event_seat"
            ligadoTexto="Reserva de vaga ativa"
            desligadoIcone="chair_alt"
            desligadoTexto="Sem reserva de vaga"
            ajuda={AJUDA_RESERVAR_VAGA}
          />
        </CartaoConfig>
        <CartaoConfig icone="sell" titulo="Aprovação automática por tag" texto={TEXTO_APROVAR_POR_TAG}>
          <SeletorTags
            tags={tags}
            selecionadas={f.aprovar_tags}
            desabilitado={!podeEditar}
            maximo={MAX_APROVAR_TAGS}
            aoMudar={(ids) => setF((a) => ({ ...a, aprovar_tags: ids, aprovar_por_tag: ids.length ? a.aprovar_por_tag : false }))}
          />
          <InterruptorEstado
            rotulo="Aprovar automaticamente por tag"
            ligado={tagHabilitada && f.aprovar_por_tag}
            desabilitado={!tagHabilitada}
            aoMudar={(v) => set("aprovar_por_tag", v)}
            ajuda={AJUDA_APROVAR_POR_TAG}
          />
        </CartaoConfig>
        <CartaoConfig icone="block" titulo="Recusa automática por bloqueio" texto="Recusa automaticamente números bloqueados (antispam, antispam global e blacklist).">
          <InterruptorEstado
            rotulo="Recusar automaticamente números bloqueados"
            ligado={f.recusar_bloqueados}
            desabilitado={!podeEditar}
            aoMudar={(v) => set("recusar_bloqueados", v)}
            ligadoIcone="shield"
            ligadoTexto="Recusa automática ativa"
            desligadoTexto="Recusa automática desligada"
          />
        </CartaoConfig>
        <CartaoConfig icone="how_to_reg" titulo="Aprovar automaticamente quem não está bloqueado">
          <InterruptorEstado
            rotulo="Aprovar automaticamente quem não está bloqueado"
            ligado={aprovacao && f.aprovar_automaticamente}
            desabilitado={!podeEditar || !aprovacao}
            aoMudar={(v) => set("aprovar_automaticamente", v)}
            ajuda={AJUDA_APROVAR_AUTOMATICAMENTE}
          />
        </CartaoConfig>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
        {mensagem && <p role="status" className="text-sm text-vg-text-2">{mensagem}</p>}
        {podeEditar && (
          <div className="flex justify-end">
            <Botao type="submit" disabled={salvando}>SALVAR</Botao>
          </div>
        )}
      </form>
    </div>
  );
}
