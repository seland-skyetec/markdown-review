import { del, get, put } from "@vercel/blob";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const pathname = `smoke/${randomUUID()}.txt`;
  const expected = "private-blob-ok";

  try {
    await put(pathname, expected, {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain; charset=utf-8",
    });

    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) {
      return Response.json({ ok: false, stage: "read" }, { status: 500 });
    }

    const actual = await new Response(result.stream).text();
    await del(pathname);

    return Response.json({
      ok: actual === expected,
      privateBlob: actual === expected,
      cleanup: true,
    });
  } catch (error) {
    console.error("Private Blob smoke test failed", error);
    await del(pathname).catch(() => undefined);
    return Response.json({ ok: false, stage: "exception" }, { status: 500 });
  }
}
