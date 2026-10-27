"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { CampanhaTipo } from "@/src/lib/regras/campanha-tipo";
import { TIPOS_CAMPANHA } from "@/src/lib/regras/campanha-tipo";
import { Janela } from "../../_componentes/janela";
import { Botao, Campo, estiloInput } from "../../_componentes/ui";
import { salvarCampanha } from "../actions";

const ROTULO_TIPO: Record<CampanhaTipo, string> = { campanha: "Campanha", lista: "Lista", viral: "Campanha viral", aleatorio: "Aleatório" };

export type CampanhaParaEditar = {
  nome: string;
  slug: string;
  padrao_nome: string;
  descricao: string;
  fechado: boolean;
  limite_por_grupo: number;
  folga: number;
  conexao_criadora_id: string;
  admins: string[];
  usar_comunidade: boolean;
  crm_webhook_url: string;
  projeto_id: string | null;
  tipo: CampanhaTipo;
  /** No formato de `<input type="datetime-local">` (Brasília), ou "" quando a campanha não tem término. */
  termina_em: string;
  link_apos_termino: string;
};

/** Diálogo "Editar": Nome, Tipo, Projeto (com "Nenhum"), término e link após o término. Os outros campos
 *  da campanha (link, nome dos grupos, admins…) continuam em "Configurações avançadas" — aqui só manda de volta
 *  os valores atuais deles pra `salvarCampanha` não apagar nada. */
export function EditarCampanha({ id, aberta, aoFechar, inicial, projetos }: {
  id: string;
  aberta: boolean;
  aoFechar: () => void;
  inicial: CampanhaParaEditar;
  projetos: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [f, setF] = useState(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const set = <K extends keyof CampanhaParaEditar>(k: K, v: CampanhaParaEditar[K]) => { setF({ ...f, [k]: v }); setErro(null); };

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await salvarCampanha(id, f);
    setEnviando(false);
    setErro(r?.erro ?? null);
    if (!r?.erro) {
      aoFechar();
      router.refresh();
    }
  }

  return (
    <Janela aberta={aberta} aoFechar={aoFechar} titulo="Editar" icone="campaign">
      <form className="grid gap-4" onSubmit={salvar}>
        <Campo rotulo="Nome da campanha *"><input className={estiloInput} value={f.nome} onChange={(e) => set("nome", e.target.value)} /></Campo>
        <Campo rotulo="Tipo">
          <select className={estiloInput} value={f.tipo} onChange={(e) => set("tipo", e.target.value as CampanhaTipo)}>
            {TIPOS_CAMPANHA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Projeto">
          <select className={estiloInput} value={f.projeto_id ?? ""} onChange={(e) => set("projeto_id", e.target.value || null)}>
            <option value="">Nenhum</option>
            {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Terminar campanha em" dica="Data e hora de Brasília. Em branco, a campanha nunca termina.">
          <input type="datetime-local" className={estiloInput} value={f.termina_em} onChange={(e) => set("termina_em", e.target.value)} />
        </Campo>
        <Campo rotulo="Link de redirecionamento após o termino">
          <input className={estiloInput} value={f.link_apos_termino} onChange={(e) => set("link_apos_termino", e.target.value)} placeholder="https://" />
        </Campo>
        {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
        <div><Botao type="submit" disabled={enviando}>SALVAR</Botao></div>
      </form>
    </Janela>
  );
}
