import { PainelInicio } from "@/app/(painel)/_componentes/inicio";
import { estiloCartao } from "@/app/(painel)/_componentes/ui";
import { Bloco } from "../bloco";

const R = (cliques: number, entradas: number, grupos = 0) => ({ cliques, entradas, saidas: 0, participantes: 0, admins: 0, grupos, gruposCheios: 0 });

export function SecaoInicio() {
  return (
    <>
      <Bloco id="inicio" titulo="Início (com dados)">
        <div className={`${estiloCartao} overflow-hidden`}>
          <PainelInicio
            email="ana@exemplo.com"
            contas={[
              { id: "n1", nome: "Captação 01", telefone: "5537" + "980001001", status: "conectado", ultimo_erro: null, pausado_ate: null },
              { id: "n2", nome: "Captação 02", telefone: "553780001001", status: "desconectado", ultimo_erro: "Desconectou durante uma tarefa", pausado_ate: null },
              { id: "n3", nome: "Captação 03", telefone: null, status: "pendente", ultimo_erro: null, pausado_ate: null },
            ]}
            campanhas={[
              { id: "c1", nome: "Aulão 21/10", descricao: "Turma de outubro", arquivada: false, resumo: R(812, 463, 9) },
              { id: "c2", nome: "Comunidade de Clientes", descricao: "Grupo de clientes", arquivada: false, resumo: R(301, 178, 4) },
            ]}
            webhooks={[
              { id: "w1", nome: "Hotmart", plataforma: "hotmart" },
              { id: "w2", nome: "Kiwify do lançamento", plataforma: "kiwify" },
            ]}
          />
        </div>
      </Bloco>
      <Bloco id="inicio-vazio" titulo="Início (sem nada)">
        <div className={`${estiloCartao} overflow-hidden`}>
          <PainelInicio email="ana@exemplo.com" contas={[]} campanhas={[]} webhooks={[]} />
        </div>
      </Bloco>
      <Bloco id="inicio-erro" titulo="Início (consultas com erro)">
        <div className={`${estiloCartao} overflow-hidden`}>
          <PainelInicio email="ana@exemplo.com" contas={null} campanhas={null} webhooks={null} />
        </div>
      </Bloco>
    </>
  );
}
