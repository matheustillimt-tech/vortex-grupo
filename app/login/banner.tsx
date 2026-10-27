import { Logo } from "../(painel)/_componentes/logo";

/** Grupos de exemplo do banner: um cheio, um enchendo e um recém-criado (limite de 350). */
const GRUPOS = [
  { nome: "Aulão de Lançamento #01", membros: 350, selo: "Cheio" },
  { nome: "Aulão de Lançamento #02", membros: 287, selo: "Recebendo" },
  { nome: "Aulão de Lançamento #03", membros: 12, selo: "Novo" },
];

/** Lado esquerdo do login (só no computador): marca, frase e uma prévia dos grupos enchendo. */
export function BannerLogin() {
  return (
    <section
      aria-hidden
      className="relative hidden overflow-hidden border-r border-vg-line bg-[#060807] lg:flex lg:flex-col lg:justify-between lg:p-12"
    >
      {/* Grade sutil e luz verde atrás da prévia. */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px] [mask-image:radial-gradient(70%_60%_at_50%_45%,#000,transparent)]" />
      <div className="pointer-events-none absolute left-1/2 top-[55%] size-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#0fa968]/20 blur-[120px]" />

      <Logo tamanho={34} className="relative" />

      <div className="relative mx-auto w-full max-w-[440px]">
        <div className="space-y-2.5 rounded-2xl border border-white/10 bg-[#0d1310]/80 p-4 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur">
          <div className="flex items-center justify-between px-1 pb-1">
            <span className="text-xs font-medium text-vg-text-2">Campanha · Aulão de Lançamento</span>
            <span className="flex items-center gap-1.5 text-[11px] text-vg-ok">
              <span className="size-1.5 animate-pulse rounded-full bg-vg-ok" /> ao vivo
            </span>
          </div>
          {GRUPOS.map((g) => (
            <div key={g.nome} className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[#13794f]/30 text-[13px] font-semibold text-vg-accent-3">
                {g.nome.slice(-2)}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{g.nome}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-vg-muted">{g.membros}/350</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[#13794f] to-[#2bd391]"
                    style={{ width: `${Math.max(4, (g.membros / 350) * 100)}%` }}
                  />
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  g.selo === "Cheio" ? "bg-white/[0.07] text-vg-text-2" : "bg-[#0fa968]/15 text-vg-ok"
                }`}
              >
                {g.selo}
              </span>
            </div>
          ))}
        </div>

        {/* Cartões flutuantes: disparo agendado e entradas do dia. */}
        <div className="absolute -right-6 -top-10 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#111a15] px-3 py-2.5 shadow-xl">
          <span className="grid size-7 place-items-center rounded-lg bg-[#0fa968]/15 text-vg-accent-3">
            <span className="material-icons text-[16px]">schedule_send</span>
          </span>
          <div className="leading-tight">
            <p className="text-[12px] font-medium">Mensagem agendada</p>
            <p className="text-[11px] text-vg-muted">3 grupos · hoje, 20h</p>
          </div>
        </div>
        <div className="absolute -bottom-8 -left-6 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[#111a15] px-3 py-2.5 shadow-xl">
          <span className="grid size-7 place-items-center rounded-lg bg-[#0fa968]/15 text-vg-accent-3">
            <span className="material-icons text-[16px]">group_add</span>
          </span>
          <div className="leading-tight">
            <p className="text-[12px] font-medium">+128 entraram hoje</p>
            <p className="text-[11px] text-vg-muted">pelo link único</p>
          </div>
        </div>
      </div>

      <div className="relative space-y-2">
        <h2 className="max-w-[440px] text-[28px] font-semibold leading-[1.15] tracking-[-0.02em]">
          Seus grupos de WhatsApp <span className="text-vg-accent-3">enchendo sozinhos.</span>
        </h2>
        <p className="max-w-[420px] text-sm leading-relaxed text-vg-text-2">
          Um link só pra campanha inteira, grupo novo a cada 350 pessoas e as mensagens saindo na hora certa.
        </p>
      </div>
    </section>
  );
}
