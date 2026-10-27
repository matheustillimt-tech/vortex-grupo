"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { PLATAFORMAS_INTEGRACAO, urlIntegracoes, type FiltrosIntegracoes } from "@/src/lib/regras/integracoes";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloInput } from "../_componentes/ui";
import { CampoBusca } from "../_componentes/campo-busca";
import { criarIntegracao } from "./actions";

// ---------- Busca + ordenação ----------

export function FiltrosIntegracoesBarra({ filtros }: { filtros: FiltrosIntegracoes }) {
  const router = useRouter();
  const ir = (mudar: Partial<FiltrosIntegracoes>) => router.push(urlIntegracoes(filtros, mudar), { scroll: false });
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <form
        className="w-full max-w-xs"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          ir({ q: String(new FormData(e.currentTarget).get("q") ?? "").trim() });
        }}
      >
        <CampoBusca key={filtros.q} valorInicial={filtros.q} rotulo="Buscar webhooks pelo nome" />
      </form>
      <label className="flex items-center gap-2 text-sm text-vg-text">
        <span>Ordenação</span>
        <select value={filtros.ordem} onChange={(e) => ir({ ordem: e.target.value === "antigos" ? "antigos" : "recentes" })} className={`${estiloInput} w-auto`}>
          <option value="recentes">Data de criação</option>
          <option value="antigos">Data de criação</option>
        </select>
        <button
          type="button"
          aria-label={filtros.ordem === "antigos" ? "Mais antigos primeiro" : "Mais novos primeiro"}
          onClick={() => ir({ ordem: filtros.ordem === "antigos" ? "recentes" : "antigos" })}
          className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Icone nome={filtros.ordem === "antigos" ? "arrow_upward" : "arrow_downward"} tamanho={18} />
        </button>
      </label>
    </div>
  );
}

// ---------- Janela "Criar webhook" ----------

function JanelaCriarWebhook({ aoFechar }: { aoFechar: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [plataforma, setPlataforma] = useState<string>(PLATAFORMAS_INTEGRACAO[0].valor);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const idNome = useId();
  const idPlataforma = useId();

  function criar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await criarIntegracao({ nome, plataforma });
        if (r.erro || !r.id) return setErro(r.erro ?? "Não foi possível criar o webhook.");
        aoFechar();
        router.push(`/webhooks/${r.id}`);
      } catch {
        setErro("Não foi possível criar o webhook. Tente de novo.");
      }
    });
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo="Criar webhook">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          criar();
        }}
      >
        <label htmlFor={idNome} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome *</span>
          <input id={idNome} className={estiloInput} value={nome} maxLength={60} required onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Hotmart do lançamento" />
        </label>
        <label htmlFor={idPlataforma} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Plataforma</span>
          <select id={idPlataforma} className={estiloInput} value={plataforma} onChange={(e) => setPlataforma(e.target.value)}>
            {PLATAFORMAS_INTEGRACAO.map((p) => (
              <option key={p.valor} value={p.valor}>{p.rotulo}</option>
            ))}
          </select>
        </label>
        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="submit" className={estiloBotao()} disabled={ocupado || !nome.trim()}>
            {ocupado ? "Criando…" : "CRIAR WEBHOOK"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function BotaoCriarWebhook({ podeEditar }: { podeEditar: boolean }) {
  const [aberta, setAberta] = useState(false);
  const [vez, setVez] = useState(0);
  if (!podeEditar) return null;
  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        <Icone nome="add" />
        Webhook
      </button>
      {aberta && <JanelaCriarWebhook key={vez} aoFechar={() => setAberta(false)} />}
    </>
  );
}
