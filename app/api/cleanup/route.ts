import { del, get, list } from "@vercel/blob";
import { ReviewRecord, isExpired } from "@/lib/review";

export const runtime = "nodejs";
export const maxDuration = 60;

async function readRecord(pathname: string): Promise<ReviewRecord | null> {
  const result = await get(pathname, { access: "private", useCache: false });
  if (!result || result.statusCode !== 200) return null;
  try {
    return JSON.parse(await new Response(result.stream).text()) as ReviewRecord;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let cursor: string | undefined;
  let deleted = 0;
  let scanned = 0;

  do {
    const page = await list({ prefix: "reviews/", cursor, limit: 100 });
    for (const blob of page.blobs) {
      const record = await readRecord(blob.pathname);
      scanned += 1;
      if (record && isExpired(record.sourceExpiresAt)) {
        await del(record.sourcePath).catch(() => undefined);
        deleted += 1;
      }
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && scanned < 5000);

  return Response.json({ ok: true, scanned, deleted });
}
