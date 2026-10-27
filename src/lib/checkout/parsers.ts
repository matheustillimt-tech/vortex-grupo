import { normalizarTelefone } from "../telefone";

export type Provedor = "vortex" | "pagarme" | "hotmart" | "kiwify";
export const PROVEDORES: Provedor[] = ["vortex", "pagarme", "hotmart", "kiwify"];
export type VendaNormalizada = { eventoId: string; aprovada: boolean; telefone: string | null; produtos: string[] };

type J = Record<string, any>; // payload externo: validado campo a campo abaixo

const txt = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));
const lista = (...v: unknown[]) => v.map(txt).filter((x): x is string => x !== null);
const tel = (v: unknown) => (txt(v) ? normalizarTelefone(String(v)) : null);

/** Telefone do comprador como veio no payload (sem normalizar), ou `null`. */
export function telefoneDoPayload(provedor: string, corpo: unknown): string | null {
  if (!corpo || typeof corpo !== "object") return null;
  const b = corpo as J;
  switch (provedor) {
    case "hotmart":
      return txt(b.data?.buyer?.checkout_phone ?? b.data?.buyer?.phone);
    case "kiwify":
      return txt(b.Customer?.mobile);
    case "pagarme": {
      const f = b.data?.customer?.phones?.mobile_phone;
      return f ? txt(`${f.country_code ?? ""}${f.area_code ?? ""}${f.number ?? ""}`) : null;
    }
    case "vortex":
      return txt(b.telefone);
    default:
      return null;
  }
}

export function lerVenda(provedor: Provedor, corpo: unknown): VendaNormalizada | null {
  if (!corpo || typeof corpo !== "object") return null;
  const b = corpo as J;
  switch (provedor) {
    case "hotmart": {
      const id = txt(b.id) ?? txt(b.data?.purchase?.transaction);
      if (!id) return null;
      const evento = String(b.event ?? "");
      return {
        eventoId: id,
        aprovada: evento === "PURCHASE_APPROVED" || evento === "PURCHASE_COMPLETE",
        telefone: tel(telefoneDoPayload(provedor, b)),
        produtos: lista(b.data?.product?.id, b.data?.product?.name),
      };
    }
    case "kiwify": {
      const id = txt(b.order_id);
      if (!id) return null;
      return {
        eventoId: id,
        aprovada: b.order_status === "paid" || b.webhook_event_type === "order_approved",
        telefone: tel(telefoneDoPayload(provedor, b)),
        produtos: lista(b.Product?.product_id, b.Product?.product_name),
      };
    }
    case "pagarme": {
      const id = txt(b.id);
      if (!id) return null;
      const itens: J[] = Array.isArray(b.data?.items) ? b.data.items : [];
      return {
        eventoId: id,
        aprovada: b.type === "order.paid" || b.type === "charge.paid",
        telefone: tel(telefoneDoPayload(provedor, b)),
        produtos: itens.flatMap((i) => lista(i.code, i.description)),
      };
    }
    case "vortex": {
      const id = txt(b.evento_id);
      if (!id) return null;
      return { eventoId: id, aprovada: b.status === "aprovado", telefone: tel(telefoneDoPayload(provedor, b)), produtos: lista(b.produto) };
    }
  }
}

const limpo = (s: string) => s.trim().toLowerCase();

export function produtoCasa(regra: string, produtos: string[]): boolean {
  return produtos.some((p) => limpo(p) === limpo(regra));
}
