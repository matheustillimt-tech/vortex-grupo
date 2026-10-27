"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState, useTransition } from "react";
import { Icone } from "../_componentes/icone";
import { Janela } from "../_componentes/janela";
import { estiloBotao, estiloCartaoDestaque, estiloInput, Selo, Tabela, type CorSelo } from "../_componentes/ui";
import { aprovarAcesso, gerarConviteChave, recusarAcesso, revogarAcesso, solicitarAcesso, verChaveAcesso } from "./acessos-actions";
import { ROTULO_ESCOPO, ROTULO_STATUS_ACESSO, type AcessoLinha, type MeuAcessoLinha, type StatusAcessoLinha } from "./comum";

/** "Acessos de atendentes" da API (Etapa 3K, Tarefa 7). Só apresentação + chamadas às ações; toda conferência
 *  (Administrador, dono do pedido, link válido) é no servidor. */

function dataCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const COR_STATUS: Record<StatusAcessoLinha, CorSelo> = { aguardando: "aviso", aprovado: "ok", recusado: "erro", revogado: "neutro" };

/** Caixa com o segredo e "Copiar" (link do convite ou chave do atendente). */
function Segredo({ valor }: { valor: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 select-all break-all rounded-lg border border-vg-line-2 bg-vg-panel-3 px-3 py-2 text-xs text-vg-text-2">{valor}</code>
      <button
        type="button"
        className={estiloBotao("secundario")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(valor);
            setCopiado(true);
          } catch {
            // sem permissão de clipboard: a pessoa seleciona e copia à mão (o código já tem select-all)
          }
        }}
      >
        {copiado ? "Copiado!" : "Copiar"}
      </button>
    </div>
  );
}

// ---------- "Compartilhar acesso" (cartão da chave, Administrador) ----------

export function BotaoCompartilharAcesso({ chaveId, nome }: { chaveId: string; nome: string }) {
  const [aberta, setAberta] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function fechar() {
    setAberta(false);
    setLink(null); // o link aparece uma vez: fechou, some da tela
    setErro(null);
  }

  function gerar() {
    setErro(null);
    iniciar(async () => {
      try {
        const r = await gerarConviteChave(chaveId);
        if (r.erro) return setErro(r.erro);
        if (r.link) setLink(r.link);
      } catch {
        setErro("Não foi possível gerar o link. Tente de novo.");
      }
    });
  }

  return (
    <>
      <button
        type="button"
        title="Compartilhar acesso"
        aria-label={`Compartilhar acesso: ${nome}`}
        className="inline-flex items-center gap-1 text-xs font-medium text-vg-accent transition-colors hover:opacity-80"
        onClick={() => setAberta(true)}
      >
        <Icone nome="share" tamanho={16} />
        Compartilhar acesso
      </button>
      <Janela aberta={aberta} aoFechar={fechar} titulo="Compartilhar acesso">
        <div className="space-y-4">
          {link ? (
            <>
              <p className={`${estiloCartaoDestaque} p-3 text-sm`}>Guarde agora: o link não aparece de novo.</p>
              <Segredo valor={link} />
              <p className="text-xs text-vg-muted">
                Mande para um atendente da equipe. Ele abre logado, pede o acesso e você aprova em &quot;Acessos de atendentes&quot;. Vale por 7 dias e para um
                único pedido.
              </p>
            </>
          ) : (
            <p className="text-sm text-vg-text-2">
              Gerar um link de pedido de acesso à chave &quot;{nome}&quot;? Vale por 7 dias e para um único pedido; gerar de novo invalida o link anterior. O
              atendente nunca vê esta chave: se você aprovar, ele gera uma chave própria, com o mesmo escopo.
            </p>
          )}
          <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
          <div className="flex justify-end gap-2">
            <button type="button" className={estiloBotao("secundario")} onClick={fechar}>{link ? "FECHAR" : "CANCELAR"}</button>
            {!link && (
              <button type="button" className={estiloBotao()} disabled={ocupado} onClick={gerar}>
                {ocupado ? "Gerando…" : "GERAR LINK"}
              </button>
            )}
          </div>
        </div>
      </Janela>
    </>
  );
}

