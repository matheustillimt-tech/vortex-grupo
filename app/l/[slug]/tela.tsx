/** Moldura das páginas públicas do link (`/l/{slug}/abrir`, `/l/{slug}/colaboradores`): cartão centralizado. */
export function Tela({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[radial-gradient(60%_45%_at_50%_0%,rgba(15,169,104,0.09),transparent)] px-6 text-center">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-vg-line bg-linear-to-b from-vg-panel to-vg-panel-3 px-6 py-8">{children}</div>
    </main>
  );
}
