"use client";
import { createContext, useContext, useMemo, useRef, useState } from "react";
import { dataCsv } from "@/src/lib/regras/csv";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Paginacao } from "../_componentes/paginacao";
import { AJUDA_GOLPISTA } from "@/src/lib/regras/administrativos";
import { Botao, Campo, estiloBotao, estiloInput, Selo, Tabela } from "../_componentes/ui";
import { analisarGrupos, bloquearVarios, desbloquearVarios } from "../leads/actions";
import { adicionarNumeroBloqueado, desbloquearBloqueados } from "./actions";
import { ROTULO_ORIGEM } from "./comum";

export type BloqueadoLinha = {
  telefone: string;
  nome: string | null;
  motivo: string | null;
  origem: string;
  created_at: string;
  /** Etapa 3K, Tarefa 6 (ausentes nas linhas antigas = sem chip). */
  lid?: string | null;
  golpista?: boolean;
};

// ---------- Seleção compartilhada entre a barra de ações e a tabela ----------

type ContextoSelecaoBloqueados = {
  itens: BloqueadoLinha[];
  marcados: Set<string>;
  setMarcados: (s: Set<string>) => void;
};
const ContextoBloqueados = createContext<ContextoSelecaoBloqueados>({ itens: [], marcados: new Set(), setMarcados: () => {} });

/** Só conta como marcado o que está na página atual: trocar de filtro/página começa do zero. */
export function ProvedorBloqueados({ itens, children }: { itens: BloqueadoLinha[]; children: React.ReactNode }) {
  const [brutos, setMarcados] = useState<Set<string>>(new Set());
  const marcados = useMemo(() => new Set([...brutos].filter((t) => itens.some((i) => i.telefone === t))), [brutos, itens]);
  return <ContextoBloqueados.Provider value={{ itens, marcados, setMarcados }}>{children}</ContextoBloqueados.Provider>;
}

