"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { createMission, subscribeMissionStream, fetchMission } from "@/lib/api";
import { getStatusColor, getAdapterLabel } from "@/lib/utils";
import {
  Send,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Brain,
  Sparkles,
  Terminal,
  FileCode,
  Zap,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import Link from "next/link";

type LogEntry = { at: string; msg: string; type: "info" | "success" | "error" };

const TEMPLATES = [
  {
    label: "API REST CRUD",
    title: "Crear API REST de Usuarios con Hono y Drizzle",
    type: "build",
    complexity: "medium",
    prompt: "Implementa un CRUD completo de usuarios en Hono con esquemas Zod en packages/shared, validaciones en TypeScript estricto y pruebas unitarias con vitest.",
    criteria: "Esquema Zod definido en protocols.ts\\nRutas GET, POST, PUT, DELETE funcionando\\nPruebas unitarias pasando con vitest",
  },
  {
    label: "Plan Arquitectura",
    title: "Diseño de Arquitectura Multi-Agente y Gobernanza",
    type: "planificar_arquitectura",
    complexity: "high",
    prompt: "Diseña un documento técnico para la orquestación distribuida de agentes de código, detallando contratos Zod, gestión de memoria semántica y políticas de sandbox.",
    criteria: "Documento de arquitectura con diagramas\\nContratos Zod especificados\\nEstrategia de persistencia y memoria",
  },
  {
    label: "Refactor & Tests",
    title: "Refactorizar Módulos y Añadir Cobertura de Pruebas",
    type: "tests",
    complexity: "medium",
    prompt: "Añade pruebas de integración para el enrutador de tareas, cubriendo casos límite, timeouts y validación de aceptación.",
    criteria: "Tests creados en *.test.ts\\n100% de tests pasando en vitest\\nSin errores de TypeScript strict",
  },
];

export default function MisionesPage() {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState("build");
  const [complexity, setComplexity] = useState("medium");
  const [criteria, setCriteria] = useState("El entregable cumple el objetivo descrito y pasa los tests");
  const [loading, setLoading] = useState(false);
  const [mission, setMission] = useState<any>(null);
  const [route, setRoute] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const esRef = useRef<(() => void) | null>(null);

  const addLog = (msg: string, type: LogEntry["type"] = "info") => {
    setLogs((l) => [...l, { at: new Date().toLocaleTimeString(), msg, type }]);
  };

  const applyTemplate = (tmpl: (typeof TEMPLATES)[0]) => {
    setTitle(tmpl.title);
    setType(tmpl.type);
    setComplexity(tmpl.complexity);
    setPrompt(tmpl.prompt);
    setCriteria(tmpl.criteria);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !prompt.trim()) return;

    setLoading(true);
    setLogs([]);
    setMission(null);
    setRoute(null);
    setLiveStatus(null);
    esRef.current?.();

    const acceptanceCriteria = criteria
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.length < 8 ? s + " — verificable" : s));

    try {
      addLog(`Creando misión "${title}"...`);
      const res = await createMission({
        type,
        complexity,
        title: title.trim(),
        prompt: prompt.trim(),
        acceptanceCriteria,
      });

      setMission(res.mission);
      setRoute(res.route);
      setLiveStatus(res.mission.status);
      addLog(`Misión registrada con ID ${res.mission.missionId.slice(0, 8)}`, "success");
      addLog(`Router → ${res.route.adapter?.toUpperCase()} (${res.route.reason})`);

      // Conexión SSE
      addLog("Conectando flujo de eventos SSE en tiempo real...");
      const close = subscribeMissionStream(res.mission.missionId, {
        onUpdate: (m) => {
          setLiveStatus(m.status);
          addLog(`Estado → ${m.status} (Adaptador: ${m.adapter || "—"})`);
        },
        onDone: async (data) => {
          addLog("Misión concluida en el orquestador", "success");
          try {
            const final = await fetchMission(res.mission.missionId);
            if (final.report) {
              addLog(
                `Reporte final: ${final.report.status} — ${final.report.summary.slice(0, 150)}...`,
                final.report.status === "success" ? "success" : "error",
              );
              setMission((prev: any) => ({ ...prev, report: final.report }));
            }
            if (final.mission) setLiveStatus(final.mission.status);
          } catch {}
          setLoading(false);
        },
        onError: (err) => {
          addLog(`SSE aviso/desconexión: ${String(err)}`, "info");
        },
      });
      esRef.current = close;
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Error: ${msg}`, "error");
      if (msg.includes("Bloqueado") || msg.includes("needs_review")) {
        addLog("La misión requiere aprobación de gobernanza. Ve al Dashboard para aprobar.", "error");
      }
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Generador de Misiones</h1>
          <p className="text-xs text-zinc-400">
            Define objetivos estructurados con aislamiento en git worktrees y enrutamiento inteligente
          </p>
        </div>
        <Link
          href="/dashboard"
          className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 px-3.5 py-2 rounded-xl transition flex items-center gap-1.5 w-fit"
        >
          Ver en Dashboard Kanban →
        </Link>
      </div>

      {/* Templates Rápidos */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-zinc-500 font-medium mr-1 flex items-center gap-1">
          <Sparkles className="h-3 w-3 text-emerald-400" /> Plantillas rápidas:
        </span>
        {TEMPLATES.map((tmpl, i) => (
          <button
            key={i}
            onClick={() => applyTemplate(tmpl)}
            className="text-xs bg-zinc-950/80 hover:bg-zinc-900 border border-zinc-800/90 text-zinc-300 hover:text-white px-3 py-1.5 rounded-lg transition shadow-sm font-medium"
          >
            {tmpl.label}
          </button>
        ))}
      </div>

      {/* Grid Principal */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Formulario */}
        <Card className="lg:col-span-3 bg-zinc-950/70 border-zinc-800/80 rounded-2xl shadow-xl">
          <CardHeader className="p-5 border-b border-zinc-800/80">
            <CardTitle className="flex items-center gap-2 text-base text-zinc-100">
              <Brain className="h-4 w-4 text-emerald-400" /> Configuración de la Misión
            </CardTitle>
            <CardDescription className="text-xs text-zinc-400">
              El Supervisor y el TaskRouter asignarán el mejor adaptador (Qwen, DSH u Opencode).
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-xs font-medium text-zinc-300 mb-1 block">Título de la Misión</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ej: Crear API de usuarios con autenticación JWT"
                  className="h-10 text-xs bg-zinc-900/90 border-zinc-700/80 rounded-xl"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-zinc-300 mb-1 block">Tipo</label>
                  <Select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="h-10 text-xs bg-zinc-900/90 border-zinc-700/80 rounded-xl"
                  >
                    <option value="build">build (construir funcionalidad)</option>
                    <option value="execute">execute (ejecución directa)</option>
                    <option value="refactor">refactor (reestructuración)</option>
                    <option value="tests">tests (pruebas unitarias)</option>
                    <option value="planificar_arquitectura">planificar_arquitectura</option>
                    <option value="revisar_entregable">revisar_entregable</option>
                    <option value="resolver_bloqueo">resolver_bloqueo</option>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-zinc-300 mb-1 block">Complejidad</label>
                  <Select
                    value={complexity}
                    onChange={(e) => setComplexity(e.target.value)}
                    className="h-10 text-xs bg-zinc-900/90 border-zinc-700/80 rounded-xl"
                  >
                    <option value="low">low (baja)</option>
                    <option value="medium">medium (media)</option>
                    <option value="high">high (alta - requiere arquitecto)</option>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 mb-1 block">
                  Prompt — Objetivo detallado
                </label>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Describe con precisión qué debe realizar el agente..."
                  className="min-h-[110px] text-xs bg-zinc-900/90 border-zinc-700/80 rounded-xl"
                  rows={4}
                  required
                />
                <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                  Mínimo 20 caracteres. Se inyectará en AGENTS.md del git worktree.
                </p>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 mb-1 block">
                  Criterios de Aceptación (uno por línea)
                </label>
                <Textarea
                  value={criteria}
                  onChange={(e) => setCriteria(e.target.value)}
                  className="min-h-[80px] text-xs bg-zinc-900/90 border-zinc-700/80 rounded-xl font-mono"
                  rows={3}
                />
              </div>

              <Button
                type="submit"
                disabled={loading || !title.trim() || !prompt.trim()}
                className="w-full h-11 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold rounded-xl transition-all shadow-md shadow-emerald-500/20 disabled:opacity-40"
              >
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                {loading ? "Enviando al Orquestador..." : "Lanzar Misión"}
              </Button>

              {route && (
                <div className="flex items-center gap-2 text-xs bg-zinc-900/90 border border-zinc-800 p-2.5 rounded-xl text-zinc-300">
                  <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
                  <span>
                    Router: Asignado a <strong>{getAdapterLabel(route.adapter)}</strong> ({route.reason})
                  </span>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Panel Lateral: Terminal SSE & Resultados */}
        <div className="lg:col-span-2 space-y-4">
          {/* Terminal SSE */}
          <Card className="bg-zinc-950/70 border-zinc-800/80 rounded-2xl shadow-xl overflow-hidden">
            <CardHeader className="p-4 border-b border-zinc-800/80 bg-zinc-900/40 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-xs font-semibold flex items-center gap-2 text-zinc-200">
                <Terminal className="h-3.5 w-3.5 text-emerald-400" /> Logs de Ejecución en Vivo
              </CardTitle>
              {liveStatus && (
                <Badge className={`text-[10px] ${getStatusColor(liveStatus)}`}>
                  {liveStatus}
                </Badge>
              )}
            </CardHeader>
            <CardContent className="p-3">
              <div className="h-[260px] overflow-auto rounded-xl bg-black/90 border border-zinc-900 p-3 font-mono text-[11px] space-y-1.5 scrollbar-thin">
                {logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-600 space-y-1 text-center">
                    <Terminal className="h-6 w-6 text-zinc-700" />
                    <span>Sin eventos. Envía una misión para ver el streaming.</span>
                  </div>
                ) : (
                  logs.map((l, i) => (
                    <div
                      key={i}
                      className={`leading-relaxed ${
                        l.type === "success"
                          ? "text-emerald-400"
                          : l.type === "error"
                          ? "text-rose-400 font-semibold"
                          : "text-zinc-300"
                      }`}
                    >
                      <span className="text-zinc-600 mr-1.5">[{l.at}]</span>
                      {l.msg}
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* Resultado / Reporte */}
          {mission && (
            <Card className="bg-zinc-950/70 border-zinc-800/80 rounded-2xl p-4 space-y-3 animate-in fade-in duration-300">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {liveStatus === "success" ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  ) : liveStatus === "failed" ? (
                    <XCircle className="h-4 w-4 text-rose-400" />
                  ) : (
                    <Clock className="h-4 w-4 text-amber-400 animate-pulse" />
                  )}
                  <h4 className="font-semibold text-xs text-zinc-100 truncate max-w-[200px]">
                    {mission.title}
                  </h4>
                </div>
                <Badge className={getStatusColor(liveStatus || mission.status)}>
                  {liveStatus || mission.status}
                </Badge>
              </div>

              {mission.report && (
                <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl space-y-2 text-xs">
                  <span className="text-zinc-400 block font-medium">Resumen del Entregable:</span>
                  <p className="text-zinc-200 leading-relaxed">{mission.report.summary}</p>
                  {mission.report.artifacts?.length > 0 && (
                    <div className="pt-2 border-t border-zinc-800/60">
                      <span className="text-zinc-500 text-[11px] block mb-1">Archivos creados/modificados:</span>
                      <ul className="space-y-1">
                        {mission.report.artifacts.map((a: any, idx: number) => (
                          <li key={idx} className="font-mono text-[11px] text-emerald-300 flex items-center gap-1.5">
                            <FileCode className="h-3 w-3 text-emerald-400" /> {a.path}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
