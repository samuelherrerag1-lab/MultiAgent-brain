"use client";

import { useState, useMemo } from "react";
import { MarkdownRenderer } from "./MarkdownRenderer";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Sparkles,
  ArrowRight,
  PlusCircle,
  HelpCircle,
  CheckCircle2,
} from "lucide-react";
import { Badge } from "./ui/badge";
import Link from "next/link";

interface QwenMessageViewProps {
  content: string;
  isStreaming?: boolean;
  thought?: string;
  isThinking?: boolean;
  onQuickReply?: (text: string) => void;
}

/**
 * Extrae el bloque de razonamiento del texto.
 * - Para mensajes en streaming: content=respuesta acumulada, propThought=thought acumulado (ya separados).
 * - Para mensajes históricos: content es el texto completo; se buscan marcadores <details>, 🤔, etc.
 */
function parseThoughtAndResponse(content: string, propThought?: string, isStreaming?: boolean) {
  // Para streaming: thought y response ya vienen separados por el backend
  if (isStreaming) {
    return { thought: propThought || "", response: content || "" };
  }

  // Para mensajes históricos: parsear el contenido buscando marcadores
  let thought = "";
  let response = content;

  // 1) Formato <details><summary>...</summary>...</details>
  const detailsMatch = content.match(/<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/i);
  if (detailsMatch) {
    thought = (detailsMatch[2] || "").trim();
    response = content.replace(detailsMatch[0], "").trim();
    return { thought, response };
  }

  // 2) Marcadores "🤔..." -> "...🤔"
  if (content.includes("🤔")) {
    const startIdx = content.indexOf("🤔");
    const endIdx = content.indexOf("🤔", startIdx + 1);
    if (startIdx !== -1 && endIdx !== -1) {
      thought = content.slice(startIdx + 7, endIdx).trim();
      response = content.slice(endIdx + 8).trim();
      return { thought, response };
    }
  }

  // 3) Sin marcadores: todo el contenido es la respuesta
  return { thought: "", response: content };
}

/**
 * Detecta preguntas y opciones finales en las respuestas de Qwen
 */
function extractQuickReplies(text: string): string[] {
  if (!text || text.length < 20) return [];

  const replies: string[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const lastLines = lines.slice(-8);

  // 1. Detectar listas numeradas al final: "1. Opción A"
  for (const line of lastLines) {
    const matchNumbered = line.match(/^[0-9]+[.)]\s+[*_]*(.+?)[*_]*$/);
    if (matchNumbered && matchNumbered[1] && matchNumbered[1].length < 80) {
      replies.push(matchNumbered[1].replace(/[:]$/, ""));
    }
  }

  // 2. Si hay preguntas explícitas con signo de interrogación al final
  if (replies.length === 0) {
    for (const line of lastLines) {
      if (line.includes("¿") && line.includes("?")) {
        const questionMatch = line.match(/¿([^?]+)\?/);
        if (questionMatch && questionMatch[1]) {
          const q = questionMatch[1].trim().toLowerCase();
          if (q.includes("quieres que") || q.includes("deseas que") || q.includes("procedemos") || q.includes("continuo")) {
            return ["✅ Sí, procede", "❌ No, hazlo de otra forma", "🔍 Explícame más detalles"];
          }
        }
      }
    }
  }

  return replies.slice(0, 4);
}

/**
 * Detecta si el mensaje contiene una propuesta de plan/arquitectura
 */
