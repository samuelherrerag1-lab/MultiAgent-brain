"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, ChevronDown, ChevronRight, Brain } from "lucide-react";

export function MarkdownRenderer({ content, className = "" }: { content: string; className?: string }) {
  return (
    <div className={`prose prose-invert max-w-none text-sm leading-relaxed space-y-3 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className: codeClass, children, ...props }: any) {
            const match = /language-(\w+)/.exec(codeClass || "");
            const language = match ? match[1] : "";
            const codeString = String(children).replace(/\n$/, "");

            if (!inline && (match || codeString.includes("\n") || codeString.length > 50)) {
              return <CodeBlock language={language} code={codeString} />;
            }

            return (
              <code
                className="bg-zinc-800/80 text-emerald-300 font-mono text-[13px] px-1.5 py-0.5 rounded border border-zinc-700/50"
                {...props}
              >
                {children}
              </code>
            );
          },
          details({ children, ...props }: any) {
            return (
              <details
                className="my-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-3.5 text-zinc-300 group open:bg-zinc-900/90 transition-colors"
                {...props}
              >
                {children}
              </details>
            );
          },
          summary({ children, ...props }: any) {
            return (
              <summary
                className="cursor-pointer text-xs font-semibold text-zinc-400 hover:text-zinc-200 select-none flex items-center gap-2 list-none"
                {...props}
              >
                <Brain className="h-4 w-4 text-emerald-400" />
                <span className="flex-1">{children}</span>
                <span className="text-[10px] bg-zinc-800 px-2 py-0.5 rounded-full text-zinc-400">Ver proceso</span>
              </summary>
            );
          },
          a({ href, children, ...props }: any) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 font-medium transition"
                {...props}
              >
                {children}
              </a>
            );
          },
          p({ children }: any) {
            return <p className="mb-2 last:mb-0">{children}</p>;
          },
          ul({ children }: any) {
            return <ul className="list-disc list-inside space-y-1 my-2 text-zinc-300">{children}</ul>;
          },
          ol({ children }: any) {
            return <ol className="list-decimal list-inside space-y-1 my-2 text-zinc-300">{children}</ol>;
          },
          li({ children }: any) {
            return <li className="leading-normal">{children}</li>;
          },
          table({ children }: any) {
            return (
              <div className="overflow-x-auto my-3 rounded-lg border border-zinc-800">
                <table className="w-full text-left text-xs border-collapse">{children}</table>
              </div>
            );
          },
          th({ children }: any) {
            return <th className="bg-zinc-900 p-2.5 font-semibold text-zinc-200 border-b border-zinc-800">{children}</th>;
          },
          td({ children }: any) {
            return <td className="p-2.5 border-b border-zinc-800/50 text-zinc-300">{children}</td>;
          },
          blockquote({ children }: any) {
            return (
              <blockquote className="border-l-2 border-emerald-500/70 pl-3.5 my-2 italic text-zinc-400 bg-zinc-900/30 py-1 rounded-r">
                {children}
              </blockquote>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ language, code }: { language?: string | undefined; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative my-3 rounded-xl border border-zinc-800 bg-zinc-950 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-3.5 py-1.5 bg-zinc-900/80 border-b border-zinc-800/80 text-xs text-zinc-400">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          {language || "código"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100 transition px-2 py-0.5 rounded hover:bg-zinc-800"
          title="Copiar código"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400 font-medium">Copiado</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <div className="p-3.5 overflow-x-auto">
        <pre className="font-mono text-[13px] leading-relaxed text-zinc-200 m-0">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}
