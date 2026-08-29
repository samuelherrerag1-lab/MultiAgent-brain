"use client";

import { useState, useEffect } from "react";
import { fetchMissions, approveMission, type MissionRow } from "@/lib/api";
import { ORCHESTRATOR_URL } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getStatusColor, getAdapterLabel } from "@/lib/utils";
import { Check, Loader2, RefreshCw, Plus, ExternalLink, Terminal, ShieldAlert } from "lucide-react";
import Link from "next/link";

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "pending", label: "Pendiente", statuses: ["pending"] },
  { key: "running", label: "En ejecución", statuses: ["running"] },
  { key: "review", label: "Revisión / Gobernanza", statuses: ["needs_review"] },
  { key: "success", label: "Hecho", statuses: ["success"] },
  { key: "failed", label: "Fallido", statuses: ["failed", "aborted"] },
];

export default function DashboardPage() {
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const data = await fetchMissions();
      setMissions(data);
      setError(null);
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleApprove = async (id: string) => {
    setApprovingId(id);
    try {
      await approveMission(id);
      await loadData();
    } catch (e: any) {
      alert("Error al aprobar misión: " + e.message);
    } finally {
      setApprovingId(null);
    }
  };

  const byStatus = (statuses: string[]) => missions.filter((m) => statuses.includes(m.status));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard Kanban</h1>
          <p className="text-sm text-zinc-400">
            Monitoreo en tiempo real de misiones y gobernanza multi-agente
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={loadData} disabled={loading} className="border-zinc-800">
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} /> Actualizar
          </Button>
          <Link href="/" className="rounded-md bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200 flex items-center gap-1.5">
            <Plus className="h-4 w-4" /> Nueva misión
          </Link>
        </div>
      </div>

      {error ? (
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="pt-6">
            <p className="text-sm text-red-400">No se pudo conectar al Orquestador ({error})</p>
            <p className="text-xs text-zinc-500 mt-2">
              Verifica que <code className="bg-zinc-900 px-1 rounded">pnpm --filter @cerebro/orchestrator dev</code> esté corriendo en {ORCHESTRATOR_URL}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const items = byStatus(col.statuses);
          const isReviewCol = col.key === "review";

          return (
            <Card key={col.key} className={`bg-zinc-950/50 border-zinc-800 ${isReviewCol && items.length > 0 ? "border-amber-700/50" : ""}`}>
              <CardHeader className="pb-3 border-b border-zinc-800/80">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {isReviewCol && items.length > 0 && <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
                    {col.label}
                  </span>
                  <Badge variant="outline" className={`border-zinc-700 text-xs ${isReviewCol && items.length > 0 ? "bg-amber-950 text-amber-300 border-amber-700" : ""}`}>
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 min-h-[350px] p-3">
                {items.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-10">Sin misiones</p>
                ) : (
                  items.map((m) => (
                    <div
                      key={m.id}
                      className={`rounded-lg border bg-zinc-900/90 p-3 space-y-2 transition ${
                        m.status === "needs_review"
                          ? "border-amber-600/60 shadow-[0_0_15px_rgba(245,158,11,0.1)]"
                          : "border-zinc-800 hover:border-zinc-700"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <Badge className={getStatusColor(m.status)}>{m.status}</Badge>
                        <Badge variant="outline" className="text-[10px] border-zinc-700">
                          {getAdapterLabel(m.adapter)}
                        </Badge>
                      </div>

                      <h4 className="font-semibold text-sm leading-snug line-clamp-2 text-zinc-100">{m.title}</h4>
                      <p className="text-xs text-zinc-400 line-clamp-2">{m.prompt}</p>

                      <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-1 border-t border-zinc-800/60">
                        <span className="font-mono">{m.id.slice(0, 8)}</span>
                        <span>
                          {m.type} · {m.complexity}
                        </span>
                      </div>

                      {/* Acción de Aprobación de Gobernanza */}
                      {m.status === "needs_review" && (
                        <div className="pt-2">
                          <Button
                            size="sm"
                            onClick={() => handleApprove(m.id)}
                            disabled={approvingId === m.id}
                            className="w-full h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium flex items-center justify-center gap-1"
                          >
                            {approvingId === m.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                            Aprobar Ejecución
                          </Button>
                        </div>
                      )}

                      {/* Enlaces de inspección */}
                      <div className="flex gap-2 pt-1">
                        <a
                          href={`${ORCHESTRATOR_URL}/api/missions/${m.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-zinc-400 hover:text-white flex items-center gap-0.5 underline"
                        >
                          JSON <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                        <a
                          href={`${ORCHESTRATOR_URL}/api/missions/${m.id}/stream`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-zinc-400 hover:text-white flex items-center gap-0.5 underline"
                        >
                          SSE <Terminal className="h-2.5 w-2.5" />
                        </a>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
