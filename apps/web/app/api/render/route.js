"use server";

import fs from 'fs';
import path from 'path';

export async function POST(req) {
  try {
    const body = await req.json();
    const id = `render-${Date.now()}`;
    const outDir = path.resolve(process.cwd(), 'tmp', 'renders');
    try { fs.mkdirSync(outDir, { recursive: true }); } catch (e) {}
    const filePath = path.join(outDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(body, null, 2));

    // For now, just queue the manifest file on disk. A separate worker/cron can pick it up and run FFmpeg.

    return new Response(JSON.stringify({ status: 'queued', id, path: `/tmp/renders/${id}.json` }), { status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
}
