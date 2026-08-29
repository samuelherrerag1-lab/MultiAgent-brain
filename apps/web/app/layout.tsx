import type { Metadata } from "next";
// @ts-ignore — Next.js handles CSS side-effect imports
import "./globals.css";
import { Navbar } from "@/components/Navbar";

export const metadata: Metadata = {
  title: "Cerebro de Agentes",
  description: "Orquestador multi-agente — QwenMax-3.8 · DSH · Opencode",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#09090b] text-zinc-100 antialiased flex flex-col selection:bg-emerald-500/20 selection:text-emerald-300">
        <Navbar />
        <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 py-6">{children}</main>
        <footer className="border-t border-zinc-900/80 py-4 text-center text-xs text-zinc-600 font-mono">
          Cerebro de Agentes · Hono · Next.js 15 · PostgreSQL/pglite · Playwright QwenMax
        </footer>
      </body>
    </html>
  );
}

