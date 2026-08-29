import { describe, it, expect } from "vitest";
import { app } from "../index.ts";

async function request(path: string, init?: RequestInit) {
  const req = new Request(`http://localhost${path}`, init);
  return app.fetch(req);
}

describe("Qwen Chat API — Endpoints", () => {
  it("GET /api/qwen/health retorna objeto de salud", async () => {
    const res = await request("/api/qwen/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(typeof json.ok).toBe("boolean");
  });

  it("GET /api/qwen/conversations lista conversaciones", async () => {
    const res = await request("/api/qwen/conversations");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.conversations)).toBe(true);
  });

  it("POST /api/qwen/chat con intención de proyecto genera misión automáticamente", async () => {
    const res = await request("/api/qwen/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Crea una API de notas en TypeScript con autenticación y tests unitarios",
        modelLabel: "QwenMax-3.8",
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.intent).toBe("project");
    expect(json.conversationId).toBeDefined();
    expect(json.missionId).toBeDefined();
    expect(json.reply).toContain("misión");

    // Verificar que los mensajes existen en el historial
    const msgRes = await request(`/api/qwen/conversations/${json.conversationId}/messages`);
    expect(msgRes.status).toBe(200);
    const msgJson = (await msgRes.json()) as any;
    expect(msgJson.messages.length).toBe(2);
    expect(msgJson.messages[0].role).toBe("user");
    expect(msgJson.messages[1].role).toBe("assistant");
  });

  it("POST /api/qwen/login retorna status opened", async () => {
    const res = await request("/api/qwen/login", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
  });
});
