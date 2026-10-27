"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Botao, estiloInput, Segmentos } from "../_componentes/ui";
import { criarConexao } from "./actions";

type Estado = { imagem?: string | null; codigo?: string | null; erro?: string | null; conectado?: boolean };

export function Conectar({ conexaoId: inicial }: { conexaoId?: string }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [id, setId] = useState<string | undefined>(inicial);
  const [modo, setModo] = useState<"qr" | "codigo">("qr");
  const [telefone, setTelefone] = useState("");
  const [estado, setEstado] = useState<Estado>({});
  const [ate, setAte] = useState(0);

  // QR: busca o QR novo (e o status) a cada 2,5 s. Código: depois que o código aparece, pergunta o status até
  // conectar. Para no conectado, no erro ou quando passam os 2 min.
  const aguardandoCodigo = modo === "codigo" && !!estado.codigo;
  useEffect(() => {
    if (!id || estado.conectado || estado.erro || Date.now() > ate) return;
    if (modo === "codigo" && !aguardandoCodigo) return;
    const rota = modo === "qr" ? "qr" : "status";
    const t = setInterval(async () => {
      if (Date.now() > ate) return clearInterval(t);
      let r: Estado;
      try {
        r = (await fetch(`/api/conexoes/${id}/${rota}`).then((x) => x.json())) as Estado;
      } catch {
        return; // rede ou resposta fora do formato: tenta de novo no próximo intervalo
      }
      setEstado((atual) => (modo === "codigo" ? { ...atual, ...r } : r));
      if (r.conectado || r.erro) {
        clearInterval(t);
        router.refresh();
      }
    }, 2500);
    return () => clearInterval(t);
  }, [id, modo, ate, aguardandoCodigo, estado.conectado, estado.erro, router]);

  async function iniciar() {
    let alvo = id;
    if (!alvo) {
      const r = await criarConexao(nome);
      if (r.erro) return setEstado({ erro: r.erro });
      alvo = r.id;
      setId(alvo);
    }
    setEstado({});
    setAte(Date.now() + 120_000);
    if (modo === "codigo") {
      try {
        const r = (await fetch(`/api/conexoes/${alvo}/pareamento`, { method: "POST", body: JSON.stringify({ telefone }) }).then((x) => x.json())) as Estado;
        setEstado(r);
      } catch {
        setEstado({ erro: "O Zapbot não respondeu. Tente de novo." });
      }
    }
  }

  const expirou = ate > 0 && Date.now() > ate && !estado.conectado;

  return (
    <div className="space-y-3">
      {!inicial && (
        <input
          className={estiloInput}
          placeholder="Nome do número (ex.: Captação 01)"
          aria-label="Nome do número"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
        />
      )}
      <Segmentos<"qr" | "codigo"> opcoes={[{ valor: "qr", rotulo: "QR code" }, { valor: "codigo", rotulo: "Código de pareamento" }]} valor={modo} aoMudar={setModo} />
      {modo === "codigo" && (
        <input
          className={estiloInput}
          placeholder="Número que vai conectar (DDD + número)"
          aria-label="Número que vai conectar"
          value={telefone}
          onChange={(e) => setTelefone(e.target.value)}
        />
      )}
      <Botao onClick={iniciar}>{ate ? "Gerar novo" : "Conectar"}</Botao>
      {estado.imagem && !estado.conectado && <img src={estado.imagem} alt="QR code" className="size-64 rounded-lg bg-white p-2" />}
      {estado.codigo && <p className="text-3xl font-bold tracking-widest">{estado.codigo}</p>}
      {(estado.imagem || estado.codigo) && !estado.conectado && (
        <p className="text-xs text-vg-muted">No celular: WhatsApp › Aparelhos conectados › Conectar um aparelho{modo === "codigo" ? " › Conectar com número de telefone" : ""}.</p>
      )}
      {estado.conectado && <p className="text-vg-ok">Conectado!</p>}
      {estado.erro && <p className="text-sm text-vg-erro">{estado.erro}</p>}
      {expirou && <p className="text-sm text-vg-muted">O código expirou. Clique em "Gerar novo".</p>}
    </div>
  );
}
