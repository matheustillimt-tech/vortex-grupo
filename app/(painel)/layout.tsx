import { areasVisiveis, membroAtual } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Moldura } from "./_componentes/moldura";

export const dynamic = "force-dynamic";

const nada = Promise.resolve({ data: null, error: null, count: null });

/** Só o menu e a barra do topo: a guarda de cada área fica em cada página (`bloqueio()`), porque o layout não
 *  renderiza de novo na navegação entre as páginas filhas. */
export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const { usuario, membro } = await membroAtual();
  const areas = await areasVisiveis();
  const db = await dbUsuario();

  let campanhas: { id: string; nome: string }[] = [];
  let contas: { id: string; nome: string }[] = [];
  let avisos = 0;
  let avisosLista: { id: string; created_at: string; tipo: string; texto: string }[] = [];

  // Erro de rede (promessa rejeitada) cai no catch; erro do Supabase (resposta com `error`) é
  // tratado por campo abaixo — nos dois casos a barra não pode derrubar o painel.
  // Campanhas, contas e alertas só carregam pra quem vê a área (a migalha usa campanhas/contas;
  // os alertas moram em Métricas — sem "ver" lá, o sino fica com contador 0 e a gaveta vazia).
  try {
    const [{ data: dadosCampanhas, error: erroCampanhas }, { data: dadosContas, error: erroContas }, { count, error: erroAvisos }, { data: dadosAvisos, error: erroListaAvisos }] =
      await Promise.all([
        areas.includes("campanhas") ? db.from("campanhas").select("id, nome").eq("arquivada", false).order("nome") : nada,
        areas.includes("contas") ? db.from("conexoes").select("id, nome").order("nome") : nada,
        areas.includes("metricas") ? db.from("alertas").select("id", { count: "exact", head: true }).eq("visto", false) : nada,
        // 20 não vistos mais novos: a gaveta do sino não precisa de mais que isso (link "Ver todos" cobre o resto).
        areas.includes("metricas")
          ? db.from("alertas").select("id, created_at, tipo, texto").eq("visto", false).order("created_at", { ascending: false }).limit(20)
          : nada,
      ]);
    campanhas = erroCampanhas ? [] : dadosCampanhas ?? [];
    contas = erroContas ? [] : dadosContas ?? [];
    avisos = erroAvisos ? 0 : count ?? 0;
    avisosLista = erroListaAvisos ? [] : dadosAvisos ?? [];
  } catch {
    // a barra não pode derrubar o painel
  }

  return (
    <div className="min-h-screen md:flex">
      <Moldura email={usuario.email ?? ""} campanhas={campanhas} contas={contas} avisos={avisos} avisosLista={avisosLista} areas={areas} papel={membro?.papel}>
        {children}
      </Moldura>
    </div>
  );
}
