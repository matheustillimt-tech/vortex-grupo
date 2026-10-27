import { Icone } from "@/app/(painel)/_componentes/icone";
import { Abas } from "@/app/(painel)/_componentes/abas";
import { Avatar } from "@/app/(painel)/_componentes/avatar";
import { AvatarFoto } from "@/app/(painel)/_componentes/avatar-foto";
import { CampoBusca } from "@/app/(painel)/_componentes/campo-busca";
import { FaixaBotoes, BotaoFaixa } from "@/app/(painel)/_componentes/faixa-botoes";
import { Grafico } from "@/app/(painel)/_componentes/grafico";
import { GraficoMetrica } from "@/app/(painel)/_componentes/grafico-metrica";
import { MenuCartao, type ItemMenuCartao } from "@/app/(painel)/_componentes/menu-cartao";
import { Informativo, GradeNumeros } from "@/app/(painel)/_componentes/numeros";
import { Paginacao } from "@/app/(painel)/_componentes/paginacao";
import { SeletorPeriodo } from "@/app/(painel)/_componentes/periodo";
import { SeloSituacao } from "@/app/(painel)/_componentes/situacao";
import { Botao, BotaoLink, Campo, Cartao, estiloAcao, estiloCartao, estiloInput, Numero, Pagina, Selo, Tabela, Vazio } from "@/app/(painel)/_componentes/ui";
import { BarrasFunil } from "@/app/(painel)/_componentes/painel/barras-funil";
import { CartaoFunil } from "@/app/(painel)/_componentes/painel/cartao-funil";
import { Ranking } from "@/app/(painel)/_componentes/painel/ranking";
import { Recolhivel } from "@/app/(painel)/_componentes/painel/recolhivel";
import { Rosca } from "@/app/(painel)/_componentes/painel/rosca";
import { Secao } from "@/app/(painel)/_componentes/painel/secao";
import { cartoesDoResumo } from "@/src/lib/regras/campanhas";
import { etapasDoFunil, variacao } from "@/src/lib/regras/painel-metricas";
import { Bloco } from "../bloco";
import { DemoJanela3L, DemoSegmentoRadio3L } from "../demo-componentes-3l";
import { DemoPeriodo, DemoSegmentos } from "../demo-segmentos";

const ITENS_MENU_CARTAO_3L: ItemMenuCartao[] = [
  { rotulo: "Fixar no topo", onClick: () => {} },
  { rotulo: "Editar", icone: "edit", onClick: () => {} },
  { rotulo: "Excluir", icone: "delete", onClick: () => {}, perigo: true },
];

const ETAPAS_EXEMPLO = etapasDoFunil({ cliques: 18181, entradas: 10875, saidas: 3648, participantes: 8359, admins: 80, grupos: 12, gruposCheios: 7 });

const RESUMO_EXEMPLO = { cliques: 1842, entradas: 1276, saidas: 430, participantes: 2910, admins: 12, grupos: 6, gruposCheios: 4 };

const SERIE_7 = [
  { dia: "10/10", cliques: 412, entradas: 230 },
  { dia: "11/10", cliques: 530, entradas: 301 },
  { dia: "12/10", cliques: 588, entradas: 322 },
  { dia: "13/10", cliques: 801, entradas: 452 },
  { dia: "14/10", cliques: 960, entradas: 540 },
  { dia: "15/10", cliques: 1102, entradas: 610 },
  { dia: "16/10", cliques: 1284, entradas: 731 },
];

const SERIE_28 = Array.from({ length: 28 }, (_, i) => ({
  dia: `${String(i + 1).padStart(2, "0")}/09`,
  cliques: Math.round(300 + 250 * Math.sin(i / 3) + i * 20),
  entradas: Math.round(160 + 120 * Math.sin(i / 3) + i * 10),
}));

