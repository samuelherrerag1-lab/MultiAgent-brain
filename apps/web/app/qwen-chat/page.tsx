"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  fetchQwenConversations,
  fetchQwenMessages,
  streamQwenChatMessage,
  startQwenLogin,
  deleteQwenConversation,
  type QwenConversation,
  type QwenMessage,
} from "@/lib/qwenApi";
import { QwenMessageView } from "@/components/QwenMessageView";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  Loader2,
  Bot,
  User,
  Plus,
  Trash2,
  ExternalLink,
  ShieldAlert,
  Search,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";

const SUGGESTED_PROMPTS = [
  "Diseña la arquitectura para el sistema de memoria vectorial con PostgreSQL y pgvector",
  "Revisa el flujo de gobernanza en guard.ts y sugiere mejoras para comandos bloqueados",
  "Planifica las pruebas de integración para el adaptador de Opencode",
];

const AVAILABLE_MODELS = [
  { id: "QwenMax-3.8", label: "QwenMax-3.8", desc: "Arquitecto Líder (Deep Reasoning)" },
  { id: "Qwen-Max", label: "Qwen-Max", desc: "Razonamiento Complejo" },
  { id: "Qwen-Turbo", label: "Qwen-Turbo", desc: "Respuestas Rápidas" },
  { id: "Qwen-Plus", label: "Qwen-Plus", desc: "Balanceado" },
];

