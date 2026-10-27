"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Papel } from "@/src/lib/regras/permissoes";
import { Janela } from "../_componentes/janela";
import { estiloAcao, estiloBotao, estiloInput, Selo, Tabela } from "../_componentes/ui";
import { editarMembro, removerAcesso } from "./actions";
import type { MembroListado } from "./comum";

/** Recarrega a página (ação "ATUALIZAR" da aba Equipe). */
export function BotaoAtualizar() {
  const router = useRouter();
  return (
    <button type="button" className={estiloBotao("contorno")} onClick={() => router.refresh()}>
      ATUALIZAR
    </button>
  );
}

function JanelaEditarMembro({ membro, aoFechar }: { membro: MembroListado; aoFechar: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState(membro.nome);
  const [papel, setPapel] = useState<Papel>(membro.papel);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await editarMembro(membro.id, { nome, papel });
        if (r.erro) return setErro(r.erro);
        aoFechar();
        router.refresh();
      } catch {
        setErro("Não foi possível salvar. Tente de novo.");
      }
    });
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Editar pessoa">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome</span>
          <input className={estiloInput} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} autoFocus />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-[13.3px] text-[#e3e9e5]">Papel</legend>
          <label className="flex items-center gap-2 text-sm text-vg-text">
            <input type="radio" name="papel" checked={papel === "admin"} onChange={() => setPapel("admin")} />
            Administrador
          </label>
          <label className="flex items-center gap-2 text-sm text-vg-text">
            <input type="radio" name="papel" checked={papel === "membro"} onChange={() => setPapel("membro")} />
            Membro
          </label>
        </fieldset>
        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>CANCELAR</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !nome.trim()}>
            {ocupado ? "Salvando…" : "SALVAR"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function ListaEquipe({ membros, euId }: { membros: MembroListado[]; euId: string }) {
  const router = useRouter();
  const [editando, setEditando] = useState<MembroListado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function remover(m: MembroListado) {
    if (!window.confirm(`Remover o acesso de "${m.nome}"? Não dá pra desfazer.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await removerAcesso(m.id);
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível remover. Tente de novo.");
      }
    });
  }

  return (
    <>
      <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <Tabela colunas={["Nome", "E-mail", "Papel", "Último acesso", ""]} vazio={membros.length ? undefined : "Nenhum resultado encontrado"}>
        {membros.map((m) => (
          <tr key={m.id}>
            <td className="px-3 py-2.5">{m.nome}</td>
            <td className="px-3 py-2.5 text-vg-muted">{m.email ?? "—"}</td>
            <td className="px-3 py-2.5">
              <Selo cor={m.papel === "admin" ? "destaque" : "neutro"}>{m.papel === "admin" ? "Administrador" : "Membro"}</Selo>
              {!m.temAcesso && <span className="ml-2 text-xs text-vg-muted">Sem acesso</span>}
            </td>
            <td className="px-3 py-2.5 tabular-nums text-vg-muted">
              {m.ultimoAcesso ? new Date(m.ultimoAcesso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "ainda não entrou"}
            </td>
            <td className="px-3 py-2.5 text-right">
              <div className="flex items-center justify-end gap-3">
                <button type="button" className={estiloAcao.normal} disabled={ocupado} onClick={() => setEditando(m)}>Editar</button>
                {m.id === euId ? (
                  <span className="text-xs text-vg-muted">você</span>
                ) : (
                  <button type="button" className={estiloAcao.perigo} disabled={ocupado} onClick={() => remover(m)}>Remover</button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </Tabela>
      {editando && <JanelaEditarMembro key={editando.id} membro={editando} aoFechar={() => setEditando(null)} />}
    </>
  );
}
