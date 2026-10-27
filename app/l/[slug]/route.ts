import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { hashIp } from "@/src/lib/crypto";
import { decidirDestino, utmsDe } from "@/src/lib/link";
import { ehBotDePreview } from "@/src/lib/regras/navegador";
import { escolherGrupo, type GrupoLink } from "@/src/lib/regras/escolha";
import { campanhaTerminou, type CampanhaTipo } from "@/src/lib/regras/campanha-tipo";
import { dispararAutomacoes } from "@/src/lib/automacoes";
import { alertar } from "@/src/lib/jobs/alertas";
import { pedirRedefinicaoAoEncher } from "@/src/lib/jobs/links";
import { avisaQueEncheu, cheioFinal } from "@/src/lib/regras/ocupacao";
import { reservadosEmVigor } from "@/src/lib/regras/solicitacoes";
import { opcoesCriacao } from "@/src/lib/regras/criacao-grupos";
import { motivoBloqueioCriacao } from "@/src/lib/jobs/novos-grupos";
import { eventoGrupoCheio } from "@/src/lib/regras/webhooks";
import { dbAdmin } from "@/src/lib/supabase/admin";
import { emitirSemFalhar } from "@/src/lib/webhooks";

export const dynamic = "force-dynamic";
const NOVENTA_DIAS = 60 * 60 * 24 * 90;

