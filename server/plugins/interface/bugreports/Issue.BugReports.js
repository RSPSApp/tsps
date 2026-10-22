"use strict";

// The GitHub issue a report becomes. What a developer reads first goes first: the player's
// words, the screenshot, and where and on what it happened. The long tails (client warnings,
// game messages, items) sit in collapsed sections, and everything else is in diagnostics.json.
// Player text is made inert: it can't mention anyone, link an issue or inject markup.

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 8000;
const MAX_LOG_LINES = 60;
const MAX_LOG_LINE = 400;
const MAX_MESSAGES = 25;
const RIGHTS = ["player", "moderator", "administrator", "owner", "developer"];

/**
 * At most `max` characters of `value`, counted in code points: a cut by UTF-16 units can leave
 * half an emoji, which GitHub stores as "?".
 */
function cut(value, max) {
  let end = 0;
  let kept = 0;
  for (const char of value) {
    if (kept++ === max) break;
    end += char.length;
  }
  return value.slice(0, end);
}

/** `value` if it fits in `max` characters, else its first `max - 1` and an ellipsis. */
const clip = (value, max) => (cut(value, max).length < value.length ? `${cut(value, max - 1)}…` : value);

const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 200) => (typeof value === "string" ? cut(value, max) : "");
const number = (value) => (Number.isFinite(value) ? value : undefined);

/**
 * Text that renders as typed: no HTML, Markdown links, images, code or headings, and a zero-width
 * space after `@` and `#` so a name or number never mentions anyone or links an issue. GitHub
 * still links a bare URL, with the URL as its text.
 */
