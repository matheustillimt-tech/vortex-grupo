import { CabecalhoCampanha } from "@/app/(painel)/campanhas/[id]/cabecalho";
import { PainelVisaoGeral } from "@/app/(painel)/campanhas/[id]/visao-geral";
import { estiloCartao } from "@/app/(painel)/_componentes/ui";
import type { MetricaDia } from "@/src/lib/regras/metricas";
import { Bloco } from "../bloco";

const SERIE: MetricaDia[] = [
  { dia: "10/10", data: "2026-10-10", cliques: 640, entradas: 352, saidas: 61 },
  { dia: "11/10", data: "2026-10-11", cliques: 820, entradas: 455, saidas: 90 },
  { dia: "12/10", data: "2026-10-12", cliques: 905, entradas: 510, saidas: 120 },
  { dia: "13/10", data: "2026-10-13", cliques: 1180, entradas: 660, saidas: 210 },
  { dia: "14/10", data: "2026-10-14", cliques: 1390, entradas: 780, saidas: 260 },
  { dia: "15/10", data: "2026-10-15", cliques: 1513, entradas: 847, saidas: 380 },
  { dia: "16/10", data: "2026-10-16", cliques: 1644, entradas: 931, saidas: 434 },
];

export function SecaoCampanha() {
  return (
    <>
      <Bloco id="campanha" titulo="Campanha: cabeçalho + Visão geral">
        <div className={`${estiloCartao} overflow-hidden`}>
          <CabecalhoCampanha id="demo" nome="Aulão 21/10" abaAtiva="" />
          <div className="mx-auto max-w-[1200px] px-4 py-5 md:px-6">
            <PainelVisaoGeral
              campanha={{
                id: "demo", nome: "Aulão 21/10", descricao: "Grupos do aulão de outubro", created_at: "2026-10-01T12:00:00Z",
                arquivada: false, fixada: false, slug: "aulao-21-10", padrao_nome: "GRUPO #{n}", fechado: true, limite_por_grupo: 1000,
                folga: 1, conexao_criadora_id: "", usar_comunidade: false, crm_webhook_url: "", projeto_id: null, tipo: "campanha",
                termina_em: "", link_apos_termino: "", admins: [],
              }}
              projetos={[]}
              link="https://seu-dominio.com.br/l/aulao-21-10"
              resumo={{ cliques: 8092, entradas: 4535, saidas: 1555, participantes: 2980, admins: 20, grupos: 10, gruposCheios: 8 }}
              metricas={SERIE}
              estado={{ dias: 90, grafico: 7, secao: "metricas" }}
            />
          </div>
        </div>
      </Bloco>
      <Bloco id="campanha-arquivada" titulo="Campanha arquivada (cabeçalho, aba Grupos)">
        <div className={`${estiloCartao} overflow-hidden`}>
          <CabecalhoCampanha id="demo-2" nome="Black Friday 2025" abaAtiva="/grupos" />
        </div>
      </Bloco>
    </>
  );
}
