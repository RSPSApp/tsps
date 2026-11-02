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
  // "Lizardmen shaman": a -men plural before its noun.
  if (/men\b/.test(name)) forms.push(...forms.map((form) => form.replace(/men\b/, "man")));
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
interface Names { npcs: Map<string, string>; quests: Map<string, string>; items: Map<string, string>; homes?: Map<string, string[]>; sets?: Map<string, string[][]>; npcIds?: Map<string, number[]>; subjects?: Map<string, string[]> }

/** A condition in a task's description (where, how, how fast): not a plain count of the deed. */
const CONDITION = /\b(without|while|using|within|in under|with only|solo|duo|trio|wearing|wielding|less than|fewer than|must be|do not count|at once|in one|at the same time|in a row|whilst|before|after)\b/i;
/** A place in it ("in the Fremennik Province", "on Ungael", "from Stonecutter Outpost"): needs the area unlocks. */
const PLACE = /\b(in|on|at|inside|near|from|outside|under|beneath|with)\b (?:the |an? |your )?[A-Z]/;

/** The cache item a task names, trying the forms a task's wording takes ("Oak Logs", "Shrimp" -> "Shrimps"). */
function itemNamed(text: string, items: Map<string, string>, prefixes: string[] = [""]): string | null {
  const base = text.replace(/,/g, "").trim();
  // The name as written first ("Raw anchovies" is an item), then its singulars and plurals.
  const forms = [...new Set([base, ...singulars(base), `${base}s`, `${base}es`])];
  for (const prefix of prefixes) {
    for (const form of forms) {
      const item = items.get(`${prefix}${form}`.toLowerCase());
      if (item) return item;
    }
  }
  return null;
}

/** The server's pickable plants (plugins/objects/data/pickables.json), by lower-cased name: Wheat (its grain), Flax... */
const PICKED_CROPS: Map<string, string> = (() => {
  const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/objects/data/pickables.json"), "utf8")).pickables;
  return new Map<string, string>(data.filter((plant: any) => plant.name !== "Nettles").map((plant: any) => [plant.name.toLowerCase(), plant.name]));
})();

/**
 * Something worn, by the name a task gives it: as the cache spells it, else without the possessive's
 * apostrophe ("Seer's Ring" is the Seers ring) or with vambraces in full ("Blue d'hide vambs").
 */
