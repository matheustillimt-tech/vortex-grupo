import { bloqueio } from "@/app/(painel)/_componentes/guarda";
import { permitido } from "@/src/lib/permissoes";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { Abas } from "../_componentes/abas";
import { COLUNAS_CHAVE, SITE_URL_PADRAO, type ChaveLinha } from "../api-externa/comum";
import { BotaoNovaChave, TabelaChaves } from "../api-externa/lista";
import { Cartao, Pagina } from "../_componentes/ui";

export const dynamic = "force-dynamic";

type Aba = "conexoes" | "claude" | "chatgpt" | "oauth";

function abaValida(v: string | string[] | undefined): Aba {
  const s = Array.isArray(v) ? v[0] : v;
  return s === "claude" || s === "chatgpt" || s === "oauth" ? s : "conexoes";
}

const pre = "overflow-x-auto rounded-lg border border-vg-line-2 bg-vg-panel-3 p-3 text-xs text-vg-text-2";

/** MCP: servidor MCP do Vórtex Grupo, pra assistentes de IA (Claude por agora) chamarem os dados e ações
 *  do painel. Abas Conexões/Guia Claude/Guia ChatGPT/Endpoints OAuth. */
export default async function Mcp({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const b = await bloqueio("webhooks");
  if (b) return b;
  const sp = await searchParams;
  const aba = abaValida(sp.aba);
  const podeAdmin = await permitido("equipe", "editar");
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL_PADRAO;
  const urlMcp = `${siteUrl}/api/mcp`;

  const db = await dbUsuario();
  const { data, error } = await db.from("api_chaves").select(COLUNAS_CHAVE).eq("tipo", "mcp").order("created_at", { ascending: false });
  if (error) throw new Error(`Não foi possível carregar as conexões: ${error.message}`);
  const chaves = (data ?? []) as ChaveLinha[];

  return (
    <Pagina
      subtitulo="Gerencie os assistentes que podem acessar os dados do Vórtex Grupo."
      acoes={podeAdmin && aba === "conexoes" ? <BotaoNovaChave tipo="mcp" rotulo="Conectar assistente" titulo="Conectar assistente" /> : undefined}
    >
      <Abas
        itens={[
          { href: "/mcp?aba=conexoes", rotulo: "Conexões", ativo: aba === "conexoes" },
          { href: "/mcp?aba=claude", rotulo: "Guia Claude", ativo: aba === "claude" },
          { href: "/mcp?aba=chatgpt", rotulo: "Guia ChatGPT", ativo: aba === "chatgpt" },
          { href: "/mcp?aba=oauth", rotulo: "Endpoints OAuth", ativo: aba === "oauth" },
        ]}
      />

      {aba === "conexoes" && (
        <TabelaChaves
          chaves={chaves}
          podeRevogar={podeAdmin}
          vazio="Nenhuma conexão ainda"
          vazioDetalhe="Conecte o ChatGPT, Claude ou outro assistente compatível ao Vórtex Grupo com permissões controladas."
          semCabecalhoQuandoVazio
        />
      )}

      {aba === "claude" && (
        <div className="space-y-4">
          <Cartao titulo="Claude Code (linha de comando)">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-vg-text-2">
              <li>Em “Conexões”, clique em “Conectar assistente” e copie a chave (ela só aparece uma vez).</li>
              <li>
                No terminal, rode:
                <pre className={`${pre} mt-1.5`}>{`claude mcp add --transport http vortex-grupo ${urlMcp} \\\n  --header "Authorization: Bearer SUA_CHAVE"`}</pre>
              </li>
              <li>Troque <code className="text-vg-text-2">SUA_CHAVE</code> pela chave que você copiou. Pronto: <code className="text-vg-text-2">claude mcp list</code> mostra “vortex-grupo” conectado.</li>
            </ol>
          </Cartao>
          <Cartao titulo="Claude Desktop (app)">
            <p className="mb-2 text-sm text-vg-text-2">
              O Claude Desktop ainda não conecta direto num servidor HTTP remoto: precisa da ponte{" "}
              <code className="text-vg-text-2">mcp-remote</code>, que roda local e repassa pro Vórtex Grupo — por isso é preciso ter o{" "}
              <strong className="text-vg-text">Node.js instalado</strong> na máquina. Edite (ou crie) o arquivo{" "}
              <code className="text-vg-text-2">claude_desktop_config.json</code> — no Mac fica em{" "}
              <code className="text-vg-text-2">~/Library/Application Support/Claude/claude_desktop_config.json</code> — e acrescente:
            </p>
            <pre className={pre}>{JSON.stringify(
              {
                mcpServers: {
                  "vortex-grupo": {
                    command: "npx",
                    args: ["-y", "mcp-remote", urlMcp, "--header", "Authorization:${AUTH}"],
                    env: { AUTH: "Bearer SUA_CHAVE" },
                  },
                },
              },
              null,
              2,
            )}</pre>
            <p className="mt-2 text-xs text-vg-muted">Salve e reabra o Claude Desktop: o terminal do app abre a janela de confirmação do mcp-remote na primeira vez.</p>
          </Cartao>
          <p className="text-xs text-vg-muted">Se aparecer 401, a chave está errada ou foi revogada.</p>
        </div>
      )}

      {aba === "chatgpt" && (
        <Cartao titulo="Guia ChatGPT">
          <p className="text-sm text-vg-text-2">
            O ChatGPT só conecta um servidor MCP por OAuth (ele mesmo abre uma tela de login): não aceita colar uma chave <code className="text-vg-text-2">Authorization: Bearer</code>{" "}
            como o Claude faz. O Vórtex Grupo ainda não tem esse fluxo de OAuth (veja a aba “Endpoints OAuth”) — por enquanto, use o Claude (Code ou Desktop) pra conectar um assistente de IA ao Vórtex Grupo.
          </p>
        </Cartao>
      )}

      {aba === "oauth" && (
        <Cartao titulo="Endpoints OAuth">
          <p className="text-sm text-vg-text-2">
            O Vórtex Grupo ainda não tem servidor de OAuth (<code className="text-vg-text-2">/authorize</code>, <code className="text-vg-text-2">/token</code>, descoberta por{" "}
            <code className="text-vg-text-2">/.well-known/oauth-authorization-server</code>): a autenticação do MCP hoje é só pela chave <code className="text-vg-text-2">vg_…</code>, no cabeçalho{" "}
            <code className="text-vg-text-2">Authorization: Bearer</code>. É o que falta pra conectores que exigem OAuth, como o ChatGPT.
          </p>
        </Cartao>
      )}
    </Pagina>
  );
}
