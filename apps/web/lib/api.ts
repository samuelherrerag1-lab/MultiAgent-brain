import { ORCHESTRATOR_URL } from "./utils";

export type MissionRow = {
  id: string;
  type: string;
  complexity: string;
  title: string;
  prompt: string;
  status: string;
  workspaceRepo: string;
  adapter: string | null;
  priority: string;
  createdAt: string;
  updatedAt: string;
};

export async function fetchMissions(): Promise<MissionRow[]> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/missions`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchMissions ${res.status}`);
  const data = await res.json();
  return data.missions as MissionRow[];
}

export async function fetchMission(id: string) {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/missions/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetchMission ${res.status}`);
  return res.json();
}

export async function createMission(payload: {
  type: string;
  complexity: string;
  title: string;
  prompt: string;
  acceptanceCriteria: string[];
  priority?: string;
}): Promise<{ mission: any; route: any }> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: payload.type,
      complexity: payload.complexity,
      title: payload.title,
      prompt: payload.prompt,
      workspace: { repo: "." },
      acceptanceCriteria: payload.acceptanceCriteria,
      priority: payload.priority || "normal",
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `createMission ${res.status}`);
  }
  return res.json();
}

export function subscribeMissionStream(
  missionId: string,
  handlers: {
    onUpdate?: (mission: MissionRow) => void;
    onDone?: (data: any) => void;
    onError?: (err: any) => void;
  },
): () => void {
  const url = `${ORCHESTRATOR_URL}/api/missions/${missionId}/stream`;
  const es = new EventSource(url);

  es.addEventListener("mission:update", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      handlers.onUpdate?.(data);
    } catch {}
  });

  es.addEventListener("done", (e) => {
    try {
      const data = JSON.parse((e as MessageEvent).data);
      handlers.onDone?.(data);
    } catch {
      handlers.onDone?.({});
    }
    es.close();
  });

  es.addEventListener("error", (e) => {
    // EventSource onerror también dispara para done, filtrar
    // Solo si no es done, notificar
    handlers.onError?.(e);
  });

  es.onerror = () => {
    // No cerrar automáticamente, dejar que el intervalo del servidor lo haga
  };

  return () => es.close();
}

export async function approveMission(id: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/missions/${id}/approve`, {
    method: "POST",
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `approveMission ${res.status}`);
  }
  return res.json();
}