function wornNamed(text: string, items: Map<string, string>): string | null {
  const forms = [text, text.replace(/'s\b/gi, "s"), text.replace(/\bvambs\b/i, "vambraces")];
  for (const form of forms) {
    const item = itemNamed(form, items);
    if (item) return item;
  }
  return null;
}

/**
 * The cache's item sets (enum 1034: set item -> an enum of its pieces, as the Grand Exchange's set
 * exchange reads them), keyed by a plain name: "ahrim's" (Ahrim's armour set), "rockshell",
 * "bloodmoon", "hueycoatlhide", "mystic" (several sets: Mystic set (light), (blue)...).
 */
let itemSets: Map<string, string[][]> | null = null;
const ITEM_SET_ENUM = 1034;
const setKey = (text: string) => text.toLowerCase().replace(/[^a-z']/g, "");
function itemSetsByName(): Map<string, string[][]> {
  if (itemSets) return itemSets;
  itemSets = new Map();
  for (const [setItem, piecesEnum] of CacheDefinitions.getEnumValues(ITEM_SET_ENUM)) {
    const name = CacheDefinitions.getItem(Number(setItem))?.name;
    if (!name) continue;
    const base = name.replace(/\s*\((?:lg|sk|light|blue|dark|dusk|f)\)$/i, "").replace(/ (?:armour |robes )?set$/i, "").replace(/ set$/i, "");
    const pieces = [...CacheDefinitions.getEnumValues(Number(piecesEnum))]
      .filter(([slot]) => Number(slot) >= 0).map(([, item]) => CacheDefinitions.getItem(Number(item))?.name).filter((piece): piece is string => !!piece);
    if (!pieces.length) continue;
    const key = setKey(base);
    itemSets.set(key, [...(itemSets.get(key) ?? []), pieces]);
  }
  return itemSets;
}

/** A set a task names ("Ahrim the Blighted's equipment", "Rockshell armour", "Blood moon armour"): its sets' pieces, or null. */
function itemSetNamed(text: string): string[][] | null {
  const base = text.replace(/,.*$/, "").replace(/^(?:the |any )/i, "").replace(/ (?:equipment|armou?r|robes|outfit|gear)(?: set)?$/i, "")
    .replace(/^([A-Z][a-z]+) the [A-Z][a-z]+'s$/, "$1's");
  return itemSetsByName().get(setKey(base)) ?? null;
}

/** A set by its Wiki page's title: its tables of pieces as the cache names them, or null when any piece is no cache item. */
function wikiSetNamed(title: string, names: Names): string[][] | null {
  const lists = names.sets?.get(title.toLowerCase());
  if (!lists?.length) return null;
  const named = lists.map((list) => list.map((piece) => names.items.get(piece.toLowerCase()) ?? null));
  if (!named.every((list) => list.length && list.every(Boolean))) return null;
  // Several tables are the one set's variants only when each shares pieces with the others (Void
  // Knight's helms with the same top, robe and gloves); Crystal armour's weapons, armour and tools
  // are three things.
  const shares = (a: Array<string | null>, b: Array<string | null>) => a.some((piece) => b.includes(piece));
  return named.every((list) => named.every((other) => shares(list, other))) ? (named as string[][]) : null;
}

/** Key chests as tasks name them -> the key chests plugin's names (their place only says where they are). */
const KEY_CHESTS: Array<[RegExp, string[]]> = [
  [/^Open the Crystal Chest in Taverley$/i, ["Crystal chest"]],
  [/^Open the Enhanced Crystal Chest in Prifddinas$/i, ["Elven Crystal Chest"]],
  [/^Open (?:\d+ of )?either Larran's Small Chest or Larran's Big Chest$/i, ["Larran's small chest", "Larran's big chest"]],
];

/** The farming plugin's crop keys (plugins/skills/farming/Data.Farming.js's rows: ["RANARR", "Ranarr seed", ...]). */
const FARMING_CROPS: Set<string> = new Set([...fs.readFileSync(path.resolve(__dirname, "../plugins/skills/farming/Data.Farming.js"), "utf8")
  .matchAll(/^\s*\["([A-Z_]+)", "[^"]*seed"/gm)].map((row) => row[1]));

/** Random events as tasks name them -> the random events plugin's kinds. */
const RANDOM_EVENTS: Array<[RegExp, string]> = [
  [/^Complete the Evil Bob random event$/i, "evilbob"], [/^Complete the Maze random event$/i, "maze"],
  [/^Complete the Pillory random event$/i, "pillory"], [/^Complete the Pinball random event$/i, "pinball"],
  [/^Complete the Prison Pete random event$/i, "prison"], [/^Complete the Surprise Exam random event$/i, "exam"],
  [/^Complete the Evil twin$/i, "eviltwin"],
];

/** Minigame completions and the monster their plugin credits for each (combat-achievements:kill). */
const MINIGAME_COMPLETIONS: Array<[RegExp, string[]]> = [
  [/^Complete The Gauntlet in Prifddinas(?: \d+ times)?$/i, ["Crystalline Hunllef"]],
  [/^Complete the Corrupted Gauntlet in Prifddinas(?: \d+ times)?$/i, ["Corrupted Hunllef"]],
  [/^Complete the TzHaar Fight Cave in Mor Ul Rek(?: \d+ times)?$/i, ["TzTok-Jad"]],
  [/^Complete the Inferno in Mor Ul Rek(?: \d+ times)?$/i, ["TzKal-Zuk"]],
  [/^Complete Tombs of Amascut on normal or Expert(?: \d+ times)?$/i, ["Tombs of Amascut", "XM: Tombs of Amascut"]],
  [/^Defeat the Moons of Peril(?: \d+ times)?$/i, ["Moons of Peril"]],
  [/^Defeat the Royal Titans(?: \d+ times)?$/i, ["Royal Titans"]],
  [/^Help the pyromancers defeat the Wintertodt(?: \d+ times)?$/i, ["Wintertodt"]],
  [/^Defeat the Doom of Mokhaiotl at any delve level$/i, ["Doom of Mokhaiotl"]],
  [/^Loot a Chest \(Barrows\) once$/i, ["Barrows"]],
];
/**
 * Deeds a content plugin emits an event of its own for, the task's name and description both
 * matching (`deed { event, items?, where?, count }`): the event, the item the event's `itemId` must be
 * (its cache name, from the match) and the values its other fields must have (`where`).
 */
const DEEDS: Array<{ name: RegExp; description: RegExp; event: string; items?: (match: RegExpExecArray) => string[]; where?: Record<string, string | number | boolean> }> = [
  // Worship.Ectofuntus: a worship made (the slime and bonemeal put in).
  { name: /^Worship the Ectofuntus$/i, description: /^Worship the Ectofuntus\.?$/i, event: "ectofuntus:worshipped" },
  // Pouches.Runecrafting: essence put into that pouch.
  { name: /^Fill an? (Large|Giant) Pouch$/i, description: /^Fill an? (Large|Giant) Pouch with Essence\.?$/i, event: "runecrafting:pouch-filled", items: (match) => [`${match[1]} pouch`] },
  // ImbuedHeart: the heart's Invigorate taking (not refused while it recovers).
  { name: /^Activate an Imbued Heart$/i, description: /^Obtain and activate an Imbued heart\.?$/i, event: "imbued-heart:invigorated" },
  // ToxicBlowpipe: those darts loaded into it ("a Blowpipe" is the toxic one, the only one darts load into).
  { name: /^Load a blowpipe with (Rune|Dragon) Darts$/i, description: /^Load an? (?:Toxic )?Blowpipe with (Rune|Dragon) Darts?s?\.?$/i, event: "toxic-blowpipe:darts-loaded", items: (match) => [`${match[1]} dart`] },
  // LootingBag: the bag's Open.
  // MagicSpellbook.changeSpellbook (an altar, a spell, a relic): the book switched to.
  { name: /^Switch to the Lunar Spellbook$/i, description: /^Switch to the Lunar Spellbook\.?$/i, event: "magic:spellbook-changed", where: { spellbook: "lunar" } },
  // The run toggle ("Turn off your [[Energy|run]]").
  { name: /^Turn off your run$/i, description: /^Turn off your (?:run|Energy)\.?$/i, event: "player:run-toggled", where: { running: false } },
  // CombatSpecial.drain: a special attack performed, with the weapon it was of.
  { name: /^Perform a Special Attack$/i, description: /^Perform any special attack\.?$/i, event: "combat-special:performed" },
  { name: /^Use the Special Attack of a Dragon Axe$/i, description: /^Use the special attack of a Dragon Axe\.?$/i, event: "combat-special:performed", items: () => ["Dragon axe"] },
  { name: /^Blow the Soulflame Horn$/i, description: /^Use the special attack of the soulflame horn\.?$/i, event: "combat-special:performed", items: () => ["Soulflame horn"] },
  // DwarfCannon's set-up: the fourth part on.
  { name: /^Set Up a Dwarf Cannon$/i, description: /^Set Up a Dwarf Multicannon\.?$/i, event: "dwarf-cannon:set-up" },
  // Farming's rake: a weed raked from a patch of that kind.
  { name: /^Rake a Flower Patch$/i, description: /^Rake a flower patch\.?$/i, event: "farming:raked", where: { patchType: "FLOWER" } },
  // Farming's compost bin: a bucket filled with its product.
  { name: /^Fill a Bucket With Supercompost$/i, description: /^Fill a Bucket with Supercompost from a Compost Bin\.?$/i, event: "farming:bin-taken", items: () => ["Supercompost"] },
  { name: /^Open a Looting Bag$/i, description: /^Open a Looting Bag\.?$/i, event: "looting-bag:opened" },
  // PrayerUnlocks: either scroll read, its prayer learnt.
  { name: /^Activate an Arcane or Dexterous Prayer Scroll$/i, description: /^Activate an Arcane prayer scroll or Dexterous prayer scroll(?: Prayer scroll)?\.?$/i, event: "prayer:scroll-read", items: () => ["Arcane prayer scroll", "Dexterous prayer scroll"] },
];
const CONDITION_IN = (text: string) => /\b(?:in less than|in under|or less|without|solo)\b/i.test(text);

/** The emotes plugin's locked emotes by slot (plugins/interface/data/emotes.json): their names. */
/** The agility shortcuts by their names (plugins/skills/data/agility-shortcuts.json: "Stepping stone (Shilo Village)"). */
const SHORTCUT_NAMES: string[] = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/skills/data/agility-shortcuts.json"), "utf8")).shortcuts.map((entry: { name?: string }) => entry.name).filter(Boolean);
const EMOTE_LOCKS: Record<string, { name?: string }> = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/interface/data/emotes.json"), "utf8")).locks;

/** The server's shops (data/definitions/shops.json): name and the names of what they stock. */
let shopList: Array<{ name: string; stock: string[] }> | null = null;
/** An item a shop of that name sells ("TzHaar-Hur-Lek's Ore and Gem Store" is each of its variants): the item and the shops' names. */
function shopItemOf(itemText: string, shopText: string, items: Map<string, string>): { item: string; shops: string[] } | null {
  shopList ??= JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/shops.json"), "utf8")).map((shop: any) => ({
    name: String(shop.name), stock: (shop.originalStock ?? []).map((entry: any) => CacheDefinitions.getItem(Number(entry.id))?.name).filter(Boolean),
  }));
  const base = (name: string) => name.replace(/\s*\([^)]*\)$/, "").replace(/\.$/, "").toLowerCase();
  const shops = shopList!.filter((shop) => base(shop.name) === shopText.toLowerCase());
  const wanted = itemNamed(itemText, items);
  if (!shops.length || !wanted) return null;
  const sold = [wanted, `${wanted} (uncharged)`].find((each) => shops.every((shop) => shop.stock.some((stocked) => stocked.toLowerCase() === each.toLowerCase())));
  return sold ? { item: shops[0].stock.find((stocked) => stocked.toLowerCase() === sold.toLowerCase())!, shops: shops.map((shop) => shop.name) } : null;
}

/** The server's prayers by plain name ("protect from melee"), from PrayerHandler's PrayerData keys. */
const PRAYER_NAMES: Map<string, string> = (() => {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/main/typescript/elvarg/game/content/PrayerHandler.ts"), "utf8");
  const names = new Map<string, string>();
  for (const [, key] of source.matchAll(/public static readonly ([A-Z_]+) = new PrayerData/g)) {
    const name = key.toLowerCase().replace(/_/g, " ");
    names.set(name, name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/ Of /g, " of ").replace(/ From /g, " from "));
  }
  return names;
})();

/** A stall by a cache loc's name ("Bakery stall"), or null. */
let stallNames: Map<string, string> | null = null;
function stallNamed(text: string): string | null {
  if (!stallNames) {
    stallNames = new Map();
    const count = CacheDefinitions.getCounts().objects;
    for (let id = 0; id < count; id++) {
      const name = CacheDefinitions.getObject(id)?.name;
      if (typeof name === "string" && /stall$/i.test(name) && !stallNames.has(name.toLowerCase())) stallNames.set(name.toLowerCase(), name);
    }
  }
  return stallNames.get(text.toLowerCase()) ?? null;
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
  catch: ["Raw ", ""], snare: [""], chop: [""], mine: [""], cook: ["", "Cooked "], craft: [""], fletch: [""], smelt: [""], smith: [""],
  make: [""], create: [""], brew: [""], clean: [""], cut: [""], spin: [""], ferment: [""],
};

/** The Combat Achievements' monsters by plain name (enum 3970: "Hueycoatl, The" is "hueycoatl"). */
let caMonsterNames: Map<string, string> | null = null;
function caMonsters(): Map<string, string> {
  if (caMonsterNames) return caMonsterNames;
  caMonsterNames = new Map();
  for (const [key, name] of CacheDefinitions.getEnumValues(CA_MONSTER_ENUM)) {
    if (Number(key) <= 0 || typeof name !== "string") continue;
    caMonsterNames.set(name.replace(/, The$/i, "").toLowerCase(), name);
  }
  return caMonsterNames;
}
const CA_MONSTER_ENUM = 3970;
/** The Combat Achievements plugin's NPCs for a monster no NPC is named after (its data/monsters.json `npcs`). */
const CA_MONSTER_NPCS: Record<string, string[]> = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/achievements/combatachievements/data/monsters.json"), "utf8")).npcs;

/** A diary's name in a task to the diaries plugin's key (plugins/achievements/diaries). */
/** Agility course names as tasks give them (without "Rooftop") -> the agility plugin's course keys. */
const AGILITY_COURSES: Array<[RegExp, string[]]> = [
  [/^al kharid$/, ["alkharid"]],
  [/^ardougne$/, ["ardougne"]],
  [/^barbarian outpost$/, ["barbarian"]],
  [/^canifis$/, ["canifis"]],
  [/^draynor(?: village)?$/, ["draynor"]],
  [/^falador$/, ["falador"]],
  [/^gnome stronghold$/, ["gnome"]],
  [/^pollnivneach$/, ["pollnivneach"]],
  [/^prifddinas$/, ["prifddinas"]],
  [/^rellekka$/, ["rellekka"]],
  [/^seers'? village$/, ["seers"]],
  [/^shayzien basic$/, ["shayzien-basic"]],
  [/^shayzien advanced$/, ["shayzien-advanced"]],
  [/^varrock$/, ["varrock"]],
  [/^werewolf$/, ["werewolf"]],
  [/^wilderness$/, ["wilderness"]],
  [/^ape atoll$/, ["ape-atoll"]],
  [/^colossal wyrm$/, ["wyrm-basic", "wyrm-advanced"]],
];

const DIARIES: Array<[RegExp, string]> = [
  [/^ardougne$/, "ardougne"], [/^desert$/, "desert"], [/^falador$/, "falador"], [/^fremennik$/, "fremennik"],
  [/^kandarin$/, "kandarin"], [/^karamja$/, "karamja"], [/^morytania$/, "morytania"], [/^wilderness$/, "wilderness"],
  [/^varrock$/, "varrock"], [/^lumbridge( (&|and) draynor)?$/, "lumbridge"], [/^western( provinces)?$/, "western"],
  [/^(kourend (&|and) kebos|kebos (&|and) kourend|kourend)$/, "kourend"],
];

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
    const match = new RegExp(`\\s+(?:anywhere )?(?:in|on|within) (?:the )?(?:${pattern.source})(?: underground)?\\.?$`, "i").exec(text);
    if (match) return { area: AREA_IDS.get(key) ?? null, text: text.slice(0, match.index) };
  }
  return { area: null, text };
}

// ---- named places ---------------------------------------------------------------------------------

/** Tiles [minX, minY, maxX, maxY], inclusive, on every plane. */
type Rect = [number, number, number, number];
/**
 * A place a task names that is no league area: a city, dungeon, guild or island. Its bounds come
 * from one source, each checked against another:
 * - `wikiPolygon`: the Wiki page's own `{{Map|mtype=polygon|...}}` outline, or its square or rectangle;
 * - `slayerArea`: the server's Slayer areas (plugins/skills/data/slayer-areas.json, by name: the
 *   Wiki's location pages, checked against the task monsters' spawns);
 * - `server`: a boundary the server's own content already keeps for it (a plugin's area), restated;
 * - `flood`: the tiles the cache's walls, fences and shores enclose around the Wiki page's map point
 *   (`centre`: the middle of its pins, where they mark the corners; `from` when the point is itself a
 *   wall), its doors and gates shut: a guild's rooms; for an island in open sea (`bbox`) the box
 *   around it, the sea between being no ground;
 *   a fill that reaches `cap` tiles has leaked out and fails the run.
 * Every place must hold one of its page's map points ({{Map}} pins and centres), or, for a page
 * whose points are its entrance only (a dungeon), every spawn of `spawns` (npc-spawns.json,
 * "Name#id").
 */
interface PlaceDef {
  key: string; names: string[]; page: string;
  wikiPolygon?: true; slayerArea?: string; server?: { rects?: Rect[]; polygon?: Array<[number, number]>; from: string }; flood?: { from?: [number, number, number]; centre?: true; cap: number; bbox?: true };
  spawns?: string[];
}
interface Place { name: string; page: string; source: string; rects: Rect[] }
/** A place is at most this many boxes: each is a zone the runtime watches every tick (docs/leagues.md, Tasks). */
const MAX_PLACE_RECTS = 192;

const PLACE_DEFS: PlaceDef[] = [
  // The Wiki's own outlines.
  // The Resource Area's pins are its fence's corners.
  { key: "resource-area", names: ["Wilderness Resource Area", "Resource Area"], page: "Resource_Area", flood: { centre: true, cap: 600 } },
  { key: "ranging-guild", names: ["Ranging Guild"], page: "Ranging_Guild", wikiPolygon: true },
  { key: "wizards-guild", names: ["Wizards' Guild"], page: "Wizards'_Guild", wikiPolygon: true },
  { key: "woodcutting-guild", names: ["Woodcutting Guild"], page: "Woodcutting_Guild", wikiPolygon: true },
  { key: "warriors-guild", names: ["Warriors' Guild", "Warriors Guild"], page: "Warriors'_Guild", wikiPolygon: true },
  { key: "hardwood-grove", names: ["Tai Bwo Wannai Hardwood Grove", "Hardwood Grove in Tai Bwo Wannai", "Hardwood Grove"], page: "Hardwood_Grove", wikiPolygon: true },
  { key: "falador", names: ["Falador"], page: "Falador", wikiPolygon: true },
  // A town's bank, its own page's outline, square or rectangle (Nardah bank's booths and the tiles before them).
  { key: "mount-quidamortem-bank", names: ["Mount Quidamortem bank"], page: "Mount_Quidamortem_bank", wikiPolygon: true },
  { key: "jatizso-bank", names: ["Jatizso bank"], page: "Jatizso_bank", wikiPolygon: true },
  { key: "nardah-bank", names: ["Nardah bank"], page: "Nardah_bank", wikiPolygon: true },
  { key: "lletya-bank", names: ["Lletya bank"], page: "Lletya_bank", wikiPolygon: true },
  { key: "neitiznot-bank", names: ["Neitiznot bank"], page: "Neitiznot_bank", wikiPolygon: true },
  // The Fortis Colosseum's lobby, under the Colosseum, round its bank chest (the Bank chest page's
  // pin for it, 1805,9501, in its wall: the box round the lobby holds it).
  { key: "fortis-colosseum-lobby", names: ["Fortis Colosseum lobby", "Fortis Colosseum bank"], page: "Bank_chest", flood: { from: [1805, 9502, 0], cap: 1500, bbox: true } },
  // The server's Slayer areas.
  { key: "taverley-dungeon", names: ["Taverley Dungeon"], page: "Taverley_Dungeon", slayerArea: "Taverley Dungeon" },
  { key: "brimhaven-dungeon", names: ["Brimhaven Dungeon"], page: "Brimhaven_Dungeon", slayerArea: "Brimhaven Dungeon", spawns: ["Wild dog#112", "Steel dragon#275"] },
  // The cache's walls around the Wiki's point.
  { key: "crafting-guild", names: ["Crafting Guild"], page: "Crafting_Guild", flood: { cap: 400 } },
  { key: "farming-guild", names: ["Farming Guild"], page: "Farming_Guild", flood: { cap: 1500 } },
  { key: "myths-guild", names: ["Myths' Guild"], page: "Myths'_Guild", flood: { from: [2457, 2848, 0], cap: 800 } },
  { key: "tree-gnome-stronghold", names: ["Tree Gnome Stronghold"], page: "Tree_Gnome_Stronghold", flood: { cap: 12000 } },
  { key: "tree-gnome-village", names: ["Tree Gnome Village"], page: "Tree_Gnome_Village_(location)", flood: { cap: 3000 } },
  { key: "darkmeyer-city", names: ["Darkmeyer"], page: "Darkmeyer", flood: { cap: 3000 } },
  { key: "necropolis", names: ["Necropolis"], page: "Necropolis", flood: { cap: 3000 } },
  { key: "sophanem", names: ["Sophanem"], page: "Sophanem", flood: { cap: 3000 } },
  { key: "piscatoris-fishing-colony", names: ["Piscatoris Fishing Colony"], page: "Piscatoris_Fishing_Colony", flood: { cap: 3000 } },
  { key: "fire-altar", names: ["Fire Altar"], page: "Fire_Altar", flood: { cap: 1000 } },
  { key: "cosmic-altar", names: ["Cosmic Altar in Zanaris", "Cosmic Altar"], page: "Cosmic_Altar", flood: { cap: 1000 } },
  { key: "keldagrim", names: ["Keldagrim"], page: "Keldagrim", server: { rects: [[2790, 10100, 2940, 10215]], from: "the Keldagrim plugin's city zone" } },
  { key: "port-phasmatys", names: ["Port Phasmatys"], page: "Port_Phasmatys", flood: { cap: 3000 } },
  { key: "lunar-isle", names: ["Lunar Isle"], page: "Lunar_Isle", flood: { cap: 8000, bbox: true } },
  { key: "slepe", names: ["Slepe"], page: "Slepe", slayerArea: "Slepe" },
  { key: "harmony-island", names: ["Harmony Island"], page: "Harmony_Island", flood: { cap: 3000, bbox: true } },
  { key: "mos-le-harmless", names: ["Mos Le'Harmless"], page: "Mos_Le'Harmless", flood: { cap: 15000, bbox: true } },
  { key: "ferox-enclave", names: ["Ferox Enclave"], page: "Ferox_Enclave", server: { polygon: require(path.resolve(__dirname, "../plugins/areas/ferox/Bounds.FeroxEnclave")).BOUNDARY, from: "the FeroxEnclave plugin's outline" } },
];

/** The places' saved Wiki pages (`--from <dir>/places`, `--save`), read before the triggers are derived. */
const placePages = new Map<string, string>();
/** The places' bounds by key, filled by `resolvePlaces`; only the places a trigger names are written. */
const places = new Map<string, Place>();

/** Every {{Map}} point on a page: its pins ("x,y" and "x:y" arguments) and its centre (x=, y=; "x:3008,y:3150"), then its location lines' pins. */
function mapPoints(wikitext: string): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const [call] of wikitext.matchAll(/\{\{Map\|[^{}]*\}\}/g)) {
    const args = call.slice(6, -2).split("|").map((arg) => arg.trim());
    const x = args.find((arg) => /^x\s*=/.test(arg)), y = args.find((arg) => /^y\s*=/.test(arg));
    if (x && y) points.push([Math.floor(Number(x.split("=")[1])), Math.floor(Number(y.split("=")[1]))]);
    for (const arg of args) {
      const pair = /^(?:x:)?(\d{3,5})(?:\.\d+)?\s*[,:]\s*(?:y:)?(\d{3,5})(?:\.\d+)?$/.exec(arg);
      if (pair) points.push([Number(pair[1]), Number(pair[2])]);
    }
  }
  // Then the pins of its location lines ({{ObjectLocLine|...|x:1805,y:9501}}: where each copy of an
  // object stands, the Bank chest page's chests).
  const lines = wikitext.replace(/\{\{((?:Object)?LocLine)[ \t]*\r?\n/g, "{{$1");
  for (const args of ["ObjectLocLine", "LocLine"].flatMap((template) => templateCalls(lines, template))) {
    for (const arg of args) {
      const pair = /^\s*x:(\d{3,5}),y:(\d{3,5})\s*$/.exec(arg);
      if (pair) points.push([Number(pair[1]), Number(pair[2])]);
    }
  }
  return points;
}

/** The page's polygon outline (`{{Map|...|mtype=polygon|x,y|...}}`), its vertices in order. */
function mapPolygon(wikitext: string): Array<[number, number]> | null {
  for (const [call] of wikitext.matchAll(/\{\{Map\|[^{}]*\}\}/g)) {
    const args = call.slice(6, -2).split("|").map((arg) => arg.trim());
    if (/mtype\s*=\s*polygon/.test(call)) {
      const vertices = args.map((arg) => /^(\d{3,5}),(\d{3,5})$/.exec(arg)).filter(Boolean).map((m) => [Number(m![1]), Number(m![2])] as [number, number]);
      if (vertices.length >= 3) return vertices;
    }
    // A square ("mtype=square|r=5", around x=, y=) or rectangle ("mtype=rectangle|rectX=6|rectY=4|2337,3807"):
    // its corners as Module:Map draws them, half the side each way of the point (an odd side one more
    // to the east or north).
    const shape = /mtype\s*=\s*(square|rectangle)\b/.exec(call)?.[1];
    if (shape) {
      const value = (name: string) => args.find((arg) => new RegExp(`^${name}\\s*=`).test(arg))?.split("=")[1].trim();
      const point = args.map((arg) => /^(\d{3,5}),(\d{3,5})$/.exec(arg)).find(Boolean);
      const [x, y] = point ? [Number(point[1]), Number(point[2])] : [Number(value("x")), Number(value("y"))];
      const r = value("r") === undefined ? undefined : Number(value("r"));
      const [rectX, rectY] = [Number(value("rectX") ?? 20), Number(value("rectY") ?? 20)];
      if (!Number.isInteger(x) || !Number.isInteger(y) || (r !== undefined && !Number.isInteger(r))) continue;
      const [halfX, halfY] = r !== undefined ? [r, r] : [Math.floor(rectX / 2), Math.floor(rectY / 2)];
      const [east, north] = [x + halfX + (r === undefined && rectX % 2 > 0 ? 1 : 0), y + halfY + (r === undefined && rectY % 2 > 0 ? 1 : 0)];
      return [[x - halfX, y - halfY], [x - halfX, north], [east, north], [east, y - halfY]];
    }
  }
  return null;
}

/** A tile in a place: in one of its boxes. */
function placeHolds(place: Place, x: number, y: number): boolean {
  return place.rects.some(([minX, minY, maxX, maxY]) => x >= minX && x <= maxX && y >= minY && y <= maxY);
}

/** A box less another: up to four boxes. */
function withoutRect(rect: Rect, other: Rect): Rect[] {
  const [minX, minY, maxX, maxY] = rect, [oMinX, oMinY, oMaxX, oMaxY] = other;
  if (oMinX > maxX || oMaxX < minX || oMinY > maxY || oMaxY < minY) return [rect];
  const parts: Rect[] = [];
  if (oMinY > minY) parts.push([minX, minY, maxX, oMinY - 1]);
  if (oMaxY < maxY) parts.push([minX, oMaxY + 1, maxX, maxY]);
  const [midMinY, midMaxY] = [Math.max(minY, oMinY), Math.min(maxY, oMaxY)];
  if (oMinX > minX) parts.push([minX, midMinY, oMinX - 1, midMaxY]);
  if (oMaxX < maxX) parts.push([oMaxX + 1, midMinY, maxX, midMaxY]);
  return parts;
}

/** The tiles whose centre an outline holds, as row runs merged into boxes. */
function polygonRects(polygon: Array<[number, number]>): Rect[] {
  const inside = (x: number, y: number) => {
    let odd = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) odd = !odd;
    }
    return odd;
  };
  const xs = polygon.map(([x]) => x), ys = polygon.map(([, y]) => y);
  const tiles: number[] = [];
  for (let y = Math.min(...ys); y <= Math.max(...ys); y++) for (let x = Math.min(...xs); x <= Math.max(...xs); x++) if (inside(x + 0.5, y + 0.5)) tiles.push(x * 65536 + y);
  return tileRects(tiles);
}

