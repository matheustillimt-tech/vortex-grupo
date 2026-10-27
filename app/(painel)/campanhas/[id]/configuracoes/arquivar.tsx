"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Botao } from "../../../_componentes/ui";
import { arquivarCampanha } from "../../actions";

export function Arquivar({ campanhaId, arquivada }: { campanhaId: string; arquivada: boolean }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);

  const alternar = async () => {
    if (!arquivada && !confirm("Arquivar esta campanha? O link para de funcionar.")) return;
    const r = await arquivarCampanha(campanhaId, !arquivada);
    setErro(r.erro ?? null);
    if (!r.erro) router.refresh();
  };

  return (
    <div className="space-y-2">
      <Botao variante={arquivada ? "secundario" : "perigo"} onClick={alternar}>
        {arquivada ? "Reativar campanha" : "Arquivar campanha"}
      </Botao>
      {erro && <p className="text-sm text-vg-erro">{erro}</p>}
    </div>
  );
}
