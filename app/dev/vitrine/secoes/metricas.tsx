import { PainelMetricas } from "@/app/(painel)/metricas/blocos";
import { preencherDias } from "@/src/lib/regras/metricas";
import { Bloco } from "../bloco";

const AGORA = new Date("2026-10-16T17:30:00Z"); // sexta, 14:30 em Brasília
const R = (cliques: number, entradas: number, saidas: number, participantes = 0, admins = 0, grupos = 0, gruposCheios = 0) =>
  ({ cliques, entradas, saidas, participantes, admins, grupos, gruposCheios });
const LINHAS = [
  { id: "c1", nome: "Aulão 21/10", descricao: "", projetoId: null, atual: R(4120, 2380, 310, 2210, 12, 9, 6), anterior: R(3010, 1720, 280, 0, 0, 0, 0) },
  { id: "c2", nome: "Comunidade de Clientes", descricao: "", projetoId: null, atual: R(860, 92, 40, 640, 4, 3, 0), anterior: R(910, 140, 30, 0, 0, 0, 0) },
  { id: "c3", nome: "Embaixadores", descricao: "", projetoId: null, atual: R(120, 70, 35, 300, 3, 1, 1), anterior: R(400, 210, 20, 0, 0, 0, 0) },
];
const somar = (k: "atual" | "anterior") =>
  LINHAS.reduce((s, l) => { for (const c of Object.keys(s) as (keyof typeof s)[]) s[c] += l[k][c]; return s; }, R(0, 0, 0));
const dias = (n: number) =>
  preencherDias(Array.from({ length: n }, (_, i) => {
    const d = new Date(AGORA.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    return { dia: d, cliques: 40 + ((i * 37) % 90), entradas: 20 + ((i * 23) % 50), saidas: (i * 7) % 12 };
  }), n, AGORA);

export function SecaoMetricas() {
  return (
    <>
      <Bloco id="metricas" titulo="Métricas (com dados)">
        <PainelMetricas
          agora={AGORA}
          nome="Ana Souza"
          estado={{ dias: 90, tc: 7, te: 7, ts: 7, projetoId: "" }}
          projetos={[{ id: "p1", nome: "Lançamento" }]}
          alertas={{ total: 2, lista: [
            { id: "a1", created_at: "2026-10-16T16:10:00Z", tipo: "execucao_bloqueada", texto: "Variável {cupom} vazia na campanha Aulão 21/10", campanha_id: "c1" },
            { id: "a2", created_at: "2026-10-16T15:02:00Z", tipo: "grupo_cheio", texto: "Grupo AULÃO #08 encheu (#09 criado)", campanha_id: "c1" },
          ] }}
          atencao={[
            { chave: "desconectados", titulo: "1 número(s) desconectado(s)", subtitulo: "Reconecte para voltar a criar grupos e enviar", href: "/numeros" },
          ]}
          erroAtencao={false}
          proximo={{ quando: "2026-10-16T22:50:00Z", descricao: "AO VIVO #{n} + Abrir grupo", campanha: "Aulão 21/10", campanhaId: "c1" }}
          hoje={{ cliques: 31, cliques7d: 504, entradas: 40, entradas7d: 210 }}
          semCliquesHoje={[{ id: "c3", nome: "Embaixadores" }]}
          desconectadas24h={[{ id: "q1", created_at: "2026-10-16T09:12:00Z", texto: "Número Captação 02 caiu: desconectado do WhatsApp" }]}
          linhas={LINHAS}
          total={somar("atual")}
          totalAnterior={somar("anterior")}
          distintosFunil={{ grupos: 10, participantes: 2800 }}
          diasPeriodo={dias(90)}
          diasTendenciaCliques={dias(7)}
          diasTendenciaEntradas={dias(7)}
          diasTendenciaSaidas={dias(7)}
          contas={{ total: 3, conectadas: 2, desconectadas: 1 }}
          campanhasAtivas={3}
        />
      </Bloco>
      <Bloco id="metricas-erro" titulo="Métricas (consultas com erro)">
        <PainelMetricas
          agora={AGORA}
          nome={null}
          estado={{ dias: 7, tc: 14, te: 14, ts: 14, projetoId: "" }}
          projetos={[]}
          alertas={null}
          atencao={[]}
          erroAtencao
          proximo={null}
          hoje={{ cliques: null, cliques7d: null, entradas: null, entradas7d: null }}
          semCliquesHoje={null}
          desconectadas24h={null}
          linhas={null}
          total={null}
          totalAnterior={null}
          distintosFunil={{ grupos: 0, participantes: 0 }}
          diasPeriodo={null}
          diasTendenciaCliques={null}
          diasTendenciaEntradas={null}
          diasTendenciaSaidas={null}
          contas={null}
          campanhasAtivas={null}
        />
      </Bloco>
    </>
  );
}
