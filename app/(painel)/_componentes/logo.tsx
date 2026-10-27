"use client";
import { useId } from "react";
import { partesDoNome } from "@/src/lib/marca";

/**
 * Símbolo do Vórtex Grupo: um "G" aberto cuja barra vira três pontos (as pessoas do grupo
 * e o "digitando…" do WhatsApp), num quadrado verde com degradê.
 */
export function Simbolo({ tamanho = 28, className = "" }: { tamanho?: number; className?: string }) {
  // Id próprio por cópia: se o degradê ficasse num SVG escondido (banner no celular), as outras cópias perderiam a cor.
  const id = `gg${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={tamanho} height={tamanho} viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id={`${id}f`} x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#2bd391" />
          <stop offset="0.55" stopColor="#13a066" />
          <stop offset="1" stopColor="#0b5e3c" />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="16" y1="0" x2="16" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id}f)`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill={`url(#${id}b)`} stroke="#fff" strokeOpacity="0.14" />
      <path d="M22.2 10.2A8.4 8.4 0 1 0 24.4 16.6" fill="none" stroke="#fff" strokeWidth="3.1" strokeLinecap="round" />
      <circle cx="20.7" cy="16.6" r="1.5" fill="#fff" />
      <circle cx="17" cy="16.6" r="1.5" fill="#fff" fillOpacity="0.78" />
      <circle cx="13.3" cy="16.6" r="1.5" fill="#fff" fillOpacity="0.55" />
    </svg>
  );
}

/** Símbolo + nome. */
export function Logo({ tamanho = 28, className = "" }: { tamanho?: number; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <Simbolo tamanho={tamanho} />
      <span className="font-semibold tracking-[-0.02em]" style={{ fontSize: tamanho * 0.56 }}>
        {partesDoNome()[0]}
        <span className="text-vg-accent-3">{partesDoNome()[1]}</span>
      </span>
    </span>
  );
}
