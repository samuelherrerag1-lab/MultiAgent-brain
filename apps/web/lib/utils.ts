import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || "http://localhost:3001";

export function getStatusColor(status: string): string {
  switch (status) {
    case "success":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "failed":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    case "running":
      return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse";
    case "pending":
      return "bg-zinc-700/50 text-zinc-400 border-zinc-600/30";
    case "needs_review":
      return "bg-orange-500/20 text-orange-400 border-orange-500/30";
    case "aborted":
      return "bg-gray-500/20 text-gray-400 border-gray-500/30";
    default:
      return "bg-zinc-800 text-zinc-300 border-zinc-700";
  }
}

export function getAdapterLabel(adapter: string | null): string {
  switch (adapter) {
    case "qwen":
      return "QwenMax-3.8";
    case "dsh":
      return "DSH";
    case "opencode":
      return "Opencode";
    default:
      return adapter || "—";
  }
}
