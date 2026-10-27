import Link from "next/link";
import { notFound } from "next/navigation";
import { descreverBloqueio } from "@/src/lib/regras/antispam";
import { dataCsv } from "@/src/lib/regras/csv";
import { ROTULO_MOTIVO, type MotivoSaida } from "@/src/lib/regras/pessoas";
import { dbUsuario } from "@/src/lib/supabase/usuario";
import { normalizarTelefone, telefoneLegivel, variantesTelefone } from "@/src/lib/telefone";
import { DefinirTrilha } from "../../_componentes/trilha";
import { Cartao, Pagina, Selo, Tabela } from "../../_componentes/ui";
import { nomeDaTag, type TagLinha } from "../comum";
import { Bloquear, Desbloquear } from "./bloquear";
import { EditarLead } from "./editar-lead";
import { TagsDaPessoa } from "./tags";
import { bloqueio } from "@/app/(painel)/_componentes/guarda";

export const dynamic = "force-dynamic";

const MAX_PARTICIPACOES = 200;

type Participacao = {
  id: string;
  entrou_em: string;
  saiu_em: string | null;
  motivo_saida: MotivoSaida | null;
  admin: boolean;
  grupos: { nome: string; campanha_id: string; campanhas: { nome: string } };
};
type MarcaDeTag = { tag_id: string; campanha_id: string | null; tags: TagLinha; campanhas: { nome: string } | null };

export default async function Lead({ params }: { params: Promise<{ telefone: string }> }) {
  const b = await bloqueio("leads");
  if (b) return b;
  const t = normalizarTelefone(decodeURIComponent((await params).telefone));
  if (!t) notFound();
  const vs = variantesTelefone(t);
  const db = await dbUsuario();
  const [parts, marcas, linhaBloqueio, linhaBlacklist, opcoes, linhaContato] = await Promise.all([
    db.from("participantes")
      .select("id, entrou_em, saiu_em, motivo_saida, admin, grupos(nome, campanha_id, campanhas(nome))")
      .in("telefone", vs)
      .order("entrou_em", { ascending: false })
      .limit(MAX_PARTICIPACOES),
    db.from("pessoa_tags").select("tag_id, campanha_id, tags(id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)), campanhas(nome)").in("telefone", vs),
    db.from("bloqueados").select("telefone, motivo, created_at").in("telefone", vs).limit(1).maybeSingle(),
    // Bloqueado só pela blacklist (não está em `bloqueados`): qual lista ATIVA, pra mostrar "Blacklist: NOME".
    db.from("blacklist_numeros").select("blacklists!inner(nome, ativa)").in("telefone", vs).eq("blacklists.ativa", true).limit(1).maybeSingle(),
    db.from("tags").select("id, nome, tipo, campanhas!tags_campanha_id_fkey(nome)").in("tipo", ["manual", "comprador"]).order("nome"),
    // Cadastro (Etapa 3I, Tarefa 1): nome e campos personalizados, se o número já foi cadastrado em Leads.
    db.from("contatos").select("nome, campos").in("telefone", vs).limit(1).maybeSingle(),
  ]);
  if (parts.error) throw new Error(`Não foi possível carregar o histórico: ${parts.error.message}`);
  if (marcas.error) throw new Error(`Não foi possível carregar as tags: ${marcas.error.message}`);
  if (linhaBloqueio.error) throw new Error(`Não foi possível ler o bloqueio: ${linhaBloqueio.error.message}`);
  if (linhaBlacklist.error) throw new Error(`Não foi possível ler a blacklist: ${linhaBlacklist.error.message}`);
  if (linhaContato.error) throw new Error(`Não foi possível ler o cadastro: ${linhaContato.error.message}`);
  const contato = linhaContato.data as { nome: string | null; campos: Record<string, string> } | null;

  const participacoes = (parts.data ?? []) as unknown as Participacao[];
  // A mesma tag pode estar gravada nas duas formas do número (com e sem o nono dígito): mostra uma vez só.
  const vistas = new Set<string>();
  const tags = ((marcas.data ?? []) as unknown as MarcaDeTag[])
    .filter((m) => m.tags)
    .map((m) => ({
      tagId: m.tag_id,
      campanhaId: m.campanha_id,
      // A "Saiu" é por campanha: mostra de qual.
      nome: m.campanha_id && m.campanhas && m.tags.tipo !== "campanha" ? `${nomeDaTag(m.tags)} · ${m.campanhas.nome}` : nomeDaTag(m.tags),
    }))
    .filter((m) => {
      const k = `${m.tagId}-${m.campanhaId ?? ""}`;
      if (vistas.has(k)) return false;
      vistas.add(k);
      return true;
    });
  const legivel = telefoneLegivel(t);
  const antispam = linhaBloqueio.data as { telefone: string; motivo: string | null; created_at: string } | null;
  const blacklist = linhaBlacklist.data as { blacklists: { nome: string } } | null;
  const exibicaoBloqueio = descreverBloqueio(antispam, blacklist ? { nome: blacklist.blacklists.nome } : null);

  return (
    <Pagina
      titulo={contato?.nome || legivel}
      sobretitulo={contato?.nome ? legivel : undefined}
      subtitulo={
        exibicaoBloqueio ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <Selo cor="erro">bloqueado</Selo>
            {exibicaoBloqueio.fonte === "Anti-spam" ? exibicaoBloqueio.motivo || "sem motivo" : exibicaoBloqueio.fonte}
            {exibicaoBloqueio.criadoEm && ` · desde ${dataCsv(exibicaoBloqueio.criadoEm)}`}
          </span>
        ) : (
          `${participacoes.length}${participacoes.length === MAX_PARTICIPACOES ? "+" : ""} participaç${participacoes.length === 1 ? "ão" : "ões"}`
        )
      }
      acoes={antispam ? <Desbloquear telefone={antispam.telefone} /> : <Bloquear telefone={t} />}
    >
      <DefinirTrilha itens={[{ rotulo: "Leads", href: "/leads" }, { rotulo: legivel }]} />
      <Cartao titulo="Cadastro">
        <EditarLead telefone={t} nome={contato?.nome ?? null} campos={contato?.campos ?? {}} />
      </Cartao>
      <Cartao titulo="Tags">
        <TagsDaPessoa telefone={t} tags={tags} opcoes={((opcoes.data ?? []) as unknown as TagLinha[]).map((o) => ({ id: o.id, nome: nomeDaTag(o) }))} />
      </Cartao>
      <Tabela colunas={["Campanha", "Grupo", "Entrou", "Saiu", "Motivo"]} vazio={participacoes.length ? undefined : "Nunca passou por um grupo do sistema."}>
        {participacoes.map((p) => (
          <tr key={p.id}>
            <td className="px-3 py-2.5">
              <Link href={`/campanhas/${p.grupos.campanha_id}`} className="transition-colors hover:text-vg-accent">{p.grupos.campanhas.nome}</Link>
            </td>
            <td className="px-3 py-2.5 text-vg-text-2">
              {p.grupos.nome}
              {p.admin && <span className="ml-1 text-xs text-vg-muted">(admin)</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{dataCsv(p.entrou_em)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-vg-text-2">{p.saiu_em ? dataCsv(p.saiu_em) : <Selo cor="ok">no grupo</Selo>}</td>
            <td className="px-3 py-2.5 text-vg-text-2">{p.motivo_saida ? ROTULO_MOTIVO[p.motivo_saida] : "—"}</td>
          </tr>
        ))}
      </Tabela>
    </Pagina>
  );
}