function inert(value) {
  return String(value)
    .replace(/[\\`[\]|#<>&]/g, (char) =>
      char === "<" ? "&lt;" : char === ">" ? "&gt;" : char === "&" ? "&amp;" : `\\${char}`)
    .replace(/@(?=\w)/g, "@​")
    .replace(/#(?=\d)/g, "#​");
}

function quote(description) {
  return cut(description, MAX_DESCRIPTION)
    .split(/\r?\n/)
    .map((line) => `> ${inert(line)}`)
    .join("\n");
}

/** A fenced block that no backtick run inside it can close. */
function codeBlock(lines) {
  const content = lines.join("\n");
  const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${content}\n${fence}`;
}

function details(summary, body) {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
}

const plain = (value, max) => text(value, max).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function issueTitle(report) {
  const line = report.description.split(/\r?\n/).find((part) => part.trim()) ?? "Bug report";
  return clip(line.replace(/\s+/g, " ").trim().replace(/@(?=\w)/g, "@​"), MAX_TITLE);
}

const formatTile = (tile) => `${tile.x}, ${tile.y}, ${tile.z}`;
const regionOf = (tile) => ((tile.x >> 6) << 8) | (tile.y >> 6);

function clientTile(client) {
  const position = isObject(client?.player) ? client.player.position : undefined;
  if (!isObject(position)) return undefined;
  const [x, y, z] = [number(position.x), number(position.y), number(position.plane)];
  return x === undefined || y === undefined ? undefined : { x, y, z: z ?? 0 };
}

function positionCell(server, client) {
  const seen = clientTile(client);
  const tile = server?.position ?? seen;
  if (!tile) return undefined;
  let cell = `${formatTile(tile)} (region ${regionOf(tile)})`;
  if (server?.position && seen && formatTile(seen) !== formatTile(server.position)) {
    cell += `; the client showed ${formatTile(seen)}`;
  }
  return cell;
}

function areaCell(player) {
  const area = player?.area;
  if (!area) return undefined;
  return [area.name, area.plugin && area.plugin !== area.name ? `(${area.plugin})` : "", area.instance ? "instance" : ""]
    .filter(Boolean)
    .join(" ");
}

function clientCell(client) {
  const info = isObject(client?.client) ? client.client : undefined;
  if (!info) return undefined;
  const viewport = isObject(info.viewport) ? info.viewport : {};
  const size = number(viewport.width) && number(viewport.height)
    ? `${viewport.width}×${viewport.height}${number(viewport.devicePixelRatio) ? ` (DPR ${viewport.devicePixelRatio})` : ""}`
    : "";
  const fps = number(info.fps) !== undefined ? `${info.fps} fps` : "";
  return [plain(info.renderer, 40), size, fps, info.mobile === true ? "mobile" : ""].filter(Boolean).join(" · ");
}

function worldCell(world) {
  if (!world) return undefined;
  const uptime = number(world.uptimeSeconds);
  return [
    world.cache,
    world.commit ? `commit ${world.commit}` : "",
    world.members === false ? "free-to-play" : "",
    number(world.experienceMultiplier) && world.experienceMultiplier !== 1 ? `${world.experienceMultiplier}x XP` : "",
    number(world.playersOnline) !== undefined ? `${world.playersOnline} online` : "",
    uptime !== undefined ? `up ${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m` : "",
  ].filter(Boolean).join(" · ");
}

function contextTable(report) {
  const player = report.server?.player;
  const rights = number(player?.rights);
  const rows = [
    ["Player", `${report.username}${rights ? ` (${RIGHTS[rights] ?? `rights ${rights}`})` : ""}`],
    ["Position", positionCell(player, report.client)],
    ["Area", areaCell(player)],
    ["Interface", number(player?.interfaceId) > 0 ? String(player.interfaceId) : undefined],
    ["Client", clientCell(report.client)],
    ["Browser", plain(report.client?.client?.userAgent, 300)],
    ["World", worldCell(report.server?.world)],
    ["Reported", report.reportedAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")],
  ].filter(([, value]) => value);
  const cell = (value) => inert(value).replace(/\r?\n/g, " ");
  return ["| | |", "| --- | --- |", ...rows.map(([name, value]) => `| ${name} | ${cell(value)} |`)].join("\n");
}

function logSection(client) {
  const logs = Array.isArray(client.logs) ? client.logs.filter(isObject) : [];
  const flagged = logs.filter((entry) => entry.level === "warn" || entry.level === "error");
  if (flagged.length === 0) {
    return `No warnings or errors in the client's console over the last 5 minutes (${logs.length} lines).`;
  }
  const shown = flagged.slice(-MAX_LOG_LINES).map((entry) => {
    const time = number(entry.time) ? new Date(entry.time).toISOString().slice(11, 23) : "";
    const line = clip(text(entry.text, MAX_LOG_LINE * 4).replace(/\s*\n\s*/g, " ⏎ "), MAX_LOG_LINE);
    return `${time} ${String(entry.level).toUpperCase().padEnd(5)} ${line}`;
  });
  const of = flagged.length > shown.length ? `the last ${shown.length} of ${flagged.length}` : `${flagged.length}`;
  return details(`Client warnings and errors, last 5 minutes (${of}; ${logs.length} lines in all)`, codeBlock(shown));
}

function messageSection(client) {
  const messages = Array.isArray(client.messages) ? client.messages.filter(isObject) : [];
  if (messages.length === 0) return "";
  const shown = messages.slice(-MAX_MESSAGES).map((message) => plain(message.text, 300));
  return details(`Recent game messages (${shown.length})`, codeBlock(shown));
}

function itemLines(items) {
  if (items.length === 0) return ["(empty)"];
  return items.map((item) =>
    `${String(item.slot).padStart(2)}: ${item.name} (${item.id})${item.amount > 1 ? ` × ${item.amount}` : ""}`);
}

function itemSection(player) {
  if (!Array.isArray(player?.inventory) || !Array.isArray(player?.equipment)) return "";
  const body = [
    `Inventory (${player.inventory.length})`,
    codeBlock(itemLines(player.inventory)),
    `Equipment (${player.equipment.length})`,
    codeBlock(itemLines(player.equipment)),
  ].join("\n\n");
  return details("Inventory and equipment, as the server had them", body);
}

/** `links` points at the screenshot and diagnostics.json, wherever they were stored. */
function issueBody(report, links) {
  const client = isObject(report.client) ? report.client : undefined;
  const sections = [
    quote(report.description),
    links.screenshot ? `![Screenshot](${links.screenshot})` : "",
    contextTable(report),
    client ? logSection(client) : "The player sent this report without diagnostics.",
    client ? messageSection(client) : "",
    client ? itemSection(report.server?.player) : "",
    links.diagnostics
      ? `Everything else is in [diagnostics.json](${links.diagnostics}): the client's console over the last ` +
        "5 minutes, its varps, and the client's and the server's view of the character."
      : "",
    "<sub>Sent with the in-game bug report (Report a Bug, ::bug).</sub>",
  ];
  return sections.filter(Boolean).join("\n\n");
}

module.exports = { issueTitle, issueBody, inert };
