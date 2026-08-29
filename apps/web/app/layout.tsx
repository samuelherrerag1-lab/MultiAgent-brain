import type { Metadata } from "next";
// @ts-ignore — Next.js handles CSS side-effect imports
import "./globals.css";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cerebro de Agentes",
  description: "Orquestador multi-agente — QwenMax-3.8 · DSH · Opencode",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body className="min-h-screen bg-[#0a0a0a] text-zinc-100 antialiased">
        <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-lg bg-white flex items-center justify-center text-black font-bold text-sm">◈</div>
              <span className="font-semibold tracking-tight">Cerebro de Agentes</span>
              <span className="hidden sm:inline text-xs text-zinc-500 ml-2">QwenMax-3.8 · DSH · Opencode</span>
            </Link>
            <nav className="flex items-center gap-1">
              <Link
                href="/"
                className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
              >
                Misiones
              </Link>
              <Link
                href="/qwen-chat"
                className="rounded-md px-3 py-2 text-sm text-white bg-zinc-900 border border-zinc-800"
              >
                Qwen Chat
              </Link>
              <Link
                href="/dashboard"
                className="rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-900 transition"
              >
                Dashboard
              </Link>
              <a
                href="http://localhost:3001/health"
                target="_blank"
                className="ml-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1 text-xs text-zinc-400 hover:text-white"
              >
                ● Orquestador
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
        <footer className="border-t border-zinc-900 py-6 text-center text-xs text-zinc-600">
          Monorepo pnpm · Hono · Drizzle · pglite · Playwright Qwen Chat
        </footer>
      </body>
    </html>
  );
}
