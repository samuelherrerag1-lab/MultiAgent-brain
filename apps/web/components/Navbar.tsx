"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, LayoutDashboard, Terminal, Activity, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { fetchQwenHealth } from "@/lib/qwenApi";
import { ORCHESTRATOR_URL } from "@/lib/utils";

export function Navbar() {
  const pathname = usePathname();
  const [orchOk, setOrchOk] = useState<boolean | null>(null);

  useEffect(() => {
    const checkOrch = async () => {
      try {
        const res = await fetch(`${ORCHESTRATOR_URL}/health`, { cache: "no-store" });
        setOrchOk(res.ok);
      } catch {
        setOrchOk(false);
      }
    };
    checkOrch();
    const interval = setInterval(checkOrch, 15_000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    {
      href: "/qwen-chat",
      label: "Qwen Chat",
      icon: Brain,
      badge: "Fase 6b",
      badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
    },
    {
      href: "/",
      label: "Misiones",
      icon: Terminal,
    },
    {
      href: "/dashboard",
      label: "Dashboard Kanban",
      icon: LayoutDashboard,
    },
  ];

  return (
    <header className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/qwen-chat" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-zinc-200 to-white text-black flex items-center justify-center font-bold text-sm shadow-sm group-hover:scale-105 transition transform">
            ◈
          </div>
          <div className="flex flex-col">
            <span className="font-semibold text-sm tracking-tight leading-tight flex items-center gap-1.5 text-zinc-100">
              Cerebro de Agentes
            </span>
            <span className="text-[10px] text-zinc-500 font-mono leading-none">
              QwenMax-3.8 · DSH · Opencode
            </span>
          </div>
        </Link>

        {/* Tab Switcher */}
        <nav className="flex items-center gap-1 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800/90">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href || (item.href === "/" && pathname === "");

            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? "bg-zinc-800 text-white shadow-[0_1px_8px_rgba(0,0,0,0.4)] border border-zinc-700/60 font-semibold"
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? "text-emerald-400" : "text-zinc-500"}`} />
                <span>{item.label}</span>
                {item.badge && (
                  <span className={`text-[9px] px-1.5 py-0.2 rounded-full border ${item.badgeColor}`}>
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <a
            href={`${ORCHESTRATOR_URL}/health`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/80 px-2.5 py-1 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition"
            title="Estado del Orquestador (puerto 3001)"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                orchOk === true
                  ? "bg-emerald-400 animate-pulse"
                  : orchOk === false
                  ? "bg-rose-500"
                  : "bg-amber-400"
              }`}
            />
            <span className="hidden sm:inline text-[11px] font-mono">
              {orchOk === true ? "Líder 3001" : orchOk === false ? "Desconectado" : "Conectando..."}
            </span>
          </a>
        </div>
      </div>
    </header>
  );
}
