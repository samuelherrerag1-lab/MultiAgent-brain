import { describe, it, expect, beforeAll } from "vitest";
import { app } from "./index.ts";

// Helper para hacer requests a Hono sin levantar servidor
async function request(path: string, init?: RequestInit) {
  const req = new Request(`http://localhost${path}`, init);
  return app.fetch(req);
}

describe("Hono orchestrator — health", () => {
  it("GET /health → 200 ok", async () => {
    const res = await request("/health");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);
    expect(json.service).toBe("cerebro-orchestrator");
  });

  it("GET /api/health → 200", async () => {
    const res = await request("/api/health");
    expect(res.status).toBe(200);
  });

  it("404 para ruta inexistente", async () => {
    const res = await request("/no-existe");
    expect(res.status).toBe(404);
  });
});

describe("Hono orchestrator — missions CRUD", () => {
  let createdId: string;

  it("POST /api/missions con payload válido → 201", async () => {
    const payload = {
      type: "build",
      complexity: "medium",
      title: "Test misión CRUD via API",
      prompt: "Implementa una función helloWorld que retorne 42. Este prompt es suficientemente largo para validación.",
      workspace: { repo: "." },
      acceptanceCriteria: ["La función helloWorld retorna 42 correctamente"],
    };

    const res = await request("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status !== 201) {
      const body = await res.text();
      console.log("POST /api/missions error:", body);
    }
    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.mission).toBeDefined();
    expect(json.mission.missionId).toMatch(/^[0-9a-f-]{36}$/);
    createdId = json.mission.missionId;
  });

  it("POST /api/missions con payload inválido → 400", async () => {
    const res = await request("/api/missions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "x" }), // falta campos
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/missions lista misiones", async () => {
    const res = await request("/api/missions");
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(Array.isArray(json.missions)).toBe(true);
    expect(json.missions.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/missions/:id retorna misión creada", async () => {
    const res = await request(`/api/missions/${createdId}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.mission.id).toBe(createdId);
  });

  it("GET /api/missions/:id inexistente → 404", async () => {
    const res = await request("/api/missions/00000000-0000-4000-a000-000000000000");
    expect(res.status).toBe(404);
  });

  it("PUT /api/missions/:id/report actualiza reporte", async () => {
    const report = {
      missionId: createdId,
      status: "success",
      adapter: "opencode",
      summary: "Misión de test completada",
      artifacts: [{ path: "hello.ts", kind: "file" }],
      durationMs: 1234,
    };

    const res = await request(`/api/missions/${createdId}/report`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });

    if (res.status !== 200) {
      const body = await res.text();
      console.log("PUT report error:", body);
    }
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.ok).toBe(true);

    // Verificar que status de misión cambió a success
    const getRes = await request(`/api/missions/${createdId}`);
    const getJson = (await getRes.json()) as any;
    expect(getJson.mission.status).toBe("success");
    expect(getJson.report).toBeDefined();
    expect(getJson.report.summary).toBe("Misión de test completada");
  });

  it("PUT /api/missions/:id/report con missionId mismatch → 400", async () => {
    const res = await request(`/api/missions/${createdId}/report`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        missionId: "11111111-1111-4111-8111-111111111111",
        status: "success",
        adapter: "dsh",
        summary: "mismatch",
        durationMs: 100,
      }),
    });
    expect(res.status).toBe(400);
  });
});
