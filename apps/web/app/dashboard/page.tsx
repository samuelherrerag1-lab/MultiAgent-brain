"use client";

import { useState, useEffect, useMemo } from "react";
import { fetchMissions, fetchMission, approveMission, type MissionRow } from "@/lib/api";
import { ORCHESTRATOR_URL } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getStatusColor, getAdapterLabel } from "@/lib/utils";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import {
  Check,
  Loader2,
  RefreshCw,
  Plus,
  ExternalLink,
  Terminal,
  ShieldAlert,
  Search,
  Filter,
  Eye,
  X,
  Clock,
  CheckCircle2,
  XCircle,
  FileCode,
  Layers,
} from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [adapterFilter, setAdapterFilter] = useState("all");
  const [selectedMission, setSelectedMission] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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

  const handleApprove = async (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setApprovingId(id);
    try {
      await approveMission(id);
      await loadData();
      if (selectedMission?.mission?.id === id) {
        openDetail(id);
      }
    } catch (e: any) {
      alert("Error al aprobar misión: " + e.message);
    } finally {
      setApprovingId(null);
    }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const full = await fetchMission(id);
      setSelectedMission(full);
    } catch (err: any) {
      alert("Error al cargar detalle: " + err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const filteredMissions = useMemo(() => {
    return missions.filter((m) => {
      const matchSearch =
        !search ||
        m.title.toLowerCase().includes(search.toLowerCase()) ||
        m.prompt.toLowerCase().includes(search.toLowerCase()) ||
        m.id.toLowerCase().includes(search.toLowerCase());

      const matchAdapter =
        adapterFilter === "all" ||
        (m.adapter && m.adapter.toLowerCase() === adapterFilter.toLowerCase());

      return matchSearch && matchAdapter;
    });
  }, [missions, search, adapterFilter]);

  const byStatus = (statuses: string[]) => filteredMissions.filter((m) => statuses.includes(m.status));

  const counts = useMemo(() => {
    return {
      total: missions.length,
      running: missions.filter((m) => m.status === "running").length,
      review: missions.filter((m) => m.status === "needs_review").length,
      success: missions.filter((m) => m.status === "success").length,
    };
  }, [missions]);

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Dashboard Kanban</h1>
          <p className="text-xs text-zinc-400">
            Monitoreo en tiempo real de misiones y gobernanza multi-agente (PostgreSQL)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="border-zinc-800 bg-zinc-900/80 text-xs h-8"
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${loading ? "animate-spin text-emerald-400" : ""}`} />
            Actualizar
          </Button>
          <Link
            href="/"
            className="rounded-lg bg-zinc-100 hover:bg-white text-black px-3.5 py-1.5 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva misión
          </Link>
        </div>
      </div>

      {/* Metrics Badges Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-950/70 border border-zinc-800/80 p-3 rounded-xl flex items-center justify-between">
          <span className="text-xs text-zinc-400 font-medium">Total Misiones</span>
          <span className="font-mono text-base font-bold text-zinc-200">{counts.total}</span>
        </div>
        <div className="bg-zinc-950/70 border border-zinc-800/80 p-3 rounded-xl flex items-center justify-between">
          <span className="text-xs text-blue-400 font-medium">En Ejecución</span>
          <span className="font-mono text-base font-bold text-blue-300">{counts.running}</span>
        </div>
        <div className="bg-zinc-950/70 border border-amber-900/40 p-3 rounded-xl flex items-center justify-between">
          <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5" /> Revisión / Guard
          </span>
          <span className="font-mono text-base font-bold text-amber-300">{counts.review}</span>
        </div>
        <div className="bg-zinc-950/70 border border-emerald-900/40 p-3 rounded-xl flex items-center justify-between">
          <span className="text-xs text-emerald-400 font-medium">Completadas</span>
          <span className="font-mono text-base font-bold text-emerald-300">{counts.success}</span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 bg-zinc-950/60 p-2.5 rounded-xl border border-zinc-800/80">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-3.5 w-3.5 absolute left-3 top-2.5 text-zinc-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, prompt o ID..."
            className="w-full h-8 pl-8 pr-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700"
          />
        </div>

        <div className="flex items-center gap-2">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          <select
            value={adapterFilter}
            onChange={(e) => setAdapterFilter(e.target.value)}
            className="h-8 text-xs bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-lg px-2 focus:outline-none"
          >
            <option value="all">Todos los adaptadores</option>
            <option value="qwen">QwenMax-3.8</option>
            <option value="dsh">DeepSeek Harness (DSH)</option>
            <option value="opencode">Opencode CLI</option>
          </select>
        </div>
      </div>

      {error ? (
        <Card className="border-rose-900/50 bg-rose-950/20">
          <CardContent className="pt-6">
            <p className="text-sm text-rose-400">No se pudo conectar al Orquestador ({error})</p>
            <p className="text-xs text-zinc-500 mt-2">
              Verifica que el Orquestador esté corriendo en {ORCHESTRATOR_URL}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const items = byStatus(col.statuses);
          const isReviewCol = col.key === "review";

          return (
            <Card
              key={col.key}
              className={`bg-zinc-950/70 border-zinc-800/80 flex flex-col ${
                isReviewCol && items.length > 0 ? "border-amber-600/50 shadow-[0_0_15px_rgba(245,158,11,0.08)]" : ""
              }`}
            >
              <CardHeader className="p-3 border-b border-zinc-800/80 bg-zinc-900/40">
                <CardTitle className="text-xs font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    {isReviewCol && items.length > 0 && <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />}
                    {col.label}
                  </span>
                  <Badge
                    variant="outline"
                    className={`border-zinc-700 text-[10px] px-1.5 py-0 ${
                      isReviewCol && items.length > 0
                        ? "bg-amber-950 text-amber-300 border-amber-700"
                        : "bg-zinc-900"
                    }`}
                  >
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 min-h-[380px] p-2.5 flex-1">
                {items.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-12">Sin misiones</p>
                ) : (
                  items.map((m) => (
                    <div
                      key={m.id}
                      onClick={() => openDetail(m.id)}
                      className={`group rounded-xl border bg-zinc-900/90 p-3 space-y-2 cursor-pointer transition-all hover:border-zinc-700 hover:shadow-md ${
                        m.status === "needs_review"
                          ? "border-amber-600/60 bg-amber-950/10 shadow-[0_0_10px_rgba(245,158,11,0.1)]"
                          : "border-zinc-800/90"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1.5 flex-wrap">
                        <Badge className={`text-[10px] px-1.5 py-0.2 ${getStatusColor(m.status)}`}>
                          {m.status}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] border-zinc-700 font-mono">
                          {getAdapterLabel(m.adapter)}
                        </Badge>
                      </div>

                      <h4 className="font-semibold text-xs leading-snug line-clamp-2 text-zinc-100 group-hover:text-emerald-300 transition">
                        {m.title}
                      </h4>
                      <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">
                        {m.prompt}
                      </p>

                      <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1.5 border-t border-zinc-800/60">
                        <span className="font-mono">{m.id.slice(0, 8)}</span>
                        <span>{m.type} · {m.complexity}</span>
                      </div>

                      {/* Acción de Aprobación de Gobernanza */}
                      {m.status === "needs_review" && (
                        <div className="pt-1.5">
                          <Button
                            size="sm"
                            onClick={(e) => handleApprove(m.id, e)}
                            disabled={approvingId === m.id}
                            className="w-full h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center justify-center gap-1 shadow-sm"
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
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Modal / Slide-over de Detalle de Misión */}
      {selectedMission && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div
            className="bg-zinc-950 border border-zinc-800 rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
              <div className="flex items-center gap-2">
                <Badge className={getStatusColor(selectedMission.mission?.status || "pending")}>
                  {selectedMission.mission?.status}
                </Badge>
                <h3 className="font-semibold text-sm text-zinc-100 truncate max-w-md">
                  {selectedMission.mission?.title}
                </h3>
              </div>
              <button
                onClick={() => setSelectedMission(null)}
                className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs scrollbar-thin">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-zinc-900/60 p-3 rounded-xl border border-zinc-800/80">
                <div>
                  <span className="text-zinc-500 block">ID Misión</span>
                  <span className="font-mono text-zinc-200 font-semibold">{selectedMission.mission?.id?.slice(0, 12)}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Adaptador</span>
                  <span className="text-zinc-200 font-medium">{getAdapterLabel(selectedMission.mission?.adapter)}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Tipo / Complejidad</span>
                  <span className="text-zinc-200">{selectedMission.mission?.type} / {selectedMission.mission?.complexity}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Prioridad</span>
                  <span className="text-zinc-200 capitalize">{selectedMission.mission?.priority || "normal"}</span>
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-zinc-300 mb-1">Prompt / Objetivo</h4>
                <div className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl text-zinc-200 leading-relaxed whitespace-pre-wrap">
                  {selectedMission.mission?.prompt}
                </div>
              </div>

              {selectedMission.mission?.acceptanceCriteria && (
                <div>
                  <h4 className="font-semibold text-zinc-300 mb-1">Criterios de Aceptación</h4>
                  <ul className="bg-zinc-900/80 border border-zinc-800 p-3 rounded-xl space-y-1 list-disc list-inside text-zinc-300">
                    {selectedMission.mission.acceptanceCriteria.map((c: string, idx: number) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Reporte de Ejecución */}
              {selectedMission.report && (
                <div>
                  <h4 className="font-semibold text-zinc-300 mb-1">Reporte de Ejecución</h4>
                  <div className="bg-zinc-900/90 border border-zinc-800 p-3 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <Badge className={selectedMission.report.status === "success" ? "bg-emerald-950 text-emerald-300" : "bg-rose-950 text-rose-300"}>
                        {selectedMission.report.status}
                      </Badge>
                      <span className="text-zinc-500 font-mono text-[11px]">Adaptador: {selectedMission.report.adapter}</span>
                    </div>
                    <p className="text-zinc-200 leading-relaxed">{selectedMission.report.summary}</p>
                    {selectedMission.report.artifacts?.length > 0 && (
                      <div className="pt-2 border-t border-zinc-800">
                        <span className="text-zinc-400 block font-medium mb-1">Artefactos generados:</span>
                        <ul className="space-y-1">
                          {selectedMission.report.artifacts.map((art: any, i: number) => (
                            <li key={i} className="flex items-center gap-1.5 text-zinc-300 font-mono text-[11px]">
                              <FileCode className="h-3 w-3 text-emerald-400" />
                              <span>{art.path}</span>
                              <span className="text-zinc-600">({art.kind})</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Decisión de Gobernanza */}
              {selectedMission.decision && (
                <div>
                  <h4 className="font-semibold text-zinc-300 mb-1">Decisión del Router & Guard</h4>
                  <div className="bg-zinc-900/60 border border-zinc-800 p-3 rounded-xl text-zinc-300">
                    <p><strong>Razón de asignación:</strong> {selectedMission.decision.reason}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 px-5 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <a
                  href={`${ORCHESTRATOR_URL}/api/missions/${selectedMission.mission?.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 underline"
                >
                  JSON <ExternalLink className="h-3 w-3" />
                </a>
                <a
                  href={`${ORCHESTRATOR_URL}/api/missions/${selectedMission.mission?.id}/stream`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 underline"
                >
                  SSE Stream <Terminal className="h-3 w-3" />
                </a>
              </div>

              {selectedMission.mission?.status === "needs_review" && (
                <Button
                  size="sm"
                  onClick={() => handleApprove(selectedMission.mission.id)}
                  disabled={approvingId === selectedMission.mission.id}
                  className="bg-amber-600 hover:bg-amber-500 text-white text-xs h-8"
                >
                  <Check className="h-3.5 w-3.5 mr-1" /> Aprobar y Reanudar
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