/** Tiles (x * 65536 + y) as row runs, each merged with the run of the same span below it. */
function tileRects(tiles: Iterable<number>): Rect[] {
  const rows = new Map<number, number[]>();
  for (const tile of tiles) { const x = Math.floor(tile / 65536), y = tile % 65536; (rows.get(y) ?? rows.set(y, []).get(y)!).push(x); }
  const rects: Rect[] = [];
  for (const [y, xs] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      const above = rects.find((rect) => rect[0] === xs[i] && rect[2] === xs[j] && rect[3] === y - 1);
      if (above) above[3] = y; else rects.push([xs[i], y, xs[j], y]);
      i = j + 1;
    }
  }
  return rects;
}

let collisionReady = false;
/** The tiles the cache's collision encloses around a start tile, as row runs merged into boxes. */
function floodRects(start: [number, number, number], cap: number, key: string, bbox = false): Rect[] {
  // Loaded here: the collision map is only needed for a flood-filled place.
  const { RegionManager } = require("../src/main/typescript/elvarg/game/collision/RegionManager");
  if (!collisionReady) { RegionManager.init(); collisionReady = true; }
  const loaded = new Set<number>();
  const load = (x: number, y: number) => { const square = (x >> 6) * 256 + (y >> 6); if (!loaded.has(square)) { loaded.add(square); RegionManager.loadMapFiles(x, y); } };
  const [x0, y0, z] = start;
  const seen = new Set<number>([x0 * 65536 + y0]);
  const queue: Array<[number, number]> = [[x0, y0]];
  for (let head = 0; head < queue.length; head++) {
    const [x, y] = queue[head];
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (seen.has(nx * 65536 + ny)) continue;
      load(x, y); load(nx, ny);
      if (!RegionManager.canMove(x, y, nx, ny, z, 1, 1, null)) continue;
      seen.add(nx * 65536 + ny);
      queue.push([nx, ny]);
      if (seen.size > cap) throw new Error(`place ${key}: the flood from ${start.join(",")} passed ${cap} tiles; it is not enclosed`);
    }
  }
  if (seen.size < 2) throw new Error(`place ${key}: the flood start ${start.join(",")} is a wall`);
  const xs = [...seen].map((tile) => Math.floor(tile / 65536)), ys = [...seen].map((tile) => tile % 65536);
  const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (bbox) return [[minX, minY, maxX, maxY]];
  // With what the fill surrounds (a table, a tree, a rock: tiles no one stands on, inside all the
  // same): every tile of the box no path from outside it reaches without crossing the fill.
  const outside = new Set<number>();
  const edge: Array<[number, number]> = [];
  for (let x = minX - 1; x <= maxX + 1; x++) edge.push([x, minY - 1], [x, maxY + 1]);
  for (let y = minY; y <= maxY; y++) edge.push([minX - 1, y], [maxX + 1, y]);
  for (const [x, y] of edge) outside.add(x * 65536 + y);
  for (let head = 0; head < edge.length; head++) {
    const [x, y] = edge[head];
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy, tile = nx * 65536 + ny;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || outside.has(tile) || seen.has(tile)) continue;
      outside.add(tile);
      edge.push([nx, ny]);
    }
  }
  const enclosed: number[] = [];
  for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) if (!outside.has(x * 65536 + y)) enclosed.push(x * 65536 + y);
  return tileRects(enclosed);
}

/** The spawns (npc-spawns.json) of "Name#id": [x, y]. */
let spawnList: Array<{ name: string; id: number; x: number; y: number }> | null = null;
function spawnsOf(spec: string): Array<[number, number]> {
  spawnList ??= JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/npc-spawns.json"), "utf8"));
  const [name, id] = spec.split("#");
  return spawnList!.filter((spawn) => spawn.name === name && spawn.id === Number(id)).map((spawn) => [spawn.x, spawn.y]);
}

/** Every place's bounds from its source, each checked against its page's map points or its spawns. */
function resolvePlaces() {
  const slayerAreas = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../plugins/skills/data/slayer-areas.json"), "utf8")).areas;
  for (const def of PLACE_DEFS) {
    const wikitext = placePages.get(def.page);
    if (wikitext === undefined) throw new Error(`place ${def.key}: no page ${def.page}`);
    const points = mapPoints(wikitext);
    const place: Place = { name: def.names[0], page: def.page, source: "", rects: [] };
    if (def.wikiPolygon) {
      const polygon = mapPolygon(wikitext);
      if (!polygon) throw new Error(`place ${def.key}: ${def.page} has no polygon`);
      Object.assign(place, { rects: polygonRects(polygon), source: "the Wiki's outline" });
    } else if (def.slayerArea) {
      const area = Object.values(slayerAreas).find((each: any) => each.name === def.slayerArea) as { boxes: number[][] } | undefined;
      if (!area?.boxes?.length) throw new Error(`place ${def.key}: no Slayer area ${def.slayerArea}`);
      // Less any other area's box that overlaps it (the Ogre Enclave's east edge in the Brimhaven
      // Dungeon's box): no tile is two places.
      const others = Object.values(slayerAreas).filter((each: any) => each !== area).flatMap((each: any) => each.boxes ?? []) as Rect[];
      const rects = others.reduce((kept: Rect[], other) => kept.flatMap((rect) => withoutRect(rect, other)), area.boxes.map(([minX, minY, maxX, maxY]) => [minX, minY, maxX, maxY] as Rect));
      Object.assign(place, { rects, source: `Slayer area ${def.slayerArea}` });
    } else if (def.server) {
      Object.assign(place, { rects: def.server.rects ?? polygonRects(def.server.polygon!), source: def.server.from });
    } else if (def.flood) {
      const middle = (axis: 0 | 1) => Math.floor(points.reduce((sum, point) => sum + point[axis], 0) / points.length);
      const from = def.flood.from ?? (!points.length ? null : def.flood.centre ? [middle(0), middle(1), 0] as [number, number, number] : [points[0][0], points[0][1], 0] as [number, number, number]);
      if (!from) throw new Error(`place ${def.key}: no map point to flood from`);
      // A start of our own only beside the page's point, where that is a wall.
      if (def.flood.from && !points.some(([x, y]) => Math.abs(x - from[0]) <= 3 && Math.abs(y - from[1]) <= 3)) throw new Error(`place ${def.key}: ${from.join(",")} is not by the page's point`);
      Object.assign(place, { rects: floodRects(from, def.flood.cap, def.key, def.flood.bbox), source: def.flood.bbox ? `the box round the walls and shores around ${from.join(",")}` : `the cache's walls around ${from.join(",")}` });
    }
    if (def.spawns) {
      for (const spec of def.spawns) {
        const tiles = spawnsOf(spec);
        if (!tiles.length) throw new Error(`place ${def.key}: no spawns of ${spec}`);
        const out = tiles.find(([x, y]) => !placeHolds(place, x, y));
        if (out) throw new Error(`place ${def.key}: ${spec} spawns at ${out.join(",")}, outside it`);
      }
    } else if (!points.some(([x, y]) => placeHolds(place, x, y))) {
      throw new Error(`place ${def.key}: none of ${def.page}'s map points (${points.map((p) => p.join(",")).join(" ") || "none"}) is inside it`);
    }
    if (!place.rects.length || place.rects.length > MAX_PLACE_RECTS) throw new Error(`place ${def.key}: ${place.rects.length} boxes (1 to ${MAX_PLACE_RECTS})`);
    places.set(def.key, place);
  }
}

/** A trailing place ("... in the Karuulm Slayer Dungeon", "at the Slayer Tower"): its key and the text without it. */
function placeOf(text: string): { place: string | null; text: string } {
  for (const def of PLACE_DEFS) {
    for (const name of def.names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const match = new RegExp(`\\s+(?:in|at|inside|within|on|from|around) (?:the )?${escaped}(?: \\(location\\))?(?=(?: \\d+ times)?\\.?$)`, "i").exec(text);
      if (match) return { place: def.key, text: text.slice(0, match.index) + text.slice(match.index + match[0].length) };
    }
  }
  return { place: null, text };
}

/** The place a whole name is ("the Crafting Guild", "Ferox Enclave"), or null. */
function placeNamed(text: string): string | null {
  const plainText = text.trim().replace(/^the /i, "").replace(/ \(location\)$/i, "").toLowerCase();
  return PLACE_DEFS.find((each) => each.names.some((name) => name.toLowerCase() === plainText))?.key ?? null;
}

/**
 * What a description says that is only the deed itself, not a condition: "whilst fishing" after a
 * catch, "from Essence at the Fire Altar" after a rune crafted (a rune is only crafted at its altar,
 * a Lava rune at the Fire Altar).
 */
function withoutRestatement(name: string, description: string): string {
  let text = description.replace(/\s+(?:whilst|while) fishing(?=\.?$)/i, "");
  if (/^Craft .*\bRunes?\b/i.test(name)) text = text.replace(/\s+(?:from Essence\s+)?at the [A-Za-z]+ Altar(?: \((?:Kourend|Zanaris)\))?(?=\.?$)/i, "");
  // Where something worn comes from ("Equip Amy's Saw from Mahogany Homes", "a Pearl fishing rod,
  // purchased from Alry on Molch Island", "a Golden tench, caught by aerial fishing"): no condition
  // on wearing it.
  // "Make an anti-venom potion 100 times at any dosage": a potion counts by its name, whatever its doses.
  text = text.replace(/ at any dosage(?=\.?$)/i, "");
  // "Successfully cut a red topaz": the deed is the success.
  text = text.replace(/^Successfully ([a-z])/, (_all, letter: string) => letter.toUpperCase());
  // "Help the Shayzien house by dealing with 150 Lizardmen shaman": the kills, the house's only the reason.
  text = text.replace(/^Help the [A-Z][a-z]+ [Hh]ouse by dealing with /, "Defeat ");
  // "Chop 75 Magic Logs from Magic Trees": the tree its logs come from.
  if (/^Chop /i.test(name)) text = text.replace(/ from (?:an? )?([A-Za-z]+) [Tt]rees?(?=\.?$)/, (all, kind: string) => (new RegExp(`\\b${kind}\\b`, "i").test(name) ? "" : all));
  if (/^Equip /i.test(name)) text = text.replace(/(?:,\s*(?:purchased|bought|rewarded|caught|obtained|won)\b[^.]*| (?:purchased |bought |rewarded |obtained )?from (?:the )?[A-Z][^.,]*)(?=\.?$)/, "");
  return text;
}

/** A potion by its name without doses ("Attack potion" for "Attack potion(3)"), or null. */
function potionNamed(text: string, items: Map<string, string>): string | null {
  // "Extended Antifire Potion", "Anti-venom+ Potions": the potion's own name has no "potion" in it.
  const base = text.replace(/,/g, "").trim();
  const named = potionNamedAs(base, items);
  return named ?? (/ potions?$/i.test(base) ? potionNamedAs(base.replace(/ potions?$/i, ""), items) : null);
}

function potionNamedAs(base: string, items: Map<string, string>): string | null {
  for (const form of [...new Set([...singulars(base), base])]) {
    for (const dose of ["(4)", "(3)", "(2)", "(1)"]) {
      const item = items.get(`${form}${dose}`.toLowerCase());
      if (item) return item.replace(/\(\d\)$/, "");
    }
  }
  return null;
}

