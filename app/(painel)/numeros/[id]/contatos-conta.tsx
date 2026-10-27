"use client";
import { useEffect, useMemo, useState } from "react";
import { CadastrarLead } from "../../leads/cadastrar";
import { Icone } from "../../_componentes/icone";
import { MenuCartao } from "../../_componentes/menu-cartao";
import { estiloInput, Tabela, Vazio } from "../../_componentes/ui";
import { cadastrarContatoComoLead, listarContatosConta, type ContatoDaConta } from "./actions";

const POR_PAGINA = 25;
const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const soDigitos = (s: string) => s.replace(/\D/g, "");

/** Busca por nome ou número (aba "Contatos", Etapa 3K Tarefa 4) — função pura, testável sem montar o componente. */
export function filtrarContatos(contatos: ContatoDaConta[], busca: string): ContatoDaConta[] {
  const b = busca.trim();
  if (!b) return contatos;
  const digitos = soDigitos(b);
  const semAc = semAcento(b);
  return contatos.filter((c) => (digitos && c.phone.includes(digitos)) || semAcento(c.nome).includes(semAc));
}

type Tag = { id: string; nome: string };
type Estado = { tipo: "carregando" } | { tipo: "erro"; mensagem: string } | { tipo: "ok"; contatos: ContatoDaConta[] };

/**
 * Aba "Contatos" (nova, primeira à esquerda — Etapa 3K Tarefa 4): lida ao vivo do Zapbot, sem
 * tabela de cache. Busca por nome/número e paginação de 25 em memória (a lista inteira já cabe numa chamada —
 * `z.contatos` não pagina). "Cadastrar como lead" grava em `contatos` sem sobrescrever nome já existente;
 * "ADICIONAR" reusa o diálogo "Cadastrar" de Leads (o contato entra nos Leads do Vórtex Grupo, não na agenda do
 * celular — por isso a nota ao lado do botão).
 */
export function ContatosConta({ contaId, conectada, tags }: { contaId: string; conectada: boolean; tags: Tag[] }) {
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(1);
  const [vez, setVez] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!conectada) return;
    setEstado({ tipo: "carregando" });
    listarContatosConta(contaId).then(
      (r) => setEstado(r.erro ? { tipo: "erro", mensagem: r.erro } : { tipo: "ok", contatos: r.contatos ?? [] }),
      () => setEstado({ tipo: "erro", mensagem: "Não foi possível ler os contatos agora." }),
    );
  }, [contaId, conectada, vez]);

  const contatos = estado.tipo === "ok" ? estado.contatos : [];
  const filtrados = useMemo(() => filtrarContatos(contatos, busca), [contatos, busca]);
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / POR_PAGINA));
  const paginaSegura = Math.min(pagina, totalPaginas);
  const visiveis = filtrados.slice((paginaSegura - 1) * POR_PAGINA, paginaSegura * POR_PAGINA);

  async function cadastrarComoLead(c: ContatoDaConta) {
    setMsg(null);
    const r = await cadastrarContatoComoLead(c.phone, c.nome || null);
    setMsg(r.erro ?? "Lead cadastrado.");
  }

  if (!conectada) {
    return (
      <div className="rounded-xl border border-vg-line">
        <Vazio texto="Conecte a conexão para ver os contatos." />
      </div>
    );
  }
  if (estado.tipo === "carregando") {
    return <p className="text-sm text-vg-muted">Carregando contatos…</p>;
  }
  if (estado.tipo === "erro") {
    return (
      <div className="rounded-xl border border-vg-line">
        <Vazio
          texto={estado.mensagem}
          acao={<button type="button" className="text-sm font-medium text-vg-accent hover:underline" onClick={() => setVez((v) => v + 1)}>Tentar de novo</button>}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium">{contatos.length} contato{contatos.length === 1 ? "" : "s"}</h2>
        <div className="flex items-center gap-2">
          <CadastrarLead tags={tags} />
        </div>
      </div>
      <p className="text-xs text-vg-muted">O contato é salvo nos Leads do Vórtex Grupo, não na agenda do celular.</p>

      <label className="relative block w-full max-w-sm">
        <Icone nome="search" tamanho={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-vg-text-3" />
        <input
          type="search"
          value={busca}
          onChange={(e) => {
            setBusca(e.target.value);
            setPagina(1);
          }}
          placeholder="Buscar"
          aria-label="Buscar contatos"
          className={`${estiloInput} pl-9`}
        />
      </label>

      {msg && <p role="status" className="text-sm text-vg-muted">{msg}</p>}

      {!visiveis.length ? (
        <div className="rounded-xl border border-vg-line">
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <Tabela colunas={["Nome", "Número", ""]}>
          {visiveis.map((c) => (
            <tr key={c.phone}>
              <td className="px-3 py-2.5 font-medium">{c.nome || "—"}</td>
              <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{c.phone}</td>
              <td className="w-10 px-3 py-2.5">
                <MenuCartao itens={[{ rotulo: "Cadastrar como lead", icone: "person_add", onClick: () => cadastrarComoLead(c) }]} />
              </td>
            </tr>
          ))}
        </Tabela>
      )}
      <p className="text-xs text-vg-muted">O Zapbot não informa conexões verificadas.</p>

      {filtrados.length > POR_PAGINA && (
        <div className="flex items-center justify-end gap-3 text-sm text-vg-text-2">
          <button type="button" disabled={paginaSegura <= 1} onClick={() => setPagina((p) => p - 1)} className="font-medium text-vg-accent disabled:pointer-events-none disabled:opacity-40">
            Anterior
          </button>
          <span className="tabular-nums">{paginaSegura} / {totalPaginas}</span>
          <button type="button" disabled={paginaSegura >= totalPaginas} onClick={() => setPagina((p) => p + 1)} className="font-medium text-vg-accent disabled:pointer-events-none disabled:opacity-40">
            Próxima
          </button>
        </div>
      )}
    </div>
  );
}
