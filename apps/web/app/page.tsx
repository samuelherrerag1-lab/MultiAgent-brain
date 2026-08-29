"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { createMission, subscribeMissionStream, fetchMission } from "@/lib/api";
import { getStatusColor, getAdapterLabel } from "@/lib/utils";
import { Send, Loader2, CheckCircle2, XCircle, Clock, Brain, Sparkles, Terminal } from "lucide-react";

type LogEntry = { at: string; msg: string; type: "info" | "success" | "error" };

export default function ChatPage() {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState("build");
  const [complexity, setComplexity] = useState("medium");
  const [criteria, setCriteria] = useState("El entregable cumple el objetivo descrito");
  const [loading, setLoading] = useState(false);
  const [mission, setMission] = useState<any>(null);
  const [route, setRoute] = useState<any>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const esRef = useRef<(() => void) | null>(null);

  const addLog = (msg: string, type: LogEntry["type"] = "info") => {
    setLogs((l) => [...l, { at: new Date().toLocaleTimeString(), msg, type }]);
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
      .map((s) => (s.length < 10 ? s + " — criterio verificable" : s));

    try {
      addLog(`Enviando misión "${title}" al Orquestador...`);
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
      addLog(`Misión creada ${res.mission.missionId.slice(0, 8)}`, "success");
      addLog(`Router → ${res.route.adapter} (${res.route.reason})`);

      // SSE streaming
      addLog(`Conectando SSE para logs en tiempo real...`);
      const close = subscribeMissionStream(res.mission.missionId, {
        onUpdate: (m) => {
          setLiveStatus(m.status);
          addLog(`status → ${m.status} (adapter: ${m.adapter || "—"})`);
        },
        onDone: async (data) => {
          addLog(`Stream done: ${JSON.stringify(data)}`, "success");
          // Fetch final report
          try {
            const final = await fetchMission(res.mission.missionId);
            if (final.report) {
              addLog(`Reporte: ${final.report.status} — ${final.report.summary.slice(0, 200)}`, final.report.status === "success" ? "success" : "error");
              setMission((prev: any) => ({ ...prev, report: final.report }));
            }
            if (final.mission) setLiveStatus(final.mission.status);
          } catch {}
          setLoading(false);
        },
        onError: (err) => {
          addLog(`SSE error: ${String(err)}`, "error");
        },
      });
      esRef.current = close;

      // Poll fallback si SSE no conecta (por si el servidor no soporta EventSource desde browser)
      setTimeout(async () => {
        try {
          const final = await fetchMission(res.mission.missionId);
          if (final.mission?.status && final.mission.status !== "pending" && final.mission.status !== "running") {
            setLiveStatus(final.mission.status);
          }
        } catch {}
      }, 4000);
    } catch (err: any) {
      const msg = err.message || String(err);
      addLog(`Error: ${msg}`, "error");
      if (msg.includes("Bloqueado") || msg.includes("needs_review")) {
        addLog("La misión fue bloqueada por gobernanza. Usa Dashboard para aprobar.", "error");
      }
      setLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Form */}
      <Card className="lg:col-span-3">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" /> Nueva misión
          </CardTitle>
          <CardDescription>Envía un objetivo al Líder — el Router elegirá QwenMax-3.8, DSH u Opencode.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-zinc-400">Título</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Crear API de usuarios CRUD" required />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-zinc-400">Tipo</label>
                <Select value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="build">build</option>
                  <option value="execute">execute</option>
                  <option value="refactor">refactor</option>
                  <option value="tests">tests</option>
                  <option value="planificar_arquitectura">planificar_arquitectura</option>
                  <option value="revisar_entregable">revisar_entregable</option>
                  <option value="resolver_bloqueo">resolver_bloqueo</option>
                </Select>
              </div>
              <div>
                <label className="text-sm text-zinc-400">Complejidad</label>
                <Select value={complexity} onChange={(e) => setComplexity(e.target.value)}>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm text-zinc-400">Prompt — objetivo detallado</label>
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe el objetivo. Ej: Implementa CRUD de usuarios con Hono + Drizzle, con validación Zod..."
                rows={5}
                required
              />
              <p className="text-xs text-zinc-600 mt-1">Mín 20 caracteres. Se inyectará en AGENTS.md del worktree.</p>
            </div>

            <div>
              <label className="text-sm text-zinc-400">Criterios de aceptación (uno por línea)</label>
              <Textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={3} />
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {loading ? "Enviando..." : "Enviar al Orquestador"}
            </Button>

            {route && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <Sparkles className="h-4 w-4" />
                Router → <Badge className={getStatusColor("pending")}>{getAdapterLabel(route.adapter)}</Badge>
                <span className="text-xs">{route.reason}</span>
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {/* Logs + Resultado */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="h-4 w-4" /> Logs SSE
              {liveStatus && <Badge className={getStatusColor(liveStatus)}>{liveStatus}</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[280px] overflow-auto rounded-md bg-black border border-zinc-800 p-3 font-mono text-xs space-y-1">
              {logs.length === 0 ? (
                <span className="text-zinc-600">Sin logs — envía una misión</span>
              ) : (
                logs.map((l, i) => (
                  <div
                    key={i}
                    className={l.type === "success" ? "text-green-400" : l.type === "error" ? "text-red-400" : "text-zinc-300"}
                  >
                    <span className="text-zinc-600">[{l.at}]</span> {l.msg}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {mission && (
          <Card className="border-zinc-800">
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                {liveStatus === "success" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : liveStatus === "failed" ? (
                  <XCircle className="h-4 w-4 text-red-400" />
                ) : (
                  <Clock className="h-4 w-4 text-yellow-400" />
                )}
                {mission.title}
              </CardTitle>
              <CardDescription className="font-mono text-xs">{mission.missionId}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex gap-2">
                <Badge className={getStatusColor(liveStatus || mission.status)}>{liveStatus || mission.status}</Badge>
                <Badge variant="outline" className="border-zinc-700">
                  {mission.type} · {mission.complexity}
                </Badge>
                {route && <Badge className="bg-zinc-800">{getAdapterLabel(route.adapter)}</Badge>}
              </div>
              {mission.report && (
                <div className="rounded-md bg-zinc-950 border border-zinc-800 p-3">
                  <p className="text-xs text-zinc-400">Reporte ({mission.report.adapter})</p>
                  <p className="mt-1 text-sm">{mission.report.summary}</p>
                  {mission.report.artifacts?.length > 0 && (
                    <ul className="mt-2 text-xs list-disc list-inside text-zinc-400">
                      {mission.report.artifacts.map((a: any, i: number) => (
                        <li key={i}>
                          {a.path} ({a.kind})
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              <div className="text-xs text-zinc-500">
                <p>Prompt: {mission.prompt.slice(0, 120)}...</p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
