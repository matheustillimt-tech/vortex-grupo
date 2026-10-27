"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Icone } from "../../_componentes/icone";
import { estiloBotao } from "../../_componentes/ui";
import { arquivarCampanha, duplicarCampanha, fixarCampanha } from "../actions";
import { EditarCampanha, type CampanhaParaEditar } from "./editar-campanha";
import { ExcluirCampanha } from "./excluir-campanha";
import type { CampanhaVisao } from "./visao-geral";

const ITEM = "flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-vg-text transition-colors hover:bg-white/5";
const ITEM_PERIGO = "flex w-full items-center gap-2 px-4 py-2 text-left text-[13px] text-vg-erro transition-colors hover:bg-vg-erro/10";

/** Botão "CONFIGURAÇÕES ›" da Visão geral: Duplicar, Fixar/Desafixar, Arquivar/Desarquivar, Editar
 *  (diálogo), Configurações avançadas (a página de sempre, com link, nome dos grupos, admins…) e Excluir
 *  (vermelho, diálogo próprio). */
export function MenuConfiguracoes({ campanha, projetos }: { campanha: CampanhaVisao; projetos: { id: string; nome: string }[] }) {
  const router = useRouter();
  const idMenu = useId();
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);

  // Fecha no clique fora ou Esc.
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

  async function duplicar() {
    setAberto(false);
    setEnviando(true);
    const r = await duplicarCampanha(campanha.id);
    setEnviando(false);
    setErro(r?.erro ?? null);
  }

  async function fixar() {
    setAberto(false);
    setEnviando(true);
    const r = await fixarCampanha(campanha.id, !campanha.fixada);
    setEnviando(false);
    setErro(r.erro ?? null);
    if (!r.erro) router.refresh();
  }

  async function alternarArquivo() {
    setAberto(false);
    if (!campanha.arquivada && !confirm("Arquivar esta campanha? O link para de funcionar.")) return;
    setEnviando(true);
    const r = await arquivarCampanha(campanha.id, !campanha.arquivada);
    setEnviando(false);
    setErro(r.erro ?? null);
    if (!r.erro) router.refresh();
  }

  const inicialEditar: CampanhaParaEditar = {
    nome: campanha.nome,
    slug: campanha.slug,
    padrao_nome: campanha.padrao_nome,
    descricao: campanha.descricao ?? "",
    fechado: campanha.fechado,
    limite_por_grupo: campanha.limite_por_grupo,
    folga: campanha.folga,
    conexao_criadora_id: campanha.conexao_criadora_id,
    admins: campanha.admins,
    usar_comunidade: campanha.usar_comunidade,
    crm_webhook_url: campanha.crm_webhook_url,
    projeto_id: campanha.projeto_id,
    tipo: campanha.tipo,
    termina_em: campanha.termina_em,
    link_apos_termino: campanha.link_apos_termino,
  };

  return (
    <div ref={caixa} className="relative">
      <button
        ref={botao}
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        disabled={enviando}
        className={estiloBotao("principal")}
      >
        CONFIGURAÇÕES
        <Icone nome="chevron_right" tamanho={18} />
      </button>
      {aberto && (
        <div id={idMenu} className="absolute left-0 top-full z-40 mt-2 min-w-52 rounded-lg border border-vg-line bg-vg-panel py-1 shadow-lg">
          <button type="button" onClick={duplicar} className={ITEM}>
            <Icone nome="content_copy" tamanho={16} /> Duplicar
          </button>
          <button type="button" onClick={fixar} className={ITEM}>
            <span className="inline-block size-4" aria-hidden /> {campanha.fixada ? "Desafixar" : "Fixar no topo"}
          </button>
          <button type="button" onClick={alternarArquivo} className={ITEM}>
            <Icone nome={campanha.arquivada ? "unarchive" : "archive"} tamanho={16} /> {campanha.arquivada ? "Desarquivar" : "Arquivar"}
          </button>
          <button type="button" onClick={() => { setAberto(false); setEditando(true); }} className={ITEM}>
            <Icone nome="edit" tamanho={16} /> Editar
          </button>
          <Link href={`/campanhas/${campanha.id}/configuracoes`} className={ITEM} onClick={() => setAberto(false)}>
            <Icone nome="tune" tamanho={16} /> Configurações avançadas
          </Link>
          <button type="button" onClick={() => { setAberto(false); setExcluindo(true); }} className={ITEM_PERIGO}>
            <Icone nome="delete" tamanho={16} /> Excluir
          </button>
        </div>
      )}
      {erro && <p role="alert" className="mt-2 text-xs text-vg-erro">{erro}</p>}

      <EditarCampanha id={campanha.id} aberta={editando} aoFechar={() => setEditando(false)} inicial={inicialEditar} projetos={projetos} />
      <ExcluirCampanha id={campanha.id} nome={campanha.nome} aberta={excluindo} aoFechar={() => setExcluindo(false)} />
    </div>
  );
}
