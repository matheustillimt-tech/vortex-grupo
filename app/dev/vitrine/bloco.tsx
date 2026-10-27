export function Bloco({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 space-y-4">
      <h2 className="border-b border-vg-line pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-vg-muted">{titulo}</h2>
      {children}
    </section>
  );
}
