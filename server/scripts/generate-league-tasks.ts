// Generates plugins/modes/data/league-tasks.json, the league task catalogs, from the OSRS Wiki and
// the cache.
//
//   yarn generate:league-tasks [--from <dir>] [--save <dir>] [--check]
//
// Sources (one `{{TRLTaskRow|...}}` / `{{RELTaskRow|...}}` / `{{DPLTaskRow|...}}` template per task
// in the raw wikitext):
//   https://oldschool.runescape.wiki/w/Trailblazer_Reloaded_League/Tasks?action=raw  (league type 4)
//   https://oldschool.runescape.wiki/w/Raging_Echoes_League/Tasks?action=raw         (league type 5)
//   https://oldschool.runescape.wiki/w/Demonic_Pacts_League/Tasks?action=raw         (league type 6)
//
// Demonic Pacts is the league the rev 241 cache carries, so its catalog is the cache's own list:
// enum 5950's positions in order, each a row of DB table 118 with the name, description, tier, area
// and category the client shows, and the position its completion bit. Only rows marked "in this
// league" (column 34) are tasks. The Wiki's DPL rows give what the cache does not: requirements and
// whether the task awards a pact point (`pactTask`). A DPL row's Wiki id is the cache position, which
// joins the two; the cache's name wins where the Wiki spells a task differently.
//
// `--save <dir>` keeps the fetched wikitext as <dir>/<league key>.wikitext; `--from <dir>` reads those
// instead of fetching, so a run can be repeated offline; `--check` regenerates and fails when the
// committed file differs. The output is deterministic: the same inputs give an identical file.
//
// What the Wiki gives: name, description, requirements, tier, region and the Wiki's own task id. What
// the cache (rev 241) gives: the tasks its own list shows (enum 5950's rows of DB table 118
// `action`), read here for a task's category (column 35: 1 Skill, 2 Combat, 3 Quest, 4 Achievement,
// 5 Minigame, 6 Other) and for the area ids the client's area enum (3412) uses, learned by matching
// rows to Wiki rows by name. A task the cache's list does not have by name takes its category from
// the rules in `ruleCategory`, recorded as `categorySource: "rule"`. Tier points: Easy 10, Medium 40
// (Trailblazer Reloaded) / 30 (Raging Echoes), Hard 80, Elite 200, Master 400 - the Wiki rows show the
// first two and the pages' per-area totals reproduce the rest exactly; Raging Echoes' match cache enum
// 2671.
//
// Triggers (`trigger` on a task) are derived from the task name and checked before they are written:
// a kill only when the cache has an NPC of that exact name, a quest only when plugins/quests/quests
// registers that name, a level only for a known skill. Everything else stays without a trigger (listed
// in the report) and can be mapped later in plugins/modes/data/league-task-triggers.json.
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";

const OUTPUT = path.resolve(__dirname, "../plugins/modes/data/league-tasks.json");
const QUESTS_DIR = path.resolve(__dirname, "../plugins/quests/quests");
const USER_AGENT = "tsps league-tasks generator (https://github.com/RSPSApp/tsps)";
const TASK_TABLE = 118;
/** The enum the task list's scripts read (position -> row of the task table), the cache's current league. */
const TASK_ENUM = 5950;
const COLUMNS = { name: 0, description: 1, difficulty: 32, inCurrentLeague: 34, category: 35, area: 36 };
const CATEGORY = { skill: 1, combat: 2, quest: 3, achievement: 4, minigame: 5, other: 6 };
const TIERS: Record<string, number> = { easy: 1, medium: 2, hard: 3, elite: 4, master: 5 };
const TIER_NAMES = ["", "Easy", "Medium", "Hard", "Elite", "Master"];
/** The Wiki's region names to the client's area enum (3412) names; General is the Global area 0. */
const REGION_AREA_NAMES: Record<string, string> = {
  General: "Global", Misthalin: "Misthalin", Karamja: "Karamja", Asgarnia: "Asgarnia", Kandarin: "Kandarin",
  Morytania: "Morytania", Desert: "Kharidian Desert", Tirannwn: "Tirannwn", Fremennik: "Fremennik Province",
  Wilderness: "Wilderness", Kourend: "Kourend & Kebos", Varlamore: "Varlamore",
};
const AREA_ENUM = 3412;
/** Wiki skill names to the server's Skill constants. */
const SKILLS: Record<string, string> = {
  attack: "ATTACK", defence: "DEFENCE", strength: "STRENGTH", hitpoints: "HITPOINTS", ranged: "RANGED", prayer: "PRAYER",
  magic: "MAGIC", cooking: "COOKING", woodcutting: "WOODCUTTING", fletching: "FLETCHING", fishing: "FISHING",
  firemaking: "FIREMAKING", crafting: "CRAFTING", smithing: "SMITHING", mining: "MINING", herblore: "HERBLORE",
  agility: "AGILITY", thieving: "THIEVING", slayer: "SLAYER", farming: "FARMING", runecraft: "RUNECRAFTING",
  runecrafting: "RUNECRAFTING", construction: "CONSTRUCTION", hunter: "HUNTER", sailing: "SAILING",
};
const MINIGAMES = /Barbarian Assault|Pest Control|Castle Wars|Fishing Trawler|Trouble Brewing|Tithe Farm|Wintertodt|Tempoross|Guardians of the Rift|Gnome Restaurant|Mage Training Arena|Volcanic Mine|Soul Wars|Blast Furnace|Giants' Foundry|Mahogany Homes|Hallowed Sepulchre|Temple Trek|Rogues' Den|Agility Arena|Nightmare Zone|Shades of Mort'ton|Last Man Standing|Burthorpe Games Room|Pyramid Plunder|Sorceress's Garden|Tears of Guthix|Rat Pits|Puro-Puro|Impetuous Impulses|Shooting Star|Gnome Ball|Ranging Guild|Stealing Artefacts|Farming Contract/i;

