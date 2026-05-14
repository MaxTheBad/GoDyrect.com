import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';

function runFfmpeg(args, cwd) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with code ${code}`));
    });
  });
}

export async function POST(req) {
  try {
    const body = await req.json();
    const src = body?.src;

    if (!src) {
      return new Response(JSON.stringify({ error: 'Missing src.' }), { status: 400 });
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'godyrect-thumb-'));
    const outputPath = path.join(workDir, 'thumb.jpg');

    try {
      await runFfmpeg([
        '-y',
        '-ss', '0.45',
        '-i', src,
        '-frames:v', '1',
        '-vf', 'scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2',
        '-q:v', '2',
        outputPath,
      ], workDir);

      const bytes = await fs.readFile(outputPath);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        },
      });
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}
