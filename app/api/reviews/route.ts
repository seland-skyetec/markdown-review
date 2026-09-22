import { put } from "@vercel/blob";
import { createHash, randomBytes } from "node:crypto";
import { expiryFor, Retention, ReviewRecord } from "@/lib/review";

export const runtime = "nodejs";

const VALID_RETENTION = new Set<Retention>(["1d", "1w", "1m", "never"]);
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as null | {
    source?: unknown;
    filename?: unknown;
    retention?: unknown;
  };

  if (!body || typeof body.source !== "string" || !body.source.trim()) {
    return Response.json({ error: "Markdown-kilden mangler." }, { status: 400 });
  }

  if (Buffer.byteLength(body.source, "utf8") > MAX_SOURCE_BYTES) {
    return Response.json({ error: "Dokumentet er større enn 2 MB." }, { status: 413 });
  }

  const retention = VALID_RETENTION.has(body.retention as Retention)
    ? body.retention as Retention
    : "1w";
  const id = randomBytes(16).toString("hex");
  const editToken = randomBytes(24).toString("base64url");
  const editTokenHash = createHash("sha256").update(editToken).digest("hex");
  const now = new Date();
  const filename = typeof body.filename === "string" && body.filename.trim()
    ? body.filename.trim().slice(0, 160)
    : "document.md";
  const title = filename.replace(/\.md$/i, "") || "Untitled review";
  const sourcePath = `sources/${id}.md`;

  const record: ReviewRecord = {
    version: 1,
    id,
    filename,
    title,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    sourcePath,
    sourceExpiresAt: expiryFor(retention, now),
    retention,
    reviewedBlockIds: [],
    annotations: [],
    editTokenHash,
  };

  try {
    await put(sourcePath, body.source, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/markdown; charset=utf-8",
    });
    await put(`reviews/${id}.json`, JSON.stringify(record), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "application/json; charset=utf-8",
    });
  } catch (error) {
    console.error("Failed to create review", error);
    return Response.json(
      { error: "Kunne ikke lagre review. Kontroller at Vercel Blob er koblet til prosjektet." },
      { status: 503 },
    );
  }

  const origin = new URL(request.url).origin;
  return Response.json({
    id,
    editToken,
    reviewUrl: `${origin}/?review=${id}`,
    agentUrl: `${origin}/api/reviews/${id}`,
    sourceExpiresAt: record.sourceExpiresAt,
  });
}
