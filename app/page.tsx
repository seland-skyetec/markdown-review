"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Annotation, Retention } from "@/lib/review";

type Block = {
  id: string;
  raw: string;
  title: string;
  kind: "heading" | "prose" | "code" | "structured";
};

type LoadedReview = {
  id: string;
  filename: string;
  retention: Retention;
  reviewedBlockIds: string[];
  annotations: Annotation[];
  source: string | null;
  sourceAvailable: boolean;
};

const retentionLabels: Record<Retention, string> = {
  "1d": "1 dag",
  "1w": "1 uke",
  "1m": "1 måned",
  never: "Aldri",
};

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_]+)_(?!_)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .trim();
}

function splitMarkdownBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const chunks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    const raw = current.join("\n").trim();
    if (raw) chunks.push(raw);
    current = [];
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      current.push(line);
      continue;
    }
    if (!fence && !line.trim()) {
      flush();
      continue;
    }
    current.push(line);
  }
  flush();

  return chunks.map((raw, index) => {
    const plain = stripInlineMarkdown(raw).replace(/\s+/g, " ").trim();
    const heading = raw.match(/^#{1,6}\s+(.+)$/m)?.[1];
    const kind: Block["kind"] = /^\s*(```|~~~)/.test(raw)
      ? "code"
      : /^#{1,6}\s+/.test(raw)
        ? "heading"
        : /^(\s*[-*+]\s+|\s*\d+\.\s+|\s*>\s+|\s*\|)/m.test(raw)
          ? "structured"
          : "prose";

    const titleSource = heading ? stripInlineMarkdown(heading) : plain;
    return {
      id: `b-${index + 1}`,
      raw,
      title: titleSource.length > 58 ? `${titleSource.slice(0, 58)}…` : titleSource || `Del ${index + 1}`,
      kind,
    };
  });
}

function sentences(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  try {
    const segmenter = new Intl.Segmenter("nb", { granularity: "sentence" });
    return Array.from(segmenter.segment(clean), (part) => part.segment.trim()).filter(Boolean);
  } catch {
    return clean.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [clean];
  }
}

function downloadText(filename: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [source, setSource] = useState("");
  const [filename, setFilename] = useState("document.md");
  const [retention, setRetention] = useState<Retention>("1w");
  const [pasteMode, setPasteMode] = useState(false);

  const [reviewId, setReviewId] = useState<string | null>(null);
  const [editToken, setEditToken] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [reviewed, setReviewed] = useState<string[]>([]);
  const [openBlockId, setOpenBlockId] = useState<string | null>(null);
  const [selectedQuote, setSelectedQuote] = useState<{ blockId: string; quote: string } | null>(null);
  const [comment, setComment] = useState("");
  const [showErrata, setShowErrata] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const blocks = useMemo(() => splitMarkdownBlocks(source), [source]);
  const openIndex = Math.max(0, blocks.findIndex((block) => block.id === openBlockId));
  const openBlock = blocks[openIndex] ?? null;
  const reviewedSet = useMemo(() => new Set(reviewed), [reviewed]);
  const agentUrl = reviewId && typeof window !== "undefined"
    ? `${window.location.origin}/api/reviews/${reviewId}`
    : "";

  const loadExisting = useCallback(async (id: string) => {
    setLoadingExisting(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviews/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Kunne ikke åpne reviewet.");
      const data = await response.json() as LoadedReview;
      setReviewId(data.id);
      setFilename(data.filename);
      setRetention(data.retention);
      setAnnotations(data.annotations ?? []);
      setReviewed(data.reviewedBlockIds ?? []);
      setSource(data.source ?? "");

      const token = localStorage.getItem(`markdown-review:${data.id}:editToken`);
      setEditToken(token);
      setReadOnly(!token);

      const parsed = data.source ? splitMarkdownBlocks(data.source) : [];
      const firstPending = parsed.find((block) => !(data.reviewedBlockIds ?? []).includes(block.id));
      setOpenBlockId(firstPending?.id ?? parsed[0]?.id ?? null);

      if (!data.sourceAvailable) setError("Kilden er utløpt. Errata er beholdt.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke laste reviewet.");
    } finally {
      setLoadingExisting(false);
    }
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("review");
    if (id) void loadExisting(id);
  }, [loadExisting]);

  const saveNow = useCallback(async () => {
    if (!reviewId || !editToken || readOnly) return true;
    setSaveState("saving");
    try {
      const response = await fetch(`/api/reviews/${reviewId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-edit-token": editToken },
        body: JSON.stringify({ annotations, reviewedBlockIds: reviewed }),
      });
      if (!response.ok) throw new Error("Lagring feilet");
      setSaveState("saved");
      return true;
    } catch {
      setSaveState("error");
      return false;
    }
  }, [reviewId, editToken, readOnly, annotations, reviewed]);

  useEffect(() => {
    if (!reviewId || !editToken || readOnly) return;
    const timer = window.setTimeout(() => void saveNow(), 500);
    return () => window.clearTimeout(timer);
  }, [annotations, reviewed, reviewId, editToken, readOnly, saveNow]);

  async function ingestFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".md") && file.type !== "text/markdown" && file.type !== "text/plain") {
      setError("Velg en .md-fil.");
      return;
    }
    setSource(await file.text());
    setFilename(file.name || "document.md");
    setError(null);
  }

  async function createReview() {
    if (!source.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, filename, retention }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunne ikke starte review.");

      setReviewId(data.id);
      setEditToken(data.editToken);
      localStorage.setItem(`markdown-review:${data.id}:editToken`, data.editToken);
      window.history.replaceState({}, "", `/?review=${data.id}`);

      const parsed = splitMarkdownBlocks(source);
      setOpenBlockId(parsed[0]?.id ?? null);
      setSaveState("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke starte review.");
    } finally {
      setBusy(false);
    }
  }

  function toggleReviewed(blockId: string) {
    if (readOnly) return;
    const isDone = reviewedSet.has(blockId);
    setReviewed((current) => isDone
      ? current.filter((id) => id !== blockId)
      : [...current, blockId]);

    if (!isDone) {
      const next = blocks[openIndex + 1];
      if (next) window.setTimeout(() => setOpenBlockId(next.id), 160);
    }
  }

  function addAnnotation() {
    if (!selectedQuote || !comment.trim() || readOnly) return;
    setAnnotations((current) => [...current, {
      id: crypto.randomUUID(),
      blockId: selectedQuote.blockId,
      quote: selectedQuote.quote,
      comment: comment.trim(),
      createdAt: new Date().toISOString(),
    }]);
    setComment("");
    setSelectedQuote(null);
  }

  async function copyAgentLink() {
    if (!agentUrl) return;
    await saveNow();
    await navigator.clipboard.writeText(agentUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function resetApp() {
    setSource("");
    setFilename("document.md");
    setReviewId(null);
    setEditToken(null);
    setAnnotations([]);
    setReviewed([]);
    setOpenBlockId(null);
    setSelectedQuote(null);
    setComment("");
    setShowErrata(false);
    setReadOnly(false);
    setError(null);
    setPasteMode(false);
    window.history.replaceState({}, "", "/");
  }

  if (loadingExisting) {
    return <main className="loading-screen"><div className="spinner" /></main>;
  }

  if (!reviewId) {
    return (
      <main className="setup-shell">
        <section className="setup-card">
          <div className="setup-title">Markdown Review</div>

          {!pasteMode ? (
            <button
              className={`dropzone ${source ? "has-file" : ""}`}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files[0];
                if (file) void ingestFile(file);
              }}
              onClick={() => fileInput.current?.click()}
            >
              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".md,text/markdown,text/plain"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void ingestFile(file);
                }}
              />
              <span className="drop-icon">＋</span>
              <span>{source ? filename : "Velg Markdown"}</span>
              {source && <small>{blocks.length} deler</small>}
            </button>
          ) : (
            <textarea
              className="source-input"
              autoFocus
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setFilename("pasted-document.md");
              }}
              placeholder="Lim inn Markdown…"
            />
          )}

          <button className="text-button mode-toggle" onClick={() => setPasteMode((value) => !value)}>
            {pasteMode ? "Velg fil" : "Lim inn i stedet"}
          </button>

          <div className="setup-footer">
            <select
              aria-label="Lagringstid for original"
              value={retention}
              onChange={(event) => setRetention(event.target.value as Retention)}
            >
              {Object.entries(retentionLabels).map(([value, label]) => (
                <option key={value} value={value}>Original: {label}</option>
              ))}
            </select>
            <button className="primary-button" disabled={!source.trim() || busy} onClick={() => void createReview()}>
              {busy ? "…" : "Start"}
            </button>
          </div>

          {error && <div className="inline-error">{error}</div>}
        </section>
      </main>
    );
  }

  return (
    <main className="review-shell">
      <header className="topbar">
        <button className="file-title" onClick={resetApp} title="Nytt dokument">
          {filename}
        </button>

        <div className="topbar-status">
          <span>{reviewed.length}/{blocks.length}</span>
          {saveState === "saving" && <span className="save-dot saving" title="Lagrer" />}
          {saveState === "error" && <span className="save-dot error" title="Lagringsfeil" />}
        </div>

        <div className="top-actions">
          {annotations.length > 0 && (
            <button className={`toolbar-button ${showErrata ? "active" : ""}`} onClick={() => setShowErrata((value) => !value)}>
              Errata {annotations.length}
            </button>
          )}
          <button className="toolbar-button primary" onClick={() => void copyAgentLink()}>
            {copied ? "Kopiert" : "Kopier lenke"}
          </button>
        </div>
      </header>

      {error && <div className="floating-error">{error}</div>}

      <div className="workspace">
        <aside className="section-rail">
          <nav className="section-list" aria-label="Dokumentdeler">
            {blocks.map((block, index) => {
              const done = reviewedSet.has(block.id);
              const count = annotations.filter((annotation) => annotation.blockId === block.id).length;
              return (
                <button
                  key={block.id}
                  className={`section-row ${openBlock?.id === block.id ? "active" : ""} ${done ? "done" : ""}`}
                  onClick={() => {
                    setOpenBlockId(block.id);
                    setSelectedQuote(null);
                  }}
                  title={block.title}
                >
                  <span className="section-state">{done ? "✓" : index + 1}</span>
                  <span className="section-title">{block.title}</span>
                  {count > 0 && <span className="section-count">{count}</span>}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="focus-pane">
          {openBlock ? (
            <article className="focus-card">
              <div className="focus-meta">{openIndex + 1} / {blocks.length}</div>

              {openBlock.kind === "prose" || openBlock.kind === "heading" ? (
                <div className={`sentence-view ${openBlock.kind === "heading" ? "heading-view" : ""}`}>
                  {sentences(stripInlineMarkdown(openBlock.raw)).map((sentence, index) => {
                    const count = annotations.filter((annotation) =>
                      annotation.blockId === openBlock.id && annotation.quote === sentence
                    ).length;
                    const selected = selectedQuote?.blockId === openBlock.id && selectedQuote.quote === sentence;

                    return (
                      <button
                        key={`${index}-${sentence.slice(0, 18)}`}
                        className={`sentence ${count ? "annotated" : ""} ${selected ? "selected" : ""}`}
                        onClick={() => !readOnly && setSelectedQuote({ blockId: openBlock.id, quote: sentence })}
                      >
                        {sentence}
                        {count > 0 && <sup>{count}</sup>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="markdown-render">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{openBlock.raw}</ReactMarkdown>
                </div>
              )}

              {!readOnly && openBlock.kind === "structured" && (
                <button
                  className="block-comment"
                  onClick={() => setSelectedQuote({ blockId: openBlock.id, quote: stripInlineMarkdown(openBlock.raw) })}
                >
                  Kommenter blokken
                </button>
              )}

              {selectedQuote && !readOnly ? (
                <div className="comment-composer">
                  <div className="selected-quote">{selectedQuote.quote}</div>
                  <textarea
                    autoFocus
                    value={comment}
                    onChange={(event) => setComment(event.target.value)}
                    placeholder="Kommentar…"
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") addAnnotation();
                      if (event.key === "Escape") {
                        setSelectedQuote(null);
                        setComment("");
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <button className="text-button" onClick={() => { setSelectedQuote(null); setComment(""); }}>Avbryt</button>
                    <button className="primary-button small" disabled={!comment.trim()} onClick={addAnnotation}>Lagre</button>
                  </div>
                </div>
              ) : (
                <div className="focus-actions">
                  <button
                    className="nav-button"
                    disabled={openIndex === 0}
                    onClick={() => setOpenBlockId(blocks[openIndex - 1]?.id ?? openBlock.id)}
                    aria-label="Forrige"
                  >
                    ←
                  </button>

                  <label className={`review-toggle ${reviewedSet.has(openBlock.id) ? "checked" : ""}`}>
                    <input
                      type="checkbox"
                      checked={reviewedSet.has(openBlock.id)}
                      disabled={readOnly}
                      onChange={() => toggleReviewed(openBlock.id)}
                    />
                    <span>{reviewedSet.has(openBlock.id) ? "✓ Gjennomgått" : "Gjennomgått"}</span>
                  </label>

                  <button
                    className="nav-button"
                    disabled={openIndex >= blocks.length - 1}
                    onClick={() => setOpenBlockId(blocks[openIndex + 1]?.id ?? openBlock.id)}
                    aria-label="Neste"
                  >
                    →
                  </button>
                </div>
              )}
            </article>
          ) : (
            <div className="empty-source">Kilden er utløpt.</div>
          )}
        </section>

        {showErrata && (
          <aside className="errata-drawer">
            <div className="drawer-head">
              <strong>Errata</strong>
              <button className="icon-button" onClick={() => setShowErrata(false)} aria-label="Lukk">×</button>
            </div>

            <div className="annotation-list">
              {annotations.map((annotation) => (
                <article className="annotation-card" key={annotation.id}>
                  <q>{annotation.quote}</q>
                  <p>{annotation.comment}</p>
                  {!readOnly && (
                    <button
                      className="delete-comment"
                      onClick={() => setAnnotations((current) => current.filter((item) => item.id !== annotation.id))}
                    >
                      Slett
                    </button>
                  )}
                </article>
              ))}
            </div>

            <div className="drawer-actions">
              <button
                className="toolbar-button"
                onClick={() => downloadText(
                  `${reviewId}-errata.json`,
                  JSON.stringify({ reviewId, annotations, reviewedBlockIds: reviewed }, null, 2),
                  "application/json"
                )}
              >
                Eksporter
              </button>
              {source && (
                <button className="toolbar-button" onClick={() => downloadText(filename, source, "text/markdown")}>
                  Original
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
