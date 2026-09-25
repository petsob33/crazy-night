// Veo generation + composing the branded card overlay with ffmpeg.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ROOT, OUT_DIR } from './store.mjs';

const run = promisify(execFile);
const FONT = path.join(ROOT, 'marketing/fonts/RussoOne-Regular.ttf');
const LOGO = path.join(ROOT, 'assets/logo.png');

// USD per second of 720p video (Gemini API pricing, 2026-09).
export const MODELS = {
  lite: { id: 'veo-3.1-lite-generate-preview', usdPerSec: 0.05 },
  fast: { id: 'veo-3.1-fast-generate-preview', usdPerSec: 0.10 },
  standard: { id: 'veo-3.1-generate-preview', usdPerSec: 0.40 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function generateVeo(ai, { prompt, model = 'lite', durationSeconds = 8, outFile, onStatus = () => {} }) {
  const m = MODELS[model] || MODELS.lite;
  let op = await ai.models.generateVideos({
    model: m.id,
    prompt,
    config: {
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds,
      // EU accounts may only use allow_adult.
      personGeneration: 'allow_adult',
      negativePrompt: 'text, letters, subtitles, captions, watermark, logo, cards with writing',
    },
  });
  const started = Date.now();
  while (!op.done) {
    onStatus(`Veo generuje… ${Math.round((Date.now() - started) / 1000)} s`);
    await sleep(10000);
    op = await ai.operations.getVideosOperation({ operation: op });
  }
  if (op.error) throw new Error(`Veo: ${op.error.message || JSON.stringify(op.error)}`);
  const video = op.response?.generatedVideos?.[0]?.video;
  if (!video) {
    const why = op.response?.raiMediaFilteredReasons?.join('; ');
    throw new Error(why ? `Veo video zablokoval filtr: ${why}` : 'Veo nevrátilo žádné video.');
  }
  await ai.files.download({ file: video, downloadPath: outFile });
  return { costUsd: m.usdPerSec * durationSeconds };
}

function wrap(text, maxChars) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > maxChars) { lines.push(line); line = word; }
    else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

// Renders the printed card look (black stock, pink Russo One, logo) as a transparent PNG.
async function renderCard(text, workDir) {
  const W = 600, pad = 40, fontSize = 44, lineH = 58, logoH = 44;
  const lines = wrap(text, 19);
  const H = pad + logoH + 30 + lines.length * lineH + pad;
  const filters = [
    `drawbox=x=0:y=0:w=${W}:h=${H}:color=0x0B0B0F@0.94:t=fill:replace=1`,
    `drawbox=x=0:y=0:w=${W}:h=${H}:color=0xE8237F:t=5:replace=1`,
  ];
  for (const [i, l] of lines.entries()) {
    const f = path.join(workDir, `line${i}.txt`);
    await fs.writeFile(f, l);
    filters.push(`drawtext=fontfile='${FONT}':textfile='${f}':fontsize=${fontSize}:fontcolor=0xE8237F:x=(w-text_w)/2:y=${pad + logoH + 30 + i * lineH}`);
  }
  const png = path.join(workDir, 'card.png');
  await run('ffmpeg', ['-y', '-v', 'error',
    '-f', 'lavfi', '-i', `color=c=black@0.0:s=${W}x${H},format=rgba`,
    '-i', LOGO,
    '-filter_complex', `[0]${filters.join(',')}[bg];[1]scale=-1:${logoH}[lg];[bg][lg]overlay=(W-w)/2:${pad}`,
    '-frames:v', '1', png]);
  return png;
}

// Fedora's ffmpeg-free ships OpenH264 instead of x264, so pick whichever exists.
let encoderArgs;
async function h264Args() {
  if (!encoderArgs) {
    const { stdout } = await run('ffmpeg', ['-hide_banner', '-encoders']);
    encoderArgs = /\blibx264\b/.test(stdout)
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20']
      : ['-c:v', 'libopenh264', '-b:v', '5M'];
  }
  return encoderArgs;
}

// Puts the card over the Veo clip; it fades in after `appearAt` seconds so the scene lands first.
export async function composeCard({ inFile, outFile, text, appearAt = 1 }) {
  const workDir = await fs.mkdtemp(path.join(OUT_DIR, '.tmp-'));
  try {
    const card = await renderCard(text, workDir);
    await run('ffmpeg', ['-y', '-v', 'error', '-i', inFile, '-loop', '1', '-i', card,
      '-filter_complex', `[0:v]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280[v];[1]format=rgba,fade=in:st=${appearAt}:d=0.4:alpha=1[c];[v][c]overlay=(W-w)/2:(H-h)/2+120:shortest=1,format=yuv420p`,
      '-map', '0:a?', ...(await h264Args()), '-c:a', 'aac', '-movflags', '+faststart', outFile]);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
