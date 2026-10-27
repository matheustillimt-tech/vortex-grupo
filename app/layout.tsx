import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@fontsource/material-icons/400.css";
import "./globals.css";
import { NOME_SISTEMA } from "@/src/lib/marca";

// Auto-hospedadas no build (o navegador não fala com o Google).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: NOME_SISTEMA,
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={inter.variable}>
      <body className="min-h-screen font-sans text-[13px] antialiased">{children}</body>
    </html>
  );
}
