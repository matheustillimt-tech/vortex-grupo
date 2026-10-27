import Link from "next/link";
import { formatarTelefone } from "@/src/lib/regras/inicio";
import { estaPausado, type ContaLista } from "@/src/lib/regras/contas";
import { Avatar } from "./avatar";
import { PopoverConta } from "./popover-conta";
import { Selo } from "./ui";

const CONTA_COR: Record<string, "ok" | "erro" | "neutro"> = { conectado: "ok", desconectado: "erro" };

/** Cartão de conta da lista (`/numeros`) e da coluna "Contas" do Início: avatar com bolinha de status, nome,
 *  telefone, selo "pausado" (limite do WhatsApp) e último erro. O cartão inteiro é o link pra conta (sem
 *  `arrow_forward`); a engrenagem continua abrindo o popover e para a
 *  propagação do clique, pra não navegar quando só queria abrir o popover. */
export function CartaoConta({ conta, href, podeEditar = true }: { conta: ContaLista; href: string; podeEditar?: boolean }) {
  const pausado = estaPausado(conta.pausado_ate);
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-vg-line bg-vg-bg p-3 transition-colors hover:border-vg-line-2">
      <Avatar nome={conta.nome} cor={CONTA_COR[conta.status] ?? "neutro"} tamanho={36} />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[15px] font-medium">{conta.nome}</p>
        {conta.telefone && <p className="truncate text-xs text-vg-muted">{formatarTelefone(conta.telefone)}</p>}
        {(pausado || conta.papel?.length) && (
          <p className="mt-1 flex flex-wrap gap-1">
            {conta.papel?.map((p) => (
              <Selo key={`${p.papel}:${p.campanha}`} cor={p.papel === "principal" ? "destaque" : "neutro"}>
                {p.papel}: {p.campanha}
              </Selo>
            ))}
            {pausado && <Selo cor="aviso">pausado</Selo>}
          </p>
        )}
        {conta.ultimo_erro && <p className="mt-1 truncate text-xs text-vg-erro" title={conta.ultimo_erro}>{conta.ultimo_erro}</p>}
      </div>
      <PopoverConta conta={conta} href={href} podeEditar={podeEditar} />
    </Link>
  );
}
