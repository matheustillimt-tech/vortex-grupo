"use client";
import { useEffect, useState } from "react";
import { Vazio } from "../../../_componentes/ui";
import { gruposDuplicados, participantesDuplicados, type GrupoDuplicado, type ParticipanteDuplicado } from "./actions";
import { telefoneLegivel } from "@/src/lib/telefone";

/** Conteúdo da janela "Participantes duplicados": telefones (`saiu_em is null`) presentes em mais de um grupo
 *  ativo da campanha, com os grupos — carregado quando a janela abre, até 200 telefones. */
export function ParticipantesDuplicados({ campanhaId }: { campanhaId: string }) {
  const [estado, setEstado] = useState<{ lista?: ParticipanteDuplicado[]; erro?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    participantesDuplicados(campanhaId).then((r) => {
      if (vivo) setEstado(r.erro ? { erro: r.erro } : { lista: r.duplicados ?? [] });
    });
    return () => {
      vivo = false;
    };
  }, [campanhaId]);

  if (!estado) return <p className="text-sm text-vg-muted">Carregando…</p>;
  if (estado.erro) return <p role="alert" className="text-sm text-vg-erro">{estado.erro}</p>;
  if (!estado.lista?.length) return <Vazio texto="Nenhum participante duplicado encontrado." compacto />;
  return (
    <div className="space-y-2">
      {estado.lista.length >= 200 && <p className="text-xs text-vg-text-3">Mostrando os 200 primeiros telefones (ordem alfabética).</p>}
      <ul className="divide-y divide-vg-line text-sm">
        {estado.lista.map((p) => (
          <li key={p.telefone} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="tabular-nums">{telefoneLegivel(p.telefone)}</span>
            <span className="text-vg-text-2">{p.grupos.join(", ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Conteúdo da janela "Grupos duplicados": grupos ativos da campanha com o mesmo nome — carregado quando a
 *  janela abre. */
export function GruposDuplicados({ campanhaId }: { campanhaId: string }) {
  const [estado, setEstado] = useState<{ lista?: GrupoDuplicado[]; erro?: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    gruposDuplicados(campanhaId).then((r) => {
      if (vivo) setEstado(r.erro ? { erro: r.erro } : { lista: r.duplicados ?? [] });
    });
    return () => {
      vivo = false;
    };
  }, [campanhaId]);

  if (!estado) return <p className="text-sm text-vg-muted">Carregando…</p>;
  if (estado.erro) return <p role="alert" className="text-sm text-vg-erro">{estado.erro}</p>;
  if (!estado.lista?.length) return <Vazio texto="Nenhum nome duplicado entre os grupos ativos." compacto />;
  return (
    <ul className="divide-y divide-vg-line text-sm">
      {estado.lista.map((g) => (
        <li key={g.nome} className="flex flex-wrap items-center justify-between gap-2 py-2">
          <span>{g.nome}</span>
          <span className="text-vg-text-2">{g.grupos.map((x) => `#${x.numero}`).join(", ")}</span>
        </li>
      ))}
    </ul>
  );
}
