"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { TIPOS_CAMPANHA, type CampanhaTipo } from "@/src/lib/regras/campanha-tipo";
import { Janela } from "../_componentes/janela";
import { Botao, Campo, estiloBotao, estiloInput } from "../_componentes/ui";
import { Icone } from "../_componentes/icone";
import { criarCampanha } from "./actions";

const ROTULO_TIPO: Record<CampanhaTipo, string> = { campanha: "Campanha", lista: "Lista", viral: "Campanha viral", aleatorio: "Aleatório" };

export type ProjetoOpcao = { id: string; nome: string };

/** Diálogo "Criar campanha": "Nome da campanha", "Tipo" e "Projeto" (opcional) — o resto
 *  fica nas configurações da campanha depois de criada (link, nome dos grupos, admins…). Abre pelo botão `add`
 *  "Campanha" ou, já aberto, por `/campanhas?nova=1` (pra onde `/campanhas/nova` redireciona, levando o
 *  `?projeto=` junto — `abrirInicial` e `projetoInicial` vêm lidos no servidor, pra não precisar de
 *  `useSearchParams` nem de `<Suspense>` aqui). `projetos` são só os ativos. */
export function CriarCampanha({
  abrirInicial = false,
  projetos = [],
  projetoInicial = "",
}: {
  abrirInicial?: boolean;
  projetos?: ProjetoOpcao[];
  projetoInicial?: string;
}) {
  const router = useRouter();
  const [aberta, setAberta] = useState(abrirInicial);
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState<CampanhaTipo>("campanha");
  const [projeto, setProjeto] = useState(projetos.some((p) => p.id === projetoInicial) ? projetoInicial : "");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  function fechar() {
    setAberta(false);
    setErro(null);
    if (abrirInicial) router.replace(projetoInicial ? `/campanhas?projeto=${projetoInicial}` : "/campanhas");
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    const r = await criarCampanha(nome, tipo, projeto || null);
    setEnviando(false);
    setErro(r?.erro ?? null);
  }

  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={estiloBotao("contorno")}>
        <Icone nome="add" /> Campanha
      </button>
      <Janela aberta={aberta} aoFechar={fechar} titulo="Criar campanha">
        <form className="grid gap-4" onSubmit={criar}>
          <Campo rotulo="Nome da campanha *">
            <input autoFocus className={estiloInput} value={nome} onChange={(e) => { setNome(e.target.value); setErro(null); }} />
          </Campo>
          <Campo rotulo="Tipo">
            <select className={estiloInput} value={tipo} onChange={(e) => setTipo(e.target.value as CampanhaTipo)}>
              {TIPOS_CAMPANHA.map((t) => <option key={t} value={t}>{ROTULO_TIPO[t]}</option>)}
            </select>
          </Campo>
          <Campo rotulo="Projeto">
            <select className={estiloInput} value={projeto} onChange={(e) => { setProjeto(e.target.value); setErro(null); }}>
              <option value="">Sem projeto</option>
              {projetos.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </Campo>
          {erro && <p role="alert" className="text-sm text-vg-erro">{erro}</p>}
          <div><Botao type="submit" disabled={enviando}>CRIAR CAMPANHA</Botao></div>
        </form>
      </Janela>
    </>
  );
}
