import { isoParaCampoBrasilia } from "@/src/lib/regras/horario";
import { MAXIMO_GLOBAIS_NA_CAMPANHA } from "@/src/lib/regras/variaveis-globais";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Cartao, Pagina } from "../../../_componentes/ui";
import { FormularioCampanha } from "../../formulario";
import { Arquivar } from "./arquivar";
import { Aula } from "./aula";
import { Variaveis } from "./variaveis";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export default async function Configuracoes({ params }: { params: Promise<{ id: string }> }) {
  const b = await bloqueio("campanhas");
  if (b) return b;
  const { id } = await params;
  const db = await dbUsuario();
  const [{ data: c }, { data: conexoes }, { data: admins }, { data: sequencias, error: erroSequencias }, { data: variaveis, error: erroVariaveis }, { data: globais, error: erroGlobais }, { data: projetosAtivos }] = await Promise.all([
    db.from("campanhas").select("*").eq("id", id).single(),
    db.from("conexoes").select("id, nome, status").order("nome"),
    db.from("campanha_conexoes").select("conexao_id").eq("campanha_id", id),
    db.from("sequencias").select("id, nome").order("nome"),
    db.from("campanha_variaveis").select("chave, valor").eq("campanha_id", id).order("chave"),
    db.from("variaveis_globais").select("chave, tipo").order("chave").limit(MAXIMO_GLOBAIS_NA_CAMPANHA),
    db.from("projetos").select("id, nome").eq("arquivado", false).order("nome"),
  ]);
  if (erroSequencias) throw new Error("Não foi possível carregar as sequências.");
  if (erroVariaveis || erroGlobais) throw new Error("Não foi possível carregar as variáveis.");

  // O projeto atual da campanha pode estar arquivado (não está em `projetosAtivos`): nesse caso ele entra como
  // uma opção extra marcada "(arquivado)", pra não sumir do select quando a campanha é editada.
  let projetos = projetosAtivos ?? [];
  if (c.projeto_id && !projetos.some((p) => p.id === c.projeto_id)) {
    const { data: projetoArquivado } = await db.from("projetos").select("id, nome").eq("id", c.projeto_id).maybeSingle();
    if (projetoArquivado) projetos = [...projetos, { id: projetoArquivado.id, nome: `${projetoArquivado.nome} (arquivado)` }];
  }

  return (
    <Pagina titulo="Editar campanha">
      <FormularioCampanha
        id={id}
        conexoes={conexoes ?? []}
        projetos={projetos}
        inicial={{
          nome: c.nome, slug: c.slug, padrao_nome: c.padrao_nome, descricao: c.descricao, fechado: c.fechado,
          limite_por_grupo: c.limite_por_grupo, folga: c.folga, conexao_criadora_id: c.conexao_criadora_id ?? "",
          admins: (admins ?? []).map((a) => a.conexao_id), usar_comunidade: c.usar_comunidade, crm_webhook_url: c.crm_webhook_url ?? "",
          projeto_id: c.projeto_id ?? null,
        }}
      />
      <Cartao titulo="Aula e sequência">
        <Aula
          campanhaId={id}
          sequencias={sequencias ?? []}
          inicial={{
            data_aula: c.data_aula ? isoParaCampoBrasilia(c.data_aula) : "", link_aula: c.link_aula ?? "", sequencia_id: c.sequencia_id ?? "",
            mensagem_fixa: c.mensagem_fixa ?? "", alertas_webhook_url: c.alertas_webhook_url ?? "",
          }}
        />
      </Cartao>
      <Cartao titulo="Variáveis">
        <Variaveis campanhaId={id} globais={globais ?? []} variaveis={variaveis ?? []} />
      </Cartao>
      <Cartao titulo={c.arquivada ? "Campanha arquivada" : "Arquivar campanha"}>
        <Arquivar campanhaId={id} arquivada={c.arquivada} />
      </Cartao>
    </Pagina>
  );
}
