/** Esqueleto mostrado na hora do clique (loading.tsx), enquanto o servidor monta a tela. Sem dados e sem hooks. */
function Barra({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-md bg-vg-panel-2 ${className}`} />;
}

export function CarregandoTela({ comTitulo = true }: { comTitulo?: boolean }) {
  return (
    <div className="mx-auto max-w-[1200px] space-y-5 px-4 py-6 md:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {comTitulo && (
        <div className="space-y-2">
          <Barra className="h-3 w-24" />
          <Barra className="h-7 w-56" />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Barra key={i} className="h-24" />
        ))}
      </div>
      <div className="space-y-2 rounded-xl border border-vg-line bg-vg-bg p-4">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Barra key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
