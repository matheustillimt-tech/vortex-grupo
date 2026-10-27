"use client";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { criarChave, revogarChave } from "../_componentes/chaves-acoes";
import { BotaoCompartilharAcesso } from "./acessos";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloCartaoDestaque, estiloInput, Selo, Tabela, type CorSelo } from "../_componentes/ui";
import { ROTULO_ESCOPO, type ChaveLinha } from "./comum";

const ESCOPOS: { valor: "leitura" | "envio"; rotulo: string }[] = [
  { valor: "leitura", rotulo: "Leitura" },
  { valor: "envio", rotulo: "Leitura e envio" },
];

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Mostra a chave em texto UMA vez (criação), com Copiar e o aviso padrão (idêntico ao segredo do Hooks). */
function JanelaChaveMostrada({ chave, aoFechar }: { chave: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Janela aberta aoFechar={aoFechar} titulo="Chave criada">
      <div className="space-y-4">
        <p className={`${estiloCartaoDestaque} p-3 text-sm`}>Guarde agora: ela não aparece de novo.</p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 px-3 py-2 text-xs text-vg-text-2">{chave}</code>
          <button
            type="button"
            className={estiloBotao("secundario")}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(chave);
                setCopiado(true);
              } catch {
                // sem permissão de clipboard: a pessoa seleciona e copia à mão (o código já tem select-all)
              }
            }}
          >
            {copiado ? "Copiado!" : "Copiar"}
          </button>
        </div>
        <p className="text-xs text-vg-muted">
          Use no cabeçalho <code className="text-vg-text-2">Authorization: Bearer {"<chave>"}</code> de cada chamada.
        </p>
        <div className="flex justify-end">
          <button type="button" className={estiloBotao()} onClick={aoFechar}>FECHAR</button>
        </div>
      </div>
    </Janela>
  );
}

/** Janela "CADASTRAR" (nome + escopo). `tipo` separa API ("api") de MCP ("mcp"). */
function JanelaNovaChave({ tipo, titulo, aoFechar }: { tipo: "api" | "mcp"; titulo: string; aoFechar: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [escopo, setEscopo] = useState<"leitura" | "envio">("leitura");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const idNome = useId();

  function salvar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await criarChave(nome, escopo, tipo);
        if (r.erro) return setErro(r.erro);
        if (r.chave) setChaveNova(r.chave);
      } catch {
        setErro("Não foi possível criar. Tente de novo.");
      }
    });
  }

  if (chaveNova) {
    return (
      <JanelaChaveMostrada
        chave={chaveNova}
        aoFechar={() => {
          aoFechar();
          router.refresh();
        }}
      />
    );
  }

  return (
    <Janela aberta aoFechar={aoFechar} titulo={titulo}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
        <label htmlFor={idNome} className="block space-y-1.5">
          <span className="text-[13.3px] text-[#e3e9e5]">Nome</span>
          <input id={idNome} className={estiloInput} value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Zapier, CRM, Claude" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-[13.3px] text-[#e3e9e5]">Escopo</legend>
          <div role="radiogroup" aria-label="Escopo" className="flex flex-wrap gap-2">
            {ESCOPOS.map((o) => (
              <label
                key={o.valor}
                className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors ${
                  escopo === o.valor ? "border-vg-accent/60 bg-vg-accent/10 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:border-white/60"
                }`}
              >
                <input type="radio" name="escopo" className="sr-only" checked={escopo === o.valor} onChange={() => setEscopo(o.valor)} />
                {o.rotulo}
              </label>
            ))}
          </div>
          <p className="text-xs text-vg-muted">Leitura e envio também enxerga tudo de leitura; só ela pode criar ações (enviar mensagem, abrir/fechar grupos…).</p>
        </fieldset>
        <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
        <div className="flex justify-end gap-2">
          <button type="button" className={estiloBotao("secundario")} onClick={aoFechar}>CANCELAR</button>
          <button type="submit" className={estiloBotao()} disabled={ocupado || !nome.trim()}>
            {ocupado ? "Criando…" : "SALVAR"}
          </button>
        </div>
      </form>
    </Janela>
  );
}

export function BotaoNovaChave({ tipo, rotulo, titulo }: { tipo: "api" | "mcp"; rotulo: string; titulo: string }) {
  const [aberta, setAberta] = useState(false);
  const [vez, setVez] = useState(0);
  return (
    <>
      <button type="button" className={estiloBotao("contorno")} onClick={() => { setVez((v) => v + 1); setAberta(true); }}>
        <Icone nome="add" />
        {rotulo}
      </button>
      {aberta && <JanelaNovaChave key={vez} tipo={tipo} titulo={titulo} aoFechar={() => setAberta(false)} />}
    </>
  );
}

const COR_REVOGADA: CorSelo = "neutro";
const COR_ATIVA: CorSelo = "ok";

/** Tabela das chaves (Keys do API, Conexões do MCP: mesmo componente). `podeRevogar`: Administrador.
 *  `podeCompartilhar` (só na API, Administrador): "Compartilhar acesso" nas chaves ativas (Etapa 3K, Tarefa 7).
 *  `vazioDetalhe` + `semCabecalhoQuandoVazio`: 2ª linha do vazio sem o cabeçalho da tabela. */
export function TabelaChaves({
  chaves,
  podeRevogar,
  vazio,
  podeCompartilhar = false,
  vazioDetalhe,
  semCabecalhoQuandoVazio = false,
}: {
  chaves: ChaveLinha[];
  podeRevogar: boolean;
  vazio: string;
  podeCompartilhar?: boolean;
  vazioDetalhe?: string;
  semCabecalhoQuandoVazio?: boolean;
}) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function revogar(c: ChaveLinha) {
    if (!window.confirm(`Revogar a chave "${c.nome}"? Quem usa essa chave pára de conseguir chamar a API/MCP na hora (inclusive as chaves dos atendentes com acesso a ela); não dá pra desfazer.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await revogarChave(c.id);
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível revogar. Tente de novo.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <Tabela
        colunas={["Nome", "Prefixo", "Escopo", "Criada", "Último uso", podeRevogar ? "" : ""]}
        vazio={chaves.length ? undefined : vazio}
        vazioDetalhe={chaves.length ? undefined : vazioDetalhe}
        semCabecalhoQuandoVazio={semCabecalhoQuandoVazio}
      >
        {chaves.map((c) => (
          <tr key={c.id}>
            <td className="px-3 py-2.5">{c.nome}</td>
            <td className="px-3 py-2.5"><code className="rounded bg-vg-panel-2 px-1 text-vg-accent-3">vg_{c.prefixo}…</code></td>
            <td className="px-3 py-2.5 text-vg-text-2">{ROTULO_ESCOPO[c.escopo]}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{dataCurta(c.created_at)}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{dataCurta(c.ultimo_uso)}</td>
            <td className="px-3 py-2.5 text-right">
              {c.revogada_em ? (
                <Selo cor={COR_REVOGADA}>Revogada</Selo>
              ) : podeRevogar ? (
                <span className="inline-flex items-center gap-3 whitespace-nowrap">
                  {podeCompartilhar && c.tipo === "api" && <BotaoCompartilharAcesso chaveId={c.id} nome={c.nome} />}
                  <button type="button" className="text-xs font-medium text-vg-erro transition-colors hover:text-red-300" disabled={ocupado} onClick={() => revogar(c)}>
                    Revogar
                  </button>
                </span>
              ) : (
                <Selo cor={COR_ATIVA}>Ativa</Selo>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