// ---------- "Acessos de atendentes" (API, Administrador) ----------

type Filtro = "todas" | StatusAcessoLinha;

const FILTROS: { valor: Filtro; rotulo: string }[] = [
  { valor: "todas", rotulo: "Todas" },
  { valor: "aguardando", rotulo: "Aguardando aprovação" },
  { valor: "aprovado", rotulo: "Aprovadas" },
  { valor: "recusado", rotulo: "Recusadas" },
  { valor: "revogado", rotulo: "Revogadas" },
];

export function AcessosAtendentes({ acessos }: { acessos: AcessoLinha[] }) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const visiveis = useMemo(() => (filtro === "todas" ? acessos : acessos.filter((a) => a.status === filtro)), [acessos, filtro]);

  function rodar(a: AcessoLinha, acao: "aprovar" | "recusar" | "revogar") {
    if (acao === "revogar" && !window.confirm(`Revogar o acesso de ${a.atendente} à chave "${a.chave}"? A chave dele para de funcionar na hora.`)) return;
    setErro(null);
    iniciar(async () => {
      try {
        const f = acao === "aprovar" ? aprovarAcesso : acao === "recusar" ? recusarAcesso : revogarAcesso;
        const r = await f(a.id);
        if (r.erro) return setErro(r.erro);
        router.refresh();
      } catch {
        setErro("Não foi possível concluir. Tente de novo.");
      }
    });
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-[17px] font-medium">Acessos de atendentes</h2>
        <p className="text-sm text-vg-muted">Veja quem está com cada chave na sua conta. Você pode aprovar, recusar ou revogar a qualquer momento.</p>
      </div>
      <div role="group" aria-label="Filtrar acessos" className="flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.valor}
            type="button"
            aria-pressed={filtro === f.valor}
            onClick={() => setFiltro(f.valor)}
            className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
              filtro === f.valor ? "border-vg-accent/60 bg-vg-accent/10 text-vg-accent" : "border-vg-line-2 text-vg-text-2 hover:border-white/60"
            }`}
          >
            {f.rotulo}
          </button>
        ))}
      </div>
      <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <Tabela colunas={["Atendente", "Chave", "Motivo", "Data", "Situação", ""]} vazio={visiveis.length ? undefined : "Nenhum pedido de acesso."}>
        {visiveis.map((a) => (
          <tr key={a.id}>
            <td className="px-3 py-2.5">
              <p>{a.atendente}</p>
              {a.contato && <p className="text-xs text-vg-muted">{a.contato}</p>}
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">{a.chave}</td>
            <td className="max-w-[260px] px-3 py-2.5 text-vg-text-2"><span className="line-clamp-2 break-words">{a.motivo || "—"}</span></td>
            <td className="px-3 py-2.5 text-vg-text-2">{dataCurta(a.created_at)}</td>
            <td className="px-3 py-2.5"><Selo cor={COR_STATUS[a.status]}>{ROTULO_STATUS_ACESSO[a.status]}</Selo></td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right">
              {a.status === "aguardando" && (
                <span className="inline-flex gap-3">
                  <button type="button" className="text-xs font-medium text-vg-accent hover:opacity-80" disabled={ocupado} onClick={() => rodar(a, "aprovar")}>Aprovar</button>
                  <button type="button" className="text-xs font-medium text-vg-erro hover:text-red-300" disabled={ocupado} onClick={() => rodar(a, "recusar")}>Recusar</button>
                </span>
              )}
              {a.status === "aprovado" && (
                <button type="button" className="text-xs font-medium text-vg-erro hover:text-red-300" disabled={ocupado} onClick={() => rodar(a, "revogar")}>Revogar</button>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
    </section>
  );
}

// ---------- Página do link: "Solicitar acesso" (atendente logado) ----------

export function FormPedidoAcesso({ token }: { token: string }) {
  const [motivo, setMotivo] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const idMotivo = useId();

  if (enviado) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-vg-text-2">Pedido enviado. Quando um administrador aprovar, a chave aparece em &quot;Meus acessos&quot;.</p>
        <Link href="/api-externa/acesso" className={estiloBotao("contorno")}>MEUS ACESSOS</Link>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setErro(null);
        iniciar(async () => {
          try {
            const r = await solicitarAcesso(token, motivo);
            if (r.erro) return setErro(r.erro);
            setEnviado(true);
          } catch {
            setErro("Não foi possível enviar o pedido. Tente de novo.");
          }
        });
      }}
    >
      <label htmlFor={idMotivo} className="block space-y-1.5">
        <span className="text-[13.3px] text-[#e3e9e5]">Motivo (opcional)</span>
        <textarea id={idMotivo} className={estiloInput} rows={3} maxLength={280} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </label>
      <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <div className="flex justify-end">
        <button type="submit" className={estiloBotao()} disabled={ocupado}>{ocupado ? "Enviando…" : "Solicitar acesso"}</button>
      </div>
    </form>
  );
}

// ---------- "Meus acessos" (o próprio atendente) ----------

export function MeusAcessos({ itens }: { itens: MeuAcessoLinha[] }) {
  const router = useRouter();
  const [erro, setErro] = useState<string | null>(null);
  const [chave, setChave] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function ver(a: MeuAcessoLinha) {
    if (a.prefixo && !window.confirm("Gerar uma chave nova? A chave anterior para de funcionar na hora.")) return;
    setErro(null);
    iniciar(async () => {
      try {
        const r = await verChaveAcesso(a.id);
        if (r.erro) return setErro(r.erro);
        if (r.chave) setChave(r.chave);
      } catch {
        setErro("Não foi possível gerar a chave. Tente de novo.");
      }
    });
  }

  return (
    <div className="space-y-2">
      <p role="status" className="text-sm text-vg-erro empty:hidden">{erro}</p>
      <Tabela colunas={["Chave", "Escopo", "Pedido em", "Situação", ""]} vazio={itens.length ? undefined : "Você ainda não pediu acesso a nenhuma chave."}>
        {itens.map((a) => (
          <tr key={a.id}>
            <td className="px-3 py-2.5">
              <p>{a.chave}</p>
              {a.prefixo && <code className="rounded bg-vg-panel-2 px-1 text-xs text-vg-accent-3">vg_{a.prefixo}…</code>}
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">{ROTULO_ESCOPO[a.escopo]}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{dataCurta(a.created_at)}</td>
            <td className="px-3 py-2.5">
              <Selo cor={a.chaveRevogada ? "neutro" : COR_STATUS[a.status]}>{a.chaveRevogada && a.status === "aprovado" ? "Chave revogada" : ROTULO_STATUS_ACESSO[a.status]}</Selo>
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right">
              {a.status === "aprovado" && !a.chaveRevogada && (
                <button type="button" className={estiloBotao(a.prefixo ? "secundario" : "principal")} disabled={ocupado} onClick={() => ver(a)}>
                  {a.prefixo ? "Gerar de novo" : "VER CHAVE"}
                </button>
              )}
            </td>
          </tr>
        ))}
      </Tabela>
      {chave && (
        <Janela
          aberta
          aoFechar={() => {
            setChave(null); // aparece uma vez: fechou, some
            router.refresh();
          }}
          titulo="Sua chave"
        >
          <div className="space-y-4">
            <p className={`${estiloCartaoDestaque} p-3 text-sm`}>Guarde agora: ela não aparece de novo.</p>
            <Segredo valor={chave} />
            <p className="text-xs text-vg-muted">
              Use no cabeçalho <code className="text-vg-text-2">Authorization: Bearer {"<chave>"}</code> de cada chamada.
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className={estiloBotao()}
                onClick={() => {
                  setChave(null);
                  router.refresh();
                }}
              >
                FECHAR
              </button>
            </div>
          </div>
        </Janela>
      )}
    </div>
  );
}