export default function QwenChatPage() {
  const [conversations, setConversations] = useState<QwenConversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<QwenMessage[]>([]);
  const [input, setInput] = useState("");
  const [selectedModel, setSelectedModel] = useState("QwenMax-3.8");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamThought, setStreamThought] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [createdMission, setCreatedMission] = useState<{ id: string; title: string; adapter: string } | null>(null);
  const [loginRequired, setLoginRequired] = useState(false);

  // In-memory cache de mensajes para cambios instantáneos (0ms)
  const messagesCache = useRef<Map<string, QwenMessage[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Cargar lista de conversaciones inicial
  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchQwenConversations();
      setConversations(list);
    } catch {}
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    scrollToBottom(true);
  }, [messages, streamContent, streamThought, scrollToBottom]);

  // Selección instantánea de conversación desde caché
  const handleSelectConversation = async (convId: string) => {
    if (activeConvId === convId) return;
    setActiveConvId(convId);
    setCreatedMission(null);

    // 1. Mostrar de inmediato desde memoria si existe (0ms)
    if (messagesCache.current.has(convId)) {
      setMessages(messagesCache.current.get(convId)!);
    } else {
      setMessages([]);
    }

    // 2. Revalidar en segundo plano
    try {
      const msgs = await fetchQwenMessages(convId);
      messagesCache.current.set(convId, msgs);
      setMessages(msgs);
    } catch {}
  };

  // Crear nueva conversación instantáneamente
  const handleNewChat = () => {
    abortCtrlRef.current?.abort();
    setActiveConvId(null);
    setMessages([]);
    setStreamContent("");
    setStreamThought("");
    setIsThinking(false);
    setCreatedMission(null);
    setInput("");
    textareaRef.current?.focus();
  };

  // Eliminar conversación
  const handleDeleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteQwenConversation(id);
      messagesCache.current.delete(id);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConvId === id) {
        handleNewChat();
      }
    } catch (err: any) {
      alert("Error al eliminar conversación: " + err.message);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || input).trim();
    if (!text || streaming) return;

    setInput("");
    setLoginRequired(false);
    setCreatedMission(null);
    setStreamContent("");
    setStreamThought("");
    setIsThinking(false);

    // Actualización optimista de mensaje del usuario
    const userMsg: QwenMessage = {
      id: "temp-user-" + Date.now(),
      conversationId: activeConvId || "pending",
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setStreaming(true);

    try {
      const cancel = streamQwenChatMessage(
        {
          message: text,
          conversationId: activeConvId || undefined,
          modelLabel: selectedModel,
        },
        {
          onThought: (delta: string) => {
            setStreamThought((prev) => prev + delta);
            setIsThinking(true);
          },
          onChunk: (delta: string) => {
            setIsThinking(false);
            setStreamContent((prev) => prev + delta);
          },
          onMissionCreated: (mission: { missionId: string; title: string; adapter: string }) => {
            setCreatedMission({ id: mission.missionId, title: mission.title, adapter: mission.adapter });
          },
          onDone: async (data: { conversationId: string; missionId?: string }) => {
            setStreaming(false);
            setIsThinking(false);
            const finalId = data.conversationId;
            if (!activeConvId) {
              setActiveConvId(finalId);
            }
            await loadConversations();
            if (finalId) {
              const updatedMsgs = await fetchQwenMessages(finalId);
              messagesCache.current.set(finalId, updatedMsgs);
              setMessages(updatedMsgs);
            }
            setStreamContent("");
            setStreamThought("");
          },
          onError: (err: string) => {
            setStreaming(false);
            setIsThinking(false);
            if (err.includes("QWEN_LOGIN_REQUIRED") || err.includes("login")) {
              setLoginRequired(true);
            }
          },
        },
      );
    } catch (err: any) {
      setStreaming(false);
      setIsThinking(false);
      if (String(err).includes("QWEN_LOGIN_REQUIRED")) {
        setLoginRequired(true);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleQuickReply = (replyText: string) => {
    if (streaming) return;
    handleSend(replyText);
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="flex h-[calc(100vh-5.5rem)] gap-4 overflow-hidden -mx-4 -my-6 p-4">
      {/* 📁 Barra Lateral de Conversaciones */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } transition-all duration-200 ease-in-out shrink-0 bg-zinc-950/80 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden`}
      >
        <div className="p-3 border-b border-zinc-800/80 flex items-center justify-between gap-2">
          <Button
            size="sm"
            onClick={handleNewChat}
            className="w-full bg-zinc-900 hover:bg-zinc-800 text-zinc-100 text-xs font-semibold h-9 rounded-xl border border-zinc-700/80 flex items-center justify-center gap-1.5 shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" /> Nueva conversación
          </Button>
        </div>

        {/* Buscador de chats */}
        <div className="p-2.5 border-b border-zinc-800/60">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar chats..."
              className="w-full h-8 pl-8 pr-2.5 rounded-lg bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-700 font-mono"
            />
          </div>
        </div>

        {/* Lista de Chats con Cambio Instantáneo */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-thin">
          {filteredConversations.length === 0 ? (
            <div className="text-center py-8 text-xs text-zinc-600">
              {searchQuery ? "Sin coincidencias" : "No hay conversaciones previas"}
            </div>
          ) : (
            filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`group w-full text-left p-2.5 rounded-xl text-xs flex items-center justify-between cursor-pointer transition-all ${
                  activeConvId === conv.id
                    ? "bg-zinc-800/90 text-zinc-100 font-semibold border border-zinc-700/60 shadow-sm"
                    : "text-zinc-400 hover:bg-zinc-900/80 hover:text-zinc-200"
                }`}
              >
                <div className="truncate pr-2 flex-1">
                  <p className="truncate text-xs">{conv.title || "Conversación"}</p>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    {new Date(conv.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => handleDeleteConversation(conv.id, e)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 rounded transition"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      {/* 💬 Panel Principal de Chat */}
      <main className="flex-1 bg-zinc-950/80 border border-zinc-800/80 rounded-2xl flex flex-col overflow-hidden shadow-2xl relative">
        {/* Top Header */}
        <header className="px-4 py-3 border-b border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition"
            >
              {sidebarOpen ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <div className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-emerald-400" />
              <h2 className="font-semibold text-xs text-zinc-100">Qwen Asistente Arquitecto</h2>
              <Badge variant="outline" className="text-[10px] border-emerald-900 bg-emerald-950/50 text-emerald-300">
                Playwright Persistent
              </Badge>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="h-8 text-xs bg-zinc-900 border border-zinc-700/80 text-zinc-200 rounded-lg px-2.5 focus:outline-none focus:border-zinc-500 font-mono"
            >
              {AVAILABLE_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} ({m.desc})
                </option>
              ))}
            </select>
          </div>
        </header>

        {/* Alerta de Login */}
        {loginRequired && (
          <div className="bg-amber-950/60 border-b border-amber-900/80 px-4 py-2.5 flex items-center justify-between text-xs text-amber-200">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0" />
              <span>La sesión de chat.qwen.ai requiere inicio de sesión. Haz clic para abrir el navegador Chromium.</span>
            </div>
            <Button
              size="sm"
              onClick={() => startQwenLogin()}
              className="h-7 text-xs bg-amber-600 hover:bg-amber-500 text-white font-medium ml-2"
            >
              Iniciar sesión Qwen
            </Button>
          </div>
        )}

        {/* Notificación de Auto-Misión Creada */}
        {createdMission && (
          <div className="bg-emerald-950/40 border-b border-emerald-900/80 px-4 py-2.5 flex items-center justify-between text-xs text-emerald-200 animate-in fade-in">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-emerald-400" />
              <span>
                Misión generada automáticamente: <strong>{createdMission.title}</strong>
              </span>
            </div>
            <Link
              href="/dashboard"
              className="text-xs bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-2.5 py-1 rounded-md flex items-center gap-1 transition"
            >
              Ver en Dashboard <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        )}

        {/* Lista de Mensajes con Renderizado Rico */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
          {messages.length === 0 && !streaming ? (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-md mx-auto space-y-4 my-auto">
              <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-emerald-400 shadow-inner">
                <Bot className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-sm text-zinc-100">¿En qué puedo ayudarte hoy?</h3>
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                  Consulta planes de arquitectura, revisión de código, resolución de bloqueos y razonamiento profundo.
                </p>
              </div>

              <div className="w-full space-y-1.5 text-left pt-2">
                {SUGGESTED_PROMPTS.map((promptText, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(promptText)}
                    className="w-full p-2.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-zinc-700 text-xs text-zinc-300 hover:text-white transition text-left"
                  >
                    {promptText}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 max-w-3xl ${isUser ? "ml-auto justify-end" : "mr-auto justify-start"} w-full`}
                  >
                    {!isUser && (
                      <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-emerald-400 mt-1">
                        <Bot className="h-4 w-4" />
                      </div>
                    )}
                    <div
                      className={`rounded-2xl p-3.5 text-xs shadow-sm max-w-[88%] ${
                        isUser
                          ? "bg-zinc-800/90 text-zinc-100 border border-zinc-700/80"
                          : "bg-zinc-900/80 text-zinc-200 border border-zinc-800/80 w-full"
                      }`}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                      ) : (
                        <QwenMessageView
                          content={msg.content}
                          onQuickReply={handleQuickReply}
                        />
                      )}
                    </div>
                    {isUser && (
                      <div className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center shrink-0 text-zinc-300 mt-1">
                        <User className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Mensaje en Streaming Activo */}
              {streaming && (
                <div className="flex gap-3 max-w-3xl mr-auto justify-start w-full">
                  <div className="w-7 h-7 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center shrink-0 text-emerald-400 mt-1">
                    <Bot className="h-4 w-4 animate-spin" />
                  </div>
                  <div className="rounded-2xl p-3.5 text-xs shadow-sm bg-zinc-900/90 text-zinc-200 border border-zinc-800 w-full">
                    <QwenMessageView
                      content={streamContent}
                      thought={streamThought}
                      isStreaming={true}
                      isThinking={isThinking}
                    />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div className="p-3.5 border-t border-zinc-800/80 bg-zinc-900/40">
          <div className="relative flex items-end gap-2 bg-zinc-900/90 border border-zinc-700/80 rounded-2xl p-2 focus-within:border-zinc-500 shadow-inner">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta a Qwen Arquitecto... (Enter para enviar, Shift+Enter para salto de línea)"
              className="min-h-[44px] max-h-[160px] text-xs bg-transparent border-0 resize-none focus-visible:ring-0 p-1.5 text-zinc-200 placeholder-zinc-500 font-sans"
              rows={1}
            />
            <Button
              size="sm"
              onClick={() => handleSend()}
              disabled={streaming || !input.trim()}
              className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold h-8 px-3 rounded-xl shrink-0 transition disabled:opacity-40"
            >
              {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500 px-1 pt-1.5 font-mono">
            <span>Modelo: {selectedModel}</span>
            <span>Sesión Playwright persistente</span>
          </div>
        </div>
      </main>
    </div>
  );
}
