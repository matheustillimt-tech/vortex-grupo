"use client";
import { hostDoSite } from "@/src/lib/site";
import { useState } from "react";
import type { CampanhaEntrada } from "@/src/lib/regras/campanha";
import { Botao, Campo, estiloCartao, estiloInput } from "../_componentes/ui";
import { salvarCampanha } from "./actions";

type Conexao = { id: string; nome: string; status: string };
type ProjetoOpcao = { id: string; nome: string };

export const CAMPANHA_VAZIA: CampanhaEntrada = {
  nome: "", slug: "", padrao_nome: "GRUPO #{n}", descricao: "", fechado: true, limite_por_grupo: 350, folga: 1,
  conexao_criadora_id: "", admins: [], usar_comunidade: false, crm_webhook_url: "", projeto_id: null,
};

export function FormularioCampanha({ id, inicial, conexoes, projetos }: { id: string | null; inicial: CampanhaEntrada; conexoes: Conexao[]; projetos: ProjetoOpcao[] }) {
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const set = <K extends keyof CampanhaEntrada>(k: K, v: CampanhaEntrada[K]) => { setF({ ...f, [k]: v }); setSalvo(false); };

  return (
    <form
      className={`${estiloCartao} grid max-w-2xl gap-4 p-4 md:p-5`}
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await salvarCampanha(id, f);
        setErro(r?.erro ?? null);
        setSalvo(!r?.erro);
      }}
    >
      <Campo rotulo="Nome"><input className={estiloInput} value={f.nome} onChange={(e) => set("nome", e.target.value)} /></Campo>
      <Campo rotulo="Endereço do link" dica={`${hostDoSite()}/l/${f.slug || "…"}`}>
        <input className={estiloInput} value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase())} />
      </Campo>
      <Campo rotulo="Nome dos grupos" dica="{n} vira o número do grupo: AULÃO #{n} → AULÃO #01. Máximo 25 caracteres.">
        <input className={estiloInput} value={f.padrao_nome} onChange={(e) => set("padrao_nome", e.target.value)} />
      </Campo>
      <Campo rotulo="Descrição dos grupos"><textarea className={estiloInput} rows={3} value={f.descricao} onChange={(e) => set("descricao", e.target.value)} /></Campo>
      <Campo rotulo="Projeto">
        <select className={estiloInput} value={f.projeto_id ?? ""} onChange={(e) => set("projeto_id", e.target.value || null)}>
          <option value="">Sem projeto</option>
          {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </Campo>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.fechado} onChange={(e) => set("fechado", e.target.checked)} /> Grupo fechado (só admins mandam mensagem)</label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Limite por grupo"><input type="number" className={estiloInput} value={f.limite_por_grupo} onChange={(e) => set("limite_por_grupo", Number(e.target.value))} /></Campo>
        <Campo rotulo="Folga (grupos com vaga prontos)"><input type="number" className={estiloInput} value={f.folga} onChange={(e) => set("folga", Number(e.target.value))} /></Campo>
      </div>
      <Campo rotulo="Número que cria os grupos">
        <select className={estiloInput} value={f.conexao_criadora_id} onChange={(e) => set("conexao_criadora_id", e.target.value)}>
          <option value="">Escolha…</option>
          {conexoes.map((c) => <option key={c.id} value={c.id}>{c.nome} ({c.status})</option>)}
        </select>
      </Campo>
      <Campo rotulo="Números que entram como admin">
        <div className="space-y-1">
          {conexoes.filter((c) => c.id !== f.conexao_criadora_id).map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.admins.includes(c.id)} onChange={(e) => set("admins", e.target.checked ? [...f.admins, c.id] : f.admins.filter((a) => a !== c.id))} />
              {c.nome}
            </label>
          ))}
        </div>
      </Campo>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.usar_comunidade} onChange={(e) => set("usar_comunidade", e.target.checked)} /> Ligar os grupos numa comunidade</label>
      <Campo rotulo="Webhook do CRM (opcional)" dica="Recebe um aviso a cada entrada e saída.">
        <input className={estiloInput} value={f.crm_webhook_url} onChange={(e) => set("crm_webhook_url", e.target.value)} placeholder="https://" />
      </Campo>
      {erro && <p className="text-sm text-vg-erro">{erro}</p>}
      {salvo && <p className="text-sm text-vg-ok">Salvo.</p>}
      <div><Botao type="submit">{id ? "Salvar" : "Criar campanha"}</Botao></div>
    </form>
  );
}
