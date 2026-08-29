import { ORCHESTRATOR_URL } from "./utils";

export type QwenConversation = {
  id: string;
  title: string;
  modelLabel: string;
  createdAt: string;
  updatedAt: string;
};

export type QwenMessage = {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: string;
  thought?: string | null;
  modelLabel?: string | null;
  createdAt: string;
};

export type QwenHealth = {
  ok: boolean;
  latencyMs?: number;
  error?: string;
};

export async function fetchQwenHealth(): Promise<QwenHealth> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/health`, { cache: "no-store" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return res.json();
  } catch (err: any) {
    return { ok: false, error: err.message || "No se pudo conectar" };
  }
}

export async function startQwenLogin(): Promise<{ ok: boolean; status?: string; message?: string; error?: string }> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/login`, { method: "POST" });
    return res.json();
  } catch (err: any) {
    return { ok: false, error: err.message };
  }
}

export async function fetchQwenConversations(): Promise<QwenConversation[]> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/conversations`, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetchQwenConversations ${res.status}`);
    const data = await res.json();
    return data.conversations as QwenConversation[];
  } catch (err) {
    console.error("[fetchQwenConversations]", err);
    return [];
  }
}

export async function fetchQwenMessages(conversationId: string): Promise<QwenMessage[]> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/conversations/${conversationId}/messages`, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetchQwenMessages ${res.status}`);
    const data = await res.json();
    return data.messages as QwenMessage[];
  } catch (err) {
    console.error("[fetchQwenMessages]", err);
    return [];
  }
}

export async function deleteQwenConversation(conversationId: string): Promise<boolean> {
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/conversations/${conversationId}`, {
      method: "DELETE",
    });
    return res.ok;
  } catch (err) {
    console.error("[deleteQwenConversation]", err);
    return false;
  }
}

export async function sendQwenChatMessage(payload: {
  conversationId?: string | undefined;
  message: string;
  modelLabel?: string | undefined;
}): Promise<{ reply: string; conversationId: string; intent?: string; missionId?: string }> {
  const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `sendQwenChatMessage ${res.status}`);
  }

  return res.json();
}

export function streamQwenChatMessage(
  payload: { conversationId?: string | undefined; message: string; modelLabel?: string | undefined },
  handlers: {
    onStart?: (data: { conversationId: string }) => void;
    onThought?: (delta: string) => void;
    onChunk?: (delta: string) => void;
    onMissionCreated?: (data: { missionId: string; title: string; adapter: string }) => void;
    onDone?: (data: { conversationId: string; missionId?: string }) => void;
    onError?: (err: string) => void;
  },
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/qwen/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        handlers.onError?.(err.error || `Stream error ${res.status}`);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        handlers.onError?.("No readable stream body");
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let currentEvent = "message";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          if (trimmed.startsWith("event:")) {
            currentEvent = trimmed.slice(6).trim();
          } else if (trimmed.startsWith("data:")) {
            const rawData = trimmed.slice(5).trim();
            try {
              const data = JSON.parse(rawData);
              if (currentEvent === "chat:started") {
                handlers.onStart?.(data);
              } else if (currentEvent === "chat:thought") {
                handlers.onThought?.(data.delta || "");
              } else if (currentEvent === "chat:chunk") {
                handlers.onChunk?.(data.delta || "");
              } else if (currentEvent === "chat:mission_created") {
                handlers.onMissionCreated?.(data);
              } else if (currentEvent === "chat:done") {
                handlers.onDone?.(data);
              } else if (currentEvent === "chat:error") {
                handlers.onError?.(data.error || "Error en chat");
              }
            } catch {
              if (currentEvent === "chat:chunk") {
                handlers.onChunk?.(rawData);
              } else if (currentEvent === "chat:thought") {
                handlers.onThought?.(rawData);
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        handlers.onError?.(err.message || String(err));
      }
    }
  })();

  return () => controller.abort();
}
