"use client";
import { estiloInput } from "./ui";

/**
 * Campos de filtro que enviam o `<form method="get">` ao redor assim que o valor muda, sem botão "Filtrar"
 *. Sem prop de função: só leem o `<form>` do próprio
 * elemento (`e.currentTarget.form`). O campo de texto livre (`CampoTextoEnviar`) só envia no `onBlur` ou Enter,
 * não a cada tecla, pra não disparar uma busca por caractere digitado.
 */
export function SelectEnviar({
  name,
  defaultValue,
  children,
  ariaLabel,
  className,
}: {
  name: string;
  defaultValue: string;
  children: React.ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <select name={name} defaultValue={defaultValue} aria-label={ariaLabel} onChange={(e) => e.currentTarget.form?.requestSubmit()} className={className ?? estiloInput}>
      {children}
    </select>
  );
}

export function DataEnviar({ name, defaultValue, ariaLabel, className }: { name: string; defaultValue: string; ariaLabel: string; className?: string }) {
  return (
    <input
      type="date"
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
      className={className ?? estiloInput}
    />
  );
}

export function CampoTextoEnviar({
  name,
  defaultValue,
  ariaLabel,
  className,
  title,
}: {
  name: string;
  defaultValue: string;
  ariaLabel: string;
  className?: string;
  title?: string;
}) {
  return (
    <input
      type="search"
      name={name}
      defaultValue={defaultValue}
      aria-label={ariaLabel}
      title={title}
      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }}
      className={className ?? estiloInput}
    />
  );
}
