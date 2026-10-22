"use strict";

// The client's Report a Bug form sends a report as base64 chunks of its JSON over the
// "bug-report" plugin-message channel (a plugin message is at most 16 KB):
//   status                      -> status { destination }   where reports go, for the form's notice
//   begin { id, chunks, chars } -> ready, or rejected { reason }
//   chunk { id, index, data }      no answer
//   end { id }                  -> missing { chunks }, then sent { issueUrl?, issueNumber? } or failed { reason }
// Mirrored by client/game/plugins/bugreport/BugReportUpload.ts.

const path = require("node:path");
const { createFiler } = require("./Filing.BugReports");
const { serverSnapshot } = require("./Snapshot.BugReports");

const CHANNEL = "bug-report";
const CHUNK_CHARS = 15_000;
const MAX_REPORT_CHARS = 3_000_000;
const MAX_CHUNKS = Math.ceil(MAX_REPORT_CHARS / CHUNK_CHARS);
const MAX_DESCRIPTION = 4000;
const MAX_SCREENSHOT_BYTES = 2_000_000;
/** An upload with no chunk for this long is dropped. */
const UPLOAD_IDLE_MS = 60_000;
/** One report a minute per player, and 30 an hour for the whole world. */
const PLAYER_COOLDOWN_MS = 60_000;
const WORLD_HOURLY_LIMIT = 30;
/** Each upload holds up to 3 MB until it's filed. */
const MAX_OPEN_UPLOADS = 5;
const HOUR_MS = 3_600_000;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;
const SCREENSHOT_PATTERN = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

let core;
let filer;
let now = Date.now;
/** By player: the upload in progress, or the report being filed. */
const uploads = new Map();
/** By lower-cased username, so logging out and back in doesn't reset it. */
const lastReportAt = new Map();
const worldReportTimes = [];
let filingQueue = Promise.resolve();

function reply(player, data) {
  try {
    player.getSession().sendClientPacket(core.encodePluginMessage(CHANNEL, data));
  } catch {}
}

function dropIdleUploads() {
  for (const [player, upload] of uploads) {
    if (!upload.filing && now() - upload.touchedAt > UPLOAD_IDLE_MS) uploads.delete(player);
  }
}

function refusal(player) {
  const waitMs = (lastReportAt.get(player.getUsername().toLowerCase()) ?? -Infinity) + PLAYER_COOLDOWN_MS - now();
  if (waitMs > 0) return `Please wait ${Math.ceil(waitMs / 1000)} seconds before sending another report.`;
  while (worldReportTimes.length > 0 && now() - worldReportTimes[0] > HOUR_MS) worldReportTimes.shift();
  if (worldReportTimes.length >= WORLD_HOURLY_LIMIT) return "This world has taken a lot of reports this hour. Please try again later.";
  if (uploads.get(player)?.filing) return "Your last report is still being sent.";
  const others = [...uploads.keys()].filter((other) => other !== player).length;
  if (others >= MAX_OPEN_UPLOADS) return "The server is busy with other reports. Please try again in a minute.";
  return undefined;
}

function begin(player, data) {
  const { id, chunks, chars } = data;
  if (typeof id !== "string" || !ID_PATTERN.test(id)) return;
  if (!Number.isInteger(chunks) || chunks < 1 || chunks > MAX_CHUNKS
    || !Number.isInteger(chars) || chars < 1 || chars > MAX_REPORT_CHARS) {
    reply(player, { type: "rejected", id, reason: "The report is too large to send." });
    return;
  }
  const reason = refusal(player);
  if (reason) {
    reply(player, { type: "rejected", id, reason });
    return;
  }
  uploads.set(player, { id, chars, parts: new Array(chunks), touchedAt: now(), filing: false });
  reply(player, { type: "ready", id });
}

function chunk(player, data) {
  const upload = uploads.get(player);
  if (!upload || upload.filing || data.id !== upload.id) return;
  const { index } = data;
  if (!Number.isInteger(index) || index < 0 || index >= upload.parts.length) return;
  if (typeof data.data !== "string" || data.data.length > CHUNK_CHARS || !BASE64_PATTERN.test(data.data)) return;
  upload.parts[index] = data.data;
  upload.touchedAt = now();
}

