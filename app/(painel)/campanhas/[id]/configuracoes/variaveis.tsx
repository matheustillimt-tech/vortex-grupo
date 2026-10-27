"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { CHAVES_AUTOMATICAS } from "@/src/lib/regras/variaveis";
import { linhasDeValores, MAXIMO_GLOBAIS_NA_CAMPANHA as MAXIMO_GLOBAIS, ROTULO_TIPO_VARIAVEL, validarValorPorTipo, type TipoVariavel } from "@/src/lib/regras/variaveis-globais";
import { Icone } from "../../../_componentes/icone";
import { Tabela, estiloBotao, estiloInput } from "../../../_componentes/ui";
import { removerVariavel, salvarValores } from "./actions";

const POR_PAGINA_VARIAVEIS = 20;

/** Paginação da tabela "Variáveis": client-side (sem
 *  `?pagina=` na URL — a lista inteira já vem carregada), por isso não reaproveita `<Paginacao>` (que é por
 *  link). Aparece mesmo com a tabela vazia ("0-0 de 0"). */
function PaginacaoVariaveis({ de, ate, total, pagina, totalPaginas, aoMudar }: {
  de: number;
  ate: number;
  total: number;
  pagina: number;
  totalPaginas: number;
  aoMudar: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-end gap-3 text-sm">
      <span className="tabular-nums text-vg-text">{de}-{ate} de {total}</span>
      <span className="flex items-center">
        <button
          type="button"
          onClick={() => aoMudar(pagina - 1)}
          disabled={pagina <= 1}
          aria-label="Página anterior"
          className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
        >
          <Icone nome="chevron_left" />
        </button>
        <button
          type="button"
          onClick={() => aoMudar(pagina + 1)}
          disabled={pagina >= totalPaginas}
          aria-label="Próxima página"
          className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
        >
          <Icone nome="chevron_right" />
        </button>
      </span>
    </div>
  );
}

const DICA: Partial<Record<string, { placeholder: string; inputMode?: "url" | "numeric" | "decimal" }>> = {
  link: { placeholder: "https://…", inputMode: "url" },
  data: { placeholder: "dd/mm/aaaa", inputMode: "numeric" },
  numero: { placeholder: "Ex.: 97,90", inputMode: "decimal" },
};

/** "Variáveis": uma linha por variável global (valor editável, validado pelo tipo) e as
 *  chaves antigas só desta campanha (removíveis). Salva só o que mudou, tudo de uma vez. */
