import { fetchMissions } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getStatusColor, getAdapterLabel } from "@/lib/utils";
import Link from "next/link";

export const dynamic = "force-dynamic";

const COLUMNS: { key: string; label: string; statuses: string[] }[] = [
  { key: "pending", label: "Pendiente", statuses: ["pending"] },
  { key: "running", label: "En ejecución", statuses: ["running"] },
  { key: "review", label: "Revisión", statuses: ["needs_review"] },
  { key: "success", label: "Hecho", statuses: ["success"] },
  { key: "failed", label: "Fallido", statuses: ["failed", "aborted"] },
];

export default async function DashboardPage() {
  let missions: any[] = [];
  let error: string | null = null;

  try {
    missions = await fetchMissions();
  } catch (e: any) {
    error = e.message || String(e);
  }

  const byStatus = (statuses: string[]) => missions.filter((m) => statuses.includes(m.status));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-zinc-400">Kanban de misiones — lectura directa de PostgreSQL/pglite vía Orquestador</p>
        </div>
        <Link href="/" className="rounded-md bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-200">
          + Nueva misión
        </Link>
      </div>

      {error ? (
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="pt-6">
            <p className="text-sm text-red-400">No se pudo conectar al Orquestador ({error})</p>
            <p className="text-xs text-zinc-500 mt-2">
              Verifica que <code className="bg-zinc-900 px-1 rounded">pnpm --filter @cerebro/orchestrator dev</code> esté corriendo en
              http://localhost:3001
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {COLUMNS.map((col) => {
          const items = byStatus(col.statuses);
          return (
            <Card key={col.key} className="bg-zinc-900/50">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  {col.label}
                  <Badge variant="outline" className="border-zinc-700">
                    {items.length}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 min-h-[300px]">
                {items.length === 0 ? (
                  <p className="text-xs text-zinc-600 text-center py-8">Vacío</p>
                ) : (
                  items.map((m) => (
                    <div key={m.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2 hover:border-zinc-700 transition">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={getStatusColor(m.status)}>{m.status}</Badge>
                        <Badge variant="outline" className="text-xs border-zinc-700">
                          {getAdapterLabel(m.adapter)}
                        </Badge>
                      </div>
                      <h4 className="font-medium text-sm leading-tight line-clamp-2">{m.title}</h4>
                      <p className="text-xs text-zinc-500 line-clamp-2">{m.prompt.slice(0, 120)}...</p>
                      <div className="flex items-center gap-2 text-xs text-zinc-600">
                        <span className="font-mono">{m.id.slice(0, 8)}</span>
                        <span>·</span>
                        <span>
                          {m.type}/{m.complexity}
                        </span>
                      </div>
                      <div className="text-xs text-zinc-600">
                        {new Date(m.createdAt).toLocaleString()}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <a
                          href={`http://localhost:3001/api/missions/${m.id}`}
                          target="_blank"
                          className="text-xs text-zinc-400 hover:text-white underline"
                        >
                          JSON
                        </a>
                        <a
                          href={`http://localhost:3001/api/missions/${m.id}/stream`}
                          target="_blank"
                          className="text-xs text-zinc-400 hover:text-white underline"
                        >
                          SSE
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

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">SSE — streaming de logs</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-zinc-400 space-y-1">
          <p>
            Cada misión expone <code className="bg-zinc-900 px-1 rounded">GET /api/missions/:id/stream</code> (text/event-stream) con
            eventos <code>connected</code>, <code>mission:update</code>, <code>done</code>.
          </p>
          <p>El Chat usa `EventSource` para pintar logs en tiempo real. El Dashboard hace polling `GET /api/missions`.</p>
          <p className="text-zinc-600">Tip: abre DevTools → Network → EventStream para ver los eventos.</p>
        </CardContent>
      </Card>
    </div>
  );
}
