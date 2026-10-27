"use client";
import { hostDoSite } from "@/src/lib/site";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { slugDaUrl, urlDeeplinks, type FiltrosDeeplinks } from "./filtros";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloInput } from "../_componentes/ui";

/**
 * Botão `search` + diálogo "Pesquisar deeplink por url do Vórtex Grupo": extrai o `slug` de `/d/{slug}`
 * da URL colada (`slugDaUrl`, puro) e navega pra `?q={slug}` — a busca (`filtrarDeeplinks`) já casa `q` com o
 * slug inteiro. Só leitura: não grava nada, só troca o filtro da própria tela.
 */
export function BotaoPesquisarUrl({ filtros }: { filtros: FiltrosDeeplinks }) {
  const router = useRouter();
  const [aberta, setAberta] = useState(false);
  const [url, setUrl] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const idUrl = useId();

  function abrir() {
    setUrl("");
    setErro(null);
    setAberta(true);
  }

  function buscar() {
    const slug = slugDaUrl(url);
    if (!slug) return setErro("Não reconheci um link de deep link do Vórtex Grupo nessa URL.");
    setAberta(false);
    router.push(urlDeeplinks(filtros, { q: slug, pasta: null }));
  }

  return (
    <>
      <button type="button" aria-label="Pesquisar deeplink por url" className={estiloBotao("secundario")} onClick={abrir}>
        <Icone nome="search" />
      </button>
      <Janela aberta={aberta} aoFechar={() => setAberta(false)} titulo="Pesquisar deeplink por url do Vórtex Grupo">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            buscar();
          }}
        >
          <label htmlFor={idUrl} className="block space-y-1.5">
            <span className="text-[13.3px] text-[#e3e9e5]">Digite a URL do link do Vórtex Grupo que será pesquisado</span>
            <input
              id={idUrl}
              className={estiloInput}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={`https://${hostDoSite()}/d/…`}
              autoFocus
            />
          </label>
          <p role="alert" className="text-sm text-vg-erro empty:hidden">{erro}</p>
          <div className="flex justify-end">
            <button type="submit" className={estiloBotao()} disabled={!url.trim()}>Buscar</button>
          </div>
        </form>
      </Janela>
    </>
  );
}
