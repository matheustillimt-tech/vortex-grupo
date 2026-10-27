"use client";
import { useMemo, useState } from "react";
import { CampoBusca } from "../../_componentes/campo-busca";
import { BotaoLink, estiloCartao, estiloInput, Tabela, Vazio } from "../../_componentes/ui";

export type WebhookLinhaConta = { id: string; nome: string; url: string; eventos: string[]; ativo: boolean };

type Status = "" | "ativo" | "inativo";

/** Aba "Webhooks" do detalhe da conta: busca (nome/URL) e filtro "Status" (Todas /
 *  Ativas / Desativadas), pela mesma coluna `ativo` que a lista de Hooks já usa. Tudo em memória — a lista
 *  já vem carregada da página. */
export function WebhooksDaConta({ webhooks }: { webhooks: WebhookLinhaConta[] }) {
  const [busca, setBusca] = useState("");
  const [status, setStatus] = useState<Status>("");

  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return webhooks
      .filter((w) => !b || w.nome.toLowerCase().includes(b) || w.url.toLowerCase().includes(b))
      .filter((w) => !status || (status === "ativo" ? w.ativo : !w.ativo));
  }, [webhooks, busca, status]);

  if (!webhooks.length) {
    return (
      <div className={estiloCartao}>
        <Vazio texto="Nenhum registro encontrado" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <CampoBusca valor={busca} aoMudar={setBusca} rotulo="Buscar webhooks" className="w-full max-w-sm" />
        <label className="flex items-center gap-2 text-sm text-vg-text">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={`${estiloInput} w-auto`} aria-label="Filtrar por status">
            <option value="">Todas</option>
            <option value="ativo">Ativos</option>
            <option value="inativo">Pausados</option>
          </select>
        </label>
      </div>

      {filtrados.length === 0 ? (
        <div className={estiloCartao}>
          <Vazio texto="Nenhum registro encontrado" />
        </div>
      ) : (
        <Tabela colunas={["Nome", "URL", "Eventos", ""]}>
          {filtrados.map((w) => (
            <tr key={w.id}>
              <td className="px-3 py-2.5 font-medium">{w.nome}</td>
              <td className="px-3 py-2.5 max-w-xs truncate text-vg-text-2" title={w.url}>{w.url}</td>
              <td className="px-3 py-2.5 text-vg-text-2">{w.eventos.join(", ")}</td>
              <td className="px-3 py-2.5">
                <BotaoLink href="/hooks" variante="secundario">Ver</BotaoLink>
              </td>
            </tr>
          ))}
        </Tabela>
      )}
    </div>
  );
}
