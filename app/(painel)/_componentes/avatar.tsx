export const COR_BOLINHA: Record<"ok" | "erro" | "neutro", string> = { ok: "bg-[#0fa968]", erro: "bg-vg-erro", neutro: "bg-vg-text-3" };

/** Avatar redondo com a inicial e bolinha de status. Com a foto real do grupo (Etapa 3M: `grupos.foto_url`, lida na
 *  conferência), use `AvatarFoto` (`avatar-foto.tsx`), que mostra a foto e volta pra esta letra se a imagem falhar.
 *  `ativo` é o atalho mais comum (bolinha verde só quando `true`, ex.: campanha ativa); `cor` serve pra quem tem
 *  três estados (ex.: conectado/desconectado/pendente de uma conta) — nesse caso passe `cor` e deixe `ativo` de lado. */
export function Avatar({ nome, ativo = false, cor, tamanho = 40 }: { nome: string; ativo?: boolean; cor?: "ok" | "erro" | "neutro"; tamanho?: number }) {
  const bolinha = cor ?? (ativo ? "ok" : null);
  return (
    <span className="relative inline-grid shrink-0 place-items-center rounded-full bg-vg-pilula font-semibold text-vg-accent" style={{ width: tamanho, height: tamanho, fontSize: tamanho * 0.42 }} aria-hidden>
      {nome.trim().charAt(0).toUpperCase() || "?"}
      {bolinha && <span className={`absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-vg-bg ${COR_BOLINHA[bolinha]}`} />}
    </span>
  );
}
