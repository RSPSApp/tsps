// Builds docs/quests/README.md, the quest test status index, from every quest the server
// registers (server/plugins/quests, `registerQuest(api, { key, name })`) and the status block
// at the top of each docs/quests/<key>/README.md. A quest with no folder is untested. A run
// whose quest plugin changed after its tested commit shows as needing a recheck.
//
//   yarn docs:quests           # rewrite the index
//   yarn docs:quests --check   # exit 1 when the index is out of date
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const QUEST_PLUGINS = join(ROOT, "server", "plugins", "quests");
const DOCS = join(ROOT, "docs", "quests");
const INDEX = join(DOCS, "README.md");

const STATUSES = ["passed", "passed-with-issues", "in-progress", "failed", "untested"];
const STATUS_LABEL = {
  "passed": "✅ passed",
  "passed-with-issues": "⚠️ passed with issues",
  "in-progress": "🔄 in progress",
  "failed": "❌ failed",
  "untested": "untested",
  "needs-recheck": "🔁 needs recheck",
};

const folderOf = (key) => key.replace(/_/g, "-");

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith(".js") ? [join(dir, entry.name)] : []);
}

const literal = (text) => /^(["'])((?:\\.|(?!\1).)*)\1/.exec(text)?.[2]?.replace(/\\(.)/g, "$1");

/** A registerQuest field: a string, or a constant declared in the same file (`key: QUEST_KEY`). */
function field(source, body, name) {
  const value = new RegExp(`\\b${name}:\\s*([^,\\n}]+)`).exec(body)?.[1]?.trim() ?? "";
  if (literal(value) !== undefined) return literal(value);
  if (!/^[A-Za-z_$][\w$]*$/.test(value)) return undefined;
  const declared = new RegExp(`\\bconst\\s+${value}\\s*=\\s*(["'][^\\n]*)`).exec(source)?.[1];
  return declared ? literal(declared) : undefined;
}

/** key -> { name, file } for every registerQuest call. */
function registeredQuests() {
  const quests = new Map();
  for (const file of walk(QUEST_PLUGINS)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/registerQuest\(\s*api\s*,\s*\{/g)) {
      const body = source.slice(match.index, match.index + 800);
      const key = field(source, body, "key");
      const name = field(source, body, "name");
      if (key && name && !quests.has(key)) quests.set(key, { name, file: relative(ROOT, file) });
    }
  }
  return quests;
}

/** The `---` block at the top of a quest page, as plain `field: value` lines. */
function statusBlock(file) {
  const text = readFileSync(file, "utf8");
  const block = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!block) throw new Error(`${relative(ROOT, file)} has no status block`);
  const fields = {};
  for (const line of block[1].split("\n")) {
    const match = /^([a-z]+):\s*(.*?)\s*(#.*)?$/.exec(line);
    if (match) fields[match[1]] = match[2].replace(/^"(.*)"$/, "$1");
  }
  if (!STATUSES.includes(fields.status)) {
    throw new Error(`${relative(ROOT, file)}: status "${fields.status}" is not one of ${STATUSES.join(", ")}`);
  }
  // Open findings: list items under "## Findings" marked **open**.
  const findings = /\n## Findings\n([\s\S]*?)(\n## |$)/.exec(text)?.[1] ?? "";
  fields.open = (findings.match(/^- \*\*open\*\*/gm) ?? []).length;
  return fields;
}

/** True when the quest's plugin file changed after `commit` (unknown commits count as unchanged). */
function changedSince(commit, file) {
  if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) return false;
  try {
    execFileSync("git", ["-C", ROOT, "cat-file", "-e", `${commit}^{commit}`], { stdio: "ignore" });
    return execFileSync("git", ["-C", ROOT, "log", "--format=%h", `${commit}..HEAD`, "--", file], { encoding: "utf8" }).trim() !== "";
  } catch {
    return false;
  }
}

function build() {
  const quests = registeredQuests();
  const rows = [];
  const folders = existsSync(DOCS) ? readdirSync(DOCS, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith("_")) : [];
  const documented = new Map(folders.map((e) => [e.name, join(DOCS, e.name, "README.md")]));
  for (const folder of documented.keys()) {
    if (![...quests.keys()].some((key) => folderOf(key) === folder)) {
      throw new Error(`docs/quests/${folder} matches no registered quest key`);
    }
  }
  for (const [key, { name, file }] of quests) {
    const page = documented.get(folderOf(key));
    if (!page || !existsSync(page)) {
      rows.push({ name, status: "untested" });
      continue;
    }
    const fields = statusBlock(page);
    if (fields.key !== key) throw new Error(`docs/quests/${folderOf(key)}: key is "${fields.key}", expected "${key}"`);
    const recheck = fields.status !== "untested" && changedSince(fields.commit, file);
    rows.push({ name, link: `${folderOf(key)}/README.md`, ...fields, shown: recheck ? "needs-recheck" : fields.status });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));

  const count = (status) => rows.filter((row) => (row.shown ?? row.status) === status).length;
  const summary = [...STATUSES.filter((s) => s !== "untested"), "needs-recheck", "untested"]
    .map((status) => `${STATUS_LABEL[status]}: ${count(status)}`).join(" · ");
  const cell = (value) => (value ? String(value).replace(/\|/g, "\\|") : "");
  const table = rows.map((row) => `| ${row.link ? `[${cell(row.name)}](${row.link})` : cell(row.name)} | ${STATUS_LABEL[row.shown ?? row.status]} | `
    + `${cell(row.tested)} | ${cell(row.tester)} | ${cell(row.model)} | ${row.open ? row.open : ""} |`);
  return `<!-- Generated by scripts/quest-docs.mjs (yarn docs:quests); edit the quest pages, not this file. -->
# Quest test status

Every quest the server registers, with the latest result recorded in its page here. How to
test a quest is in [server/docs/agents/quest-testing.md](../../server/docs/agents/quest-testing.md);
how to record the result is in [_template/README.md](_template/README.md).

${rows.length} quests · ${summary}

"Needs recheck" means the quest's plugin has changed since the commit its result was proven on.

| Quest | Status | Tested | By | Model | Open findings |
| --- | --- | --- | --- | --- | --- |
${table.join("\n")}
`;
}

const output = build();
if (process.argv.includes("--check")) {
  const current = existsSync(INDEX) ? readFileSync(INDEX, "utf8") : "";
  if (current !== output) {
    console.error("docs/quests/README.md is out of date: run yarn docs:quests");
    process.exit(1);
  }
  console.log("docs/quests/README.md is up to date");
} else {
  writeFileSync(INDEX, output);
  console.log(`wrote ${relative(ROOT, INDEX)}`);
}