/** Interruptor do diálogo "Adicionar número" (mesmo desenho dos outros interruptores do painel). */
function Chave({ ligado, aoMudar, rotulo, ajuda, desabilitado }: { ligado: boolean; aoMudar: (v: boolean) => void; rotulo: string; ajuda?: string; desabilitado?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={desabilitado}
        onClick={() => aoMudar(!ligado)}
        className="mt-0.5 flex items-center disabled:opacity-50"
      >
        <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${ligado ? "bg-vg-accent/60" : "bg-white/20"}`}>
          <span className={`absolute top-0.5 size-4 rounded-full transition-all ${ligado ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
        </span>
      </button>
      <div>
        <p className="text-sm text-vg-text">{rotulo}</p>
        {ajuda && <p className="text-xs text-vg-muted">{ajuda}</p>}
      </div>
    </div>
  );
}
type Msg = { texto: string; erro: boolean } | null;

/** Botões de ação (analisar, exportar, adicionar, adicionar CSV, excluir) **acima** da busca. A seleção
 *  usada por "EXCLUIR" vem do contexto (`ProvedorBloqueados`), compartilhado com `TabelaBloqueados`. */
export function BarraAcoesBloqueados({ exportarHref }: { exportarHref: string }) {
  const { itens, marcados, setMarcados } = useContext(ContextoBloqueados);
  const [janelaAberta, setJanelaAberta] = useState(false);
  const [umAberto, setUmAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [porLid, setPorLid] = useState(false);
  const [golpista, setGolpista] = useState(false);
  const [desbloquearAberto, setDesbloquearAberto] = useState(false);
  const [tambemWhatsApp, setTambemWhatsApp] = useState(false);
  const [texto, setTexto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  /** Onde a análise parou (último telefone conferido) quando a anterior foi parcial: o próximo clique continua dali. */
  const [continuarDe, setContinuarDe] = useState<string | undefined>(undefined);
  const arquivo = useRef<HTMLInputElement>(null);

  async function analisar() {
    setOcupado(true);
    try {
      const r = await analisarGrupos(continuarDe);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else if (r.resumo) {
        const partes = [`${r.resumo.processados} conferido(s)`, `${r.resumo.remocoes} remoção(ões) na fila`];
        if (r.resumo.parcial) partes.push("parcial: clique de novo para continuar de onde parou");
        else if (continuarDe) partes.push("análise concluída");
        setContinuarDe(r.resumo.parcial ? (r.resumo.proximo ?? continuarDe) : undefined);
        setMsg({ texto: partes.join(" · "), erro: false });
      }
    } finally {
      setOcupado(false);
    }
  }

  async function enviar(conteudo: string, origem: "manual" | "csv", motivoPadrao: string) {
    setOcupado(true);
    try {
      const r = await bloquearVarios(conteudo, motivoPadrao, origem);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else if (r.resumo) {
        const partes = [`${r.resumo.novos} bloqueado(s)`, `${r.resumo.jaEstavam} já estava(m)`, `${r.resumo.remocoes} remoção(ões) na fila`];
        if (r.resumo.ignorados.length) partes.push(`${r.resumo.ignorados.length} conectado(s) no sistema ignorado(s)`);
        if (r.resumo.administrativos?.length) partes.push(`${r.resumo.administrativos.length} número(s) administrativo(s) recusado(s)`);
        if (r.resumo.invalidos.length) partes.push(`inválidos: ${r.resumo.invalidos.slice(0, 10).join(", ")}${r.resumo.invalidos.length > 10 ? "…" : ""}`);
        setMsg({ texto: partes.join(" · "), erro: false });
        setJanelaAberta(false);
        setTexto("");
        setMotivo("");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function adicionarUm() {
    setOcupado(true);
    try {
      const r = await adicionarNumeroBloqueado(nome, telefone, { porLid, golpista });
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else if (r.resumo) {
        const partes = [r.resumo.novos ? "Número bloqueado" : "Esse número já estava bloqueado", `${r.resumo.remocoes} remoção(ões) na fila`];
        if (golpista) partes.push(`bloqueio no WhatsApp de ${r.contas ?? 0} conexão(ões) na fila`);
        setMsg({ texto: partes.join(" · "), erro: false });
        setUmAberto(false);
        setNome("");
        setTelefone("");
        setPorLid(false);
        setGolpista(false);
      }
    } finally {
      setOcupado(false);
    }
  }

  const golpistasMarcados = itens.filter((i) => i.golpista && marcados.has(i.telefone)).length;

  /** Golpista entre os escolhidos: abre o diálogo com a caixa "Também desbloquear no WhatsApp das contas". */
  async function excluir() {
    if (!marcados.size) return;
    if (golpistasMarcados) {
      setTambemWhatsApp(false);
      setDesbloquearAberto(true);
      return;
    }
    if (!window.confirm(`Desbloquear ${marcados.size} número(s)?`)) return;
    setOcupado(true);
    try {
      const r = await desbloquearVarios([...marcados]);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        setMsg({ texto: `${r.desbloqueados} número(s) desbloqueado(s).`, erro: false });
        setMarcados(new Set());
      }
    } finally {
      setOcupado(false);
    }
  }

  async function excluirComGolpistas() {
    setOcupado(true);
    try {
      const r = await desbloquearBloqueados([...marcados], tambemWhatsApp);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        const partes = [`${r.desbloqueados} número(s) desbloqueado(s).`];
        if (r.contas) partes.push(`${r.contas} desbloqueio(s) no WhatsApp das conexões na fila.`);
        setMsg({ texto: partes.join(" "), erro: false });
        setMarcados(new Set());
        setDesbloquearAberto(false);
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Botao icone={<Icone nome="refresh" tamanho={16} />} onClick={analisar} disabled={ocupado}>
          {continuarDe ? "CONTINUAR ANÁLISE" : "ANALISAR GRUPOS"}
        </Botao>
        <a href={exportarHref} className={estiloBotao("principal")}>
          <Icone nome="download" tamanho={16} />
          EXPORTAR
        </a>
        <Botao icone={<Icone nome="add" tamanho={16} />} onClick={() => setUmAberto(true)} disabled={ocupado}>
          ADICIONAR
        </Botao>
        <Botao icone={<Icone nome="playlist_add" tamanho={16} />} onClick={() => setJanelaAberta(true)} disabled={ocupado}>
          COLAR LISTA
        </Botao>
        <Botao icone={<Icone nome="file_upload" tamanho={16} />} onClick={() => arquivo.current?.click()} disabled={ocupado}>
          ADICIONAR CSV
        </Botao>
        <input
          ref={arquivo}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) await enviar(await f.text(), "csv", "");
          }}
        />
        <Botao variante="perigo" icone={<Icone nome="delete" tamanho={16} />} onClick={excluir} disabled={!marcados.size || ocupado}>
          EXCLUIR
        </Botao>
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}

      <Janela aberta={umAberto} aoFechar={() => setUmAberto(false)} titulo="Adicionar número">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void adicionarUm();
          }}
        >
          <Campo rotulo="Nome *">
            <input className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required placeholder="ex.: Golpista do link" />
          </Campo>
          <Campo rotulo={porLid ? "Telefone ou LID *" : "Telefone *"} dica={porLid ? "O LID (id do WhatsApp que esconde o número) é descoberto por uma conexão conectada: os dois ficam bloqueados." : "BR: com DDD, com ou sem +55."}>
            <input className={estiloInput} value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode={porLid ? "text" : "tel"} required placeholder={porLid ? "(11) 9 1234-5678 ou 123456789012345@lid" : "(11) 9 1234-5678"} />
          </Campo>
          <Chave ligado={porLid} aoMudar={setPorLid} rotulo="Bloquear por LID" desabilitado={ocupado} />
          <Chave ligado={golpista} aoMudar={setGolpista} rotulo="Denunciar golpista" ajuda={AJUDA_GOLPISTA} desabilitado={ocupado} />
          <Botao type="submit" disabled={ocupado || !nome.trim() || !telefone.trim()} className="w-full">
            Salvar
          </Botao>
        </form>
      </Janela>

      <Janela aberta={desbloquearAberto} aoFechar={() => setDesbloquearAberto(false)} titulo="Desbloquear números">
        <div className="space-y-3">
          <p className="text-sm text-vg-text-2">
            Desbloquear {marcados.size} número(s)? {golpistasMarcados} deles está(ão) marcado(s) como golpista e bloqueado(s) no WhatsApp das conexões.
          </p>
          <label className="flex items-center gap-2 text-sm text-vg-text">
            <input type="checkbox" checked={tambemWhatsApp} onChange={(e) => setTambemWhatsApp(e.target.checked)} />
            Também desbloquear no WhatsApp das conexões
          </label>
          <div className="flex justify-end gap-2">
            <Botao variante="secundario" onClick={() => setDesbloquearAberto(false)} disabled={ocupado}>Fechar</Botao>
            <Botao variante="perigo" onClick={excluirComGolpistas} disabled={ocupado}>Desbloquear</Botao>
          </div>
        </div>
      </Janela>

      <Janela aberta={janelaAberta} aoFechar={() => setJanelaAberta(false)} titulo="Adicionar números bloqueados">
        <div className="space-y-3">
          <Campo rotulo="Números" dica="Um por linha, com ou sem +55, espaços e traços.">
            <textarea className={`${estiloInput} min-h-28 font-mono`} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"(11) 9 1234-5678\n21 9 8765-4321"} />
          </Campo>
          <Campo rotulo="Motivo">
            <input className={estiloInput} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="ex.: spam de link" />
          </Campo>
          <Botao onClick={() => enviar(texto, "manual", motivo)} disabled={ocupado || !texto.trim()} className="w-full">
            Bloquear
          </Botao>
        </div>
      </Janela>
    </div>
  );
}

