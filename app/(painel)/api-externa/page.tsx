import Link from "next/link";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { ENDPOINTS_API } from "@/src/lib/api/endpoints";
import { membroAtual } from "@/src/lib/permissoes";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { Pagina, Tabela } from "../_componentes/ui";
import { COLUNAS_CHAVE, SITE_URL_PADRAO, type ChaveLinha } from "./comum";
import { AcessosAtendentes } from "./acessos";
import { carregarAcessosAdmin } from "./acessos-dados";
import { BotaoNovaChave, TabelaChaves } from "./lista";

export const dynamic = "force-dynamic";

type Aba = "keys" | "endpoints" | "docs";

function abaValida(v: string | string[] | undefined): Aba {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "endpoints" || s === "docs" ? s : "keys";
}

/** `curl` de exemplo pra um endpoint do catálogo, com a URL do site e um placeholder pra chave. */
function curlDoEndpoint(siteUrl: string, e: (typeof ENDPOINTS_API)[number]): string {
  const base = `curl ${e.metodo === "POST" ? "-X POST " : ""}"${siteUrl}${e.caminho}" \\\n  -H "Authorization: Bearer SUA_CHAVE"`; // gitleaks:allow (exemplo com marcador, não é chave)
  if (!e.corpoExemplo) return base;
  return `${base} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(e.corpoExemplo)}'`;
}

/** API: API própria do Vórtex Grupo por chave `vg_…`, abas Keys/Endpoints/Documentação. */
export default async function ApiExterna({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const sp = await searchParams;
  const aba = abaValida(sp.aba);
  // Administrador = `membro.papel === "admin"` (o mesmo que "equipe"/"editar"); aprovar/recusar/revogar acesso de
  // atendente confere de novo no servidor, na ação.
  const { usuario, membro } = await membroAtual();
  const podeAdmin = membro?.papel === "admin";
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL_PADRAO;

  const db = await dbUsuario();
  // As chaves filhas (dos atendentes, `acesso_de`) não entram na lista: o Administrador nunca as vê nem revoga daqui
  // (revoga o acesso, em "Acessos de atendentes").
  const { data, error } = await db.from("api_chaves").select(COLUNAS_CHAVE).eq("tipo", "api").is("acesso_de", null).order("created_at", { ascending: false });
  if (error) throw new Error(`Não foi possível carregar as chaves: ${error.message}`);
  const chaves = (data ?? []) as ChaveLinha[];
  const acessos = aba === "keys" && podeAdmin ? await carregarAcessosAdmin() : [];
  const { count: meus } = aba === "keys"
    ? await dbAdmin().from("api_acessos").select("id", { count: "exact", head: true }).eq("solicitante", usuario.id)
    : { count: 0 };

  return (
    <Pagina
      acoes={podeAdmin && aba === "keys" ? <BotaoNovaChave tipo="api" rotulo="CADASTRAR" titulo="Nova chave" /> : undefined}
    >
      <Abas
        itens={[
          { href: "/api-externa?aba=keys", rotulo: "Keys", ativo: aba === "keys" },
          { href: "/api-externa?aba=endpoints", rotulo: "Endpoints", ativo: aba === "endpoints" },
          { href: "/api-externa?aba=docs", rotulo: "Documentação (API)", ativo: aba === "docs" },
        ]}
      />

      {aba === "keys" && (
        <div className="space-y-6">
          <TabelaChaves chaves={chaves} podeRevogar={podeAdmin} podeCompartilhar={podeAdmin} vazio="Nenhuma Key registrada!" />
          {(meus ?? 0) > 0 && (
            <p className="text-sm text-vg-text-2">
              <Link href="/api-externa/acesso" className="text-vg-accent hover:opacity-80">Meus acessos ({meus})</Link>: as chaves que você pediu a um administrador.
            </p>
          )}
          <section className="space-y-2 text-sm text-vg-text-2">
            <h2 className="text-[15px] font-medium text-vg-text">Autorização de chaves por conta</h2>
            <p>Cada chave fica vinculada a uma pessoa: quem criou (<code className="text-vg-text-2">criada_por</code>) ou, no caso da chave de um atendente, quem pediu o acesso. Ela nunca passa pra outra pessoa.</p>
            <p>Use as restrições por módulo: uma chave vale para leitura, ou para leitura e envio, no catálogo inteiro de endpoints — não há recorte além desses dois escopos.</p>
            <p>Atendentes pedem acesso à conta em atendimento pelo link que um administrador compartilha ("Compartilhar acesso"); ele aprova, recusa ou revoga em "Acessos de atendentes" a qualquer momento, e a chave do atendente é gerada só depois da aprovação, com o mesmo escopo da chave original.</p>
            <p>Uma chave não troca de conta: revogar a chave original revoga junto, na hora, qualquer chave de atendente gerada a partir dela — ninguém continua com acesso depois disso.</p>
          </section>
          {podeAdmin && <AcessosAtendentes acessos={acessos} />}
        </div>
      )}

      {aba === "endpoints" && (
        <Tabela colunas={["Método", "Caminho", "Escopo", "Descrição"]}>
          {ENDPOINTS_API.map((e) => (
            <tr key={`${e.metodo} ${e.caminho}`}>
              <td className="px-3 py-2.5"><code className="text-vg-accent-3">{e.metodo}</code></td>
              <td className="px-3 py-2.5"><code className="text-vg-text-2">{e.caminho}</code></td>
              <td className="px-3 py-2.5 text-vg-text-2">{e.escopo === "envio" ? "Leitura e envio" : "Leitura"}</td>
              <td className="px-3 py-2.5 text-vg-text-2">{e.descricao}</td>
            </tr>
          ))}
        </Tabela>
      )}

      {aba === "docs" && (
        <div className="space-y-4">
          <p className="text-sm text-vg-text-2">
            Toda chamada leva o cabeçalho <code className="text-vg-text-2">Authorization: Bearer SUA_CHAVE</code>. Erros voltam como{" "}
            <code className="text-vg-text-2">{"{ erro }"}</code>; limite de 60 chamadas por minuto por chave.
          </p>
          {ENDPOINTS_API.map((e) => (
            <section key={`${e.metodo} ${e.caminho}`} className="space-y-1.5 rounded-xl border border-vg-line p-4">
              <p className="text-sm font-medium">
                <code className="text-vg-accent-3">{e.metodo}</code> <code className="text-vg-text">{e.caminho}</code>
              </p>
              <p className="text-xs text-vg-muted">{e.descricao}</p>
              <pre className="overflow-x-auto rounded-lg border border-vg-line-2 bg-vg-panel-3 p-3 text-xs text-vg-text-2">{curlDoEndpoint(siteUrl, e)}</pre>
            </section>
          ))}
        </div>
      )}
    </Pagina>
  );
}