export function Variaveis({ campanhaId, globais, variaveis }: { campanhaId: string; globais: { chave: string; tipo: string }[]; variaveis: { chave: string; valor: string }[] }) {
  const router = useRouter();
  const linhas = useMemo(() => linhasDeValores(globais, variaveis), [globais, variaveis]);
  const iniciais = useMemo(() => Object.fromEntries(linhas.map((l) => [l.chave, l.valor])), [linhas]);
  const [valores, setValores] = useState<Record<string, string>>(iniciais);
  // Chegaram valores novos do servidor (router.refresh depois de salvar ou remover): o campo volta a mostrar o que
  // está gravado. Ajuste durante a renderização (padrão do React), sem efeito e sem perder a mensagem da tela.
  const assinatura = JSON.stringify(linhas);
  const [base, setBase] = useState(assinatura);
  if (base !== assinatura) {
    setBase(assinatura);
    setValores(iniciais);
  }
  const [erros, setErros] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, iniciar] = useTransition();
  const [pagina, setPagina] = useState(1);

  const valorDe = (chave: string) => valores[chave] ?? iniciais[chave] ?? "";
  const mudadas = linhas.filter((l) => valorDe(l.chave) !== l.valor);
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA_VARIAVEIS));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const de = (paginaAtual - 1) * POR_PAGINA_VARIAVEIS;
  const linhasDaPagina = linhas.slice(de, de + POR_PAGINA_VARIAVEIS);

  function salvar() {
    setMsg(null);
    const locais: Record<string, string> = {};
    for (const l of mudadas) {
      const e = l.global ? validarValorPorTipo(l.tipo, valorDe(l.chave).trim()) : null;
      if (e) locais[l.chave] = e;
    }
    setErros(locais);
    if (Object.keys(locais).length) return setMsg({ texto: "Confira os valores marcados: nada foi salvo.", erro: true });
    if (!mudadas.length) return setMsg({ texto: "Nada mudou.", erro: false });
    const enviados = mudadas.map((l) => ({ chave: l.chave, valor: valorDe(l.chave).trim() }));
    iniciar(async () => {
      try {
        const r = await salvarValores(campanhaId, enviados);
        setErros(r.erros ?? {});
        setMsg({ texto: r.erro ?? "Valores salvos.", erro: Boolean(r.erro) });
        if (r.erros) return;
        // O servidor grava sem espaços nas pontas: já deixa o campo igual; o refresh traz os valores gravados.
        setValores((v) => ({ ...v, ...Object.fromEntries(enviados.map((e) => [e.chave, e.valor])) }));
        router.refresh();
      } catch {
        setMsg({ texto: "Não foi possível salvar. Tente de novo.", erro: true });
      }
    });
  }

  function remover(chave: string) {
    if (!window.confirm(`Remover {${chave}} desta campanha?`)) return;
    setMsg(null);
    iniciar(async () => {
      try {
        const r = await removerVariavel(campanhaId, chave);
        setMsg(r.erro ? { texto: r.erro, erro: true } : null);
        router.refresh();
      } catch {
        setMsg({ texto: "Não foi possível remover. Tente de novo.", erro: true });
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-sm text-vg-muted">
          Use no texto como {"{nome}"}. Valor vazio bloqueia o envio que usa a variável. Já existem automáticas:{" "}
          {CHAVES_AUTOMATICAS.map((c) => `{${c}}`).join(", ")}.
        </p>
        <Link href="/variaveis" className={estiloBotao("contorno")}>
          <Icone nome="data_object" />
          Abrir painel de variáveis
        </Link>
      </div>

      {globais.length === 0 && (
        <p className="rounded-lg border border-vg-line bg-vg-panel-3 px-3 py-2.5 text-sm text-vg-text-2">
          Você ainda não tem variáveis globais. Crie variáveis na seção &apos;Variáveis globais&apos; para definir os valores desta campanha aqui.
        </p>
      )}
      {globais.length >= MAXIMO_GLOBAIS && <p className="text-xs text-vg-text-3">Mostrando as {MAXIMO_GLOBAIS} primeiras variáveis globais (ordem alfabética).</p>}

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          salvar();
        }}
      >
          <Tabela colunas={["Nome", "Tipo", "Valor na campanha", ""]}>
            {linhasDaPagina.map((l) => {
              const erro = erros[l.chave];
              const idErro = `erro-variavel-${l.chave}`;
              const dica = l.global ? DICA[l.tipo] : undefined;
              return (
                <tr key={l.chave}>
                  <td className="px-3 py-2.5 align-top"><code className="rounded bg-vg-panel-2 px-1 text-vg-accent-3">{`{${l.chave}}`}</code></td>
                  <td className="whitespace-nowrap px-3 py-2.5 align-top text-vg-text-2">{l.global ? (ROTULO_TIPO_VARIAVEL[l.tipo as TipoVariavel] ?? l.tipo) : "Texto (só desta campanha)"}</td>
                  <td className="min-w-[220px] px-3 py-1.5">
                    <input
                      className={`${estiloInput} ${erro ? "border-vg-erro" : ""}`}
                      value={valorDe(l.chave)}
                      maxLength={2000}
                      placeholder={dica?.placeholder ?? "(vazio bloqueia o envio)"}
                      inputMode={dica?.inputMode}
                      aria-label={`Valor de {${l.chave}}`}
                      aria-invalid={erro ? true : undefined}
                      aria-describedby={erro ? idErro : undefined}
                      onChange={(e) => setValores({ ...valores, [l.chave]: e.target.value })}
                    />
                    {erro && <p id={idErro} className="mt-1 text-xs text-vg-erro">{erro}</p>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {!l.global && (
                      <button
                        type="button"
                        disabled={ocupado}
                        onClick={() => remover(l.chave)}
                        aria-label={`Remover {${l.chave}} desta campanha`}
                        className="grid size-8 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-vg-erro disabled:opacity-40"
                      >
                        <Icone nome="delete" tamanho={18} />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </Tabela>
          <PaginacaoVariaveis
            de={linhas.length ? de + 1 : 0}
            ate={Math.min(de + POR_PAGINA_VARIAVEIS, linhas.length)}
            total={linhas.length}
            pagina={paginaAtual}
            totalPaginas={totalPaginas}
            aoMudar={setPagina}
          />
          <div className="flex flex-wrap items-center justify-end gap-3">
            <p role="status" className={`text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
            <button type="submit" className={estiloBotao()} disabled={ocupado}>{ocupado ? "Salvando…" : "Salvar"}</button>
          </div>
      </form>
    </div>
  );
}
