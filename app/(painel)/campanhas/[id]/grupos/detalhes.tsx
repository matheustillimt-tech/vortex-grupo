"use client";
import { dataHoraCompleta } from "@/src/lib/regras/abas-mensagens";
import type { GrupoLinha } from "./lista";

function Linha({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-vg-line py-2 text-sm last:border-b-0">
      <span className="text-vg-text-2">{rotulo}</span>
      <span className="min-w-0 text-right text-vg-text">{valor}</span>
    </div>
  );
}

/** Conteúdo da janela "Detalhes" do menu "⋮": tudo que a tela já sabe sobre o grupo, numa lista. */
export function Detalhes({ grupo, tipoGrupo }: { grupo: GrupoLinha; tipoGrupo: string }) {
  return (
    <div className="divide-y divide-vg-line">
      <Linha rotulo="Nome" valor={grupo.nome} />
      <Linha rotulo="Número" valor={`#${grupo.numero}`} />
      <Linha rotulo="Tipo" valor={tipoGrupo} />
      <Linha rotulo="Conexão" valor={grupo.conexao || "—"} />
      <Linha rotulo="Id no WhatsApp" valor={<code className="text-xs">{grupo.groupId}</code>} />
      <Linha rotulo="Participantes" valor={grupo.participantes} />
      <Linha rotulo="Administradores" valor={grupo.admins} />
      <Linha rotulo="Leads" valor={grupo.leads} />
      <Linha rotulo="Redirect (cliques)" valor={grupo.cliques} />
      <Linha rotulo="Cliques reais" valor={grupo.cliquesReais} />
      <Linha rotulo="Cheio" valor={grupo.cheioManual === null ? `Automático (${grupo.cheio ? "cheio" : "não cheio"})` : grupo.cheioManual ? "Sim (à mão)" : "Não (à mão)"} />
      <Linha rotulo="Ativo" valor={grupo.ativo ? "Sim" : "Não"} />
      <Linha rotulo="Suspenso" valor={grupo.suspenso ? "Sim (saiu do ar no WhatsApp)" : "Não"} />
      <Linha rotulo="Link de convite" valor={grupo.link_convite ?? "—"} />
      <Linha rotulo="Criado em" valor={dataHoraCompleta(grupo.created_at)} />
      <Linha rotulo="Última conferência" valor={grupo.conferido_em ? dataHoraCompleta(grupo.conferido_em) : "Ainda não conferido"} />
    </div>
  );
}