export function SecaoComponentes() {
  return (
    <>
      <Bloco id="pagina" titulo="Pagina (migalha, título, subtítulo, ações)">
        <div className={`${estiloCartao} overflow-hidden`}>
          <Pagina
            titulo="Configurações"
            trilha={[{ rotulo: "Campanhas", href: "#" }, { rotulo: "Aulão 21/10", href: "#" }]}
            subtitulo="Subtítulo opcional da página."
            acoes={<><Botao variante="secundario">Secundário</Botao><Botao icone={<Icone nome="add" tamanho={14} />}>Principal</Botao></>}
          >
            <p className="text-sm text-vg-muted">Conteúdo da página.</p>
          </Pagina>
        </div>
      </Bloco>

      <Bloco id="botoes" titulo="Botões, ações e segmentos">
        <div className="flex flex-wrap items-center gap-2">
          <Botao>Principal</Botao>
          <Botao variante="contorno" icone={<Icone nome="add" tamanho={14} />}>Contorno</Botao>
          <Botao variante="secundario" icone={<Icone nome="send" tamanho={14} />}>Secundário</Botao>
          <Botao variante="perigo" icone={<Icone nome="delete_forever" tamanho={14} />}>Perigo</Botao>
          <Botao disabled>Desabilitado</Botao>
          <BotaoLink href="#">BotaoLink</BotaoLink>
          <BotaoLink href="#" variante="contorno">BotaoLink contorno</BotaoLink>
        </div>
        <div className="flex flex-wrap gap-4">
          <span className={estiloAcao.normal}>ação normal</span>
          <span className={estiloAcao.perigo}>ação de perigo</span>
          <span className={estiloAcao.neutro}>ação neutra</span>
        </div>
        <DemoSegmentos />
        <DemoPeriodo />
      </Bloco>

      <Bloco id="campos" titulo="Campos">
        <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" dica="Dica embaixo do campo."><input className={estiloInput} placeholder="Ex.: Aulão 21/10" /></Campo>
          <Campo rotulo="Sequência">
            <select className={estiloInput} defaultValue="">
              <option value="">Nenhuma</option>
              <option value="1">Webinário padrão</option>
            </select>
          </Campo>
          <Campo rotulo="Data e hora (Brasília)"><input type="datetime-local" className={estiloInput} /></Campo>
          <Campo rotulo="Desabilitado"><input className={estiloInput} disabled defaultValue="não editável" /></Campo>
          <div className="sm:col-span-2"><Campo rotulo="Mensagem"><textarea className={estiloInput} rows={3} defaultValue="Oi! A aula começa às {hora_aula}." /></Campo></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" defaultChecked /> Grupo fechado</label>
        </div>
      </Bloco>

      <Bloco id="selos" titulo="Selos e situação">
        <div className="flex flex-wrap gap-2">
          <Selo cor="ok">conectado</Selo>
          <Selo cor="aviso">cheio</Selo>
          <Selo cor="erro">desconectado</Selo>
          <Selo cor="neutro">pendente</Selo>
          <Selo cor="destaque">D-5</Selo>
          <Selo cor="neutro" semPonto>12</Selo>
        </div>
        <div className="flex flex-wrap gap-2">
          <SeloSituacao situacao="feito" detalhe="30/30" extra="lido por 9.812" />
          <SeloSituacao situacao="feito" detalhe="28/30 · 2 com erro" />
          <SeloSituacao situacao="feito" detalhe="nenhum grupo" />
          <SeloSituacao situacao="executando" detalhe="12/30" />
          <SeloSituacao situacao="agendado" />
          <SeloSituacao situacao="projetado" />
          <SeloSituacao situacao="falhou" detalhe="0/30" />
          <SeloSituacao situacao="bloqueado" />
          <SeloSituacao situacao="cancelado" />
          <SeloSituacao situacao="pulado" />
        </div>
      </Bloco>

      <Bloco id="numeros" titulo="Números">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Numero rotulo="Cliques hoje" valor="1.284" variacao="▲ 18% vs média 7d" tom="ok" />
          <Numero rotulo="Sairam" valor="1.555" variacao="34% das entradas" tom="erro" />
          <Numero rotulo="Com atenção" valor="7" variacao="▼ 12% vs média 7d" tom="atencao" />
          <Numero rotulo="Números" valor={2} sufixo="/ 3" variacao="● 1 sem conexão" tom="erro" />
          <Numero rotulo="Próximo envio" valor="19:50" variacao="AO VIVO + abrir" tom="atencao" destaque />
          <Numero rotulo="Cliques (ads)" valor="3.482" icone="ads_click" variacao="▲ 9% vs média 7d" tom="ok" />
        </div>
      </Bloco>

      <Bloco id="cartoes" titulo="Cartões">
        <div className="grid gap-3 md:grid-cols-2">
          <Cartao titulo="Cartão com título" acao={<span className="text-xs text-vg-muted">hoje</span>}><p className="text-sm text-vg-muted">Conteúdo.</p></Cartao>
          <Cartao titulo="Cartão destaque" destaque><p className="text-sm text-vg-accent-3">Próximo envio às 19:50.</p></Cartao>
        </div>
      </Bloco>

      <Bloco id="abas" titulo="Abas">
        <Abas
          itens={[
            { href: "#visao", rotulo: "Visão geral", ativo: true },
            { href: "#grupos", rotulo: "Grupos", ativo: false },
            { href: "#mensagens", rotulo: "Mensagens", ativo: false },
            { href: "#calendario", rotulo: "Calendário", ativo: false },
            { href: "#configuracoes", rotulo: "Configurações", ativo: false },
          ]}
        />
      </Bloco>

      <Bloco id="tabela" titulo="Tabela e vazio">
        <Tabela colunas={["Campanha", "Grupos", "Situação"]}>
          <tr><td className="px-3 py-2 font-medium">Aulão 21/10</td><td className="px-3 py-2 tabular-nums">10</td><td className="px-3 py-2"><Selo cor="ok">ativa</Selo></td></tr>
          <tr><td className="px-3 py-2 font-medium">Comunidade de Clientes</td><td className="px-3 py-2 tabular-nums">4</td><td className="px-3 py-2"><Selo cor="neutro">arquivada</Selo></td></tr>
        </Tabela>
        <Tabela colunas={["Nome", "Telefone"]} vazio="Nenhum número conectado." />
        <div className={estiloCartao}>
          <Vazio icone={<Icone nome="campaign" tamanho={16} />} texto="Nenhuma campanha ainda." acao={<BotaoLink href="#" variante="secundario">Criar campanha</BotaoLink>} />
        </div>
      </Bloco>

      <Bloco id="campanhas-etapa2a" titulo="Campanhas (Etapa 2A)">
        <Informativo>Cliques, entradas e saídas dos últimos 90 dias. Participantes e grupos mostram o total atual.</Informativo>
        <SeletorPeriodo atual={90} opcoes={[7, 14, 21, 28, 90]} href={(d) => `?dias=${d}`} />
        <GradeNumeros cartoes={cartoesDoResumo(RESUMO_EXEMPLO)} />
        <Paginacao de={1} ate={6} total={6} anterior={undefined} proxima={undefined} />
        <div className="flex flex-wrap items-center gap-4">
          <Avatar nome="Aulão 21/10" ativo />
          <Avatar nome="Comunidade" ativo={false} />
        </div>
        {/* Foto real do grupo (Etapa 3M): com foto válida, com URL quebrada (vira letra no erro) e sem foto. */}
        <div className="flex flex-wrap items-center gap-4">
          <AvatarFoto nome="Foto válida" foto="https://avatars.githubusercontent.com/u/9919?s=96" ativo />
          <AvatarFoto nome="URL quebrada" foto="https://pps.whatsapp.net/v/expirada.jpg" ativo />
          <AvatarFoto nome="Sem foto" foto={null} ativo={false} />
          <AvatarFoto nome="Migalha" foto="https://avatars.githubusercontent.com/u/9919?s=96" tamanho={20} />
        </div>
      </Bloco>

      <Bloco id="grafico" titulo="Gráfico">
        <Cartao titulo="7 dias"><Grafico dados={SERIE_7} idGradiente="vitrine-7" /></Cartao>
        <Cartao titulo="28 dias"><Grafico dados={SERIE_28} idGradiente="vitrine-28" /></Cartao>
        <Cartao titulo="Sem movimento"><Grafico dados={SERIE_7.map((d) => ({ ...d, cliques: 0, entradas: 0 }))} idGradiente="vitrine-zero" /></Cartao>
      </Bloco>

      <Bloco id="metricas" titulo="Métricas (Etapa 2C)">
        <Secao titulo="Funil de campanhas" subtitulo="Indicadores agregados de cliques, entradas, saídas e grupos.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <CartaoFunil
              icone="ads_click"
              rotulo="Clicks"
              valor="18.181"
              rodape="Dados dos últimos 7 dias"
              variacao={variacao(1284, 940)}
              serie={[412, 530, 588, 801, 960, 1102, 1284]}
            />
            <CartaoFunil icone="login" rotulo="Entraram" valor="10.875" variacao={variacao(731, 850)} serie={[230, 301, 322, 452, 540, 610, 731]} />
            <CartaoFunil icone="percent" rotulo="Percentual de entrada" valor="59,8 %" detalhe="59,82 no período" />
            <CartaoFunil icone="logout" rotulo="Sairam" valor="3.648" variacao={variacao(120, 260, false)} serie={[60, 58, 50, 44, 38, 30, 22]} />
          </div>
        </Secao>

        <Secao titulo="Funil em etapas" subtitulo="Cliques → entradas → participantes atuais.">
          <div className={`${estiloCartao} p-4`}>
            <BarrasFunil etapas={ETAPAS_EXEMPLO} />
          </div>
        </Secao>

        <Secao titulo="Status das conexões" subtitulo="Distribuição operacional atual.">
          <div className={`${estiloCartao} flex justify-center p-4`}>
            <Rosca
              total={14}
              rotulo="Conexões"
              fatias={[
                { rotulo: "Conectadas", valor: 10, cor: "#65DFAB" },
                { rotulo: "Desconectadas", valor: 3, cor: "#F26D68" },
                { rotulo: "Outras", valor: 1, cor: "#929F96" },
              ]}
            />
          </div>
          <div className={`${estiloCartao} flex justify-center p-4`}>
            <Rosca total={0} rotulo="Conexões (zerado)" fatias={[{ rotulo: "Conectadas", valor: 0, cor: "#65DFAB" }, { rotulo: "Desconectadas", valor: 0, cor: "#F26D68" }]} />
          </div>
        </Secao>

        <Secao titulo="Destaques" subtitulo="Top campanhas por cliques.">
          <div className={estiloCartao}>
            <Ranking
              vazio="Nenhuma campanha com cliques no período."
              itens={[
                { chave: "1", nome: "Aulão 21/10", linha2: "1.284 cliques", valor: "731 entradas" },
                { chave: "2", nome: "Comunidade de Clientes", linha2: "960 cliques", valor: "540 entradas" },
                { chave: "3", nome: "Semana da Automação", linha2: "588 cliques", valor: "34% churn", tom: "erro", href: "#" },
              ]}
            />
          </div>
          <div className={estiloCartao}>
            <Ranking vazio="Nenhuma campanha com queda relevante de cliques no período." itens={[]} />
          </div>
        </Secao>

        <Secao titulo="Alertas">
          <Recolhivel titulo="Alertas" subtitulo="3 não vistos" icone="notifications">
            <p className="text-sm text-vg-muted">Campanha &quot;Aulão 21/10&quot; está exposta (sem número conectado).</p>
          </Recolhivel>
          <Recolhivel titulo="Alertas (fechado por padrão)" subtitulo="Não há notificações por enquanto." icone="notifications" iniciaAberto={false}>
            <p className="text-sm text-vg-muted">Não há notificações por enquanto.</p>
          </Recolhivel>
        </Secao>
      </Bloco>

      <Bloco id="componentes-3l" titulo="Acabamento (Etapa 3L)">
        <p className="text-sm text-vg-muted">Props novas dos componentes compartilhados — o padrão de cada um continua idêntico ao de hoje.</p>

        <h3 className="text-sm font-medium text-vg-text-2">Paginação: linhas por página, sem pontas, alinhada à esquerda</h3>
        <Paginacao de={1} ate={10} total={42} anterior="#" proxima="#" porPagina={10} opcoesPorPagina={[10, 25, 50]} parametroPorPagina="por" />
        <Paginacao de={1} ate={6} total={6} pontas={false} />
        <Paginacao de={1} ate={6} total={6} alinhar="esquerda" />

        <h3 className="text-sm font-medium text-vg-text-2">Campo de busca: ícone à direita e sem ícone</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <CampoBusca icone="direita" className="w-full" />
          <CampoBusca icone="nenhum" rotuloVisivel="Buscar grupo" className="w-full" />
        </div>

        <h3 className="text-sm font-medium text-vg-text-2">Gráfico: Total geral, ATUALIZAR desligado, 2 séries, sem menu</h3>
        <GraficoMetrica
          titulo="Clicks"
          total="1.284"
          totalGeral="18.181"
          serie={SERIE_7.map((d) => ({ data: `2026-10-${d.dia.slice(0, 2)}`, valor: d.cliques }))}
          idGradiente="vitrine-3l-total-geral"
        />
        <GraficoMetrica
          titulo="Entraram"
          total="731"
          atualizar={false}
          serie={SERIE_7.map((d) => ({ data: `2026-10-${d.dia.slice(0, 2)}`, valor: d.entradas }))}
          idGradiente="vitrine-3l-sem-atualizar"
        />
        <GraficoMetrica
          titulo="Atividade Diária"
          series={[
            { nome: "Entraram", valores: SERIE_7.map((d) => d.entradas), cor: "destaque" },
            { nome: "Sairam", valores: SERIE_7.map((d) => Math.round(d.entradas * 0.3)), cor: "neutro" },
          ]}
          idGradiente="vitrine-3l-series"
        />
        <GraficoMetrica
          titulo="Sem menu"
          total="1.284"
          menu={false}
          serie={SERIE_7.map((d) => ({ data: `2026-10-${d.dia.slice(0, 2)}`, valor: d.cliques }))}
          idGradiente="vitrine-3l-sem-menu"
        />

        <h3 className="text-sm font-medium text-vg-text-2">
          Gráfico: sem ATUALIZAR nem tela cheia (Atividades), empilhado (Leadscoring — Etapa 3N Task 4)
        </h3>
        <GraficoMetrica
          titulo="Atividade Diaria"
          series={[
            { nome: "Entraram", valores: SERIE_7.map((d) => d.entradas), cor: "destaque" },
            { nome: "Sairam", valores: SERIE_7.map((d) => Math.round(d.entradas * 0.3)), cor: "neutro" },
          ]}
          diasRotulo={7}
          atualizar={false}
          telaCheia={false}
          idGradiente="vitrine-3n-sem-telacheia"
        />
        <GraficoMetrica
          titulo="Volume por dia"
          total="214"
          rotuloTotal="recibos · últimos 7 dias"
          empilhado={[
            { nome: "Recebeu", valores: SERIE_7.map((d) => d.cliques), cor: "#0FA968" },
            { nome: "Visualizou", valores: SERIE_7.map((d) => d.entradas), cor: "#F1CE87" },
            { nome: "Reproduziu", valores: SERIE_7.map((d) => Math.round(d.entradas * 0.4)), cor: "#7FB8E6" },
          ]}
          idGradiente="vitrine-3n-empilhado"
        />

        <h3 className="text-sm font-medium text-vg-text-2">Tabela: sem cabeçalho e com detalhe quando vazia</h3>
        <Tabela colunas={["Nome", "Status"]} vazio="Nenhuma conexão ainda" vazioDetalhe="Conecte o ChatGPT, Claude ou outro assistente compatível ao Vórtex Grupo com permissões controladas." semCabecalhoQuandoVazio />

        <h3 className="text-sm font-medium text-vg-text-2">Faixa de botões sem caixa alta</h3>
        <FaixaBotoes>
          <BotaoFaixa icone="schedule" ativo caixaNormal>7</BotaoFaixa>
          <BotaoFaixa icone="schedule" ativo={false} caixaNormal>14</BotaoFaixa>
          <BotaoFaixa icone="schedule" ativo={false} caixaNormal>Todo Período</BotaoFaixa>
        </FaixaBotoes>

        <h3 className="text-sm font-medium text-vg-text-2">Informativo sem ícone</h3>
        <Informativo semIcone>Cliques, entradas e saídas dos últimos 90 dias (ícone já aparece em outro lugar da tela).</Informativo>

        <h3 className="text-sm font-medium text-vg-text-2">Menu do cartão: cabeçalho e item sem ícone</h3>
        <MenuCartao itens={ITENS_MENU_CARTAO_3L} cabecalho={<div className="text-xs"><p className="font-medium text-vg-text">+55 11 9 1234-5678</p><p className="text-vg-text-3">Conexão principal</p></div>} />

        <h3 className="text-sm font-medium text-vg-text-2">Segmento com largura total</h3>
        <DemoSegmentoRadio3L />

        <h3 className="text-sm font-medium text-vg-text-2">Janela com ícone, ação no topo e sem "close"</h3>
        <DemoJanela3L />
      </Bloco>
    </>
  );
}
