"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { dataCsv } from "@/src/lib/regras/csv";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { Botao, Campo, estiloInput, Tabela } from "../_componentes/ui";
import { alternarBlacklist, criarBlacklist, excluirBlacklist } from "./actions";

export type BlacklistLinha = { id: string; nome: string; ativa: boolean; created_at: string; numeros: number };

/** "CADASTRAR" (só o nome): cria e abre a lista nova pra colar os números. */
export function BotaoCadastrarBlacklist() {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function salvar() {
    setOcupado(true);
    setErro(null);
    try {
      const r = await criarBlacklist(nome);
      if (r.erro) setErro(r.erro);
      else if (r.id) {
        setAberta(false);
        setNome("");
        router.push(`/blacklists/${r.id}`);
      }
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <Botao icone={<Icone nome="add" tamanho={16} />} onClick={() => setAberta(true)}>
        CADASTRAR
      </Botao>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Blacklists">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}
        >
          <Campo rotulo="Nome *">
            <input className={estiloInput} value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} required placeholder="ex.: Golpistas conhecidos" />
          </Campo>
          {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
          <div className="flex justify-end gap-2">
            <Botao type="button" variante="secundario" onClick={() => setAberta(false)}>Fechar</Botao>
            <Botao type="submit" disabled={ocupado || !nome.trim()}>Salvar</Botao>
          </div>
        </form>
      </Janela>
    </>
  );
}

export function ListaBlacklists({ itens, podeEditar }: { itens: BlacklistLinha[]; podeEditar: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);

  async function rodar(f: () => Promise<{ erro?: string }>, ok: string) {
    setOcupado(true);
    try {
      const r = await f();
      setMsg(r.erro ? { texto: r.erro, erro: true } : { texto: ok, erro: false });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-vg-muted">
        Números de uma lista ativa contam como bloqueados no Anti-spam: quem entrar num grupo é removido (nunca admin nem número conectado).
      </p>
      {msg && <p role={msg.erro ? "alert" : "status"} className={`text-sm ${msg.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg.texto}</p>}
      <Tabela colunas={["Nome", "Números", "Ativa", "Criada em", ""]} vazio={itens.length ? undefined : "Nenhum registro encontrado"}>
        {itens.map((l) => (
          <tr key={l.id}>
            <td className="px-3 py-2.5">
              <Link href={`/blacklists/${l.id}`} className="text-vg-text hover:text-vg-accent hover:underline">{l.nome}</Link>
            </td>
            <td className="px-3 py-2.5 tabular-nums text-vg-text-2">{l.numeros.toLocaleString("pt-BR")}</td>
            <td className="px-3 py-2.5">
              <button
                type="button"
                role="switch"
                aria-checked={l.ativa}
                aria-label={`${l.nome}: ${l.ativa ? "ativa" : "inativa"}`}
                disabled={!podeEditar || ocupado}
                onClick={() =>
                  rodar(
                    () => alternarBlacklist(l.id, !l.ativa),
                    l.ativa ? `"${l.nome}" desativada.` : `"${l.nome}" ativada. Quem já está nos grupos sai ao usar "Analisar grupos" no Anti-spam.`,
                  )
                }
                className="flex items-center disabled:opacity-50"
              >
                <span aria-hidden className={`relative h-5 w-9 rounded-full transition-colors ${l.ativa ? "bg-vg-accent/60" : "bg-white/20"}`}>
                  <span className={`absolute top-0.5 size-4 rounded-full transition-all ${l.ativa ? "left-[18px] bg-vg-accent" : "left-0.5 bg-[#b4bdb7]"}`} />
                </span>
              </button>
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(l.created_at)}</td>
            <td className="px-3 py-2.5 text-right">
              {podeEditar && (
                <button
                  type="button"
                  aria-label={`Excluir ${l.nome}`}
                  disabled={ocupado}
                  onClick={() => {
                    if (window.confirm(`Excluir a blacklist "${l.nome}" e os ${l.numeros} número(s) dela?`)) void rodar(() => excluirBlacklist(l.id), `"${l.nome}" excluída.`);
                  }}
                  className="text-vg-muted hover:text-vg-erro disabled:opacity-50"
                >
                  <Icone nome="delete" tamanho={18} />
                </button>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
