"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dataCsv } from "@/src/lib/regras/csv";
import { telefoneLegivel } from "@/src/lib/telefone";
import { Icone } from "../../_componentes/icone";
import { Janela } from "../../_componentes/janela";
import { Paginacao } from "../../_componentes/paginacao";
import { Botao, Campo, estiloBotao, estiloInput, Tabela } from "../../_componentes/ui";
import { CampoBusca } from "../../_componentes/campo-busca";
import { adicionarNumerosBlacklist, removerNumerosBlacklist } from "../actions";

export type NumeroLinha = { telefone: string; created_at: string };

export function NumerosBlacklist({ id, itens, busca, podeEditar, ativa, paginacao }: {
  id: string;
  itens: NumeroLinha[];
  busca: string | null;
  podeEditar: boolean;
  ativa: boolean;
  paginacao: { de: number; ate: number; total: number; porPagina: number; anterior?: string; proxima?: string };
}) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState(false);
  const [texto, setTexto] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  const tudoMarcado = itens.length > 0 && itens.every((i) => marcados.has(i.telefone));

  function alternar(telefone: string, sim: boolean) {
    const s = new Set(marcados);
    if (sim) s.add(telefone);
    else s.delete(telefone);
    setMarcados(s);
  }

  async function adicionar() {
    setOcupado(true);
    try {
      const r = await adicionarNumerosBlacklist(id, texto);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else if (r.resumo) {
        const partes = [`${r.resumo.novos} adicionado(s)`, `${r.resumo.jaEstavam} já estava(m)`];
        if (ativa) partes.push(`${r.resumo.remocoes} remoção(ões) na fila`);
        if (r.resumo.ignorados) partes.push(`${r.resumo.ignorados} conectado(s) no sistema ignorado(s)`);
        if (r.resumo.invalidos.length) partes.push(`inválidos: ${r.resumo.invalidos.slice(0, 10).join(", ")}${r.resumo.invalidos.length > 10 ? "…" : ""}`);
        setMsg({ texto: partes.join(" · "), erro: false });
        setAberta(false);
        setTexto("");
      }
    } finally {
      setOcupado(false);
    }
  }

  async function remover() {
    if (!marcados.size || !window.confirm(`Tirar ${marcados.size} número(s) da lista?`)) return;
    setOcupado(true);
    try {
      const r = await removerNumerosBlacklist(id, [...marcados]);
      if (r.erro) setMsg({ texto: r.erro, erro: true });
      else {
        setMsg({ texto: `${r.removidos} número(s) tirado(s) da lista.`, erro: false });
        setMarcados(new Set());
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="w-full max-w-xs"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = String(new FormData(e.currentTarget).get("q") ?? "").replace(/\D/g, "");
            router.push(q ? `/blacklists/${id}?q=${q}` : `/blacklists/${id}`, { scroll: false });
          }}
        >
          <CampoBusca key={busca ?? ""} valorInicial={busca ?? ""} inputMode="numeric" rotulo="Buscar número na blacklist" />
        </form>
        <a href={`/api/exportar/blacklists/${id}`} className={estiloBotao("principal")}>
          <Icone nome="download" tamanho={16} />
          EXPORTAR
        </a>
        {podeEditar && (
          <>
            <Botao icone={<Icone nome="add" tamanho={16} />} onClick={() => setAberta(true)} disabled={ocupado}>
              ADICIONAR
            </Botao>
            <Botao variante="perigo" icone={<Icone nome="delete" tamanho={16} />} onClick={remover} disabled={!marcados.size || ocupado}>
              REMOVER
            </Botao>
          </>
        )}
      </div>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}

      <Paginacao {...paginacao} />

      <div className="space-y-2">
        {podeEditar && (
          <label className="flex items-center gap-2 px-1 text-[13px] text-vg-text-2">
            <input
              type="checkbox"
              checked={tudoMarcado}
              disabled={!itens.length}
              onChange={(e) => {
                const s = new Set(marcados);
                for (const i of itens) {
                  if (e.target.checked) s.add(i.telefone);
                  else s.delete(i.telefone);
                }
                setMarcados(s);
              }}
            />
            Selecionar tudo ({marcados.size}/{itens.length})
          </label>
        )}
        <Tabela colunas={podeEditar ? ["", "Telefone", "Adicionado em"] : ["Telefone", "Adicionado em"]} vazio={itens.length ? undefined : "Nenhum registro encontrado"}>
          {itens.map((n) => (
            <tr key={n.telefone}>
              {podeEditar && (
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={marcados.has(n.telefone)} onChange={(e) => alternar(n.telefone, e.target.checked)} aria-label={`Selecionar ${telefoneLegivel(n.telefone)}`} />
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{telefoneLegivel(n.telefone)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(n.created_at)}</td>
            </tr>
          ))}
        </Tabela>
      </div>

      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Adicionar números">
        <div className="space-y-3">
          <Campo rotulo="Números" dica="Um por linha, com ou sem +55, espaços e traços. Até 5000 por vez.">
            <textarea className={`${estiloInput} min-h-40 font-mono`} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={"(11) 9 1234-5678\n21 9 8765-4321"} />
          </Campo>
          <Botao onClick={adicionar} disabled={ocupado || !texto.trim()} className="w-full">
            Adicionar
          </Botao>
        </div>
      </Janela>
    </div>
  );
}