/** Tabela de bloqueados com seleção. A seleção compartilha o contexto
 *  com `BarraAcoesBloqueados` (o "EXCLUIR" dela usa os mesmos marcados). */
export function TabelaBloqueados({ total, de, ate, porPagina, anterior, proxima }: {
  total: number;
  de: number;
  ate: number;
  porPagina: number;
  anterior?: string;
  proxima?: string;
}) {
  const { itens, marcados, setMarcados } = useContext(ContextoBloqueados);
  const tudoMarcado = itens.length > 0 && itens.every((i) => marcados.has(i.telefone));

  function alternarTudo(sim: boolean) {
    const s = new Set(marcados);
    for (const i of itens) {
      if (sim) s.add(i.telefone);
      else s.delete(i.telefone);
    }
    setMarcados(s);
  }

  function alternar(telefone: string, sim: boolean) {
    const s = new Set(marcados);
    if (sim) s.add(telefone);
    else s.delete(telefone);
    setMarcados(s);
  }

  return (
    <div className="space-y-3">
      <Paginacao de={de} ate={ate} total={total} porPagina={porPagina} anterior={anterior} proxima={proxima} />
      <div className="space-y-2">
        <label className="flex items-center gap-2 px-1 text-[13px] text-vg-text-2">
          <input type="checkbox" checked={tudoMarcado} disabled={!itens.length} onChange={(e) => alternarTudo(e.target.checked)} />
          Selecionar tudo ({marcados.size}/{itens.length})
        </label>
        <Tabela colunas={["", "Nome", "Telefone", "Motivo", "Origem", "Quando"]} vazio={itens.length ? undefined : "Nenhum registro encontrado"}>
          {itens.map((b) => (
            <tr key={b.telefone}>
              <td className="px-3 py-2.5">
                <input type="checkbox" checked={marcados.has(b.telefone)} onChange={(e) => alternar(b.telefone, e.target.checked)} aria-label={`Selecionar ${telefoneLegivel(b.telefone)}`} />
              </td>
              <td className="px-3 py-2.5">
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  {b.nome ?? "—"}
                  {b.lid && <Selo cor="neutro" semPonto>LID</Selo>}
                  {b.golpista && <Selo cor="erro" semPonto>Golpista</Selo>}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{telefoneLegivel(b.telefone)}</td>
              <td className="px-3 py-2.5 text-vg-text-2">{b.motivo ?? "—"}</td>
              <td className="px-3 py-2.5 text-vg-muted">{ROTULO_ORIGEM[b.origem] ?? b.origem}</td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(b.created_at)}</td>
            </tr>
          ))}
        </Tabela>
      </div>
    </div>
  );
}