/** The client's report, checked; a string says what's wrong with it. */
function readReport(upload) {
  const joined = upload.parts.join("");
  if (joined.length !== upload.chars) return "The report arrived damaged.";
  let report;
  try {
    report = JSON.parse(Buffer.from(joined, "base64").toString("utf8"));
  } catch {
    return "The report arrived damaged.";
  }
  if (!report || typeof report !== "object" || Array.isArray(report)) return "The report arrived damaged.";
  const description = typeof report.description === "string" ? report.description.trim() : "";
  if (!description) return "A report needs a description.";
  if (description.length > MAX_DESCRIPTION) return `Keep the description under ${MAX_DESCRIPTION} characters.`;
  let screenshot;
  if (report.screenshot != null) {
    const match = typeof report.screenshot === "string" ? SCREENSHOT_PATTERN.exec(report.screenshot) : null;
    const bytes = match ? Buffer.from(match[2], "base64") : undefined;
    if (!bytes || bytes.length > MAX_SCREENSHOT_BYTES) return "The screenshot couldn't be read.";
    screenshot = { extension: match[1] === "png" ? "png" : "jpg", bytes };
  }
  const diagnostics = report.diagnostics && typeof report.diagnostics === "object" && !Array.isArray(report.diagnostics)
    ? report.diagnostics
    : undefined;
  return { description, screenshot, diagnostics };
}

function end(player, data) {
  const upload = uploads.get(player);
  if (!upload || upload.filing || data.id !== upload.id) {
    if (typeof data.id === "string" && ID_PATTERN.test(data.id)) {
      reply(player, { type: "failed", id: data.id, reason: "The server lost the report. Please send it again." });
    }
    return;
  }
  const missing = [];
  for (let index = 0; index < upload.parts.length; index++) {
    if (upload.parts[index] === undefined) missing.push(index);
  }
  if (missing.length > 0) {
    upload.touchedAt = now();
    reply(player, { type: "missing", id: upload.id, chunks: missing });
    return;
  }
  const read = readReport(upload);
  if (typeof read === "string") {
    uploads.delete(player);
    reply(player, { type: "failed", id: upload.id, reason: read });
    return;
  }
  upload.filing = true;
  upload.parts = [];
  const username = player.getUsername();
  lastReportAt.set(username.toLowerCase(), now());
  worldReportTimes.push(now());
  const report = {
    id: upload.id,
    reportedAt: new Date(now()).toISOString(),
    username,
    description: read.description,
    screenshot: read.screenshot,
    client: read.diagnostics,
    server: serverSnapshot(core, player, read.diagnostics !== undefined),
  };
  filingQueue = filingQueue.then(() => fileReport(player, upload, report));
}

async function fileReport(player, upload, report) {
  try {
    const filed = await filer.file(report);
    console.log(`[bug-report] ${report.username}: ${filed.issueUrl ?? filed.savedTo}`);
    reply(player, { type: "sent", id: report.id, issueUrl: filed.issueUrl, issueNumber: filed.issueNumber });
  } catch (error) {
    console.warn(`[bug-report] ${report.username}'s report couldn't be saved: ${error.message}`);
    reply(player, { type: "failed", id: report.id, reason: "The server couldn't save the report." });
  } finally {
    if (uploads.get(player) === upload) uploads.delete(player);
  }
}

function receiveMessage(event) {
  if (event.channel !== CHANNEL) return;
  event.handled = true;
  const { player, data } = event;
  dropIdleUploads();
  switch (data.type) {
    case "status":
      reply(player, { type: "status", destination: filer.destination ?? null });
      return;
    case "begin":
      begin(player, data);
      return;
    case "chunk":
      chunk(player, data);
      return;
    case "end":
      end(player, data);
      return;
  }
}

function forgetUpload({ player }) {
  if (!uploads.get(player)?.filing) uploads.delete(player);
}

/** `options` (env, fetch, directory, now) are for tests; the plugin passes none. */
module.exports = function attach(api, options = {}) {
  core = api.core;
  now = options.now ?? Date.now;
  filer = createFiler({
    env: options.env ?? process.env,
    fetch: options.fetch ?? globalThis.fetch,
    directory: options.directory ?? path.join(process.cwd(), "data", "saves", "bug-reports"),
  });
  uploads.clear();
  lastReportAt.clear();
  worldReportTimes.length = 0;
  filingQueue = Promise.resolve();
  api.onCustomEvent("network:plugin-message", receiveMessage);
  api.onPlayerLogout(forgetUpload);
  api.onPlayerDisconnect(forgetUpload);
};

/** Resolves once every report accepted so far is filed (tests). */
module.exports.settled = () => filingQueue;
