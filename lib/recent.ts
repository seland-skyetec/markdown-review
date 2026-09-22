"use client";

export type RecentReviewRef = {
  id: string;
  filename: string;
  lastOpenedAt: string;
};

const KEY = "markdown-review:recent:v1";
const LIMIT = 8;
const EVENT = "markdown-review:recent";

function valid(value: unknown): value is RecentReviewRef {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RecentReviewRef>;
  return /^[a-f0-9]{32}$/.test(item.id ?? "")
    && typeof item.filename === "string"
    && typeof item.lastOpenedAt === "string";
}

export function readRecentReviews(): RecentReviewRef[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter(valid).slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

function writeRecentReviews(items: RecentReviewRef[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items.slice(0, LIMIT)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Recent history is optional; reviews remain accessible by their capability URL.
  }
}

export function rememberRecentReview(id: string, filename: string) {
  const now = new Date().toISOString();
  const next = readRecentReviews().filter((item) => item.id !== id);
  next.unshift({ id, filename, lastOpenedAt: now });
  writeRecentReviews(next);
}

export function forgetRecentReview(id: string) {
  writeRecentReviews(readRecentReviews().filter((item) => item.id !== id));
}

export function onRecentReviewsChanged(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