export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = dbAdmin();
  const { data: camp } = await db
    .from("campanhas")
    .select("id, limite_por_grupo, arquivada, tipo, termina_em, link_apos_termino, nao_criar_grupos, limite_cliques_sem_criar, cookie_redirecionamento, deep_linking, redefinir_link_cheio, reservar_vaga_pendentes")
    .eq("slug", slug)
    .maybeSingle();
  if (!camp || camp.arquivada) return new NextResponse("Link indisponível.", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

  // Robô de pré-visualização (o WhatsApp busca o link pra montar o card da mensagem): leva pro mesmo destino, mas
  // não soma clique nem entra na conta de lotação do grupo.
  const robo = ehBotDePreview(req.headers.get("user-agent") ?? "");
  const cookie = `vg_${slug}`;
  // Seção "Cookie de redirecionamento" (padrão ligado = como sempre foi). Desligada: não lê nem grava `vg_{slug}`
  // (cada clique escolhe o grupo de novo); o `vg_visitante` continua.
  const usarCookie = camp.cookie_redirecionamento !== false;
  const terminou = campanhaTerminou(camp.termina_em, new Date());

  type GrupoComExtras = GrupoLink & { nome: string; participantes: number; conferido_em: string | null; cheio_manual: boolean | null; pendentes_reservados?: number | null; pendentes_lidos_em?: string | null };
  let grupo: GrupoComExtras | null = null;
  // Campanha terminada: nenhuma escolha de grupo nem ação de "criar grupo" (não precisa de vaga nova).
  if (!terminou) {
    const { data } = await db.from("grupos").select("id, nome, numero, cheio, cheio_manual, ativo, link_convite, participantes, conferido_em, pendentes_reservados, pendentes_lidos_em").eq("campanha_id", camp.id).eq("ativo", true).eq("cheio", false);
    // Marcado cheio à mão nunca recebe ninguém, mesmo que `cheio` ainda esteja false (a conferência acerta depois).
    const grupos = ((data ?? []) as GrupoComExtras[]).filter((g) => g.cheio_manual !== true);
    grupo = escolherGrupo(grupos, usarCookie ? (req.cookies.get(cookie)?.value ?? null) : null, (camp.tipo as CampanhaTipo) ?? "campanha") as GrupoComExtras | null;

    if (!robo) {
      try {
        if (grupo) {
          // Lotação entre conferências: participantes + 60% dos cliques desde a última conferência. Grupo marcado
          // "não cheio" à mão continua recebendo até o limite do WhatsApp (1024), nunca além (`cheioFinal`).
          const g = grupos.find((x) => x.id === grupo!.id)!;
          const { count } = await db.from("cliques").select("id", { count: "exact", head: true }).eq("grupo_id", g.id).gt("created_at", g.conferido_em ?? "1970-01-01");
          // "Reservar vaga para solicitações pendentes" (Etapa 3N): só com o interruptor ligado os pedidos pendentes
          // contam contra o limite da campanha, e só se foram lidos há até 15 min; desligado, a coluna é ignorada (a conta
          // de antes).
          const reservados = reservadosEmVigor({ ligada: camp.reservar_vaga_pendentes === true, reservados: g.pendentes_reservados, lidosEm: g.pendentes_lidos_em, agora: new Date() });
          if (cheioFinal(g.cheio_manual, g.participantes, (count ?? 0) + 1, camp.limite_por_grupo, reservados)) {
            const { data: virou, error } = await db.from("grupos").update({ cheio: true }).eq("id", g.id).eq("cheio", false).select("id");
            if (error) console.error("[link] falha ao marcar grupo como cheio", error);
            // Só quem virou o grupo pra cheio avisa (dois cliques ao mesmo tempo não geram dois alertas). Lotação
            // marcada à mão (cheio_manual definido) não avisa nem dispara automações (mesma regra da conferência).
            // Cheio só por causa da reserva (Etapa 3N, revisão final A): o grupo sai da rotação, mas não é "encheu" (sem
            // alerta, Hook, automações nem redefinir link); a conferência dispara quando ele encher de verdade.
            // Reserva desligada = `reservados` 0 e a conta abaixo é a mesma de cima.
            const cheioSemReserva = reservados === 0 || cheioFinal(g.cheio_manual, g.participantes, (count ?? 0) + 1, camp.limite_por_grupo);
            if (virou?.length && cheioSemReserva && avisaQueEncheu(g.cheio_manual)) {
              await alertar({ tipo: "grupo_cheio", texto: `Grupo ${g.nome} encheu pela estimativa do link (campanha ${slug})`, campanhaId: camp.id }, db);
              // Hook "Grupo cheio": mesma chave da conferência pro mesmo enchimento (não duplica). Nunca lança.
              await emitirSemFalhar(db, [eventoGrupoCheio({ grupoId: g.id, grupoNome: g.nome, campanhaId: camp.id, campanhaSlug: slug, participantes: g.participantes, conferidoEm: g.conferido_em, origem: "link" })]);
              // Automações de "encher grupo": a conferência também dispara ao confirmar; o índice único evita duplicar.
              // Falha aqui nunca derruba o redirecionamento.
              try {
                await dispararAutomacoes({ campanhaId: camp.id, gatilho: "grupo_cheio", grupoId: g.id }, new Date(), db);
              } catch (e) {
                console.error(`[link] automações de grupo cheio (${g.id}) não foram agendadas`, e);
                await alertar({ tipo: "criacao_erro", campanhaId: camp.id, texto: `Grupo ${g.nome} encheu, mas as automações não foram agendadas: ${e instanceof Error ? e.message : e}` }, db);
              }
              // Seção "Redefinir link de convite": revoga o convite do grupo que encheu (nunca lança).
              if (camp.redefinir_link_cheio === true) {
                await pedirRedefinicaoAoEncher(db, { campanhaId: camp.id, grupoId: g.id, grupoNome: g.nome, conferidoEm: g.conferido_em });
              }
            }
          }
        } else if (!(await motivoBloqueioCriacao(db, camp.id, opcoesCriacao(camp)))) {
          // Sem vaga e sem trava de criação ("Não criar grupos" / cliques altos): pede um grupo novo.
          const { error } = await db.from("acoes").insert({ tipo: "criar_grupo", campanha_id: camp.id, origem: "link-sem-vaga" }); // índice único evita duplicar
          if (error) console.error("[link] falha ao registrar ação criar_grupo (pode ser duplicata esperada)", error);
        }
      } catch (error) {
        console.error("[link] erro inesperado ao atualizar ocupação/ações", error);
      }
    }
  }

  const visitante = req.cookies.get("vg_visitante")?.value ?? randomUUID();
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (!robo) {
    try {
      // Clique de campanha terminada não é clique de grupo (grupo_id null), mesmo que o cookie tivesse um grupo
      // guardado: mais simples que decidir a quem "pertenceria" esse clique, e não afeta a lotação (já ignorada acima).
      const { error } = await db.from("cliques").insert({
        campanha_id: camp.id,
        grupo_id: terminou ? null : (grupo?.id ?? null),
        visitante,
        ...utmsDe(req.nextUrl),
        referer: req.headers.get("referer"),
        user_agent: req.headers.get("user-agent"),
        ip_hash: ip ? hashIp(ip) : null,
      });
      if (error) console.error("[link] falha ao registrar clique", error);
    } catch (error) {
      console.error("[link] erro inesperado ao registrar clique", error);
    }
  }

  // Terminada sem link: "Link indisponível." (sem `espera`, que recarregaria a cada 10 s e somaria cliques).
  const destino = terminou
    ? { tipo: "convite" as const, url: camp.link_apos_termino ?? `/l/${slug}/abrir` }
    : decidirDestino({ grupo, userAgent: req.headers.get("user-agent") ?? "", slug, deepLinking: camp.deep_linking === true });
  const res = NextResponse.redirect(new URL(destino.url, req.url), 302);
  res.cookies.set("vg_visitante", visitante, { maxAge: NOVENTA_DIAS, sameSite: "lax", secure: true, httpOnly: true, path: "/" });
  if (!terminou && grupo && usarCookie) res.cookies.set(cookie, grupo.id, { maxAge: NOVENTA_DIAS, sameSite: "lax", secure: true, httpOnly: true, path: "/" });
  return res;
}
