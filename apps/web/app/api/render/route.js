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
    const form = await req.formData();
    const clips = form.getAll('clips').filter((item) => item instanceof File);
    const manifestText = form.get('manifest');
    const manifest = manifestText ? JSON.parse(String(manifestText)) : {};

    if (!clips.length) {
      return new Response(JSON.stringify({ error: 'No clips uploaded.' }), { status: 400 });
    }

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'godyrect-render-'));
    const inputPaths = [];
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const inputPath = path.join(workDir, `input-${i}${path.extname(clip.name || '') || '.mp4'}`);
      const bytes = Buffer.from(await clip.arrayBuffer());
      await fs.writeFile(inputPath, bytes);
      inputPaths.push(inputPath);
    }

    const outputPath = path.join(workDir, 'rendered.mp4');
    const filterParts = [];
    for (let i = 0; i < inputPaths.length; i++) {
      filterParts.push(`[${i}:v]fps=30,scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`);
    }
    filterParts.push(`${inputPaths.map((_, i) => `[v${i}]`).join('')}concat=n=${inputPaths.length}:v=1:a=0[outv]`);

    await runFfmpeg([
      '-y',
      ...inputPaths.flatMap((inputPath) => ['-i', inputPath]),
      '-filter_complex', filterParts.join(';'),
      '-map', '[outv]',
      '-an',
      '-movflags', '+faststart',
      '-preset', 'veryfast',
      '-crf', '20',
      outputPath,
    ], workDir);

    const outputBytes = await fs.readFile(outputPath);
    const response = new Response(outputBytes, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'X-Render-Manifest': encodeURIComponent(JSON.stringify(manifest)),
      },
    });

    await fs.rm(workDir, { recursive: true, force: true });
    return response;
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), { status: 500 });
  }
}
