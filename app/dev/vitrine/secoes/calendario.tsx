import { Calendario } from "@/app/(painel)/_componentes/calendario";
import { FiltrosCalendario } from "@/app/(painel)/_componentes/filtros-calendario";
import type { DiaCalendario } from "@/src/lib/calendario";
import type { ItemCalendario } from "@/src/lib/regras/calendario";
import { Bloco } from "../bloco";

const AGORA = new Date("2026-10-21T20:00:00Z"); // 21/10 às 17:00 em Brasília

const item = (p: Partial<ItemCalendario> & Pick<ItemCalendario, "chave" | "quando">): ItemCalendario => ({
  campanhaId: "c1",
  execucaoId: null,
  passoId: null,
  tipo: "mensagem",
  origem: "sequencia",
  resumo: "",
  situacao: "projetado",
  detalhe: null,
  ...p,
});

const DIAS: DiaCalendario[] = [
  {
    dia: "2026-10-20",
    rotulo: "ter., 20/10",
    itens: [
      item({ chave: "e-1", execucaoId: "e1", quando: "2026-10-20T12:00:00Z", resumo: "Lembrete da aula de amanhã", situacao: "feito", detalhe: "30/30" }),
      item({ chave: "e-2", execucaoId: "e2", quando: "2026-10-20T20:00:00Z", tipo: "enquete", resumo: "Vai assistir ao vivo?", situacao: "feito", detalhe: "28/30 · 2 com erro" }),
      item({ chave: "e-3", execucaoId: "e3", quando: "2026-10-20T21:00:00Z", origem: "avulsa", resumo: "Cupom liberado: {cupom}", situacao: "bloqueado" }),
      item({ chave: "e-4", execucaoId: "e4", quando: "2026-10-20T22:00:00Z", origem: "massa", tipo: "descricao", resumo: "Aula amanhã às 20h", situacao: "falhou", detalhe: "0/30" }),
    ],
  },
  {
    dia: "2026-10-21",
    rotulo: "qua., 21/10",
    itens: [
      item({ chave: "e-5", execucaoId: "e5", quando: "2026-10-21T19:55:00Z", origem: "avulsa", resumo: "Faltam 3 horas!", situacao: "executando", detalhe: "12/30" }),
      item({ chave: "e-6", execucaoId: "e6", quando: "2026-10-21T22:50:00Z", tipo: "nome", resumo: "AO VIVO #{n}", situacao: "agendado" }),
      item({ chave: "p-c1-7", passoId: "p7", quando: "2026-10-21T22:50:00Z", tipo: "abrir" }),
      item({ chave: "p-c1-8", passoId: "p8", quando: "2026-10-21T23:02:00Z", resumo: "Link da aula: {link_aula}" }),
      item({ chave: "p-c1-9", passoId: "p9", quando: "2026-10-22T01:00:00Z", tipo: "fechar" }),
    ],
  },
];

export function SecaoCalendario() {
  return (
    <>
      <Bloco id="calendario" titulo="Calendário da campanha (D-N, próximo, lido por)">
        <FiltrosCalendario periodo="padrao" diasAntes={30} />
        <Calendario dias={DIAS} dataAula="2026-10-21T23:00:00Z" lidos={new Map([["e1", 9812]])} agora={AGORA} />
      </Bloco>
      <Bloco id="calendario-geral" titulo="Calendário geral (nome da campanha em cada item)">
        <FiltrosCalendario campanhas={[{ id: "c1", nome: "Aulão 21/10" }, { id: "c2", nome: "Comunidade de Clientes" }]} periodo="semana" diasAntes={7} />
        <Calendario dias={DIAS} nomes={new Map([["c1", "Aulão 21/10"]])} agora={AGORA} />
      </Bloco>
      <Bloco id="calendario-vazio" titulo="Calendário vazio">
        <Calendario dias={[]} />
      </Bloco>
    </>
  );
}
