/** Cabeçalho de bloco da página de Métricas: título + subtítulo à esquerda, ações à direita, conteúdo embaixo. */
export function Secao({ titulo, subtitulo, acoes, children }: {
  titulo: string;
  subtitulo?: string;
  acoes?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-medium">{titulo}</h2>
          {subtitulo && <p className="text-xs text-vg-muted">{subtitulo}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </section>
  );
}
