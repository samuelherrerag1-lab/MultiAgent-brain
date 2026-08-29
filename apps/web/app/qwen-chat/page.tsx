"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  fetchQwenHealth,
  startQwenLogin,
  fetchQwenConversations,
  fetchQwenMessages,
  streamQwenChatMessage,
  type QwenConversation,
  type QwenMessage,
  type QwenHealth,
} from "@/lib/qwenApi";
import {
  Brain,
  Send,
  Loader2,
  Sparkles,
  Plus,
  RefreshCw,
  LogIn,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";

export default function QwenChatPage() {
  const [conversations, setConversations] = useState<QwenConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QwenMessage[]>([]);
  const [input, setInput] = useState("");
  const [modelLabel, setModelLabel] = useState("QwenMax-3.8");
  const [health, setHealth] = useState<QwenHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [createdMission, setCreatedMission] = useState<{ missionId: string; title: string; adapter: string } | null>(null);
  const [loginStarting, setLoginStarting] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<(() => void) | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

  // Cargar salud y conversaciones iniciales
  useEffect(() => {
    loadHealth();
    loadConversations();
    const interval = setInterval(loadHealth, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Cargar mensajes cuando cambia la conversación activa
  useEffect(() => {
    if (activeConvId) {
      loadMessages(activeConvId);
    } else {
      setMessages([]);
    }
  }, [activeConvId]);

  const loadHealth = async () => {
    const h = await fetchQwenHealth();
    setHealth(h);
  };

  const loadConversations = async () => {
    const list = await fetchQwenConversations();
    setConversations(list);
  };

  const loadMessages = async (id: string) => {
    const msgs = await fetchQwenMessages(id);
    setMessages(msgs);
  };

  const handleStartLogin = async () => {
    setLoginStarting(true);
    await startQwenLogin();
    setTimeout(() => {
      setLoginStarting(false);
      loadHealth();
    }, 4000);
  };

  const handleNewConversation = () => {
    setActiveConvId(null);
    setMessages([]);
    setStreamingText("");
    setCreatedMission(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setLoading(true);
    setStreamingText("");
    setCreatedMission(null);
    abortRef.current?.();

    // Mensaje optimista
    const tempUserMsg: QwenMessage = {
      id: "temp-" + Date.now(),
      conversationId: activeConvId || "new",
      role: "user",
      content: userText,
      modelLabel,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    let accumulatedAssistant = "";

    const payload: any = { message: userText, modelLabel };
    if (activeConvId) payload.conversationId = activeConvId;

    const stopStream = streamQwenChatMessage(payload,
      {
        onStart: (data) => {
          if (!activeConvId) {
            setActiveConvId(data.conversationId);
            loadConversations();
          }
        },
        onChunk: (delta) => {
          accumulatedAssistant += delta;
          setStreamingText(accumulatedAssistant);
        },
        onMissionCreated: (data) => {
          setCreatedMission(data);
        },
        onDone: (data) => {
          if (data.conversationId) {
            setActiveConvId(data.conversationId);
            loadConversations();
            loadMessages(data.conversationId);
          }
          setStreamingText("");
          setLoading(false);
        },
        onError: (err) => {
          setMessages((prev) => [
            ...prev,
            {
              id: "err-" + Date.now(),
              conversationId: activeConvId || "error",
              role: "assistant",
              content: `⚠️ Error: ${err}`,
              createdAt: new Date().toISOString(),
            },
          ]);
          setStreamingText("");
          setLoading(false);
        },
      },
    );

    abortRef.current = stopStream;
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6 h-[calc(100vh-140px)]">
      {/* Sidebar de conversaciones */}
      <Card className="hidden md:flex md:flex-col bg-zinc-950/60 border-zinc-800">
        <CardHeader className="p-4 border-b border-zinc-800 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-zinc-400" /> Conversaciones
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={handleNewConversation} className="h-8 px-2 text-xs">
            <Plus className="h-4 w-4 mr-1" /> Nueva
          </Button>
        </CardHeader>
        <CardContent className="p-2 flex-1 overflow-y-auto space-y-1">
          {conversations.length === 0 ? (
            <p className="text-xs text-zinc-600 text-center py-6">Sin conversaciones previas</p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConvId(c.id)}
                className={`w-full text-left p-2 rounded-md text-xs transition flex flex-col gap-1 ${
                  activeConvId === c.id
                    ? "bg-zinc-800 text-white font-medium"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
              >
                <span className="line-clamp-1">{c.title || "Conversación"}</span>
                <span className="text-[10px] text-zinc-600">
                  {new Date(c.updatedAt).toLocaleDateString()} · {c.modelLabel}
                </span>
              </button>
            ))
          )}
        </CardContent>
      </Card>

      {/* Panel principal de Chat */}
      <div className="md:col-span-3 flex flex-col h-full bg-zinc-950/40 rounded-xl border border-zinc-800 overflow-hidden">
        {/* Header con selectores de modelo y salud */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-950 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold">
              <Brain className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold flex items-center gap-2">
                Qwen Chat Asistente
                <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-500/30">
                  Fase 6b
                </Badge>
              </h2>
              <p className="text-xs text-zinc-500">
                Playwright Persistent Context · QwenMax-3.8 · Auto-misión inteligente
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Select
              value={modelLabel}
              onChange={(e) => setModelLabel(e.target.value)}
              className="h-8 text-xs bg-zinc-900 border-zinc-700"
            >
              <option value="QwenMax-3.8">QwenMax-3.8 (Recomendado)</option>
              <option value="Qwen-Max">Qwen-Max</option>
              <option value="Qwen-Turbo">Qwen-Turbo</option>
              <option value="Qwen-Plus">Qwen-Plus</option>
            </Select>

            {/* Health Badge */}
            {health?.ok ? (
              <Badge className="bg-emerald-950 text-emerald-300 border border-emerald-800 flex items-center gap-1 text-xs">
                <CheckCircle2 className="h-3 w-3" /> Sesión OK {health.latencyMs ? `(${health.latencyMs}ms)` : ""}
              </Badge>
            ) : (
              <Badge className="bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1 text-xs">
                <AlertCircle className="h-3 w-3" /> {health?.error || "Desconectado"}
              </Badge>
            )}

            {/* Login button */}
            {health && !health.ok && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleStartLogin}
                disabled={loginStarting}
                className="h-8 text-xs border-amber-700/50 hover:bg-amber-950/30 text-amber-300"
              >
                <LogIn className="h-3 w-3 mr-1" />
                {loginStarting ? "Abriendo..." : "Iniciar sesión Qwen"}
              </Button>
            )}
          </div>
        </div>

        {/* Banner de Auto-Misión Creada */}
        {createdMission && (
          <div className="bg-blue-950/40 border-b border-blue-900/50 p-3 px-4 flex items-center justify-between text-xs text-blue-200">
            <div className="flex items-center gap-2">
              <FolderPlus className="h-4 w-4 text-blue-400" />
              <span>
                Misión generada: <strong>{createdMission.title}</strong> → Adaptador:{" "}
                <Badge className="bg-blue-900 text-blue-100 text-[10px]">{createdMission.adapter}</Badge>
              </span>
            </div>
            <Link
              href="/dashboard"
              className="text-xs bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded transition font-medium"
            >
              Ver en Dashboard →
            </Link>
          </div>
        )}

        {/* Zona de Mensajes */}
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {messages.length === 0 && !streamingText ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-3">
              <div className="h-12 w-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400">
                <Sparkles className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-base font-medium">¿En qué puedo ayudarte hoy?</h3>
              <p className="text-xs text-zinc-500 max-w-md">
                Pregunta cualquier duda técnica, pide diseño de sistemas o solicita la creación de un nuevo proyecto. Si detecto intención de código o arquitectura, generaré automáticamente una misión para el Orquestador.
              </p>
              <div className="flex flex-wrap gap-2 justify-center pt-2">
                <button
                  onClick={() => setInput("Explícame cómo funciona el enrutador de tareas en Cerebro")}
                  className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-400 transition"
                >
                  💡 ¿Cómo funciona el router?
                </button>
                <button
                  onClick={() => setInput("Crea una API de autenticación con JWT en TypeScript")}
                  className="text-xs bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-400 transition"
                >
                  🚀 Crea una API con JWT
                </button>
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div
                  key={m.id || i}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-white text-black rounded-tr-sm font-medium"
                        : "bg-zinc-900 text-zinc-200 border border-zinc-800 rounded-tl-sm"
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="text-[10px] text-zinc-600 mt-1 px-1">
                    {m.role === "user" ? "Tú" : m.modelLabel || "Qwen"} ·{" "}
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              ))}

              {/* Burbuja de streaming en vivo */}
              {streamingText && (
                <div className="flex flex-col items-start">
                  <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap bg-zinc-900 text-zinc-200 border border-zinc-800">
                    {streamingText}
                    <span className="inline-block w-1.5 h-4 bg-emerald-400 ml-1 animate-pulse" />
                  </div>
                  <span className="text-[10px] text-zinc-600 mt-1 px-1 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" /> Escribiendo...
                  </span>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Footer / Input */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-950">
          <form onSubmit={handleSubmit} className="flex gap-2 items-end">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder="Escribe un mensaje o 'Crea un proyecto para...' (Enter para enviar, Shift+Enter para nueva línea)"
              className="min-h-[44px] max-h-[140px] resize-none text-sm bg-zinc-900 border-zinc-700"
              rows={1}
              disabled={loading}
            />
            <Button type="submit" disabled={loading || !input.trim()} className="h-11 px-4">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
