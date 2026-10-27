import { inicioDoPeriodo, resumoDaLinha, type Resumo } from "@/src/lib/regras/campanhas";
import { papeisDasContas } from "@/src/lib/regras/contingencia";
import { areasVisiveis, membroAtual, permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { comFotos } from "./campanhas/dados";
import type { ConexaoCaida } from "./_componentes/tarja-conexoes";
import { PainelInicio, type BlocosInicio, type CampanhaInicio, type ContaInicio, type WebhookInicio } from "./_componentes/inicio";

export const dynamic = "force-dynamic";

const nada = Promise.resolve({ data: null, error: null });

const RESUMO_ZERO: Resumo = { cliques: 0, entradas: 0, saidas: 0, participantes: 0, admins: 0, grupos: 0, gruposCheios: 0 };

export default async function Inicio() {
  const { usuario } = await membroAtual();
  const areas = await areasVisiveis();
  // Início mostra só os blocos das áreas que a pessoa vê (no mínimo o cabeçalho); o que não aparece nem é consultado.
  const blocos: BlocosInicio = {
    contas: areas.includes("contas"),
    campanhas: areas.includes("campanhas"),
    webhooks: areas.includes("webhooks"),
    metricas: areas.includes("metricas"),
    equipe: areas.includes("equipe"),
  };
  // Engrenagem do cartão de conta (revisão final): "Desconectar" só aparece com "contas"/"editar".
  const podeEditarContas = blocos.contas ? await permitido("contas", "editar") : false;
  const db = await dbUsuario();
  const email = usuario.email ?? "";

  // Cada consulta devolve { data, error } sem lançar: um erro só apaga a coluna que depende dela.
  const [
    { data: conexoes, error: erroConexoes },
    { data: campanhas, error: erroCampanhas },
    { data: linhasResumo, error: erroResumo },
    { data: integracoes, error: erroIntegracoes },
    { data: associacoes },
    { data: caidas, error: erroCaidas },
  ] = await Promise.all([
    blocos.contas ? db.from("conexoes").select("id, nome, telefone, status, ultimo_erro, pausado_ate") : nada,
    blocos.campanhas
      ? db.from("campanhas").select("id, nome, descricao, arquivada, conexao_criadora_id, imagem_grupo_url").eq("arquivada", false)
      : nada,
    blocos.campanhas ? db.rpc("resumo_campanhas", { p_desde: inicioDoPeriodo(90) }) : nada,
    // Coluna "Webhooks" = webhooks de checkout (entrada); sem a coluna segredo.
    blocos.webhooks ? db.from("integracoes_checkout").select("id, nome, plataforma").eq("arquivada", false).order("created_at", { ascending: false }) : nada,
    blocos.contas ? db.from("campanha_conexoes").select("campanha_id, conexao_id") : nada,
    // Tarja em cima dos cartões: todo mundo do time vê quando um número cai (não depende da área Contas).
    db.from("conexoes").select("id, nome, telefone, caiu_em, diagnostico_queda").eq("status", "desconectado").order("nome"),
  ]);

  for (const [onde, erro] of Object.entries({ erroConexoes, erroCampanhas, erroResumo, erroIntegracoes })) {
    if (erro) console.error(`[inicio] ${onde}`, erro);
  }

  const listaConexoes: { id: string; nome: string; telefone: string | null; status: string; ultimo_erro: string | null; pausado_ate: string | null }[] | null =
    erroConexoes ? null : conexoes ?? [];

  type CampanhaCarregada = {
    id: string;
    nome: string;
    descricao: string | null;
    arquivada: boolean;
    conexao_criadora_id: string | null;
  };
  const listaCampanhas: CampanhaCarregada[] | null = erroCampanhas ? null : campanhas ?? [];

  const resumos = new Map<string, Resumo>();
  if (!erroResumo) {
    for (const l of linhasResumo ?? []) {
      const r = resumoDaLinha(l as Record<string, unknown>);
      resumos.set(r.campanhaId, r);
    }
  }

  // Etiqueta principal/reserva: só com as campanhas lidas (sem elas, os cartões ficam sem etiqueta).
  const papeis = papeisDasContas((campanhas ?? []) as { id: string; nome: string; conexao_criadora_id: string | null }[], (associacoes ?? []) as { campanha_id: string; conexao_id: string }[]);
  const contas: ContaInicio[] | null = listaConexoes ? listaConexoes.map((c) => ({ ...c, papel: papeis.get(c.id) })) : null;

  const campanhasInicio: CampanhaInicio[] | null = listaCampanhas
    ? (await comFotos(db, listaCampanhas)).map((c) => ({
        id: c.id,
        nome: c.nome,
        descricao: c.descricao ?? "",
        arquivada: c.arquivada,
        foto: c.foto,
        nomeGrupo: c.nomeGrupo,
        resumo: resumos.get(c.id) ?? RESUMO_ZERO,
      }))
    : null;

  const webhooks: WebhookInicio[] | null = erroIntegracoes ? null : ((integracoes ?? []) as WebhookInicio[]);

  return (
    <PainelInicio
      email={email}
      contas={contas}
      campanhas={campanhasInicio}
      webhooks={webhooks}
      blocos={blocos}
      podeEditarContas={podeEditarContas}
      caidas={erroCaidas ? [] : ((caidas ?? []) as ConexaoCaida[])}
    />
  );
}