/**
 * What the client reads for a row without the column: table 118's default for its tier, category
 * and area columns (32, 35, 36) is -1 (its config, archive 39 file 118), "in this league" (34) 0.
 * One Demonic Pacts row has no category ("Store 10k bowstrings inside a bowstring spool").
 */
const TABLE_DEFAULT = -1;
/** The enum of a tier's points the task list reads (tier -> points), the cache's current league. */
const POINTS_ENUM = 2671;

/**
 * A league's sources. `fromCache`: the cache's own task list is this league's (the current league),
 * so the tasks, their order and their tier points are read from it; `points` is then filled in.
 */
interface League { type: number; key: string; name: string; page: string; template: string; points: Record<number, number>; fromCache?: boolean }
const LEAGUES: League[] = [
  { type: 4, key: "trailblazer-reloaded", name: "Trailblazer Reloaded", page: "Trailblazer_Reloaded_League/Tasks", template: "TRLTaskRow", points: { 1: 10, 2: 40, 3: 80, 4: 200, 5: 400 } },
  { type: 5, key: "raging-echoes", name: "Raging Echoes", page: "Raging_Echoes_League/Tasks", template: "RELTaskRow", points: { 1: 10, 2: 30, 3: 80, 4: 200, 5: 400 } },
  { type: 6, key: "demonic-pacts", name: "Demonic Pacts", page: "Demonic_Pacts_League/Tasks", template: "DPLTaskRow", points: {}, fromCache: true },
];

interface WikiRow { name: string; description: string; s: string; other: string; tier: string; region: string; id: number; pactTask: boolean }
interface Trigger { kind: string; [key: string]: unknown }
interface Task {
  id: string; wikiId: number; name: string; description: string; tier: number; points: number; area: number;
  category: number; categorySource: "cache" | "rule"; requirements: string; skills: Array<{ skill: string; level: number }>;
  /** The cache's list position (its completion bit), for a league whose list is the cache's. */
  position?: number;
  /** Completing it awards a Demonic Pact point (the Wiki's `pactTask=yes`). */
  pactTask?: true;
  trigger?: Trigger;
}

// ---- wikitext -------------------------------------------------------------------------------------

/** Every `{{Template|...}}` call of that name, each split into its positional and named arguments. */
function templateCalls(wikitext: string, template: string): string[][] {
  const calls: string[][] = [];
  const marker = `{{${template}`;
  let from = 0;
  for (;;) {
    const start = wikitext.indexOf(marker, from);
    if (start < 0) break;
    const after = wikitext[start + marker.length];
    if (after !== "|" && after !== "}") { from = start + marker.length; continue; }
    let depth = 0;
    let bracket = 0;
    let argStart = start + marker.length + 1;
    const args: string[] = [];
    let i = start;
    for (; i < wikitext.length; i++) {
      const two = wikitext.slice(i, i + 2);
      if (two === "{{") { depth++; i++; continue; }
      if (two === "}}") {
        depth--;
        i++;
        if (depth === 0) { args.push(wikitext.slice(argStart, i - 1)); break; }
        continue;
      }
      if (two === "[[") { bracket++; i++; continue; }
      if (two === "]]") { bracket--; i++; continue; }
      if (wikitext[i] === "|" && depth === 1 && bracket === 0) {
        args.push(wikitext.slice(argStart, i));
        argStart = i + 1;
      }
    }
    if (depth !== 0) throw new Error(`Unterminated ${marker} at offset ${start}`);
    calls.push(args.filter((arg, index) => index > 0 || arg !== ""));
    from = i;
  }
  return calls;
}

function parseRow(args: string[]): WikiRow {
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (const arg of args) {
    const match = /^\s*([A-Za-z]+)\s*=([\s\S]*)$/.exec(arg);
    if (match && !arg.trimStart().startsWith("[[") && !arg.trimStart().startsWith("{{")) named[match[1]] = match[2].trim();
    else positional.push(arg.trim());
  }
  const id = Number(named.id);
  if (positional.length < 2 || !Number.isInteger(id)) throw new Error(`Malformed task row: ${args.join("|").slice(0, 120)}`);
  return { name: positional[0], description: positional[1], s: named.s ?? "", other: named.other ?? "", tier: (named.tier ?? "").toLowerCase(), region: named.region ?? "", id,
    pactTask: /^yes$/i.test(named.pactTask ?? "") };
}

