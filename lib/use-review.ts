"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { buildDocument, normaliseReviewed } from "./document";
import type { Annotation, PublicReview, Retention } from "./review";
import { rememberRecentReview } from "./recent";

export type Session = {
  id: string;
  filename: string;
  source: string | null;
  retention: Retention;
  annotations: Annotation[];
  reviewed: string[];
  editToken: string | null;
};
export type SaveState = "saved" | "pending" | "saving" | "error";

export function useReview() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const current = useRef<Session | null>(null);
  const dirty = useRef(false);
  const revision = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null);

  const adopt = useCallback((next: Session | null) => {
    current.current = next;
    dirty.current = false;
    revision.current = 0;
    setSession(next);
    setSaveState("saved");
  }, []);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("review");
    if (!id) return;
    const controller = new AbortController();
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/reviews/${encodeURIComponent(id)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Kunne ikke åpne dokumentet.");
        const data = await response.json() as PublicReview;
        let editToken: string | null = null;
        try { editToken = localStorage.getItem(`markdown-review:${id}:editToken`); } catch { /* Read-only when browser storage is unavailable. */ }
        if (!controller.signal.aborted) {
          adopt({
            id: data.id, filename: data.filename, source: data.source, retention: data.retention,
            annotations: data.annotations ?? [],
            reviewed: data.source ? normaliseReviewed(buildDocument(data.source), data.reviewedBlockIds ?? []) : data.reviewedBlockIds ?? [],
            editToken,
          });
          rememberRecentReview(data.id, data.filename);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Kunne ikke åpne dokumentet.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [adopt]);

  // Serialize writes. A slow, older autosave must never overwrite a newer edit.
  const flush = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    if (!dirty.current || !current.current?.editToken) return Promise.resolve(true);
    const task = (async () => {
      setSaveState("saving");
      while (dirty.current && current.current?.editToken) {
        const snapshot = current.current;
        const version = revision.current;
        try {
          const response = await fetch(`/api/reviews/${snapshot.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json", "x-edit-token": snapshot.editToken! },
            body: JSON.stringify({ annotations: snapshot.annotations, reviewedBlockIds: snapshot.reviewed }),
          });
          if (!response.ok) throw new Error("Lagring feilet.");
          if (version === revision.current) dirty.current = false;
        } catch {
          setSaveState("error");
          return false;
        }
      }
      setSaveState("saved");
      return true;
    })();
    inFlight.current = task;
    void task.then(() => { inFlight.current = null; });
    return task;
  }, []);

  useEffect(() => {
    if (!dirty.current) return;
    const timer = setTimeout(() => void flush(), 650);
    return () => clearTimeout(timer);
  }, [session, flush]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);

  const update = useCallback((transform: (value: Session) => Session) => {
    if (!current.current?.editToken) return;
    const next = transform(current.current);
    current.current = next;
    dirty.current = true;
    revision.current += 1;
    setSession(next);
    setSaveState("pending");
  }, []);

  async function create(source: string, filename: string, retention: Retention) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source, filename, retention }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Kunne ikke lagre dokumentet.");
      adopt({ id: data.id, filename, source, retention, annotations: [], reviewed: [], editToken: data.editToken });
      rememberRecentReview(data.id, filename);
      try { localStorage.setItem(`markdown-review:${data.id}:editToken`, data.editToken); }
      catch { setError("Nettleseren kan ikke huske redigeringstilgangen. Behold denne fanen åpen."); }
      window.history.replaceState({}, "", `/?review=${data.id}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Kunne ikke lagre dokumentet."); }
    finally { setLoading(false); }
  }

  async function reset() {
    if (!await flush()) return false;
    adopt(null);
    setError(null);
    window.history.replaceState({}, "", "/");
    return true;
  }
  return { session, loading, error, setError, saveState, create, update, flush, reset };
}
