"use client";
import { useMemo, useRef, useState } from "react";
import {
  filtrarAdministrativos,
  ordenarAdministrativos,
  ROTULO_ORDEM_ADMINISTRATIVOS,
  type AdministrativoLinha,
  type OrdemAdministrativos,
} from "@/src/lib/regras/administrativos";
import { dataCsv } from "@/src/lib/regras/csv";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { Botao, Campo, estiloBotao, estiloInput, Tabela } from "../../_componentes/ui";
import { adicionarAdministrativo, excluirAdministrativos, importarAdministrativos } from "../actions";

type Msg = { texto: string; erro: boolean } | null;

/** Lista manual de Números administrativos: ADICIONAR, ADICIONAR CSV, EXPORTAR, Buscar, Ordenação, excluir por
 *  linha e em massa. A busca e a ordenação são feitas aqui (a página manda a lista inteira). */
export function ListaAdministrativos({ itens, podeEditar }: { itens: AdministrativoLinha[]; podeEditar: boolean }) {
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<OrdemAdministrativos>("alfabetica");
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [ocupado, setOcupado] = useState(false);
  const arquivo = useRef<HTMLInputElement>(null);

  const visiveis = useMemo(() => ordenarAdministrativos(filtrarAdministrativos(itens, busca), ordem), [itens, busca, ordem]);
  const tudoMarcado = visiveis.length > 0 && visiveis.every((i) => marcados.has(i.telefone));

  function alternar(tel: string, sim: boolean) {
    const s = new Set(marcados);
    if (sim) s.add(tel);
    else s.delete(tel);
    setMarcados(s);
  }

  function alternarTudo(sim: boolean) {
    const s = new Set(marcados);
    for (const i of visiveis) {
      if (sim) s.add(i.telefone);
      else s.delete(i.telefone);
    }
    setMarcados(s);
  }

  async function salvar() {
    setOcupado(true);
    try {
      const r = await adicionarAdministrativo(nome, telefone);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        setMsg({ texto: "Número administrativo adicionado.", erro: false });
        setAberto(false);
        setNome("");
        setTelefone("");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function importar(texto: string) {
    setOcupado(true);
    try {
      const r = await importarAdministrativos(texto);
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: r.resumo ?? "", erro: false });
    } finally {
      setOcupado(false);
    }
  }

  async function excluir(telefones: string[]) {
    if (!telefones.length) return;
    if (!window.confirm(`Excluir ${telefones.length} número(s) administrativo(s)? Eles voltam a poder ser removidos dos grupos.`)) return;
    setOcupado(true);
    try {
      const r = await excluirAdministrativos(telefones);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        setMsg({ texto: `${r.excluidos} número(s) excluído(s).`, erro: false });
        const s = new Set(marcados);
        for (const t of telefones) s.delete(t);
        setMarcados(s);
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium text-vg-text">Números administrativos</h2>
      <div className="flex flex-wrap items-center gap-2">
        <a href="/api/exportar/administrativos" className={estiloBotao("principal")}>
          <Icone nome="download" tamanho={16} />
          EXPORTAR
        </a>
        <Botao icone={<Icone nome="add" tamanho={16} />} onClick={() => setAberto(true)} disabled={!podeEditar || ocupado}>
          ADICIONAR
        </Botao>
        <Botao icone={<Icone nome="file_upload" tamanho={16} />} onClick={() => arquivo.current?.click()} disabled={!podeEditar || ocupado}>
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
            if (f) await importar(await f.text());
          }}
        />
        <Botao variante="perigo" icone={<Icone nome="delete" tamanho={16} />} onClick={() => excluir([...marcados])} disabled={!podeEditar || !marcados.size || ocupado}>
          Excluir
        </Botao>
      </div>
      <p className="text-xs text-vg-text-3">CSV com as colunas nome,telefone (até 5000 linhas).</p>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}

      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Buscar</span>
          <input className={estiloInput} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar" />
        </label>
        <label className="flex items-center gap-2 text-[13px] text-vg-text-2">
          Ordenação
          <select className={estiloInput} value={ordem} onChange={(e) => setOrdem(e.target.value === "criacao" ? "criacao" : "alfabetica")}>
            {(Object.keys(ROTULO_ORDEM_ADMINISTRATIVOS) as OrdemAdministrativos[]).map((o) => (
              <option key={o} value={o}>{ROTULO_ORDEM_ADMINISTRATIVOS[o]}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 px-1 text-[13px] text-vg-text-2">
        <input type="checkbox" checked={tudoMarcado} disabled={!visiveis.length || !podeEditar} onChange={(e) => alternarTudo(e.target.checked)} />
        Selecionar tudo ({marcados.size}/{visiveis.length})
      </label>
      <Tabela colunas={["", "Nome", "Telefone", "Criado em", ""]} vazio={visiveis.length ? undefined : "Nenhum registro encontrado"}>
        {visiveis.map((a) => (
          <tr key={a.telefone}>
            <td className="px-3 py-2.5">
              <input type="checkbox" checked={marcados.has(a.telefone)} disabled={!podeEditar} onChange={(e) => alternar(a.telefone, e.target.checked)} aria-label={`Selecionar ${telefoneLegivel(a.telefone)}`} />
            </td>
            <td className="px-3 py-2.5">{a.nome ?? "—"}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{telefoneLegivel(a.telefone)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(a.created_at)}</td>
            <td className="px-3 py-2.5 text-right">
              <button type="button" className="text-vg-muted hover:text-vg-erro disabled:opacity-50" onClick={() => excluir([a.telefone])} disabled={!podeEditar || ocupado} aria-label={`Excluir ${telefoneLegivel(a.telefone)}`}>
                <Icone nome="delete" tamanho={18} />
              </button>
            </td>
          </tr>
        ))}
      </Tabela>

      <Janela aberta={aberto} aoFechar={() => setAberto(false)} titulo="Adicionar número administrativo">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <Campo rotulo="Nome *">
            <input className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required />
          </Campo>
          <Campo rotulo="Telefone *" dica="BR: com DDD, com ou sem +55.">
            <input className={estiloInput} value={telefone} onChange={(e) => setTelefone(e.target.value)} inputMode="tel" required placeholder="(11) 9 1234-5678" />
          </Campo>
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="secundario" onClick={() => setAberto(false)} disabled={ocupado}>Fechar</Botao>
            <Botao type="submit" disabled={ocupado || !nome.trim() || !telefone.trim()}>Salvar</Botao>
          </div>
        </form>
      </Janela>
    </div>
  );
}