function detectPlanOrCode(text: string): { isPlan: boolean; title?: string } {
  if (!text || text.length < 50) return { isPlan: false };
  const hasPlanHeader = /#+ (Plan|Arquitectura|Propuesta|Diseño|Estrategia)/i.test(text);
  const hasCodeBlocks = text.includes("```");
  const hasAcceptance = /criterios? de aceptaci[oó]n/i.test(text);

  if (hasPlanHeader || (hasCodeBlocks && hasAcceptance)) {
    const titleMatch = text.match(/#+ ([^\n]+)/);
    const title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/[*_#]/g, "").trim() : "Misión propuesta por Qwen";
    return {
      isPlan: true,
      title,
    };
  }
  return { isPlan: false };
}

export function QwenMessageView({
  content,
  isStreaming,
  thought: propThought,
  isThinking,
  onQuickReply,
}: QwenMessageViewProps) {
  const { thought, response } = useMemo(
    () => parseThoughtAndResponse(content, propThought, isStreaming),
    [content, propThought, isStreaming],
  );

  const [thoughtOpen, setThoughtOpen] = useState(false);
  const quickReplies = useMemo(() => (!isStreaming ? extractQuickReplies(response) : []), [response, isStreaming]);
  const planInfo = useMemo(() => (!isStreaming ? detectPlanOrCode(response) : { isPlan: false }), [response, isStreaming]);

  const hasThought = Boolean(thought && thought.length > 0);
  const activeThinking = isThinking || (isStreaming && hasThought && !response);

  return (
    <div className="space-y-3 w-full">
      {/* 🧠 Bloque de Razonamiento / Pensamiento Dedicado */}
      {hasThought && (
        <div className="rounded-xl border border-purple-900/40 bg-purple-950/20 overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => setThoughtOpen(!thoughtOpen)}
            className="w-full px-3.5 py-2 flex items-center justify-between text-left hover:bg-purple-900/20 transition-colors"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-purple-300">
              <Brain className={`h-3.5 w-3.5 text-purple-400 ${activeThinking ? "animate-pulse" : ""}`} />
              <span>{activeThinking ? "Razonando en tiempo real..." : "Proceso de Razonamiento"}</span>
              {activeThinking && (
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-purple-400/80">
              <span className="font-mono">{thought.length} caracteres</span>
              {thoughtOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </div>
          </button>

          {(thoughtOpen || activeThinking) && (
            <div className="p-3 pt-1 text-xs text-purple-200/90 font-mono leading-relaxed border-t border-purple-900/30 max-h-[300px] overflow-y-auto whitespace-pre-wrap scrollbar-thin">
              {thought}
            </div>
          )}
        </div>
      )}

      {/* 💬 Respuesta Principal de Qwen */}
      {response ? (
        <MarkdownRenderer content={response} />
      ) : activeThinking ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400 italic py-1">
          <span className="animate-spin inline-block h-3 w-3 border-2 border-emerald-400 border-t-transparent rounded-full" />
          <span>Formulando respuesta final...</span>
        </div>
      ) : null}

      {/* ⚡ Banner de Conversión a Misión del Orquestador si contiene un Plan */}
      {planInfo.isPlan && (
        <div className="rounded-xl border border-emerald-800/60 bg-emerald-950/30 p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 text-xs text-emerald-200">
            <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
            <div>
              <p className="font-semibold text-emerald-300">Plan de arquitectura detectado</p>
              <p className="text-[11px] text-emerald-400/80">Puedes lanzarlo directamente como misión con aislamiento en git worktree</p>
            </div>
          </div>
          <Link
            href={`/?title=${encodeURIComponent(planInfo.title || "Misión Qwen")}&prompt=${encodeURIComponent(response.slice(0, 500))}`}
            className="shrink-0 text-xs bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition shadow-sm"
          >
            <PlusCircle className="h-3.5 w-3.5" /> Crear Misión
          </Link>
        </div>
      )}

      {/* 🔘 Chips de Respuestas Rápidas e Interactivas */}
      {quickReplies.length > 0 && onQuickReply && (
        <div className="pt-2 border-t border-zinc-800/60 space-y-1.5">
          <span className="text-[11px] text-zinc-500 font-medium flex items-center gap-1">
            <HelpCircle className="h-3 w-3 text-zinc-400" /> Respuestas sugeridas:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {quickReplies.map((reply, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => onQuickReply(reply)}
                className="text-xs bg-zinc-900 hover:bg-zinc-800 hover:text-white border border-zinc-700/80 text-zinc-300 px-2.5 py-1 rounded-lg transition-all flex items-center gap-1 text-left shadow-sm active:scale-95"
              >
                <span>{reply}</span>
                <ArrowRight className="h-3 w-3 text-zinc-500 shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