/** Wikitext to the plain text the client shows. */
function plain(text: string): string {
  let out = text;
  for (let pass = 0; pass < 8; pass++) {
    const before = out;
    // A skill icon with a level reads "Mining 55"; a bare icon ({{SCP|Quest}}) is dropped.
    out = out.replace(/\{\{SCP\|([^|{}]+)(?:\|(\d+))?[^{}]*\}\}/gi, (_m, skill: string, level?: string) => (level ? `${/^(overall|total)$/i.test(skill.trim()) ? "Total level" : skill.trim()} ${level}` : ""));
    out = out.replace(/\{\{Coins\|([^|{}]+)[^{}]*\}\}/gi, (_m, amount: string) => { const coins = Number(amount.replace(/,/g, "")); return `${coins.toLocaleString("en-GB")} ${coins === 1 ? "coin" : "coins"}`; });
    out = out.replace(/\{\{Currency\|([^|{}]+)[^{}]*\}\}/gi, (_m, amount: string) => amount.trim());
    out = out.replace(/\{\{(?:TBR|RE)\|([^|{}]+)[^{}]*\}\}/gi, (_m, area: string) => area.trim());
    out = out.replace(/\{\{fairycode\|([^|{}]+)[^{}]*\}\}/gi, (_m, code: string) => code.trim().toUpperCase());
    out = out.replace(/\{\{(?:Map|sic|bug)\b[^{}]*\}\}/gi, "");
    out = out.replace(/\{\{[^{}|]+\}\}/g, "");
    out = out.replace(/\[\[(?:[^\]|]*)\|([^\]]*)\]\]/g, "$1");
    out = out.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\]\]/g, "$1");
    if (out === before) break;
  }
  out = out.replace(/'''?/g, "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  return out.replace(/\s+/g, " ").trim();
}

/** Wikitext to plain text that keeps each link's target ("[[Oathplate chest|chest]]" -> "Oathplate chest"), for triggers. */
function plainTargets(text: string): string {
  return plain(text.replace(/\[\[([^\]|#]*)(?:#[^\]|]*)?\|[^\]]*\]\]/g, (_m, target: string) => `[[${target}]]`));
}

function slug(text: string): string {
  return text.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function skillsOf(requirements: string): Array<{ skill: string; level: number }> {
  const skills: Array<{ skill: string; level: number }> = [];
  for (const match of requirements.matchAll(/\{\{SCP\|([A-Za-z]+)\|(\d+)/g)) {
    const skill = SKILLS[match[1].toLowerCase()];
    if (skill && !skills.some((entry) => entry.skill === skill && entry.level === Number(match[2]))) skills.push({ skill, level: Number(match[2]) });
  }
  return skills;
}

// ---- the cache ------------------------------------------------------------------------------------

interface CacheTask { category: number; area: number }

/** A row of the cache's own list, by position: what the client shows for it. */
interface CacheListRow { position: number; name: string; description: string; tier: number; area: number; category: number; inLeague: boolean }

/** The cache's own task list in position order (enum 5950 -> table 118 rows). */
function cacheList(): CacheListRow[] {
  const list: CacheListRow[] = [];
  const entries = [...CacheDefinitions.getEnumValues(TASK_ENUM).entries()].sort(([a], [b]) => a - b);
  for (const [position, rowId] of entries) {
    const row = typeof rowId === "number" ? CacheDefinitions.getDbRow(rowId) : undefined;
    if (!row || row.tableId !== TASK_TABLE) throw new Error(`Enum ${TASK_ENUM} position ${position} is not a row of table ${TASK_TABLE}`);
    const column = (id: number) => row.columns.get(id)?.[0];
    list.push({
      position, name: String(column(COLUMNS.name) ?? ""), description: String(column(COLUMNS.description) ?? ""),
      tier: Number(column(COLUMNS.difficulty) ?? TABLE_DEFAULT), area: Number(column(COLUMNS.area) ?? TABLE_DEFAULT),
      category: Number(column(COLUMNS.category) ?? TABLE_DEFAULT), inLeague: Number(column(COLUMNS.inCurrentLeague) ?? 0) === 1,
    });
  }
  return list;
}

/** The cache's tier points (enum 2671). */
function cachePoints(): Record<number, number> {
  const points: Record<number, number> = {};
  for (const [tier, value] of [...CacheDefinitions.getEnumValues(POINTS_ENUM).entries()].sort(([a], [b]) => a - b)) points[tier] = Number(value);
  for (let tier = 1; tier < TIER_NAMES.length; tier++) if (!points[tier]) throw new Error(`Enum ${POINTS_ENUM} has no points for tier ${tier}`);
  return points;
}

/** The tasks the cache's own list shows (the rows its task enum points at), by lower-cased name. */
function cacheTasks(): Map<string, CacheTask> {
  const byName = new Map<string, CacheTask>();
  for (const rowId of CacheDefinitions.getEnumValues(TASK_ENUM).values()) {
    const row = typeof rowId === "number" ? CacheDefinitions.getDbRow(rowId) : undefined;
    const name = row?.columns.get(COLUMNS.name)?.[0];
    if (!row || typeof name !== "string" || row.tableId !== TASK_TABLE) continue;
    byName.set(name.toLowerCase(), { category: Number(row.columns.get(COLUMNS.category)?.[0] ?? CATEGORY.other), area: Number(row.columns.get(COLUMNS.area)?.[0] ?? 0) });
  }
  return byName;
}

/** The client's area ids by the Wiki's region name, from the area enum's names; Kourend's two ids are settled by the cache's own rows. */
function areaIds(cache: Map<string, CacheTask>, rows: Map<League, WikiRow[]>): Record<string, number> {
  const enumNames = CacheDefinitions.getEnumValues(AREA_ENUM);
  const idsByName = new Map<string, number[]>();
  for (const [id, name] of enumNames) (idsByName.get(String(name)) ?? idsByName.set(String(name), []).get(String(name))!).push(id);
  const areas: Record<string, number> = {};
  for (const [region, areaName] of Object.entries(REGION_AREA_NAMES)) {
    const ids = idsByName.get(areaName) ?? [];
    if (ids.length === 1) { areas[region] = ids[0]; continue; }
    if (ids.length === 0) throw new Error(`The area enum ${AREA_ENUM} has no "${areaName}"`);
    const votes = new Map<number, number>();
    for (const leagueRows of rows.values()) {
      for (const row of leagueRows) {
        if (row.region !== region) continue;
        const found = cache.get(plain(row.name).toLowerCase());
        if (found && ids.includes(found.area)) votes.set(found.area, (votes.get(found.area) ?? 0) + 1);
      }
    }
    const [winner] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (winner === undefined) throw new Error(`No cache row settles which of ${ids.join("/")} is ${areaName}`);
    areas[region] = winner;
  }
  return areas;
}

function npcNames(): Map<string, string> {
  const names = new Map<string, string>();
  const count = CacheDefinitions.getCounts().npcs;
  for (let id = 0; id < count; id++) {
    const npc = CacheDefinitions.getNpc(id);
    const name = npc?.name;
    if (name && name !== "null" && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return names;
}

/** The cache's item names, by lower-cased name (the first item of each name). */
function itemNames(): Map<string, string> {
  const names = new Map<string, string>();
  const count = CacheDefinitions.getCounts().items;
  for (let id = 0; id < count; id++) {
    const name = CacheDefinitions.getItem(id)?.name;
    if (name && name !== "null" && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  }
  return names;
}

function questNames(): Map<string, string> {
  const names = new Map<string, string>();
  for (const file of fs.readdirSync(QUESTS_DIR)) {
    if (!file.endsWith(".js")) continue;
    const source = fs.readFileSync(path.join(QUESTS_DIR, file), "utf8");
    for (const match of source.matchAll(/^\s+name: "([^"]+)",?\s*$/gm)) names.set(plainName(match[1]), match[1]);
  }
  return names;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) (groups.get(key(item)) ?? groups.set(key(item), []).get(key(item))!).push(item);
  return groups;
}

const plainName = (name: string) => name.toLowerCase().replace(/^the /, "").replace(/[^a-z0-9]+/g, " ").trim();

// ---- triggers and categories ----------------------------------------------------------------------

const singulars = (name: string) => {
  const forms = [name];
  if (/ies$/.test(name)) forms.push(name.replace(/ies$/, "y"));
  if (/(ch|sh|x|s)es$/.test(name)) forms.push(name.replace(/es$/, ""));
  if (/s$/.test(name)) forms.push(name.replace(/s$/, ""));
  return forms;
};

/** The cache NPC a task names ("Moss Giant" -> "Moss giant", "Giant Mole" -> "The Giant Mole"... as the cache spells it), or null. */
function npcNamed(text: string, npcs: Map<string, string>): string | null {
  const candidates = singulars(text.replace(/,/g, "").replace(/ Boss$/i, "").trim());
  for (const form of [...candidates, ...candidates.map((form) => `The ${form}`)]) {
    const npc = npcs.get(form.toLowerCase());
    if (npc) return npc;
  }
  return null;
}

/**
 * The alternatives a kill task's description accepts, when it lists more than one: its first
 * sentence "Defeat A or B N times (combined)" / "Defeat A, B or C". Empty for a single target.
 */
function alternativesOf(description: string): string[] {
  const sentence = description.replace(/\([^)]*\)/g, "").split(/\.(?:\s|$)/)[0].trim();
  const match = /^(?:Defeat|Kill) (?:\d+ )?(?:a |an |the |some )?(.+?)(?: \d+ times)?(?: combined)?$/i.exec(sentence);
  if (!match || !/,| or /.test(match[1])) return [];
  return match[1].split(/,\s*|\s+or\s+/).map((part) => part.replace(/^(?:a |an |the )/i, "").trim()).filter(Boolean);
}

/** The cache names a trigger may name, each checked before it is written. */
interface Names { npcs: Map<string, string>; quests: Map<string, string>; items: Map<string, string> }

/** A condition in a task's description (where, how, how fast): not a plain count of the deed. */
const CONDITION = /\b(without|while|using|within|in under|with only|solo|duo|trio|wearing|wielding|less than|fewer than|must be|do not count|at once|in one|at the same time|in a row|whilst|before|after)\b/i;
/** A place in it ("in the Fremennik Province", "on Ungael", "from Stonecutter Outpost"): needs the area unlocks. */
const PLACE = /\b(in|on|at|inside|near|from|outside|under|beneath|with)\b (?:the |an? |your )?[A-Z]/;

/** The cache item a task names, trying the forms a task's wording takes ("Oak Logs", "Shrimp" -> "Shrimps"). */
function itemNamed(text: string, items: Map<string, string>, prefixes: string[] = [""]): string | null {
  const base = text.replace(/,/g, "").trim();
  const forms = [...new Set([...singulars(base), `${base}s`, `${base}es`])];
  for (const prefix of prefixes) {
    for (const form of forms) {
      const item = items.get(`${prefix}${form}`.toLowerCase());
      if (item) return item;
    }
  }
  return null;
}

/** "Mine 5 Tin Ore", "Chop Some Logs", "Cook a Trout", "Fletch 150 Iron Arrows": the count and what is named. */
function countAndSubject(rest: string): { count: number; subject: string } {
  const match = /^(?:(\d[\d,]*)\s+|a |an |the |some |any )?(.+?)(?: (\d+) times)?$/i.exec(rest.trim());
  const count = Number((match?.[1] ?? match?.[3] ?? "1").replace(/,/g, ""));
  return { count, subject: match?.[2] ?? rest };
}

/**
 * The making and gathering verbs, each with the item name forms its subject takes: a fish is caught
 * raw ("Catch a Trout" -> "Raw trout"), the rest are named as made. Whatever skill makes the item,
 * the `produce` kind counts it (docs/leagues.md, Tasks).
 */
const PRODUCE_VERBS: Record<string, string[]> = {
  catch: ["Raw ", ""], chop: [""], mine: [""], cook: [""], craft: [""], fletch: [""], smelt: [""], smith: [""],
  make: [""], create: [""], brew: [""], clean: [""], cut: [""],
};

/**
 * The league areas a task may name as its place, to the area ids the areas plugin's map uses
 * (plugins/modes/data/league-areas.json; the task list's own area enum numbers Kourend 10, the map 20).
 */
const AREA_PLACES: Array<[RegExp, string]> = [
  [/Varlamore/i, "varlamore"], [/Karamja/i, "karamja"], [/Asgarnia/i, "asgarnia"], [/Kandarin/i, "kandarin"],
  [/Morytania/i, "morytania"], [/Tirannwn/i, "tirannwn"], [/(?:the )?Wilderness/i, "wilderness"],
  [/(?:the )?Fremennik Provinces?/i, "fremennik"], [/(?:the )?(?:Kharidian )?Desert/i, "kharidian_desert"],
  [/(?:Kebos and )?Kourend(?: and Kebos)?/i, "kourend"],
];
const AREA_IDS: Map<string, number> = (() => {
  const areas = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/modes/data/league-areas.json"), "utf8")).areas;
  return new Map(Object.entries(areas).map(([id, area]: [string, any]) => [area.key, Number(id)]));
})();

/** A trailing league area ("... in the Fremennik Province", "... on Karamja underground"): its map id and the text without it. */
function leagueAreaOf(text: string): { area: number | null; text: string } {
  for (const [pattern, key] of AREA_PLACES) {
    const match = new RegExp(`\\s+(?:in|on|within) (?:the )?(?:${pattern.source})(?: underground)?\\.?$`, "i").exec(text);
    if (match) return { area: AREA_IDS.get(key) ?? null, text: text.slice(0, match.index) };
  }
  return { area: null, text };
}

function deriveTrigger(name: string, description: string, names: Names): { trigger?: Trigger; unmapped?: string } {
  const { npcs, quests, items } = names;
  let match: RegExpExecArray | null;
  if ((match = /^Reach Level (\d+) ([A-Za-z]+)$/.exec(name)) && SKILLS[match[2].toLowerCase()]) {
    return { trigger: { kind: "level", skill: SKILLS[match[2].toLowerCase()], level: Number(match[1]) } };
  }
  if (/^Achieve Your First Level Up$/i.test(name)) return { trigger: { kind: "level-up" } };
  if ((match = /^Achieve Your First Level (\d+)$/.exec(name))) {
    const excluding: string[] = [];
    const clause = /not including ([^)]*)\)/.exec(description);
    for (const word of clause?.[1].split(/,|\band\b/) ?? []) {
      const skill = SKILLS[word.trim().toLowerCase()];
      if (skill) excluding.push(skill);
    }
    return { trigger: { kind: "any-level", level: Number(match[1]), excluding } };
  }
  if ((match = /^Reach Total Level (\d+)$/.exec(name))) return { trigger: { kind: "total-level", level: Number(match[1]) } };
  if ((match = /^Reach Base Level (\d+)$/.exec(name))) return { trigger: { kind: "base-level", level: Number(match[1]) } };
  if ((match = /^Reach Combat Level (\d+)$/.exec(name))) return { trigger: { kind: "combat-level", level: Number(match[1]) } };
  if ((match = /^(?:Defeat|Kill) (\d+) (.+)$/.exec(name)) || (match = /^(?:Defeat|Kill) (?:a |an |the |some )?(.+?)(?: (\d+) [Tt]imes)?$/.exec(name))) {
    const [, first, second] = match;
    const [named, count] = /^\d+$/.test(first) ? [second, Number(first)] : [first, second ? Number(second) : 1];
    // A league area as the place ("in Varlamore", "on Karamja", "within Morytania", "in the
    // Fremennik Province", "in Varlamore underground"): a kill there, the areas' own map deciding.
    const { area, text: subject } = leagueAreaOf(named);
    if (area !== null) description = leagueAreaOf(description).text;
    // A condition in the description (where, how, how fast) is not a plain kill count: a place
    // ("in the Fremennik Province", "on Ungael") needs the area unlocks, which do not exist yet.
    // "(must be of one difficulty, normal and awakened together do not count)" is one too.
    const condition = /\b(without|while|using|within|in under|with only|solo|duo|trio|wearing|wielding|less than|fewer than|must be|do not count)\b/i;
    const place = /\b(in|on|at|inside|near|from|outside|under|beneath)\b (?:the |an? )?[A-Z]/;
    if (condition.test(description) || place.test(description.replace(subject, "")) || place.test(subject)) return { unmapped: name };
    const primary = npcNamed(subject, npcs);
    // The description may accept others for the same count: "Defeat Callisto or Artio 50 times",
    // "Defeat The Nightmare or Phosani's Nightmare 50 times combined". Every one must be a cache NPC.
    const accepted = alternativesOf(description).map((part) => npcNamed(part, npcs));
    if (accepted.some((npc) => npc === null)) return { unmapped: name };
    const names = [...new Set([primary, ...accepted].filter((npc): npc is string => npc !== null))];
    if (!names.length) return { unmapped: name };
    return { trigger: area === null ? { kind: "kill", npcs: names, count } : { kind: "kill", npcs: names, count, area } };
  }
  if ((match = /^Complete (?:the )?(.+)$/.exec(name))) {
    // "Complete the Observatory Quest" is the quest "Observatory Quest"; "Complete Gertrude's Cat quest" is "Gertrude's Cat";
    // "Complete the Vale Totems miniquest" is the miniquest "Vale Totems".
    const quest = quests.get(plainName(match[1])) ?? quests.get(plainName(match[1].replace(/ (?:[Mm]ini)?[Qq]uest$/, "")));
    if (quest) return { trigger: { kind: "quest", name: quest } };
  }
  // "Obtain 25 Million Agility XP", "... XP in a combat skill" (the description's list), "... in any
  // non-combat skill", "... in 5 non-combat skills" (excluding the description's list): experience
  // of at least that much in that many of the skills. Sailing is left out (it came after the leagues).
  if ((match = /^Obtain (\d+) Million (?:([A-Za-z]+) XP|XP in (?:an?y? |a )?(combat|non-combat) skills?|XP in (\d+) non-combat skills)$/i.exec(name))) {
    const amount = Number(match[1]) * 1_000_000;
    const every = [...new Set(Object.values(SKILLS))].filter((skill) => skill !== "SAILING");
    const listed = (text: string) => (text.split(/,\s*|\s+or\s+|\s*&\s*|\s+and\s+/).map((word) => SKILLS[word.trim().toLowerCase()]).filter(Boolean));
    if (match[2]) {
      const skill = SKILLS[match[2].toLowerCase()];
      return skill ? { trigger: { kind: "experience", skills: [skill], amount, count: 1 } } : {};
    }
    const either = /either (.+?)\.?$/i.exec(description)?.[1];
    const excluding = /excluding (.+?)\.?$/i.exec(description)?.[1];
    if (match[3]?.toLowerCase() === "combat" && either) return { trigger: { kind: "experience", skills: listed(either), amount, count: 1 } };
    const combat = excluding ? listed(excluding) : ["ATTACK", "STRENGTH", "DEFENCE", "MAGIC", "RANGED", "HITPOINTS"];
    const nonCombat = every.filter((skill) => !combat.includes(skill));
    return { trigger: { kind: "experience", skills: nonCombat, amount, count: match[4] ? Number(match[4]) : 1 } };
  }
  // "1 Easy Clue Scroll", "25 Elite Clue Scrolls": a reward casket of that tier opened.
  if ((match = /^(\d+) (Beginner|Easy|Medium|Hard|Elite|Master) Clue Scrolls?$/i.exec(name))) {
    return { trigger: { kind: "clue", tier: match[2].toLowerCase(), count: Number(match[1]) } };
  }
  // A parenthesis with a space is a remark ("(not including Agility)"); one without is part of a name ("(c)", "(kp)").
  const clean = (text: string) => text.replace(/\s*\([^)]*\s[^)]*\)/g, "").replace(/\.$/, "").trim();
  // A condition, or a group the description names ("Chop any kind of logs", "Catch any butterfly"):
  // no single item or NPC stands for it.
  if (CONDITION.test(clean(description)) || /\bany\b/i.test(clean(description))) return {};
  // The description's list: "Equip either a Saradomin Cape, a Guthix Cape or a Zamorak Cape" (any one),
  // "Equip an Archer's Ring, a Berserker Ring, a Seer's Ring and a Warrior Ring" (all at once).
  if (/^Equip /i.test(name) && (match = /^Equip (?:either )?(.+)$/i.exec(clean(description)))) {
    const list = match[1];
    const anyOf = / or /.test(list), allOf = / and /.test(list);
    if (anyOf !== allOf && /,| or | and /.test(list)) {
      const parts = list.split(/,\s*(?:or |and )?|\s+or\s+|\s+and\s+/).map((part) => part.replace(/^(?:an? |the |some |a pair of )/i, "").trim()).filter(Boolean);
      const named = parts.map((part) => itemNamed(part, items));
      if (named.length > 1 && named.every(Boolean)) return { trigger: { kind: anyOf ? "equip" : "equip-all", items: [...new Set(named as string[])] } };
    }
  }
  // "Equip a Tyras helm": the cache item worn. A group ("an Elemental Staff", "a Dragon weapon") is no item.
  if ((match = /^Equip (?:a |an |the |some |your )?(.+)$/i.exec(name))) {
    if (PLACE.test(clean(description).replace(/^Equip (?:a |an |the |some |your )?/i, "").replace(match[1], ""))) return {};
    const item = itemNamed(match[1], items);
    return item ? { trigger: { kind: "equip", items: [item] } } : {};
  }
  // "Pickpocket a knight of varlamore 20 times": the NPC's pocket picked; the description's
  // alternatives stand for the name ("Pickpocket a Citizen": "Pickpocket a Man or a Woman").
  if ((match = /^Pickpocket (.+)$/i.exec(name))) {
    const { count, subject } = countAndSubject(match[1]);
    const said = /^(?:.*?\bpickpocket) (?:an? |the )?(.+?)(?: \d+ times)?$/i.exec(clean(description))?.[1] ?? subject;
    const parts = said.split(/,\s*|\s+or\s+/).map((part) => part.replace(/^(?:an? |the )/i, "").trim()).filter(Boolean);
    if (parts.some((part) => PLACE.test(part.replace(/^[A-Z]/, "x")))) return {};
    const accepted = (parts.length > 1 ? parts : [subject]).map((part) => npcNamed(part, npcs));
    if (accepted.some((npc) => npc === null)) return {};
    return { trigger: { kind: "pickpocket", npcs: [...new Set(accepted as string[])], count } };
  }
  const verb = /^([A-Za-z]+) (.+)$/.exec(name);
  const forms = verb ? PRODUCE_VERBS[verb[1].toLowerCase()] : undefined;
  if (verb && forms) {
    const { count, subject } = countAndSubject(verb[2]);
    if (PLACE.test(subject) || PLACE.test(clean(description).split(" ").slice(1).join(" ").replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), ""))) return {};
    const lowerVerb = verb[1].toLowerCase();
    // A herb is cleaned into its clean self: "Clean 15 Grimy Tarromin" counts the Tarromin.
    const made = lowerVerb === "clean" ? subject.replace(/^Grimy /i, "") : subject;
    if (lowerVerb === "catch") {
      // A fish is caught raw; anything else caught is a creature hunted ("Catch 500 Chinchompas").
      const fish = itemNamed(made, items, ["Raw "]);
      if (fish) return { trigger: { kind: "produce", items: [fish], count } };
      const creature = npcNamed(made, npcs);
      if (creature) return { trigger: { kind: "hunt", npcs: [creature], count } };
    }
    const item = itemNamed(made, items, forms);
    return item ? { trigger: { kind: "produce", items: [item], count } } : {};
  }
  return {};
}

/**
 * A task the cache does not carry: its category from its name (ours; the Wiki has no type). The rules
 * follow how the cache files the current league's tasks: quests Quest; kills and almost every Equip
 * Combat; clue scrolls and the minigames Minigame; levels, agility courses, gathering and making Skill;
 * the rest (visits, oddities) Other.
 */
function ruleCategory(name: string, trigger?: Trigger): number {
  if (trigger?.kind === "quest") return CATEGORY.quest;
  if (trigger?.kind === "kill" || /^(Defeat|Kill|Equip) /.test(name)) return CATEGORY.combat;
  if (trigger) return CATEGORY.skill;
  if (/Clue Scrolls?|Treasure Trail/i.test(name)) return CATEGORY.minigame;
  if (/Agility Course|Rooftop|Laps? of|Slayer Task/i.test(name)) return CATEGORY.skill;
  if (MINIGAMES.test(name)) return CATEGORY.minigame;
  if (/^(Reach|Achieve|Gain|Obtain) .*(Level|XP|Experience|Points)/i.test(name)) return CATEGORY.skill;
  if (/^(Catch|Chop|Mine|Fish|Cook|Smith|Smelt|Craft|Fletch|Burn|Light|Make|Create|Brew|Clean|Pickpocket|Steal|Plant|Harvest|Cast|Enchant|Pray|Bury|Runecraft|Build|Tan|Spin|Weave|Grind|Mix|String|Obtain|Fill|Check|Gain)\b/i.test(name)) return CATEGORY.skill;
  return CATEGORY.other;
}

// ---- the cache's own league -----------------------------------------------------------------------

/**
 * The tasks of the league the cache carries, in its list's order: the cache row gives the name,
 * description, tier, area and category; the Wiki row of the same id (= position) the requirements,
 * the pact flag and the fuller description the trigger is derived from. A row the cache marks as not in this league is left out; every task must have
 * its Wiki row, and every Wiki row its task.
 */
function cacheLeagueTasks(league: League, wikiRows: WikiRow[], names: Names, report: string[]): Task[] {
  const wikiById = new Map<number, WikiRow>();
  for (const row of wikiRows) {
    if (wikiById.has(row.id)) throw new Error(`${league.key}: Wiki id ${row.id} is on two rows`);
    wikiById.set(row.id, row);
  }
  const tasks: Task[] = [];
  const renamed: string[] = [];
  const skipped: string[] = [];
  for (const row of cacheList()) {
    if (!row.inLeague) { skipped.push(`${row.position} "${row.name}"`); continue; }
    const wiki = wikiById.get(row.position);
    if (!wiki) throw new Error(`${league.key}: no Wiki row has id ${row.position} ("${row.name}")`);
    wikiById.delete(row.position);
    if (!TIER_NAMES[row.tier]) throw new Error(`${league.key}: position ${row.position} has tier ${row.tier}`);
    if (plain(wiki.name).toLowerCase() !== row.name.toLowerCase()) renamed.push(`${row.position}: Wiki "${plain(wiki.name)}", cache "${row.name}"`);
    // The trigger reads the Wiki's description, which keeps what the cache's short one drops
    // ("Reach level 10 in any skill (not including Agility and Hitpoints)"); the task shows the cache's.
    const derived = deriveTrigger(row.name, plainTargets(wiki.description), names);
    const task: Task = {
      id: slug(row.name), wikiId: wiki.id, name: row.name, description: row.description, tier: row.tier, points: league.points[row.tier],
      area: row.area, category: row.category, categorySource: "cache",
      requirements: [plain(wiki.s), plain(wiki.other)].filter(Boolean).join("; "), skills: skillsOf(wiki.s), position: row.position,
    };
    if (wiki.pactTask) task.pactTask = true;
    if (derived.trigger) task.trigger = derived.trigger;
    tasks.push(task);
  }
  if (wikiById.size) throw new Error(`${league.key}: Wiki rows with no task in the cache's list: ${[...wikiById.keys()].join(", ")}`);
  for (const [id, group] of groupBy(tasks, (task) => task.id)) {
    if (group.length > 1) throw new Error(`${league.key}: the cache names two tasks "${group[0].name}" (${id})`);
  }
  if (renamed.length) report.push(`${league.key}: named as the cache has them: ${renamed.join("; ")}`);
  if (skipped.length) report.push(`${league.key}: cache rows not in this league: ${skipped.join("; ")}`);
  return tasks;
}

function summarise(league: League, tasks: Task[], duplicateWikiIds: string[], unmapped: string[], report: string[]) {
  const perTier = TIER_NAMES.slice(1).map((label, index) => `${label} ${tasks.filter((task) => task.tier === index + 1).length}`).join(", ");
  const triggers = new Map<string, number>();
  for (const task of tasks) if (task.trigger) triggers.set(task.trigger.kind, (triggers.get(task.trigger.kind) ?? 0) + 1);
  const pacts = tasks.filter((task) => task.pactTask).length;
  report.push(`${league.name}: ${tasks.length} tasks (${perTier}); ${tasks.reduce((sum, task) => sum + task.points, 0)} points; category from cache ${tasks.filter((task) => task.categorySource === "cache").length}, by rule ${tasks.filter((task) => task.categorySource === "rule").length}${pacts ? `; pact tasks ${pacts}` : ""}`);
  report.push(`  triggers: ${[...triggers.entries()].map(([kind, count]) => `${kind} ${count}`).join(", ") || "none"}; without one ${tasks.filter((task) => !task.trigger).length}`);
  if (duplicateWikiIds.length) report.push(`  Wiki ids used twice (the Wiki's error, kept as is): ${duplicateWikiIds.join("; ")}`);
  if (unmapped.length) report.push(`  kill tasks without a matching cache NPC (${unmapped.length}): ${unmapped.join(" | ")}`);
}

// ---- main -----------------------------------------------------------------------------------------

async function wikitextOf(league: League, options: { from?: string; save?: string }): Promise<string> {
  if (options.from) return fs.readFileSync(path.join(options.from, `${league.key}.wikitext`), "utf8");
  const url = `https://oldschool.runescape.wiki/w/${league.page}?action=raw`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  if (options.save) {
    fs.mkdirSync(options.save, { recursive: true });
    fs.writeFileSync(path.join(options.save, `${league.key}.wikitext`), text);
  }
  return text;
}

function serialise(output: Record<string, unknown>): string {
  // Each task on its own line, so the file diffs by task.
  const leagues = output.leagues as Record<string, { tasks: Task[]; [key: string]: unknown }>;
  const header = JSON.stringify({ ...output, leagues: undefined }, null, 2).replace(/\n}$/, "");
  const parts: string[] = [];
  for (const [type, league] of Object.entries(leagues)) {
    const { tasks, ...rest } = league;
    const fields = JSON.stringify(rest, null, 4).replace(/^\{\n|\n\}$/g, "").split("\n").map((line) => `  ${line}`).join("\n");
    parts.push(`    "${type}": {\n${fields},\n      "tasks": [\n${tasks.map((task) => `        ${JSON.stringify(task)}`).join(",\n")}\n      ]\n    }`);
  }
  return `${header},\n  "leagues": {\n${parts.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (flag: string) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const options = { from: option("--from"), save: option("--save"), check: argv.includes("--check") };

  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const cache = cacheTasks();
  for (const league of LEAGUES) if (league.fromCache) league.points = cachePoints();
  const npcs = npcNames();
  const quests = questNames();
  const names: Names = { npcs, quests, items: itemNames() };

  const rows = new Map<League, WikiRow[]>();
  for (const league of LEAGUES) {
    const wikitext = await wikitextOf(league, options);
    rows.set(league, templateCalls(wikitext, league.template).map(parseRow));
  }
  const areas = areaIds(cache, rows);

  const output: Record<string, unknown> = {
    $comment: "Generated by server/scripts/generate-league-tasks.ts (yarn generate:league-tasks) from the OSRS Wiki's Trailblazer_Reloaded_League/Tasks, Raging_Echoes_League/Tasks and Demonic_Pacts_League/Tasks pages and the rev 241 cache; never edit by hand (docs/leagues.md, Tasks). A task's position in its league's list is its completion bit for the client (script 9470): its `position` where the league is `fromCache` (Demonic Pacts, whose list is the cache's own, in the cache's order; `pactTask` marks the tasks that award a pact point), else its index; saves hold the string ids. `category` is the cache's where the current league's task table (118) has the task by name, else a rule in the generator (`categorySource`). `points` are the league's tier points; `areas` the client's area enum (3412) ids by the Wiki's region names. `trigger` is a derived, verified award trigger (docs/leagues.md lists the kinds); tasks without one await a mapping in league-task-triggers.json.",
    points: Object.fromEntries(LEAGUES.map((league) => [league.type, league.points])),
    tiers: TIER_NAMES.slice(1),
    categories: { 1: "Skill", 2: "Combat", 3: "Quest", 4: "Achievement", 5: "Minigame", 6: "Other" },
    areas,
    leagues: {} as Record<string, unknown>,
  };

  const report: string[] = [];
  for (const league of LEAGUES) {
    const wikiRows = rows.get(league)!;
    if (league.fromCache) {
      const tasks = cacheLeagueTasks(league, wikiRows, names, report);
      (output.leagues as Record<string, unknown>)[league.type] = {
        key: league.key, name: league.name, source: `https://oldschool.runescape.wiki/w/${league.page}`, fromCache: true, tasks,
      };
      summarise(league, tasks, [], [], report);
      continue;
    }
    const tasks: Task[] = [];
    const unmapped: string[] = [];
    const seenIds = new Map<number, string>();
    const duplicateWikiIds: string[] = [];
    for (const row of wikiRows) {
      const tier = TIERS[row.tier];
      if (!tier) throw new Error(`${league.key}: unknown tier "${row.tier}" on ${row.name}`);
      if (!(row.region in areas)) throw new Error(`${league.key}: unknown region "${row.region}" on ${row.name}`);
      if (seenIds.has(row.id)) duplicateWikiIds.push(`${row.id}: "${seenIds.get(row.id)}" and "${plain(row.name)}"`);
      seenIds.set(row.id, plain(row.name));
      const name = plain(row.name);
      const description = plain(row.description);
      const derived = deriveTrigger(name, plainTargets(row.description), names);
      if (derived.unmapped) unmapped.push(derived.unmapped);
      const fromCache = cache.get(name.toLowerCase());
      const requirements = [plain(row.s), plain(row.other)].filter(Boolean).join("; ");
      const task: Task = {
        id: slug(name), wikiId: row.id, name, description, tier, points: league.points[tier], area: areas[row.region],
        category: fromCache?.category ?? ruleCategory(name, derived.trigger), categorySource: fromCache ? "cache" : "rule",
        requirements, skills: skillsOf(row.s),
      };
      if (derived.trigger) task.trigger = derived.trigger;
      tasks.push(task);
    }
    // Ids are unique within a league: a repeated name takes its area, then its Wiki id.
    const regionOf = new Map(tasks.map((task, index) => [task, wikiRows[index].region]));
    for (const [id, group] of groupBy(tasks, (task) => task.id)) {
      if (group.length < 2) continue;
      for (const task of group) task.id = `${id}-${slug(regionOf.get(task)!)}`;
      for (const [areaId, sameArea] of groupBy(group, (task) => task.id)) {
        if (sameArea.length > 1) for (const task of sameArea) task.id = `${areaId}-${task.wikiId}`;
      }
      report.push(`${league.key}: repeated name "${group[0].name}" -> ${group.map((task) => task.id).join(", ")}`);
    }
    tasks.sort((a, b) => a.tier - b.tier || a.area - b.area || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) || a.wikiId - b.wikiId);
    if (tasks.length > 1984) throw new Error(`${league.key}: ${tasks.length} tasks exceed the client's 1984 completion bits`);
    (output.leagues as Record<string, unknown>)[league.type] = {
      key: league.key, name: league.name, source: `https://oldschool.runescape.wiki/w/${league.page}`, tasks,
    };
    summarise(league, tasks, duplicateWikiIds, unmapped, report);
  }

  const text = serialise(output);
  if (options.check) {
    // The file is LF (.gitattributes); a checkout that still turned it into CRLF compares the same.
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n") : "";
    console.log(report.join("\n"));
    if (current !== text) { console.error(`${OUTPUT} differs from a fresh generation`); process.exit(1); }
    console.log(`${OUTPUT} is up to date`);
    return;
  }
  fs.writeFileSync(OUTPUT, text);
  console.log(report.join("\n"));
  console.log(`Wrote ${OUTPUT}`);
}

main().catch((error) => { console.error(error); process.exit(1); });
