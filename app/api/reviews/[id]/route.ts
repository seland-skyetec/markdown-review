import { del, get, put } from "@vercel/blob";
import { createHash, timingSafeEqual } from "node:crypto";
import { Annotation, PublicReview, ReviewRecord, isExpired } from "@/lib/review";

export const runtime = "nodejs";

async function readText(pathname: string): Promise<string | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  return new Response(result.stream).text();
}

async function readRecord(id: string): Promise<ReviewRecord | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  const text = await readText(`reviews/${id}.json`);
  if (!text) return null;
  try {
    return JSON.parse(text) as ReviewRecord;
  } catch {
    return null;
  }
}

function validEditToken(candidate: string | null, expectedHex: string): boolean {
  if (!candidate) return false;
  const actual = Buffer.from(createHash("sha256").update(candidate).digest("hex"));
  const expected = Buffer.from(expectedHex);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await readRecord(id);
  if (!record) return Response.json({ error: "Review ikke funnet." }, { status: 404 });

  let source: string | null = null;
  const expired = isExpired(record.sourceExpiresAt);
  if (!expired) {
    source = await readText(record.sourcePath);
  } else {
    await del(record.sourcePath).catch((error: unknown) => console.error("Lazy source cleanup failed", error));
  }

  const { editTokenHash: _secret, sourcePath: _path, ...safe } = record;
  const payload: PublicReview = {
    ...safe,
    source,
    sourceAvailable: source !== null && !expired,
  };

  return Response.json(payload, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const record = await readRecord(id);
  if (!record) return Response.json({ error: "Review ikke funnet." }, { status: 404 });

  if (!validEditToken(request.headers.get("x-edit-token"), record.editTokenHash)) {
    return Response.json({ error: "Mangler gyldig edit-token." }, { status: 403 });
  }

  const body = await request.json().catch(() => null) as null | {
    annotations?: unknown;
    reviewedBlockIds?: unknown;
    title?: unknown;
  };
  if (!body) return Response.json({ error: "Ugyldig payload." }, { status: 400 });

  const annotations = Array.isArray(body.annotations)
    ? body.annotations.filter((item): item is Annotation => {
        if (!item || typeof item !== "object") return false;
        const annotation = item as Partial<Annotation>;
        return typeof annotation.id === "string"
          && typeof annotation.blockId === "string"
          && typeof annotation.quote === "string"
          && typeof annotation.comment === "string"
          && typeof annotation.createdAt === "string";
      }).slice(0, 5000)
    : record.annotations;

  const reviewedBlockIds = Array.isArray(body.reviewedBlockIds)
    ? body.reviewedBlockIds.filter((item): item is string => typeof item === "string").slice(0, 10000)
    : record.reviewedBlockIds;

  const title = typeof body.title === "string" && body.title.trim()
    ? body.title.trim().slice(0, 200)
    : record.title;

  const updated: ReviewRecord = {
    ...record,
    title,
    annotations,
    reviewedBlockIds,
    updatedAt: new Date().toISOString(),
  };

  await put(`reviews/${id}.json`, JSON.stringify(updated), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
  });

  return Response.json({ ok: true, updatedAt: updated.updatedAt });
}