/** The combat levels of the cache NPCs of a name that have an Attack option. */
let attackable: Map<string, Set<number>> | null = null;
function attackLevels(name: string): Set<number> {
  if (!attackable) {
    attackable = new Map();
    for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) {
      const npc: any = CacheDefinitions.getNpc(id);
      if (!npc?.name || !(npc.actions ?? []).includes("Attack")) continue;
      const key = npc.name.toLowerCase();
      (attackable.get(key) ?? attackable.set(key, new Set()).get(key)!).add(Number(npc.combatLevel));
    }
  }
  return attackable.get(name.toLowerCase()) ?? new Set();
}

/** A place name as two spellings of it compare: lower-cased, without "the", a parenthesis or a plural. */
const placeKey = (text: string) => text.toLowerCase().replace(/\s*\(.*$/, "").replace(/^the /, "").replace(/s$/, "").trim();

/**
 * "Defeat a X in the P" without "in the P" when every location the Wiki gives X (its page's
 * location lines) is P; otherwise unchanged.
 */
function withoutOnlyHome(description: string, homes?: Map<string, string[]>): string {
  const match = /^((?:Defeat|Kill|Slay) (?:an? |the |some |\d+ )?(.+?))\s+(?:in|on|at|inside|within|beneath|underneath|under) (?:the )?(.+?)((?: \d+ times)?\.?)$/.exec(description);
  const known = match ? homes?.get(match[2].toLowerCase()) : undefined;
  if (!match || !known?.length || !known.every((home) => placeKey(home) === placeKey(match[3]))) return description;
  // And the name is that one monster's: every cache NPC of the name one can attack is of one level
  // (the duck called "Drake" cannot be attacked).
  if (attackLevels(match[2]).size !== 1) return description;
  return `${match[1]}${match[4]}`;
}

/** SpellTeleports' teleport spells (the Normal and Ancient books): name, spellbook and runes. */
let teleportSpells: Array<{ name: string; book: string; runes: number[] }> | null = null;
function teleportSpellList() {
  if (teleportSpells) return teleportSpells;
  const { SpellTeleports } = require(path.resolve(__dirname, "../src/main/typescript/elvarg/game/content/combat/magic/SpellTeleports"));
  const { MagicSpellbook } = require(path.resolve(__dirname, "../src/main/typescript/elvarg/game/model/MagicSpellbook"));
  teleportSpells = SpellTeleports.getTeleportDestinations().map((spell: any) => ({
    name: spell.name, book: spell.spellbook === MagicSpellbook.ANCIENT ? "ancient" : spell.spellbook === MagicSpellbook.NORMAL ? "standard" : "other",
    runes: spell.runes.map((rune: any) => rune.getId()),
  }));
  return teleportSpells!;
}

/** The teleport spells a task names: "Cast X Teleport", "Teleport to X using the standard spellbook", "... that uses Law Runes". */
function teleportOf(name: string, description: string, items: Map<string, string>): string[] | null {
  const spells = teleportSpellList();
  let match: RegExpExecArray | null;
  if ((match = /^Cast (?:the )?(.+? Teleport)$/i.exec(name))) {
    const said = /^Cast the (?:spell )?(.+? Teleport)(?: spell)?$/i.exec(description)?.[1];
    const spell = spells.find((each) => each.name === match![1].toLowerCase());
    return spell && (!said || said.toLowerCase() === spell.name) ? [spell.name] : null;
  }
  if ((match = /^Teleport to (.+)$/i.exec(name)) && (match = /^Teleport to (.+?) using the (standard|ancient) spellbook$/i.exec(description))) {
    const spell = spells.find((each) => each.name === `${match![1].toLowerCase()} teleport` && each.book === match![2].toLowerCase());
    return spell ? [spell.name] : null;
  }
  if ((match = /^Cast any teleport spell that uses ([A-Za-z]+ Runes?)$/i.exec(description))) {
    const rune = items.get(match[1].replace(/s$/i, "").toLowerCase());
    if (!rune) return null;
    const id = [...Array(CacheDefinitions.getCounts().items).keys()].find((each) => CacheDefinitions.getItem(each)?.name === rune);
    const using = spells.filter((spell) => spell.runes.includes(id!)).map((spell) => spell.name);
    return using.length ? using : null;
  }
  return null;
}

function deriveTrigger(fullName: string, rawDescription: string, names: Names): { trigger?: Trigger; unmapped?: string } {
  const { npcs, quests, items, homes } = names;
  // "Successfully Cut a Red Topaz" is cutting one.
  const name = fullName.replace(/^Successfully ([a-z])/i, (_all, letter: string) => letter.toUpperCase());
  let description = withoutRestatement(name, rawDescription);
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
  // A minigame or group encounter completed, as its plugin credits it (combat-achievements:kill): the
  // Moons of Peril's chest, the Royal Titans, the Wintertodt, the Gauntlet's and the
  // Corrupted Gauntlet's Hunllef, the TzHaar Fight Cave's TzTok-Jad, the Inferno's TzKal-Zuk, Tombs of
  // Amascut's normal and expert raids. Their place only says where they are; a time or other
  // condition is left out.
  if (!CONDITION_IN(description)) {
    const completion = MINIGAME_COMPLETIONS.find(([pattern]) => pattern.test(description.replace(/\.$/, "")));
    if (completion) {
      const times = / (\d+) times$/i.exec(description.replace(/\.$/, ""));
      return { trigger: { kind: "kill", npcs: completion[1], count: times ? Number(times[1]) : 1, credited: true } };
    }
  }
  // A deed its plugin emits an event of its own for ("Worship the Ectofuntus", "Fill a Large Pouch").
  for (const deed of DEEDS) {
    const named = deed.name.exec(name);
    if (!named || !(match = deed.description.exec(description))) continue;
    const trigger: Trigger = { kind: "deed", event: deed.event, count: 1 };
    if (deed.items) {
      const listed = deed.items(match).map((each) => itemNamed(each, items));
      if (listed.some((each) => !each)) return {};
      trigger.items = listed;
    }
    if (deed.where) trigger.where = deed.where;
    return { trigger };
  }
  // "Help the Spirit Anglers defeat Tempoross": Tempoross subdued (the minigame's tempoross:subdued;
  // no NPC dies).
  if ((match = /^Help the Spirit Anglers defeat Tempoross(?: (\d+) times)?\.?$/i.exec(description))) {
    return { trigger: { kind: "tempoross", count: match[1] ? Number(match[1]) : 1 } };
  }
  // A key chest opened ("Open 15 of either Larran's Small Chest or Larran's Big Chest").
  const keyChest = KEY_CHESTS.find(([pattern]) => pattern.test(description.replace(/\.$/, "")));
  if (keyChest) {
    const times = /^Open (\d+) of /i.exec(description);
    return { trigger: { kind: "open-chest", chests: keyChest[1], count: times ? Number(times[1]) : 1 } };
  }
  // Farming: "Plant some seeds in an allotment patch" (any crop in that kind of patch), "Plant an Anima
  // Seed in the Farming Guild" (its only patch: Attas, Iasor or Kronos), "Harvest a Ranarr weed from
  // any Herb patch" (a patch of it harvested; a count of the crop is no harvest count).
  if ((match = /^Plant some seeds in an? (allotment|herb|flower|hops|bush) patch\.?$/i.exec(description))) {
    return { trigger: { kind: "plant", patches: [match[1].toUpperCase()], count: 1 } };
  }
  if (/^Plant an Anima Seed in the Farming Guild\.?$/i.test(description)) return { trigger: { kind: "plant", crops: ["ATTAS", "IASOR", "KRONOS"], count: 1 } };
  if ((match = /^Harvest an? (.+?) from any [A-Za-z]+ patch\.?$/i.exec(description))) {
    const crop = match[1].toUpperCase().replace(/ WEED$/, "").replace(/[^A-Z]+/g, "_");
    return FARMING_CROPS.has(crop) ? { trigger: { kind: "harvest", crops: [crop], count: 1 } } : {};
  }
  // Giants' Foundry: "Hand in 10 successful swords to Kovac", "Hand in a sword with at least 50 quality".
  if ((match = /^Hand in (\d+) successful swords to Kovac\.?$/i.exec(description))) return { trigger: { kind: "foundry", count: Number(match[1]) } };
  if ((match = /^Hand in a sword with at least (\d+) quality in Giants' Foundry\.?$/i.exec(description))) {
    return { trigger: { kind: "foundry", quality: Number(match[1]), count: 1 } };
  }
  // "Fully decorate a Maple totem in the Vale Totems" (the Redwood one's place is the Auburn Valley, where they stand).
  if ((match = /^Fully decorate an? ([A-Za-z]+) totem in (?:the Vale Totems|the Auburn Valley)\.?$/i.exec(description))) {
    return { trigger: { kind: "totem", woods: [match[1].toLowerCase()], count: 1 } };
  }
  // "Cast the High Level Alchemy or Low Level Alchemy spell to convert an item into 500 coins or
  // more": an alchemy paying that much (magic:alchemy-completed's coins).
  if ((match = /^Cast the (?:High|Low) Level Alchemy or (?:High|Low) Level Alchemy spell to convert an item into ([\d,]+) coins or more\.?$/i.exec(description))) {
    return { trigger: { kind: "alch", coins: Number(match[1].replace(/,/g, "")), count: 1 } };
  }
  // "Purchase a Celestial ring from Dusuri's Star Shop", "Purchase an Uncut onyx from TzHaar-Hur-Lek's
  // Ore and Gem Store": that item bought from that shop (ShopManager's shop:purchase), the shop and
  // its stock as data/definitions/shops.json has them (an item's uncharged form is the one sold).
  if (/^(?:Purchase|Buy) /i.test(name) && (match = /^(?:Purchase|Buy) (?:an? |the |some )?(.+?) from (?:an? |the )?(.+?)(?: in (?:the )?[A-Z][^.]*)?\.?$/i.exec(description))) {
    const bought = shopItemOf(match[1], match[2], items);
    if (bought) return { trigger: { kind: "buy", items: [bought.item], shops: bought.shops, count: 1 } };
  }
  // "Use the Stepping stone (Shilo Village) in Shilo Village", "Cross a Pillar (Revenant Caves) in the
  // Revenant Caves": the agility shortcut of that name crossed (the Agility plugin's agility:obstacle);
  // a name its entries tell apart ("Pillar (Revenant Caves, easy)", "medium", "hard") is any of them.
  // A place after it only restates where the shortcut is (its name's own).
  if (/\bshortcut\b|^Cross /i.test(name) && (match = /^(?:Use|Cross) (?:the |an? )?(.+? \(([^)]+)\))(?: in (?:the )?(.+?))?\.?$/i.exec(description))) {
    const [, linked, where, place] = match;
    if (place && place.replace(/ \(location\)$/i, "").toLowerCase() !== where.toLowerCase()) return {};
    const family = linked.slice(0, -1);
    const shortcuts = SHORTCUT_NAMES.filter((each) => each === linked || each.startsWith(`${family}, `));
    return shortcuts.length ? { trigger: { kind: "shortcut", shortcuts: [...new Set(shortcuts)], count: 1 } } : {};
  }
  // "Talk to any Port master", "Talk to a Gladiator (Fortis Colosseum)", "Talk to Ilfeen in Tirannwn",
  // "Pet Renu": that option done on an NPC of the name (npc:operated, once something answered it), in
  // the league area or place that follows. Every cache NPC of the name with that option must be one
  // of the linked NPC page's ids, so the name means that NPC ("(Fortis Colosseum)" its page only).
  if ((match = /^(Talk to|Pet) (.+)$/i.exec(name))) {
    const option = match[1].toLowerCase() === "pet" ? "pet" : "talk-to";
    const subjectOf = (text: string) => {
      const { area, text: unplaced } = leagueAreaOf(text.replace(/\.$/, ""));
      const spot = placeOf(unplaced);
      const said = /^(?:Talk to|Pet) (?:any |an? |the )?(.+)$/i.exec(spot.text)?.[1] ?? "";
      return { area, place: spot.place, page: said, npc: said.replace(/\s*\([^)]*\)$/, "") };
    };
    const named = subjectOf(name), said = subjectOf(description);
    if (named.area !== said.area || named.place !== said.place || PLACE.test(said.npc) || CONDITION.test(said.npc)) return {};
    const npc = npcNamed(said.npc, npcs);
    if (!npc || npc !== npcNamed(named.npc, npcs)) return {};
    const pageIds = names.npcIds?.get(said.page.toLowerCase()) ?? [];
    const ids = npcIdsWithOption(npc, option);
    if (!ids.length || ids.some((id) => !pageIds.includes(id))) return {};
    const trigger: Trigger = { kind: "npc-op", npcs: [npc], option, count: 1 };
    if (said.area !== null) trigger.area = said.area;
    if (said.place) trigger.place = said.place;
    return { trigger };
  }
  // "Use the Bank in Nardah", "Bank at Mount Quidamortem" ("Open your Bank using the Bank at Mount
  // Quidamortem"): the bank opened (bank:opened) inside that town's bank (its own page's bounds), or
  // inside the place itself where that holds one bank only ("on Lunar Isle"). Name and description must
  // name the same place.
  if ((match = /^(?:Use the )?Bank(?: Chest)? (?:at|in|on|inside) (?:the )?(.+)$/i.exec(name))) {
    const said = /^(?:Open your Bank using the Bank|Use the Bank(?: Chest)?) (?:at|in|on|inside) (?:the )?(.+?)\.?$/i.exec(description);
    if (!said || said[1].toLowerCase() !== match[1].toLowerCase()) return {};
    const place = placeNamed(`${match[1]} bank`) ?? placeNamed(match[1]);
    return place ? { trigger: { kind: "bank", place, count: 1 } } : {};
  }
  // "Obtain a bird nest whilst cutting down trees": a nest from a tree (Woodcutting's
  // woodcutting:nest-drop).
  if (/^Obtain a Bird Nest$/i.test(name) && /^Obtain an? birds? nest (?:whilst|while) cutting down trees\.?$/i.test(description)) {
    return { trigger: { kind: "bird-nest", count: 1 } };
  }
  // "Use the Fortis Salute emote": that emote performed (the emotes plugin's player:emote, by its
  // slot; the names are its locked emotes', plugins/interface/data/emotes.json).
  if ((match = /^Use the (.+) emote$/i.exec(name)) && new RegExp(`^Use the ${match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} emote\\.?$`, "i").test(description)) {
    const slot = Object.entries(EMOTE_LOCKS).find(([, lock]) => lock.name?.toLowerCase() === match![1].toLowerCase())?.[0];
    return slot === undefined ? {} : { trigger: { kind: "emote", slots: [Number(slot)], count: 1 } };
  }
  // "Complete the Theatre of Blood on normal or hard mode 25 times": raids finished in those modes
  // (the raid's tob:completed); a condition ("without any party member dying") is no count.
  if ((match = /^Complete the Theatre of Blood on (Entry|Normal|Hard)(?: [Mm]ode)?(?: or (Entry|Normal|Hard))? [Mm]ode(?: (\d+) times)?\.?$/i.exec(description))) {
    const modes = [match[1], match[2]].filter(Boolean).map((mode) => mode.toLowerCase());
    return { trigger: { kind: "tob", modes, count: match[3] ? Number(match[3]) : 1 } };
  }
  // "Guardians of the Rift 10 Rifts closed" ("Close the Rift in the Temple of the Eye 10 times"):
  // the minigame's own count of rifts closed.
  if ((match = /^Guardians of the Rift (\d+) Rifts? closed$/i.exec(name)) && /^Close the Rift in the Temple of the Eye(?: \(location\))?(?: \d+ times)?\.?$/i.test(description)) {
    const times = / (\d+) times\.?$/i.exec(description);
    if (Number(times?.[1] ?? 1) === Number(match[1])) return { trigger: { kind: "rifts", count: Number(match[1]) } };
  }
  // "Attack a dummy": any dummy hit (the attack dummies plugin's).
  if (/^Attack a dummy\.?$/i.test(description)) return { trigger: { kind: "dummy", count: 1 } };
  // A random event completed (the random events plugin's `random-events:completed`).
  // The task's own name must be that event's too: the Wiki's row for "Complete the Postie Pete random
  // event" describes the Evil twin.
  const randomEvent = RANDOM_EVENTS.find(([pattern]) => pattern.test(description.replace(/\.$/, "")));
  if (randomEvent) {
    const words = randomEvent[0].source.replace(/^\^Complete the /, "").replace(/(?: random event)?\$$/, "");
    return new RegExp(words, "i").test(name) ? { trigger: { kind: "random-event", events: [randomEvent[1]], count: 1 } } : {};
  }
  // "Complete a Hunter Rumour", "Complete 25 Hunter Rumours" ("Hunters' Rumours"): rumours handed in.
  if ((match = /^Complete (an?|\d+) Hunter(?:'?s'?)? Rumours?\.?$/i.exec(description))) {
    return { trigger: { kind: "rumours", count: /^an?$/i.test(match[1]) ? 1 : Number(match[1]) } };
  }
  // "Complete floor 3 of the Hallowed Sepulchre in Darkmeyer": that floor done.
  if ((match = /^Complete floor (\d) of the Hallowed Sepulchre in Darkmeyer\.?$/i.exec(description))) {
    return { trigger: { kind: "sepulchre-floor", floor: Number(match[1]), count: 1 } };
  }
  // "Search the Golden Chest in Room 8 of Pyramid Plunder in Sophanem [25 times]": that room's chest.
  if ((match = /^Search the Golden Chest in Room (\d) of Pyramid Plunder in Sophanem(?: (\d+) times)?\.?$/i.exec(description))) {
    return { trigger: { kind: "plunder-chest", room: Number(match[1]), count: match[2] ? Number(match[2]) : 1 } };
  }
  // "Defeat 25 Superior slayer monsters", "Defeat a Superior slayer monster": superiors killed.
  if ((match = /^Defeat (an?|\d+) Superior slayer monsters?\.?$/i.exec(description))) {
    return { trigger: { kind: "superior-kills", count: /^an?$/i.test(match[1]) ? 1 : Number(match[1]) } };
  }
  // "Defeat a Moss giant, Fire giant & Hill Giant in Kourend": one of each, in the league area that follows.
  if (/^(?:Defeat|Kill) /i.test(name) && (match = /^(?:Defeat|Kill) an? (.+?), (.+?) (?:&|and) (.+?)$/i.exec(leagueAreaOf(description.replace(/\.$/, "")).text))) {
    const each = [match[1], match[2], match[3]].map((part) => npcNamed(part.replace(/^an? /i, ""), npcs));
    if (each.every(Boolean) && new Set(each).size === 3) {
      const { area } = leagueAreaOf(description.replace(/\.$/, ""));
      const trigger: Trigger = { kind: "kill-each", npcs: Object.fromEntries(each.map((npc) => [npc!, 1])) };
      if (area !== null) trigger.area = area;
      return { trigger };
    }
  }
  // "Enter the Crafting Guild", "Visit Ferox Enclave": the player inside a place the server knows
  // the bounds of (where its guild, dungeon or island lies, "in the Kebos Lowlands", says nothing more).
  if ((match = /^(?:Enter|Visit) (.+)$/.exec(name))) {
    const said = /^(?:Enter|Visit) (.+?)(?: in (?:the )?[A-Z][A-Za-z' ]+)?\.?$/.exec(description);
    const place = placeNamed(match[1]);
    return place && said && placeNamed(said[1]) === place ? { trigger: { kind: "enter", place } } : {};
  }
  if ((match = /^(?:Defeat|Kill) (\d+) (.+)$/.exec(name)) || (match = /^(?:Defeat|Kill) (?:[Aa] |[Aa]n |[Tt]he |[Ss]ome )?(.+?)(?: (\d+) [Tt]imes?)?$/.exec(name))) {
    const [, first, second] = match;
    const [named, count] = /^\d+$/.test(first) ? [second, Number(first)] : [first, second ? Number(second) : 1];
    // A league area as the place ("in Varlamore", "on Karamja", "within Morytania", "in the
    // Fremennik Province", "in Varlamore underground"): a kill there, the areas' own map deciding.
    const fromName = leagueAreaOf(named);
    const subject = fromName.text;
    // The description may give the area the name leaves out ("Defeat Hueycoatl 1 Time": "Defeat the Hueycoatl in Varlamore").
    const fromDescription = leagueAreaOf(description.replace(/ \d+ times$/i, ""));
    const area = fromName.area ?? fromDescription.area;
    if (area !== null) description = fromDescription.text;
    // A boss in its own lair ("Defeat Vorkath on Ungael 50 times", "Sarachnis in the Forthos
    // Dungeon", "the Giant Mole beneath Falador"): the place only says where it lives. A boss is a
    // Combat Achievements monster (enum 3970), and lives in one place.
    // "the Kraken Boss" is the Kraken.
    const bossName = subject.replace(/^the /i, "").replace(/ boss$/i, "").toLowerCase();
    if (caMonsters().has(bossName)) {
      description = description.replace(/\s+(?:in|on|at|inside|beneath|under|underneath) (?:the )?[A-Z][^.]*?(?=(?: \d+ times?)?\.?$)/, "");
    }
    // A monster the Wiki has in that one place only ("Defeat a Drake in the Karuulm Slayer Dungeon":
    // every location line of its page is the dungeon) is killed there whatever the task adds.
    description = withoutOnlyHome(description, homes);
    // A named place the server knows the bounds of ("in the Warriors' Guild"): a kill there.
    const spot = placeOf(description);
    if (spot.place) description = spot.text;
    // A condition in the description (where, how, how fast) is not a plain kill count: a place
    // ("in the Fremennik Province", "on Ungael") needs the area unlocks, which do not exist yet.
    // "(must be of one difficulty, normal and awakened together do not count)" is one too.
    const condition = /\b(without|while|using|within|in under|with only|solo|duo|trio|wearing|wielding|less than|fewer than|must be|do not count)\b/i;
    const place = /\b(in|on|at|inside|near|from|outside|under|beneath)\b (?:the |an? )?[A-Z]/;
    if (condition.test(description) || place.test(description.replace(subject, "")) || place.test(subject)) return { unmapped: name };
    // A Combat Achievements monster that is no NPC of its name is the NPCs its plugin counts for it
    // ("Grotesque Guardians": Dusk, whose death ends the fight).
    const counted = caMonsters().has(bossName) ? CA_MONSTER_NPCS[caMonsters().get(bossName)!] : undefined;
    const primary = npcNamed(subject, npcs) ?? (caMonsters().has(bossName) ? npcNamed(subject.replace(/ boss$/i, ""), npcs) : null);
    if (!primary && counted?.length && counted.every((npc) => npcs.has(npc.toLowerCase())) && !alternativesOf(description).length) {
      const trigger: Trigger = area === null ? { kind: "kill", npcs: counted, count } : { kind: "kill", npcs: counted, count, area };
      if (spot.place) trigger.place = spot.place;
      return { trigger };
    }
    // The description may accept others for the same count: "Defeat Callisto or Artio 50 times",
    // "Defeat The Nightmare or Phosani's Nightmare 50 times combined". Every one must be a cache NPC.
    const accepted = alternativesOf(description).map((part) => npcNamed(part, npcs));
    if (accepted.some((npc) => npc === null)) return { unmapped: name };
    const names = [...new Set([primary, ...accepted].filter((npc): npc is string => npc !== null))];
    if (!names.length) return { unmapped: name };
    const trigger: Trigger = area === null ? { kind: "kill", npcs: names, count } : { kind: "kill", npcs: names, count, area };
    if (spot.place) trigger.place = spot.place;
    return { trigger };
  }
  if ((match = /^Complete (?:the )?(.+)$/.exec(name))) {
    // "Complete the Observatory Quest" is the quest "Observatory Quest"; "Complete Gertrude's Cat quest" is "Gertrude's Cat";
    // "Complete the Vale Totems miniquest" is the miniquest "Vale Totems".
    const quest = quests.get(plainName(match[1])) ?? quests.get(plainName(match[1].replace(/ (?:[Mm]ini)?[Qq]uest$/, "")))
      // The description may give the quest's full name the task shortens ("Complete a Ribbiting Tale").
      ?? quests.get(plainName(description.replace(/^Complete /i, "").replace(/\.$/, "")));
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
  // Combat Achievements: "Combat Achievements Easy Tier" (its points reached), "100 Combat Achievements",
  // "Complete 5 Speed Tasks", "Complete all tasks for 3 bosses", "Kraken Combat Achievements"
  // (every task of that monster; the description names it as the plugin may: "for the Giant Mole").
  if ((match = /^Combat Achievements (Easy|Medium|Hard|Elite|Master|Grandmaster) Tier$/i.exec(name))) return { trigger: { kind: "ca-tier", tier: match[1] } };
  if ((match = /^(\d+) Combat Achievements$/i.exec(name))) return { trigger: { kind: "ca-count", count: Number(match[1]) } };
  if ((match = /^Complete (\d+) Speed Tasks?$/i.exec(name))) return { trigger: { kind: "ca-count", count: Number(match[1]), type: "speed" } };
  if ((match = /^Complete all tasks for (\d+) bosse?s?$/i.exec(name))) return { trigger: { kind: "ca-bosses", count: Number(match[1]) } };
  if (/ Combat Achievements$/i.test(name) && ((match = /^Complete all of the Combat Achievements for (?:the )?(.+?)\.?$/i.exec(description))
    || (match = /^Complete all (?:of )?the (.+?)(?: Combat Achievements)?\.?$/i.exec(description)))) {
    // Only a monster the Combat Achievements list has (enum 3970); a group ("all three Dagannoth Kings") is none.
    const monster = caMonsters().get(match[1].replace(/^the /i, "").toLowerCase());
    return monster ? { trigger: { kind: "ca-boss", monster } } : {};
  }
  // "Complete the Easy Ardougne Diary", "Kourend and Kebos Hard Diary Tasks": every task of that tier
  // (the diaries plugin's keys).
  if ((match = /^(?:Complete the (Easy|Medium|Hard|Elite) (.+?) Diary|(.+?) (Easy|Medium|Hard|Elite) Diary Tasks)$/i.exec(name))) {
    const tier = (match[1] ?? match[4]).toLowerCase();
    const region = (match[2] ?? match[3]).toLowerCase();
    const diary = DIARIES.find(([pattern]) => pattern.test(region))?.[1];
    return diary ? { trigger: { kind: "diary", diary, tier } } : {};
  }
  // "Complete a lap of the Canifis Rooftop Agility Course", "Complete 10 laps of the Colossal Wyrm
  // Agility Course": laps of the agility plugin's course (either Colossal Wyrm course). A timed lap
  // ("in 1:10 or less") is not a lap count. Yama's stepping stones count each stone as a lap.
  // The description's course is its link's target ("Shayzien Agility Course" for either Shayzien
  // course), so the name's ("Complete the Shayzien Basic Agility Course") is tried after it.
  if ((match = /^Complete (a|\d+) laps? of the (.+?) Agility Course$/i.exec(description.replace(/\.$/, "")))) {
    const course = (place: string | undefined) => place && AGILITY_COURSES.find(([pattern]) => pattern.test(place.replace(/ Rooftop$/i, "").toLowerCase()))?.[1];
    const courses = course(match[2]) || course(/^Complete (?:the |\d+ laps of the )?(.+?) Agility Course$/i.exec(name)?.[1]);
    return courses ? { trigger: { kind: "agility-laps", courses, count: match[1] === "a" ? 1 : Number(match[1]) } } : {};
  }
  if ((match = /^Jump on Yama's stepping stones (\d+) times$/i.exec(name))) {
    return { trigger: { kind: "agility-laps", courses: ["yama-stepping-stones"], count: Number(match[1]) } };
  }
  // "Eat a piece of food that restores at least 6 hitpoints": any food healing that much.
  if ((match = /^Eat a piece of food that restores at least (\d+) hitpoints?$/i.exec(name))) {
    return { trigger: { kind: "eat-heal", heal: Number(match[1]) } };
  }
  // "Eat an Onion" ("Eat an Onion, raw"), "Eat a Rabbit" ("Eat a cooked rabbit"), "Drink a Strength
  // Potion": the item eaten or the potion drunk, by the description or else the name; a place
  // ("in Auburn Valley", "from a bird bath") is no item. A potion is named without its doses.
  if ((match = /^(Eat|Drink) (.+)$/i.exec(name))) {
    const kind = match[1].toLowerCase() === "eat" ? "eat" : "drink";
    const rest = description.replace(/\s*\([^)]*\s[^)]*\)/g, "").replace(/\.$/, "").trim().replace(/,.*$/, "");
    if (PLACE.test(rest) || /\bfrom\b/i.test(rest)) return {};
    const subjectOf = (text: string) => countAndSubject(text.replace(/^(?:Eat|Drink) /i, "").replace(/^(?:a cup of |a piece of |some of )/i, ""));
    const named = subjectOf(match[2]);
    const said = subjectOf(rest);
    const item = [said.subject, named.subject].map((subject) => itemNamed(subject, items) ?? itemNamed(subject, items, ["", "Cooked "]) ?? (kind === "drink" ? itemNamed(`${subject}(4)`, items) : null)).find(Boolean);
    return item ? { trigger: { kind, items: [item.replace(/\(\d\)$/, "")], count: Math.max(named.count, said.count) } } : {};
  }
  // "Obtain 15 unique Collection Log slots": that many slots filled, any category.
  if ((match = /^Obtain (\d+) unique Collection Log slots\.?$/i.exec(description))) {
    return { trigger: { kind: "collection-log", count: Number(match[1]) } };
  }
  // "Fill 15 slots in the Hard Clue section of the Collection Log", "Gain 10 unique items from
  // Reward casket (easy)": that many of the tier's Treasure Trails collection log slots filled.
  if ((match = /^Fill (\d+) slots in the (Beginner|Easy|Medium|Hard|Elite|Master) Clue section of the Collection Log\.?$/i.exec(description))
    || (match = /^Gain (an?|\d+) unique items? from (?:an? )?Reward casket \((beginner|easy|medium|hard|elite|master)\)\.?$/i.exec(description))) {
    const tier = match[2][0].toUpperCase() + match[2].slice(1).toLowerCase();
    return { trigger: { kind: "collection-log", category: `${tier} Treasure Trails`, count: /^an?$/i.test(match[1]) ? 1 : Number(match[1]) } };
  }
  // "Check the health of any fruit tree you've grown", "... of 5 Crystal Trees": a health check of a
  // grown crop of that kind (the farming plugin's crop types). A cactus is only grown in the
  // special patches and a redwood in the Farming Guild, so those places say nothing; any other
  // place ("in Lletya", "in Marcellus's Patch") is left out.
  if ((match = /^Check the health of (?:any |an? )?(\d+ )?(.+?)(?: you've grown| after growing one)?(?: in (?:Special patches|the Farming Guild))?\.?$/i.exec(description))) {
    const kind = match[2].replace(/ \(Farming\)/i, "").replace(/ you've grown$/i, "").toLowerCase();
    const types: Record<string, string> = {
      "fruit tree": "FRUIT_TREE", "tree patch": "TREE", "calquat tree": "CALQUAT", "crystal trees": "CRYSTAL_TREE",
      "crystal tree": "CRYSTAL_TREE", "redwood tree": "REDWOOD",
    };
    const count = match[1] ? Number(match[1]) : 1;
    // A cactus is the crop itself: a potato cactus, of the same kind of patch, is not one.
    if (kind === "cactus") return { trigger: { kind: "check-health", crops: ["CACTUS"], count } };
    if (/\bin\b/i.test(kind) || !types[kind]) return {};
    return { trigger: { kind: "check-health", types: [types[kind]], count } };
  }
  // "Complete 1 Slayer task", "Complete 200 Slayer Tasks": Slayer tasks done (from any master).
  if ((match = /^Complete (\d+) Slayer tasks?\.?$/i.exec(description))) return { trigger: { kind: "slayer-tasks", count: Number(match[1]) } };
  // "Complete an Easy Temple Trek": a trek of that difficulty finished.
  if ((match = /^Complete an? (Easy|Medium|Hard) Temple Trek\.?$/i.exec(description))) return { trigger: { kind: "temple-trek", difficulty: match[1].toLowerCase(), count: 1 } };
  // "Complete a game of Novice Pest Control or higher", "... of Veteran Pest Control": a game won on that boat (or a harder one).
  if ((match = /^Complete a game of (Novice|Intermediate|Veteran) Pest Control( or higher)?\.?$/i.exec(description))) {
    const boats = ["novice", "intermediate", "veteran"];
    const from = boats.indexOf(match[1].toLowerCase());
    return { trigger: { kind: "pest-control", boats: match[2] ? boats.slice(from) : [boats[from]], count: 1 } };
  }
  // "Use the Protect from Melee prayer", "Activate Smite in your prayer book": that prayer switched on.
  // A prayer this server lacks (Deadeye, Mystic Vigour) or one with a place is left out.
  if ((match = /^(?:Use|Activate) (?:the )?(.+?)(?: [Pp]rayer| in your prayer book)\.?$/.exec(description))) {
    const prayer = PRAYER_NAMES.get(match[1].toLowerCase());
    return prayer ? { trigger: { kind: "prayer", prayers: [prayer], count: 1 } } : {};
  }
  // "Obtain any Skilling Pet": a new pet of a skill's. (A boss pet is not told apart from the other
  // pets that have no skill, so "Obtain any Boss Pet" is left out.)
  if (/^Obtain any Skilling Pet\.?$/i.test(description)) return { trigger: { kind: "pet", skilling: true, count: 1 } };
  // "1 Easy Clue Scroll", "25 Elite Clue Scrolls": a reward casket of that tier opened.
  if ((match = /^(\d+) (Beginner|Easy|Medium|Hard|Elite|Master) Clue Scrolls?$/i.exec(name))) {
    return { trigger: { kind: "clue", tier: match[2].toLowerCase(), count: Number(match[1]) } };
  }
  // A parenthesis with a space is a remark ("(not including Agility)"); one without is part of a name ("(c)", "(kp)").
  const clean = (text: string) => text.replace(/\s*\([^)]*\s[^)]*\)/g, "").replace(/\.$/, "").trim();
  // "Chop any kind of logs using a steel axe", "Mine any ore using a Rune Pickaxe", "Mine some runite
  // ore with a dragon pickaxe within the Wilderness": gathered with that tool (the success event's own
  // axe or pickaxe), the item if one is named, in the league area if one follows.
  if ((match = /^(Chop|Mine) (any kind of Woodcutting|any ore|some (.+?)) (?:using|with) an? ([A-Za-z]+ (?:axe|pickaxe))$/i.exec(leagueAreaOf(clean(description)).text))) {
    const { area } = leagueAreaOf(clean(description));
    const tool = itemNamed(match[4], items);
    const what = match[3] ? itemNamed(match[3], items) : null;
    if (!tool || (match[3] && !what)) return {};
    const trigger: Trigger = { kind: "gather-with", skill: match[1].toLowerCase() === "chop" ? "woodcutting" : "mining", tools: [tool], count: 1 };
    if (what) trigger.items = [what];
    if (area !== null) trigger.area = area;
    return { trigger };
  }
  // A cache item set: "Equip a full set of Ahrim the Blighted's equipment" / "Equip full Blood moon
  // armour" (every piece at once), "Equip any piece of the Justiciar Armour set" / "a piece of
  // Sunfire Fanatic armour" (any one), "a full set of any Barrows equipment" (one whole set of them).
  if (/^Equip /i.test(name) && !/ in | while /i.test(clean(description))) {
    const said = clean(description).replace(/^Equip /i, "").replace(/,.*$/, "");
    let set: RegExpExecArray | null;
    if ((set = /^(?:a )?full (?:set of )?(?:the )?(.+)$/i.exec(said))) {
      if (/^any barrows/i.test(set[1])) {
        const barrows = ["ahrim's", "dharok's", "guthan's", "karil's", "torag's", "verac's"].map((key) => itemSetsByName().get(key)?.[0]);
        if (barrows.every(Boolean)) return { trigger: { kind: "equip-any-set", sets: barrows as string[][] } };
      }
      const sets = itemSetNamed(set[1]);
      if (sets && sets.length === 1) return { trigger: { kind: "equip-all", items: sets[0] } };
      // A set the cache has no item set for: its Wiki page's pieces, every one a cache item; one
      // table is that set, several are one set each (any of them whole).
      const listed = wikiSetNamed(set[1], names);
      if (listed?.length === 1) return { trigger: { kind: "equip-all", items: listed[0] } };
      if (listed && listed.length > 1) return { trigger: { kind: "equip-any-set", sets: listed } };
    } else if ((set = /^(?:any |a )?piece of (?:the )?(?:any )?(.+?)(?: set)?$/i.exec(said))) {
      if (/^barrows armour$/i.test(set[1])) {
        // A piece of armour: the sets' weapons (the staff, the greataxe...) are no armour.
        const barrows = ["ahrim's", "dharok's", "guthan's", "karil's", "torag's", "verac's"].flatMap((key) => itemSetsByName().get(key)?.[0] ?? [])
          .filter((piece) => !/(?:staff|greataxe|warspear|crossbow|hammers|flail)$/i.test(piece));
        if (barrows.length) return { trigger: { kind: "equip", items: [...new Set(barrows)] } };
      }
      const sets = itemSetNamed(set[1]) ?? wikiSetNamed(set[1], names);
      if (sets) return { trigger: { kind: "equip", items: [...new Set(sets.flat())] } };
    }
  }
  // "Steal some bread" ("from a bakery stall"), "Steal From a Gem Stall", "Steal from a Fur Stall in
  // Kandarin": a theft from that stall (a cache loc of the name), of that item if one is named, in
  // that league area if one follows. Any other place, or a stall the cache doesn't name, is left out.
  if (/^(?:Steal|Thieve) /i.test(name)) {
    const { area, text: unplaced } = leagueAreaOf(clean(description));
    const spot = placeOf(unplaced);
    const text = spot.text;
    const theft = /^(?:Steal|Thieve) (?:(?:some |an? |the )?(.+?) )?from (?:an? |the )?(.+? [Ss]tall)$/i.exec(text);
    if (!theft || PLACE.test(theft[2])) return {};
    const stall = stallNamed(theft[2]);
    const what = theft[1] ? (itemNamed(countAndSubject(theft[1]).subject, items) ?? itemNamed(`${countAndSubject(theft[1]).subject}s`, items)) : null;
    if (!stall || (theft[1] && !what)) return {};
    const count = countAndSubject(name.replace(/^(?:Steal|Thieve) /i, "")).count;
    const trigger: Trigger = { kind: "steal", stalls: [stall], count };
    if (what) trigger.items = [what];
    if (area !== null) trigger.area = area;
    if (spot.place) trigger.place = spot.place;
    return { trigger };
  }
  // "Pick up 10 White berries in Tirannwn", "Pick up Snape grass from Lunar Isle", "Telegrab a Bloody
  // bracer in Slepe": that ground item taken (ItemOnGroundManager's ground-items:taken, by hand or by
  // Telekinetic Grab), in the league area or place that follows.
  if ((match = /^(Pick up|Telegrab) (.+)$/i.exec(name))) {
    const { area, text: unplaced } = leagueAreaOf(clean(description));
    const spot = placeOf(unplaced);
    const taken = new RegExp(`^${match[1]} (.+)$`, "i").exec(spot.text);
    if (!taken || PLACE.test(taken[1]) || /\bfrom\b/i.test(taken[1]) || CONDITION.test(taken[1])) return {};
    const { count, subject } = countAndSubject(taken[1]);
    const item = itemNamed(subject, items);
    if (!item) return {};
    const trigger: Trigger = { kind: "take", items: [item], source: match[1].toLowerCase() === "telegrab" ? "telegrab" : "pickup", count };
    if (area !== null) trigger.area = area;
    if (spot.place) trigger.place = spot.place;
    return { trigger };
  }
  // "Pick 6 flax", "Pick some Sweetcorn from a Field": that crop picked from a field (the server's
  // pickable plants); "Pick 6 wheat, 6 cabbage, and 6 potatoes": each of them that many. A place, or
  // a plant picked elsewhere (a minigame's sq'irks, a ground item "picked up"), is left out.
  if ((match = /^Pick (?!up )(.+)$/i.exec(name))) {
    const said = clean(description).replace(/^Pick /i, "").replace(/ from an? (?:Field|[A-Za-z]+ \(scenery\))$/i, "").replace(/ from an? field$/i, "");
    if (PLACE.test(said) || CONDITION.test(said)) return {};
    const crop = (text: string) => {
      const { count, subject } = countAndSubject(text.trim());
      const lower = subject.toLowerCase();
      const item = [lower, lower.replace(/es$/, ""), lower.replace(/s$/, "")].map((form) => PICKED_CROPS.get(form)).find(Boolean);
      return item ? { item, count } : null;
    };
    const parts = said.split(/,\s*(?:and\s+)?|\s+and\s+/).filter(Boolean).map(crop);
    if (!parts.length || parts.some((part) => part === null)) return {};
    if (parts.length === 1) return { trigger: { kind: "pick", plants: [parts[0]!.item], count: parts[0]!.count } };
    return { trigger: { kind: "pick-each", plants: Object.fromEntries(parts.map((part) => [part!.item, part!.count])) } };
  }
  // "Cast Kourend Castle Teleport", "Teleport to Civitas illa Fortis" ("using the standard
  // spellbook"), "Teleport Using Law Runes" ("any teleport spell that uses Law Runes"): a teleport
  // spell that lands (spell:teleport-arrival), as SpellTeleports names its Normal and Ancient ones.
  const teleport = teleportOf(name, clean(description), items);
  if (teleport) return { trigger: { kind: "teleport", spells: teleport, count: 1 } };
  // "Cast Ice Burst" ("Cast the Ice Burst spell"), "Cast Low Level Alchemy", "Cast a Wave Spell" ("any
  // wave spell": the four): a spell whose cost is paid (magic:cast-committed). Combat spells and the
  // alchemies only, the spells the server names when they are cast; a teleport, a place ("outside
  // of the Mage Arena", "at a black dragon in Kandarin") or a condition is left out.
  if ((match = /^Cast (?:an? |the )?(.+?)(?: [Ss]pell)?$/.exec(name))) {
    const said = clean(description);
    if (PLACE.test(said.replace(/^Cast /i, "")) || /\b(?:outside|at an?)\b/i.test(said) || CONDITION.test(said)) return {};
    const tiers = ["Strike", "Bolt", "Blast", "Wave", "Surge"];
    const any = /^Cast any (strike|bolt|blast|wave|surge) spell$/i.exec(said);
    if (any) {
      const tier = tiers.find((each) => each.toLowerCase() === any[1].toLowerCase())!;
      return { trigger: { kind: "cast", spells: ["Wind", "Water", "Earth", "Fire"].map((element) => `${element} ${tier}`), count: 1 } };
    }
    const spell = match[1].replace(/^the /i, "");
    const combat = /^(?:(?:Wind|Water|Earth|Fire) (?:Strike|Bolt|Blast|Wave|Surge)|(?:Smoke|Shadow|Blood|Ice) (?:Rush|Burst|Blitz|Barrage)|Saradomin Strike|Claws of Guthix|Flames of Zamorak|Iban Blast|Magic Dart|Crumble Undead)$/i;
    const alchemy = /^(?:Low|High) Level Alchemy$/i;
    if (!combat.test(spell) && !alchemy.test(spell)) return {};
    if (!CacheDefinitions.getSpellByName(spell)) return {};
    return { trigger: { kind: "cast", spells: [spell], count: 1 } };
  }
  // "Burn 100 Willow Logs", "Burn Some Normal Logs" ("Burn some Logs"): those logs lit for a fire.
  // "Burn Some Food": anything burnt while cooking it.
  if (/^Burn Some Food$/i.test(name)) return { trigger: { kind: "burn-food", count: 1 } };
  if ((match = /^Burn (.+)$/i.exec(name))) {
    const named = countAndSubject(match[1]);
    const said = countAndSubject(clean(description).replace(/^Burn /i, ""));
    // Pyre logs go on a funeral pyre (the Shades of Mort'ton minigame), not a plain fire.
    if (CONDITION.test(clean(description)) || PLACE.test(said.subject) || /coloured|firelighter|pyre/i.test(description)) return {};
    const logs = [said.subject, named.subject].map((subject) => itemNamed(subject, items)).find((item) => item && /logs$/i.test(item));
    return logs ? { trigger: { kind: "burn", items: [logs], count: named.count } } : {};
  }
  // "Bury 6 bones" ("Bury 6 Remains of any kind"): any bones; "Bury Some Wyvern or Dragon Bones"
  // ("either some wyvern bones or some dragon bones"): any of those; a place is no plain count.
  if ((match = /^Bury (.+)$/i.exec(name))) {
    const named = countAndSubject(match[1]);
    const said = clean(description).replace(/^Bury /i, "");
    if (PLACE.test(said) || /\bnear\b/i.test(said) || CONDITION.test(said)) return {};
    if (/^(?:\d+ )?Remains of any kind$/i.test(said)) return { trigger: { kind: "bury", any: true, count: named.count } };
    const parts = said.replace(/^either /i, "").split(/\s+or\s+|,\s*/).map((part) => countAndSubject(part).subject);
    const bones = parts.map((part) => itemNamed(part, items) ?? itemNamed(`${part}s`, items));
    return bones.length && bones.every(Boolean) ? { trigger: { kind: "bury", items: [...new Set(bones as string[])], count: named.count } } : {};
  }
  // Something worn in a league area ("Equip a dark bow in Tirannwn", "a pair of dragon boots while
  // inside the Wilderness", "a leaf-bladed sword, leaf-bladed battleaxe, or leaf-bladed spear in
  // Tirannwn"): worn while there (`area`, checked as it goes on and as the player crosses into a
  // map square).
  if (/^Equip /i.test(name)) {
    const placed = leagueAreaOf(clean(description).replace(/ while (?:inside|in) /i, " in "));
    if (placed.area !== null && !/\bany\b/i.test(placed.text)) {
      const list = placed.text.replace(/^Equip (?:either )?/i, "");
      const parts = list.split(/,\s*(?:or )?|\s+or\s+/).map((part) => part.replace(/^(?:a pair of |an? |the |some )/i, "").trim()).filter(Boolean);
      const named = parts.map((part) => wornNamed(part, items));
      if (!/ and /.test(list) && named.length && named.every(Boolean)) return { trigger: { kind: "equip", items: [...new Set(named as string[])], area: placed.area } };
    }
  }
  // A condition, or a group the description names ("Chop any kind of logs", "Catch any butterfly"):
  // no single item or NPC stands for it.
  if (CONDITION.test(clean(description)) || /\bany\b/i.test(clean(description))) return {};
  // The description's list: "Equip either a Saradomin Cape, a Zamorak Cape or a Guthix Cape" (any
  // one), "Equip an Archer's Ring, a Berserker Ring, a Seer's Ring and a Warrior Ring" (all at
  // once), "Equip an Adamant Platebody, a Adamant Full Helm and either some Adamant Platelegs or an
  // Adamant Plateskirt" (all, the last either of two).
  if (/^Equip /i.test(name) && (match = /^Equip (?:either )?(.+)$/i.exec(clean(description)))) {
    const list = match[1];
    const article = (part: string) => part.replace(/^(?:a pair of |an? |the |some )/i, "").trim();
    const anyOf = / or /.test(list) && !/ and /.test(list);
    if (anyOf && /,| or /.test(list)) {
      const named = list.split(/,\s*(?:or )?|\s+or\s+/).map(article).filter(Boolean).map((part) => wornNamed(part, items));
      if (named.length > 1 && named.every(Boolean)) return { trigger: { kind: "equip", items: [...new Set(named as string[])] } };
    } else if (/ and /.test(list)) {
      const slots = list.split(/,\s*(?:and )?|\s+and\s+/).map((part) => part.trim()).filter(Boolean).map((part) => {
        const either = /^either (.+?) or (.+)$/i.exec(part);
        if (!either) return wornNamed(article(part), items);
        const options = [either[1], either[2]].map((each) => wornNamed(article(each), items));
        return options.every(Boolean) ? (options as string[]) : null;
      });
      if (slots.length > 1 && slots.every(Boolean)) return { trigger: { kind: "equip-all", items: slots as Array<string | string[]> } };
    }
  }
  // "Equip a Tyras helm": the cache item worn. A group ("an Elemental Staff", "a Dragon weapon") is no item.
  // A name the cache spells otherwise is the description's, as it stands ("Equip an Enchanted Slayer
  // Staff": "an Slayer's staff (e)"; "a pair of Dragon Claws"), or the versions its page names, any
  // one worn ("Equip the Webweaver": Webweaver bow, charged or not).
  if ((match = /^Equip (?:a |an |the |some |your )?(.+)$/i.exec(name))) {
    if (PLACE.test(clean(description).replace(/^Equip (?:a |an |the |some |your )?/i, "").replace(match[1], ""))) return {};
    const said = /^Equip (?:a pair of |an? |the |some |your )?(.+?)\.?$/i.exec(description)?.[1] ?? "";
    const item = wornNamed(match[1], items) ?? wornNamed(said, items);
    if (item) return { trigger: { kind: "equip", items: [item] } };
    const versions = names.subjects?.get(said.toLowerCase());
    return versions ? { trigger: { kind: "equip", items: versions } } : {};
  }
  // "Pickpocket an uncut diamond from a TzHaar-Hur", "Pickpocket a gnome for a King Worm",
  // "Pickpocket an elite clue scroll from a hero": that item in the pocket's loot
  // (thieving:loot); a clue scroll is its tier's scroll or scroll box, as the pocket hands either.
  if (/^Pickpocket /i.test(name) && ((match = /^Pickpocket (?:an? |some )?(.+?) from (?:an? |the )?(.+)$/i.exec(clean(description)))
    || ((match = /^Pickpocket (?:an? |the )?(.+?) for (?:an? |some )?(.+)$/i.exec(clean(description))) && (match = [match[0], match[2], match[1]] as unknown as RegExpExecArray)))) {
    const clue = /^(beginner|easy|medium|hard|elite|master) clue scroll$/i.exec(match[1]);
    const loot = clue ? [`Clue scroll (${clue[1].toLowerCase()})`, `Scroll box (${clue[1].toLowerCase()})`].map((each) => items.get(each.toLowerCase()) ?? null) : [itemNamed(match[1], items)];
    const npc = npcNamed(match[2], npcs);
    if (npc && loot.length && loot.every(Boolean)) return { trigger: { kind: "pickpocket-loot", npcs: [npc], items: loot as string[], count: 1 } };
  }
  // "Pickpocket a knight of varlamore 20 times": the NPC's pocket picked; the description's
  // alternatives stand for the name ("Pickpocket a Citizen": "Pickpocket a Man or a Woman").
  if ((match = /^Pickpocket (.+)$/i.exec(name))) {
    const { count, subject } = countAndSubject(match[1]);
    const said = /^(?:.*?\bpickpocket) (?:from )?(?:an? |the )?(.+?)(?: \d+ times)?$/i.exec(clean(description))?.[1] ?? subject;
    const parts = said.split(/,\s*|\s+or\s+/).map((part) => part.replace(/^(?:an? |the )/i, "").trim()).filter(Boolean);
    if (parts.some((part) => PLACE.test(part.replace(/^[A-Z]/, "x")))) return {};
    const accepted = (parts.length > 1 ? parts : [subject]).map((part) => npcNamed(part, npcs));
    if (accepted.some((npc) => npc === null)) return {};
    return { trigger: { kind: "pickpocket", npcs: [...new Set(accepted as string[])], count } };
  }
  const verb = /^([A-Za-z]+) (.+)$/.exec(name);
  const forms = verb ? PRODUCE_VERBS[verb[1].toLowerCase()] : undefined;
  if (verb && forms) {
    // A trailing league region ("Chop 100 Maples in Tirannwn", "Catch 50 Karambwan on Karamja") is
    // counted only there (`area`, as kill tasks); any other place is no plain count.
    // So is a named place the server has the bounds of ("Cook 20 Sharks in Darkmeyer", "Craft a
    // Lava Rune at the Fire Altar"); the name's and the description's must be the same one.
    const namedSpot = placeOf(leagueAreaOf(verb[2]).text), saidSpot = placeOf(leagueAreaOf(clean(description)).text);
    if (namedSpot.place && saidSpot.place && namedSpot.place !== saidSpot.place) return {};
    const spot = namedSpot.place ?? saidSpot.place;
    const named = { ...leagueAreaOf(verb[2]), text: namedSpot.text };
    const said = { ...leagueAreaOf(clean(description)), text: saidSpot.text };
    const area = named.area ?? said.area;
    const { count, subject } = countAndSubject(named.text);
    const lowerVerb = verb[1].toLowerCase();
    const describedSubject = countAndSubject(said.text.replace(/^[A-Za-z]+ /, "")).subject;
    const restDescription = said.text.split(" ").slice(1).join(" ");
    if (PLACE.test(subject) || PLACE.test(restDescription.replace(new RegExp(subject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), "").replace(new RegExp(describedSubject.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), ""))) return {};
    if (CONDITION.test(said.text)) return {};
    // A skill's page for the subject ("Craft some [[Crafting#Pottery|Pottery]]") is that skill's
    // products, no one item.
    if (SKILLS[describedSubject.toLowerCase()]) return {};
    const withArea = (trigger: Trigger) => ({ trigger: { ...trigger, ...(area === null ? {} : { area }), ...(spot ? { place: spot } : {}) } });
    // The name's subject, else the description's ("Clean a Grimy Guam": "a grimy guam leaf";
    // "Mine 10 Silver": "10 silver ore").
    for (const candidate of [subject, describedSubject]) {
      // A herb is cleaned into its clean self: "Clean 15 Grimy Tarromin" counts the Tarromin.
      const made = lowerVerb === "clean" ? candidate.replace(/^Grimy /i, "") : candidate;
      // "Snare a Bird" is any bird snared: no one creature.
      if (lowerVerb === "snare" && /^birds?$/i.test(made)) return {};
      if (lowerVerb === "catch" || lowerVerb === "snare") {
        // A fish is caught raw; anything else caught is a creature hunted ("Catch 500 Chinchompas").
        const fish = itemNamed(made, items, ["Raw "]) ?? (/^Raw /i.test(made) ? itemNamed(made, items) : null);
        if (fish) return withArea({ kind: "produce", items: [fish], count });
        // "Red chinchompa (Hunter)s": the link's target, plural after it.
        // ... or the NPC its page names ("Red chinchompa (Hunter)": the Carnivorous chinchompa).
        const creature = npcNamed(made.replace(/ \(Hunter\)s?$/i, ""), npcs) ?? npcNamed(made.replace(/ \(Hunter\)s$/i, " (Hunter)"), npcs);
        if (creature) return withArea({ kind: "hunt", npcs: [creature], count });
        continue;
      }
      if (lowerVerb === "chop") {
        // A tree chopped is its logs ("Chop 100 Maples", "100 Maple tree"): never a "tree" item.
        const tree = made.replace(/^down (?:an? )?/i, "").replace(/\s+trees?$/i, "").replace(/s$/i, "");
        const logs = itemNamed(/logs?$/i.test(made) ? made : `${tree} logs`, items);
        if (logs) return withArea({ kind: "produce", items: [logs], count });
        continue;
      }
      // Something cooked is cooked: the description's "raw" is what goes on the fire.
      const what = lowerVerb === "cook" ? made.replace(/^raw /i, "") : made;
      const item = itemNamed(what, items, forms) ?? (/^(make|create|brew)$/.test(lowerVerb) ? potionNamed(what, items) : null);
      // A page of several items, any of them made ("Mine 15 Granite": its three weights; "30 chunks of").
      const versions = item ? null : names.subjects?.get(what.replace(/^chunks? of /i, "").toLowerCase());
      if (versions) return withArea({ kind: "produce", items: versions, count });
      if (item && !(lowerVerb === "cook" && /^Raw /.test(item))) return withArea({ kind: "produce", items: [item], count });
    }
    return {};
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
/** The cache league's tasks no rule maps, with the description the rules read (`--unmapped <file>`). */
const unmappedRows: string[] = [];

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
    else unmappedRows.push([task.id, row.name, plainTargets(wiki.description)].join("\t"));
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

/**
 * The monsters a kill task names before a place ("Defeat a [[Drake]] in the [[Karuulm Slayer
 * Dungeon]]"): their Wiki pages, read for where they live.
 */
function homePagesOf(wikitext: string): string[] {
  const pages: string[] = [];
  for (const [, description] of wikitext.matchAll(/\{\{(?:DPL|REL|TRL)TaskRow\|[^|]*\|([^\n]*?)\|s=/g)) {
    const subject = /^(?:Defeat|Kill|Slay) (?:an? |the |some |\d+ )?\[\[([^\]|#]+)/.exec(description);
    if (subject && /\b(?:in|on|at|inside|within|beneath|underneath|under)\b (?:the )?(?:\[\[|[A-Z])/.test(description.slice(subject.index + subject[0].length))) pages.push(subject[1].trim());
  }
  return pages;
}

/** The sets an equip task names by link ("a full set of [[Armadyl armour|...]]", "any piece of the [[Infinity robes]]"). */
function setPagesOf(wikitext: string): string[] {
  const pages: string[] = [];
  for (const [, name, description] of wikitext.matchAll(/\{\{(?:DPL|REL|TRL)TaskRow\|([^|]*)\|([^\n]*?)\|s=/g)) {
    if (!/^Equip /i.test(name)) continue;
    const link = /\b(?:full set of|full|piece of)\s+(?:the |any )?\[\[([^\]|#]+)/i.exec(description);
    if (link) pages.push(link[1].trim());
  }
  return pages;
}

/**
 * A set's pieces as its Wiki page tabulates them: each {{Infotable Bonuses}} or {{Skill outfit}}
 * a table (Void Knight equipment has three, one per helm), else the pieces its {{Infobox Set}}
 * pictures link to.
 */
function setListsOf(wikitext: string): string[][] {
  const lists = [...wikitext.matchAll(/\{\{(?:Infotable Bonuses|Skill outfit)\|([^{}]*)\}\}/g)]
    .map((match) => match[1].split("|").map((arg) => arg.trim()).filter((arg) => arg && !arg.includes("=")).map((arg) => arg.replace(/#.*$/, "")));
  if (lists.length) return lists;
  const infobox = /\{\{Infobox Set[\s\S]*?\|image\s*=([^\n]*)/.exec(wikitext);
  const pictured = infobox ? [...infobox[1].matchAll(/link=([^\]|]+)/g)].map((match) => match[1].trim()) : [];
  return pictured.length ? [pictured] : [];
}

/**
 * Where the Wiki says a monster lives: each {{LocLine}}'s location (its first link), else its
 * infobox's. A monster that lives in one place only is killed there whatever a task adds.
 */
/**
 * The pages a task's deed links its subject to where the link's title is no cache item or NPC
 * ("Create a [[Mithril Grapple]]", "Catch 150 [[Red chinchompa (Hunter)]]s"), saved as
 * `<dir>/subjects/<page>.wikitext` (the redirect followed: Mithril Grapple is Mith grapple's page).
 */
const SUBJECT_LINK = /^(?:Equip|Make|Create|Craft|Mine|Catch|Chop|Fletch|Blow|Smith|Cook|Brew|Successfully \w+|Trap|Snare|Smelt|Cut)(?: (?:either|any|a|an|the|some|\d+|pair of|chunks of))* \[\[([^\]|#]+)/i;
function subjectPagesOf(wikitext: string, names: Names): string[] {
  const pages: string[] = [];
  for (const [, description] of wikitext.matchAll(/\{\{(?:DPL|REL|TRL)TaskRow\|[^|]*\|([^\n]*?)\|s=/g)) {
    const title = SUBJECT_LINK.exec(description)?.[1].trim();
    if (title && !names.items.has(title.toLowerCase()) && !names.npcs.has(title.toLowerCase())) pages.push(title.replace(/^./, (first) => first.toUpperCase()));
  }
  return pages;
}

/** The in-game names an item, monster or NPC page's infoboxes give (`|name = Mith grapple`, `|name1 = Granite (500g)`). */
function infoboxNames(wikitext: string, templates: string[]): string[] {
  // "{{Infobox Item\n|name = ..." opens on its own line.
  const text = wikitext.replace(/\{\{(Infobox [A-Za-z]+)[ \t]*\r?\n/g, "{{$1");
  return [...new Set(templates.flatMap((template) => templateCalls(text, template)).flatMap((args) => args
    .map((arg) => /^\s*name\d*\s*=\s*(.+?)\s*$/s.exec(arg)?.[1]).filter((name): name is string => !!name)))];
}

/** The NPC pages the talk and pet tasks link to ("Talk to a [[Gladiator (Fortis Colosseum)]]"), saved as `<dir>/npcs/<page>.wikitext`. */
function operatedPagesOf(wikitext: string): string[] {
  const pages: string[] = [];
  for (const [, description] of wikitext.matchAll(/\{\{(?:DPL|REL|TRL)TaskRow\|(?:Talk to|Pet) [^|]*\|([^\n]*?)\|s=/g)) {
    const subject = /^(?:Talk to|Pet) (?:any |an? |the )?(?:\[\[[^\]]+\]\]'s )?\[\[([^\]|#]+)/i.exec(description);
    // A title's first letter is the Wiki's capital ("[[port master]]" is Port master).
    if (subject) pages.push(subject[1].trim().replace(/^./, (first) => first.toUpperCase()));
  }
  return pages;
}

/** Every NPC id an NPC page's infoboxes give (`|id = 7668, 14183`, `|id1 = 12834`). */
function npcIdsOf(wikitext: string): number[] {
  return [...wikitext.matchAll(/^\|\s*id\d*\s*=([^\n]*)$/gm)].flatMap((match) => match[1].split(",").map((id) => Number(id.trim()))).filter(Number.isInteger);
}

/** The cache items of a name, less banknotes and bank placeholders. */
function itemIdsNamed(name: string): number[] {
  const ids: number[] = [];
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const item = CacheDefinitions.getItem(id);
    if (item?.name?.toLowerCase() === name.toLowerCase() && !(item.noteTemplate >= 0) && !(item.placeholderTemplate >= 0)) ids.push(id);
  }
  return ids;
}

/** The cache NPCs of a name. */
function npcIdsNamed(name: string): number[] {
  const ids: number[] = [];
  for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) if (CacheDefinitions.getNpc(id)?.name?.toLowerCase() === name.toLowerCase()) ids.push(id);
  return ids;
}

/** The cache NPCs of a name whose menu has the option ("Talk-to", "Pet"). */
function npcIdsWithOption(name: string, option: string): number[] {
  const ids: number[] = [];
  for (let id = 0; id < CacheDefinitions.getCounts().npcs; id++) {
    const npc = CacheDefinitions.getNpc(id);
    if (npc?.name?.toLowerCase() === name.toLowerCase() && (npc.actions ?? []).some((action: string | null) => action?.toLowerCase() === option)) ids.push(id);
  }
  return ids;
}

function homesOf(wikitext: string): string[] {
  const firstLink = (text: string) => /\[\[([^\]|#]+)/.exec(text)?.[1].trim() ?? text.replace(/\(.*$/, "").trim();
  const lines = [...wikitext.matchAll(/\{\{LocLine\b[\s\S]*?\|\s*location\s*=([^|\n]*)/g)].map((match) => firstLink(match[1]));
  if (lines.length) return lines;
  const infobox = /^\|\s*location\s*=(.*)$/m.exec(wikitext);
  return infobox ? [firstLink(infobox[1])] : [];
}

/** A Wiki page by its title, following a redirect; saved as <dir>/<kind>/<title>.wikitext like the task pages. */
async function wikiPageOf(kind: string, page: string, options: { from?: string; save?: string }): Promise<string> {
  const file = `${page.replace(/ /g, "_").replace(/\//g, "_")}.wikitext`;
  if (options.from) return fs.readFileSync(path.join(options.from, kind, file), "utf8");
  let title = page;
  let text = "";
  for (let hop = 0; hop < 3; hop++) {
    const url = `https://oldschool.runescape.wiki/w/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/")}?action=raw`;
    const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    text = await response.text();
    const redirect = /^#REDIRECT\s*\[\[([^\]#|]+)/i.exec(text);
    if (!redirect) break;
    title = redirect[1].trim();
  }
  if (options.save) {
    fs.mkdirSync(path.join(options.save, kind), { recursive: true });
    fs.writeFileSync(path.join(options.save, kind, file), text);
  }
  return text;
}

/** A place's Wiki page, saved as <dir>/places/<page>.wikitext like the task pages. */
async function placePageOf(page: string, options: { from?: string; save?: string }): Promise<string> {
  if (options.from) return fs.readFileSync(path.join(options.from, "places", `${page}.wikitext`), "utf8");
  const url = `https://oldschool.runescape.wiki/w/${encodeURIComponent(page).replace(/%2F/g, "/")}?action=raw`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  if (options.save) {
    fs.mkdirSync(path.join(options.save, "places"), { recursive: true });
    fs.writeFileSync(path.join(options.save, "places", `${page}.wikitext`), text);
  }
  return text;
}

function serialise(output: Record<string, unknown>): string {
  // Each task on its own line, so the file diffs by task.
  const leagues = output.leagues as Record<string, { tasks: Task[]; [key: string]: unknown }>;
  const placesOut = (output.places ?? {}) as Record<string, unknown>;
  const header = JSON.stringify({ ...output, places: undefined, leagues: undefined }, null, 2).replace(/\n}$/, "");
  // Each place on its own line too.
  const placeLines = Object.entries(placesOut).map(([key, place]) => `    ${JSON.stringify(key)}: ${JSON.stringify(place)}`);
  const placesPart = placeLines.length ? `,\n  "places": {\n${placeLines.join(",\n")}\n  }` : "";
  const parts: string[] = [];
  for (const [type, league] of Object.entries(leagues)) {
    const { tasks, ...rest } = league;
    const fields = JSON.stringify(rest, null, 4).replace(/^\{\n|\n\}$/g, "").split("\n").map((line) => `  ${line}`).join("\n");
    parts.push(`    "${type}": {\n${fields},\n      "tasks": [\n${tasks.map((task) => `        ${JSON.stringify(task)}`).join(",\n")}\n      ]\n    }`);
  }
  return `${header}${placesPart},\n  "leagues": {\n${parts.join(",\n")}\n  }\n}\n`;
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (flag: string) => { const index = argv.indexOf(flag); return index >= 0 ? argv[index + 1] : undefined; };
  const options = { from: option("--from"), save: option("--save"), check: argv.includes("--check"), unmapped: option("--unmapped") };

  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  const cache = cacheTasks();
  for (const league of LEAGUES) if (league.fromCache) league.points = cachePoints();
  const npcs = npcNames();
  const quests = questNames();
  const names: Names = { npcs, quests, items: itemNames(), homes: new Map() };

  const rows = new Map<League, WikiRow[]>();
  const rawPages = new Map<League, string>();
  for (const league of LEAGUES) {
    const wikitext = await wikitextOf(league, options);
    rawPages.set(league, wikitext);
    rows.set(league, templateCalls(wikitext, league.template).map(parseRow));
  }
  const areas = areaIds(cache, rows);
  for (const page of new Set(PLACE_DEFS.map((def) => def.page))) placePages.set(page, await placePageOf(page, options));
  // The homes of the monsters the kill tasks name before a place, by lower-cased page title.
  const homePages = [...new Set(LEAGUES.flatMap((league) => homePagesOf(rawPages.get(league)!)))].sort();
  for (const page of homePages) names.homes!.set(page.toLowerCase(), homesOf(await wikiPageOf("npcs", page, options)));
  // A deed's subject linked by a title that is no cache name: the item or NPC its page's infobox names,
  // when that is one cache name ("Mithril Grapple" is the Mith grapple, "Red chinchompa (Hunter)" the
  // Carnivorous chinchompa); a page of several (Granite's three weights) names them all.
  names.subjects = new Map();
  for (const page of [...new Set(LEAGUES.flatMap((league) => subjectPagesOf(rawPages.get(league)!, names)))].sort()) {
    const text = await wikiPageOf("subjects", page, options);
    // Every cache entry of the name (unnoted, no placeholder) must be one of the page's ids: a name
    // the cache gives other things too ("Chompy bird hat", every rank's; "Mith grapple", the
    // unfinished one's) is no one subject.
    const ids = npcIdsOf(text);
    const items = infoboxNames(text, ["Infobox Item", "Infobox Bonuses"]).map((each) => names.items.get(each.toLowerCase())).filter((each): each is string => !!each)
      .filter((each) => itemIdsNamed(each).every((id) => ids.includes(id)));
    const npcs = infoboxNames(text, ["Infobox Monster", "Infobox NPC"]).map((each) => names.npcs.get(each.toLowerCase())).filter((each): each is string => !!each)
      .filter((each) => npcIdsNamed(each).every((id) => ids.includes(id)));
    const key = page.toLowerCase();
    if (new Set(items).size === 1 && !npcs.length) names.items.set(key, items[0]);
    else if (new Set(npcs).size === 1 && !items.length) names.npcs.set(key, npcs[0]);
    else if (items.length > 1 && !npcs.length) names.subjects.set(key, [...new Set(items)]);
  }
  // The ids of the NPCs the talk and pet tasks link to, by lower-cased page title.
  names.npcIds = new Map();
  for (const page of [...new Set(LEAGUES.flatMap((league) => operatedPagesOf(rawPages.get(league)!)))].sort()) names.npcIds.set(page.toLowerCase(), npcIdsOf(await wikiPageOf("npcs", page, options)));
  // The pieces of the sets equip tasks link to that the cache has no item set for.
  names.sets = new Map();
  for (const page of [...new Set(LEAGUES.flatMap((league) => setPagesOf(rawPages.get(league)!)))].sort()) names.sets.set(page.toLowerCase(), setListsOf(await wikiPageOf("sets", page, options)));
  resolvePlaces();

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

  // The places the triggers name, by key: their bounds and where those come from (docs/leagues.md, Tasks).
  const named = new Set(Object.values(output.leagues as Record<string, { tasks: Task[] }>).flatMap((league) => league.tasks.map((task) => task.trigger?.place)).filter((key): key is string => typeof key === "string"));
  output.places = Object.fromEntries([...named].sort().map((key) => [key, places.get(key)]));
  if (options.unmapped) fs.writeFileSync(options.unmapped, unmappedRows.join("\n") + "\n");
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
