// Vision tools: screenshots and short clips of an online player through a
// headless rendering client (see client/tests/vision-capture.browser.cjs).
// The MCP server is stateless, so every call boots its own browser, logs the
// named player in through it (taking over any headless session), aims the
// camera, captures, and shuts down. Scene setup stays with the existing tools
// (command/teleport, interact, npc_option, ...); these only observe.
//
// Export layout, all under <worktree>/exports/ (git-ignored):
//   <run>/logs/run.log                    one tick-stamped line per vision call
//   <run>/logs/harness-t<TICK>-<label>.json   full harness summary per call
//   <run>/screenshots/t<TICK>-<label>.png
//   <run>/videos/t<TICK>-<label>.mp4      (frames kept only if no video)
// <run> is the `run` tool argument (same label groups a whole test session);
// without one, each call gets its own <timestamp>-<username> folder.
// The server tick in file names ties media to run.log lines (completion tick;
// capture and naming are seconds apart, so within a few ticks). Results are
// file paths as text; agents read the PNGs back to inspect them.
// Toggles: VISION_EXPORTS=0 (false/off) sends captures to the OS temp dir and
// writes no logs; VISION_KEEP_FRAMES=1 keeps clip frame JPEGs after a video
// builds. VISION_EXPORT_DIR overrides the exports folder; VISION_CLIENT_URL
// overrides the auto-detected worktree client URL; VISION_CHROME_PATH picks a
// specific browser.
// ASYNC on purpose: spawnSync would block this server's event loop for the
// whole capture, so the browser's own login request could never be processed
// (server and harness waiting on each other = deadlock). Async spawn keeps the
// world ticking while the capture runs.
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function worktreeRoot() {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

// Exports on by default (worktree exports/ folder, git-ignored). VISION_EXPORTS=0
// (or false/off) redirects captures to the OS temp dir and writes no run logs or
// harness JSONs, so repeated probing does not accumulate repo data.
function exportsEnabled() {
  const value = String(process.env.VISION_EXPORTS ?? "1").toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

// Clip frame JPEGs are a fallback for when ffmpeg cannot produce a video;
// once a video exists they are deleted unless VISION_KEEP_FRAMES=1.
function keepFrames() {
  return String(process.env.VISION_KEEP_FRAMES ?? "0") === "1";
}

function exportsRoot() {
  if (process.env.VISION_EXPORT_DIR) return process.env.VISION_EXPORT_DIR;
  return path.join(worktreeRoot(), "exports");
}

function clientUrl() {
  if (process.env.VISION_CLIENT_URL) return process.env.VISION_CLIENT_URL;
  // The worktree's own client port (scripts/wt writes PORT into root .env);
  // main checkout has none and keeps the 3000 default (docs/worktrees.md).
  try {
    const env = fs.readFileSync(path.join(worktreeRoot(), ".env"), "utf8");
    const match = env.match(/^PORT=(\d+)\s*$/m);
    if (match) return `http://localhost:${match[1]}`;
  } catch {}
  return "http://localhost:3000";
}

function serverTick(ctx) {
  try {
    const tick = ctx?.core?.World?.getProcessCycle?.();
    if (Number.isInteger(tick) && tick >= 0) return tick;
  } catch {}
  return null;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sanitizeLabel(label, fallback) {
  const clean = String(label ?? "").replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return clean || fallback;
}

// One folder per run label; without a label, per call (<stamp>-<username>).
function resolveRunDir(runLabel, username) {
  const enabled = exportsEnabled();
  const runId = sanitizeLabel(runLabel, `${stamp()}-${String(username).toLowerCase()}`);
  const base = enabled ? exportsRoot() : path.join(os.tmpdir(), "tsps-vision");
  const runDir = path.join(base, runId);
  for (const sub of ["logs", "screenshots", "videos"]) {
    fs.mkdirSync(path.join(runDir, sub), { recursive: true });
  }
  return { runDir, runId, enabled };
}

function logRun(runDir, line) {
  fs.appendFileSync(path.join(runDir, "logs", "run.log"), `${new Date().toISOString()} ${line}\n`);
}

function uniquePath(dir, name) {
  let candidate = path.join(dir, name);
  if (!fs.existsSync(candidate)) return candidate;
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  for (let index = 2; index < 1000; index++) {
    candidate = path.join(dir, `${stem}-${index}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return candidate;
}

function runHarness(args, timeoutMs) {
  const harness = path.join(worktreeRoot(), "client", "tests", "vision-capture.browser.cjs");
  if (!fs.existsSync(harness)) return Promise.reject(new Error(`vision harness missing: ${harness}`));
  const started = Date.now();
  const budget = Math.max(60000, timeoutMs);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [harness, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errBuf = "";
    child.stdout.on("data", (chunk) => { out += String(chunk); });
    child.stderr.on("data", (chunk) => { errBuf += String(chunk); });
    const killer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error(`vision harness exceeded ${budget}ms`));
    }, budget);
    child.on("error", (error) => {
      clearTimeout(killer);
      reject(new Error(`vision harness failed to run: ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(killer);
      const lines = out.trim().split("\n");
      let summary = null;
      for (let index = lines.length - 1; index >= 0; index--) {
        try {
          const parsed = JSON.parse(lines[index]);
          if (parsed && typeof parsed === "object" && "ok" in parsed) {
            summary = parsed;
            break;
          }
        } catch {}
      }
      if (!summary) {
        reject(new Error(`vision harness produced no summary (exit ${code}): ${String(errBuf).slice(0, 300)}`));
        return;
      }
      summary.wallMs = Date.now() - started;
      if (!summary.ok) {
        reject(new Error(`vision capture failed: ${summary.error ?? "unknown"}`));
        return;
      }
      resolve(summary);
    });
  });
}

module.exports = function registerVisionTools(ctx) {
  const { player, tool, z } = ctx;
  const yaw = z.number().int().min(0).max(2047).optional()
    .describe("Camera yaw (0-2047). Omit to keep the player's current view.");
  const pitch = z.number().int().min(0).max(512).optional()
    .describe("Camera pitch (0 level - 512 down). Omit to keep the player's current view.");
  const run = z.string().min(1).max(60).optional()
    .describe("Run label grouping captures into one exports/<run>/ folder (default: timestamped per call).");
  const label = z.string().min(1).max(60).optional()
    .describe("Short label for the file names, e.g. lumbridge, araxxor-lair (default: tool name).");

  tool(
    "vision_screenshot",
    "Capture what the named online player sees right now through a headless game client (WebGPU): logs them in through it, aims the optional camera, screenshots to PNG under exports/<run>/screenshots with the server tick in the name. Arrange the scene first (command/teleport, interact, ...). Returns paths for inspection.",
    { player, yaw, pitch, run, label },
    async ({ player: username, yaw: y, pitch: p, run: runLabel, label: name }) => {
      const tickStart = serverTick(ctx);
      const { runDir, runId, enabled } = resolveRunDir(runLabel, username);
      const args = ["--url", clientUrl(), "--user", username, "--pass", process.env.VISION_BOT_PASSWORD ?? "vision1234",
        "--settle-ms", "2500"];
      if (y !== undefined) args.push("--yaw", String(y));
      if (p !== undefined) args.push("--pitch", String(p));
      const tickShot = serverTick(ctx);
      const fileBase = `t${String(tickShot ?? 0).padStart(7, "0")}-${sanitizeLabel(name, "screenshot")}`;
      const out = uniquePath(path.join(runDir, "screenshots"), `${fileBase}.png`);
      const summary = await runHarness([...args, "--out", out], 240000);
      const tickEnd = serverTick(ctx);
      if (enabled) {
        // Named like the media it belongs to (t<tick>-<label>), so the summary
        // is matchable to its screenshot/video at a glance.
        fs.writeFileSync(path.join(runDir, "logs", `harness-${fileBase}.json`), JSON.stringify(summary, null, 2));
        logRun(runDir, `tick ${tickStart}->${tickEnd} tool=vision_screenshot player=${username} ` +
          `camera=${JSON.stringify(summary.camera ?? null)} files=${path.relative(runDir, summary.screenshot)}`);
      }
      return { run: runId, exported: enabled, screenshot: summary.screenshot, tick: tickEnd,
        camera: summary.camera ?? null, client: summary.client ?? null, ms: summary.wallMs };
    }
  );

  tool(
    "vision_clip",
    "Record a short clip of what the named online player sees (CDP screencast frames assembled to MP4 with ffmpeg when available, else JPEG frames), stored under exports/<run>/videos with the server tick in the name. Keep under ~15 seconds. Returns paths for inspection.",
    {
      player, yaw, pitch, run, label,
      seconds: z.number().int().min(1).max(30).default(8).describe("Clip length in seconds."),
    },
    async ({ player: username, yaw: y, pitch: p, run: runLabel, label: name, seconds }) => {
      const tickStart = serverTick(ctx);
      const { runDir, runId, enabled } = resolveRunDir(runLabel, username);
      const args = ["--url", clientUrl(), "--user", username, "--pass", process.env.VISION_BOT_PASSWORD ?? "vision1234",
        "--settle-ms", "2500"];
      if (y !== undefined) args.push("--yaw", String(y));
      if (p !== undefined) args.push("--pitch", String(p));
      const tickShot = serverTick(ctx);
      const base = `t${String(tickShot ?? 0).padStart(7, "0")}-${sanitizeLabel(name, "clip")}`;
      const videoDir = path.join(runDir, "videos");
      const summary = await runHarness([...args,
        "--out", uniquePath(path.join(runDir, "screenshots"), `${base}.png`),
        "--clip-secs", String(seconds), "--clip-fps", "10",
        "--clip-out", path.join(videoDir, `${base}.mp4`),
        "--frames-dir", path.join(videoDir, `${base}-frames`)], 240000 + seconds * 1000);
      const tickEnd = serverTick(ctx);
      // Frames are only a fallback: drop them once the video exists.
      let framesDeleted = false;
      if (summary.clip?.video && summary.clip?.framesDir && !keepFrames()) {
        try {
          fs.rmSync(summary.clip.framesDir, { recursive: true, force: true });
          framesDeleted = true;
        } catch {}
      }
      if (enabled) {
        fs.writeFileSync(path.join(runDir, "logs", `harness-${base}.json`), JSON.stringify(summary, null, 2));
        const files = [summary.screenshot, summary.clip?.video ?? summary.clip?.framesDir ?? null].filter(Boolean)
          .map((f) => path.relative(runDir, f)).join(",");
        logRun(runDir, `tick ${tickStart}->${tickEnd} tool=vision_clip player=${username} seconds=${seconds} ` +
          `camera=${JSON.stringify(summary.camera ?? null)}${framesDeleted ? " frames=deleted" : ""} files=${files}`);
      }
      return {
        run: runId,
        exported: enabled,
        video: summary.clip?.video ?? null,
        videoCodec: summary.clip?.videoCodec ?? null,
        videoError: summary.clip?.videoError ?? null,
        frames: summary.clip?.frames ?? 0,
        framesDir: framesDeleted ? null : (summary.clip?.framesDir ?? null),
        framesDeleted,
        screenshot: summary.screenshot ?? null,
        tick: tickEnd,
        ms: summary.wallMs,
      };
    }
  );
};
