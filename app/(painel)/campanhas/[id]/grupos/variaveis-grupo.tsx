"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { linhasDeValores, validarValorPorTipo, type TipoVariavel, ROTULO_TIPO_VARIAVEL } from "@/src/lib/regras/variaveis-globais";
import { Icone } from "../../../_componentes/icone";
import { Tabela, estiloBotao, estiloInput } from "../../../_componentes/ui";
import { salvarValoresGrupo, valoresDoGrupo } from "./actions";

const POR_PAGINA = 10;

/**
 * Conteúdo da janela "Valores das variáveis no grupo": subtítulo com o nome do grupo; uma linha por variável
 * (globais + as que só existem na campanha), com o valor deste grupo (vazio = herda o da campanha, mostrado como
 * dica); a tabela aparece sempre, mesmo vazia. Os valores de hoje são carregados quando a janela abre (não
 * no carregamento da página inteira de Grupos). Salva só o que mudou. Paginação de 10 em memória (sem ida ao
 * servidor: a lista já está toda carregada).
 */
export function VariaveisGrupo({ campanhaId, grupoId, grupoNome, globais, variaveisCampanha }: {
  campanhaId: string;
  grupoId: string;
  grupoNome: string;
  globais: { chave: string; tipo: string }[];
  variaveisCampanha: { chave: string; valor: string }[];
}) {
  const [variaveisGrupo, setVariaveisGrupo] = useState<{ chave: string; valor: string }[] | null>(null);
  const [erroCarregar, setErroCarregar] = useState<string | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});

  // `linhasDeValores` dá a lista completa de chaves (globais + só-da-campanha) com o valor da campanha; o valor
  // deste grupo (pra inicializar `valores`) vem do que `valoresDoGrupo` carregar quando a janela abre.
  const linhasCampanha = useMemo(() => linhasDeValores(globais, variaveisCampanha), [globais, variaveisCampanha]);

  useEffect(() => {
    let vivo = true;
    valoresDoGrupo(grupoId, campanhaId).then((r) => {
      if (!vivo) return;
      if (r.erro) return setErroCarregar(r.erro);
      const doGrupo = r.valores ?? [];
      const valorGrupoPorChave = new Map(doGrupo.map((v) => [v.chave, v.valor]));
      setValores(Object.fromEntries(linhasCampanha.map((l) => [l.chave, valorGrupoPorChave.get(l.chave) ?? ""])));
      setVariaveisGrupo(doGrupo);
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `linhasCampanha` só é usada pra inicializar; recalcular
    // a partir dela de novo depois que o grupo já carregou apagaria o que a pessoa está digitando.
  }, [grupoId, campanhaId]); // Carrega uma vez ao abrir a janela (ela só monta o conteúdo quando aberta).

  const valorGrupoPorChave = useMemo(() => new Map((variaveisGrupo ?? []).map((v) => [v.chave, v.valor])), [variaveisGrupo]);
  const linhas = useMemo(() => linhasCampanha.map((l) => ({ ...l, valorCampanha: l.valor, valor: valorGrupoPorChave.get(l.chave) ?? "" })), [linhasCampanha, valorGrupoPorChave]);

  const [erros, setErros] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [pagina, setPagina] = useState(1);

  const valorDe = (chave: string) => valores[chave] ?? "";
  const mudadas = linhas.filter((l) => valorDe(l.chave) !== l.valor);
  const totalPaginas = Math.max(1, Math.ceil(linhas.length / POR_PAGINA));
  const paginaAtual = Math.min(pagina, totalPaginas);
  const de = (paginaAtual - 1) * POR_PAGINA;
  const visiveis = linhas.slice(de, de + POR_PAGINA);

  async function salvar() {
    setMsg(null);
    const locais: Record<string, string> = {};
    for (const l of mudadas) {
      const v = valorDe(l.chave).trim();
      const e = l.global && v ? validarValorPorTipo(l.tipo, v) : null;
      if (e) locais[l.chave] = e;
    }
    setErros(locais);
    if (Object.keys(locais).length) return setMsg({ texto: "Confira os valores marcados: nada foi salvo.", erro: true });
    if (!mudadas.length) return setMsg({ texto: "Nada mudou.", erro: false });
    setOcupado(true);
    try {
      const r = await salvarValoresGrupo(grupoId, campanhaId, mudadas.map((l) => ({ chave: l.chave, valor: valorDe(l.chave).trim() })));
      setErros(r.erros ?? {});
      setMsg({ texto: r.erro ?? "Valores salvos.", erro: Boolean(r.erro) });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-xl space-y-1">
          <p className="text-sm font-medium text-vg-text">{grupoNome}</p>
          <p className="text-sm text-vg-muted">
            Defina valores específicos para este grupo. Deixe em branco ou use restaurar para herdar o valor configurado na campanha.
          </p>
        </div>
        <Link href="/variaveis" className={estiloBotao("contorno")}>
          <Icone nome="data_object" />
          Abrir painel de variáveis
        </Link>
      </div>

      {erroCarregar && <p role="alert" className="text-sm text-vg-erro">{erroCarregar}</p>}
      {variaveisGrupo === null && !erroCarregar && <p className="text-sm text-vg-muted">Carregando…</p>}

      {variaveisGrupo !== null && (
        <Tabela
          colunas={["Nome", "Tipo", "Valor no grupo"]}
          vazio={
            linhas.length === 0
              ? 'Você ainda não tem variáveis globais. Crie variáveis na seção "Variáveis globais" para definir os valores desta campanha aqui.'
              : undefined
          }
        >
          {visiveis.map((l) => {
            const erro = erros[l.chave];
            const idErro = `erro-variavel-grupo-${l.chave}`;
            return (
              <tr key={l.chave}>
                <td className="px-3 py-2.5 align-top"><code className="rounded bg-vg-panel-2 px-1 text-vg-accent-3">{`{${l.chave}}`}</code></td>
                <td className="whitespace-nowrap px-3 py-2.5 align-top text-vg-text-2">{l.global ? (ROTULO_TIPO_VARIAVEL[l.tipo as TipoVariavel] ?? l.tipo) : "Texto"}</td>
                <td className="min-w-[220px] px-3 py-1.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      className={`${estiloInput} ${erro ? "border-vg-erro" : ""}`}
                      value={valorDe(l.chave)}
                      maxLength={2000}
                      placeholder={l.valorCampanha ? `Herda: ${l.valorCampanha}` : "(herda o da campanha, hoje vazio)"}
                      aria-label={`Valor de {${l.chave}} neste grupo`}
                      aria-invalid={erro ? true : undefined}
                      aria-describedby={erro ? idErro : undefined}
                      onChange={(e) => setValores({ ...valores, [l.chave]: e.target.value })}
                    />
                    {valorDe(l.chave) !== "" && (
                      <button
                        type="button"
                        title="Restaurar (voltar a herdar o valor da campanha)"
                        aria-label={`Restaurar {${l.chave}} (herdar da campanha)`}
                        onClick={() => setValores({ ...valores, [l.chave]: "" })}
                        className="grid size-8 shrink-0 place-items-center rounded-md text-vg-text-2 transition-colors hover:bg-white/5 hover:text-white"
                      >
                        <Icone nome="restart_alt" tamanho={18} />
                      </button>
                    )}
                  </div>
                  {erro && <p id={idErro} className="mt-1 text-xs text-vg-erro">{erro}</p>}
                </td>
              </tr>
            );
          })}
        </Tabela>
      )}

      {linhas.length > 0 && (
        <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm">
          <span className="tabular-nums text-vg-text">{de + 1}-{Math.min(de + POR_PAGINA, linhas.length)} de {linhas.length}</span>
          <span className="flex items-center">
            <button
              type="button"
              aria-label="Página anterior"
              disabled={paginaAtual <= 1}
              onClick={() => setPagina(paginaAtual - 1)}
              className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
            >
              <Icone nome="chevron_left" />
            </button>
            <button
              type="button"
              aria-label="Próxima página"
              disabled={paginaAtual >= totalPaginas}
              onClick={() => setPagina(paginaAtual + 1)}
              className="grid size-8 place-items-center rounded-full text-vg-text hover:bg-white/5 disabled:pointer-events-none disabled:text-vg-text-3"
            >
              <Icone nome="chevron_right" />
            </button>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        <p role="status" className={`text-sm empty:hidden ${msg?.erro ? "text-vg-erro" : "text-vg-muted"}`}>{msg?.texto}</p>
        <button type="button" disabled={ocupado || variaveisGrupo === null || !linhas.length} onClick={salvar} className={estiloBotao()}>
          {ocupado ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
