// Lists the English strings tsps draws that the OSRS Translate dictionaries have no entry for, as
// keys ready to translate. Read-only: it reads the cache, the server's sources and the
// dictionaries, and writes JSON lists to the output folder.
//
//   node client/scripts/osrs-translate-keys.mjs <dictionary clone> <output folder>
//
// <dictionary clone> is a checkout of walterrezende12-tech/osrs-translate-translations (main).
// Our bundled additions (client/public/osrstranslate/additions-*.json) count as present too.
// Needs the cache in server/caches (`yarn --cwd server ensure-cache`).
//
// Output: one `<dictionary file>.json` per target file, an array of { key, source, note? }.
// `key` is what the game draws once tags are stripped and whitespace collapsed (the plugin's
// lookup form); `[placeholder]`s stand for values built at runtime. Prayer tooltips keep their
// `<br>`s, because the client receives them as one string.
//
// Sources:
//   A. cache text: spell descriptions, prayer tooltips, settings dropdowns, combat style buttons,
//      chat-tab statuses, clientscript literals (via server/scripts/dump-cs2.ts) and static
//      interface text (via server/scripts/dump-widget.ts);
//   B. server messages: message, dialogue and overhead calls in server/plugins/**/*.js and
//      server/src/**/*.ts (TypeScript compiler API), plus the plugins' data/*.json `messages`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SERVER = join(ROOT, "server");
const LANGUAGES = ["pt-BR", "ESP"];
const DICTIONARY_FILES = [
    "translations.json",
    "translations_skills.json",
    "translations_quests.json",
    "translations_items.json",
    "translations_menu.json",
    "translations_overhead.json",
    "translations_game_message.json",
    "translations_welcome.json",
    "translations_settings.json",
];
const DIALOGUE = "translations.json";
const MENU = "translations_menu.json";
const SETTINGS = "translations_settings.json";
const CHAT = "translations_game_message.json";

const [dictionaryArg, outArg] = process.argv.slice(2);
if (!dictionaryArg || !outArg) {
    console.error("usage: node client/scripts/osrs-translate-keys.mjs <dictionary clone> <output folder>");
    process.exit(1);
}
const DICTIONARY = resolve(dictionaryArg);
const OUT = resolve(outArg);

// ---------------------------------------------------------------------------------------------
// Key normalisation, as the plugin's lookup (TranslationLookup.cleanText + normalizeLookupText).

const BR = /<br\s*\/?>/gi;
const TAG = /<[^>]+>/g;
const PLACEHOLDER = /\[[^\]]+\]/g;
const LETTER = /\p{L}/u;

function lookupForm(text) {
    return String(text)
        .replace(BR, " ")
        .replace(TAG, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\s+([.,!?])/g, "$1")
        .replace(/([Hh])ardcore Ironmen /g, "$1ardcore Ironman ")
        .replace(/standard Ironmen /g, "standard Ironman ");
}

/** The lookup form, but with `<br>` kept (for strings the client receives whole). */
function brForm(text) {
    return String(text)
        .split(BR)
        .map((part) => lookupForm(part))
        .join("<br>");
}

const shape = (key) => key.replace(PLACEHOLDER, "\u0000");
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ---------------------------------------------------------------------------------------------
// The dictionaries: author's main plus our bundled additions.

function loadDictionaries() {
    const additions = {};
    for (const language of LANGUAGES) {
        const path = join(ROOT, "client", "public", "osrstranslate", `additions-${language}.json`);
        additions[language] = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).files ?? {} : {};
    }
    const byFile = new Map(); // file -> language -> { exact:Set, shapes:Set, patterns:RegExp[] }
    for (const file of DICTIONARY_FILES) {
        const perLanguage = {};
        for (const language of LANGUAGES) {
            const path = join(DICTIONARY, language, file);
            const entries = existsSync(path) ? Object.keys(JSON.parse(readFileSync(path, "utf8"))) : [];
            const added = additions[language][file];
            const extra = added ? Object.keys(added.add ?? added) : [];
            const exact = new Set();
            const shapes = new Set();
            const patterns = [];
            for (const raw of [...entries, ...extra]) {
                const key = lookupForm(raw);
                exact.add(key);
                if (!/\[[^\]]+\]/.test(key)) continue;
                shapes.add(shape(key));
                if (!LETTER.test(key.replace(PLACEHOLDER, ""))) continue;
                patterns.push(new RegExp(`^${key.split(PLACEHOLDER).map(escapeRegExp).join("(.+?)")}$`, "s"));
            }
            perLanguage[language] = { exact, shapes, patterns };
        }
        byFile.set(file, perLanguage);
    }
    return byFile;
}

/** Whether `key` (lookup form) already translates in `file` for `language`. */
function covered(dictionaries, file, language, key) {
    const d = dictionaries.get(file)[language];
    if (d.exact.has(key) || d.shapes.has(shape(key))) return true;
    return d.patterns.some((pattern) => pattern.test(key));
}

// ---------------------------------------------------------------------------------------------
// Collected keys.

const found = new Map(); // file -> Map(key -> { key, source, note? })

function add(file, rawKey, source, note, { keepBr = false } = {}) {
    const key = keepBr ? brForm(rawKey) : lookupForm(rawKey);
    if (!key) return;
    if (!found.has(file)) found.set(file, new Map());
    const list = found.get(file);
    const existing = list.get(key);
    if (existing) {
        if (!existing.source.includes(source) && existing.source.split("; ").length < 4) existing.source += `; ${source}`;
        return;
    }
    const entry = { key, source };
    if (note) entry.note = note;
    list.set(key, entry);
}

// ---------------------------------------------------------------------------------------------
// A. Cache text.

const TS_ENV = { ...process.env, TS_NODE_COMPILER_OPTIONS: '{"target":"es2020"}', TS_NODE_TRANSPILE_ONLY: "true" };
const TS_NODE = join(SERVER, "node_modules", "ts-node", "dist", "bin-transpile.js");
const serverScript = (script, args) =>
    execFileSync(process.execPath, [TS_NODE, join(SERVER, "scripts", script), ...args.map(String)], {
        cwd: SERVER,
        env: TS_ENV,
        encoding: "utf8",
        maxBuffer: 256 * 1024 * 1024,
    });

async function loadCache() {
    process.env.TS_NODE_COMPILER_OPTIONS = TS_ENV.TS_NODE_COMPILER_OPTIONS;
    const require = createRequire(join(SERVER, "package.json"));
    require("ts-node").register({ transpileOnly: true, project: join(SERVER, "tsconfig.json"), compilerOptions: { target: "es2020", module: "commonjs" } });
    const cacheDir = join(SERVER, "src", "main", "typescript", "elvarg", "game", "cache");
    const { CachePipeline } = require(join(cacheDir, "CachePipeline"));
    const { CacheDefinitions } = require(join(cacheDir, "CacheDefinitions"));
    await CachePipeline.initialize(SERVER);
    return CacheDefinitions;
}

const SPELL_PARAM = 596;
const SPELL_NAME_PARAM = 601;
const SPELL_DESCRIPTION_PARAM = 602;
const PRAYER_NAME_PARAM = 1752;
const PRAYER_LEVEL_PARAM = 1753;
const PRAYER_DESCRIPTION_PARAM = 1754;
const SETTINGS_DROPDOWN_ENUMS = [3993, 3994];
const CHAT_STATUS_ENUM = 3844;
const COMBAT_STYLE_TABLE = 78;
const QUEST_TABLE = 0;

const properNames = new Set();
const isProperName = (key) => properNames.has(key.toLowerCase());

function extractCacheTables(defs) {
    const itemCount = defs.getCounts().items;
    const spells = [];
    const prayers = [];
    for (let id = 0; id < itemCount; id++) {
        const params = defs.getItem(id).params;
        if (!params) continue;
        if (params.has(SPELL_PARAM)) {
            const name = params.get(SPELL_NAME_PARAM);
            if (typeof name === "string") properNames.add(lookupForm(name).toLowerCase());
            const description = params.get(SPELL_DESCRIPTION_PARAM);
            if (typeof description === "string") spells.push([id, description]);
        }
        const prayerName = params.get(PRAYER_NAME_PARAM);
        if (typeof prayerName === "string") {
            properNames.add(lookupForm(prayerName).toLowerCase());
            prayers.push([id, params.get(PRAYER_LEVEL_PARAM), prayerName, params.get(PRAYER_DESCRIPTION_PARAM)]);
        }
    }
    for (const row of defs.getDbTableRows(QUEST_TABLE)) {
        for (const values of row.columns.values()) {
            for (const value of values) if (typeof value === "string" && value.length < 60) properNames.add(lookupForm(value).toLowerCase());
        }
    }
    for (const [id, description] of spells) add(MENU, description, `cache obj ${id} param ${SPELL_DESCRIPTION_PARAM} (spell description)`);
    for (const [id, level, name, description] of prayers) {
        if (typeof description !== "string") continue;
        // Script 2762 builds the tooltip as "Level N<br>Name<br>Description" and draws it whole.
        add(MENU, `Level ${level}<br>${name}<br>${description}`, `cache obj ${id} params 1753/1752/1754 (prayer tooltip, script 2762)`,
            "Prayer tooltip: the client receives this as one string, so the key keeps its <br>s; keep the prayer name in English.",
            { keepBr: true });
    }
    for (const enumId of SETTINGS_DROPDOWN_ENUMS) {
        for (const [k, v] of defs.getEnumValues(enumId)) if (typeof v === "string") add(SETTINGS, v, `cache enum ${enumId}[${k}] (settings dropdown)`);
    }
    for (const [k, v] of defs.getEnumValues(CHAT_STATUS_ENUM)) if (typeof v === "string") add(MENU, v, `cache enum ${CHAT_STATUS_ENUM}[${k}] (chat-tab status)`);
    const button = defs.getDbColumn(COMBAT_STYLE_TABLE, "button");
    if (button === null) console.warn(`dbtable ${COMBAT_STYLE_TABLE} has no "button" column`);
    else for (const row of defs.getDbTableRows(COMBAT_STYLE_TABLE)) {
        // Each tuple is (index, name, tooltip, sprite); the tooltip is one "(Accurate)<br>(Crush)<br>(Attack XP)" string.
        for (const v of row.column(button)) {
            if (typeof v !== "string") continue;
            const tooltip = /<br\s*\/?>/i.test(v);
            add(MENU, v, `cache dbtable ${COMBAT_STYLE_TABLE} row ${row.id} button (combat style ${tooltip ? "tooltip" : "name"})`,
                tooltip ? "Combat style tooltip: one string with <br>s, so the key keeps them." : undefined, { keepBr: tooltip });
        }
    }
}

// Clientscript literals. Strings are followed through a small symbolic stack: `join_string`
// joins what was pushed before it, `tostring` is a runtime number, locals keep what was stored.
const SCRIPT_GROUPS = [
    { ids: [3237], file: MENU, what: "quest list header" },
    { ids: [3950, 3949, 3310], file: MENU, what: "character summary" },
    { ids: [3917, 3903, 5523, 4564, 4565, 3918, 375, 381, 7099, 3933, 3934, 3935], file: SETTINGS, what: "settings side panel" },
    { ids: [4727], file: MENU, what: "more options", value: "[option]" },
    { ids: [4728], file: MENU, what: "+N options" },
    { ids: [7593, 2486, 325, 187], file: MENU, what: "combat options" },
    { ids: [123, 127], file: MENU, what: "friends/ignore title" },
    { ids: [999], file: MENU, what: "XP drop label", value: "[skill]", split: true },
    { ids: [3517], file: MENU, what: "equipment stats" },
];
const STRING_PUSH = { tostring: "[number]", oc_name: "[item]", nc_name: "[npc]", get_varc_string: "[x]", cc_gettext: "[x]", if_gettext: "[x]", chat_playername: "[player name]", enum: "[x]" };
const NEUTRAL = new Set(["iconst", "iload", "istore", "add", "sub", "multiply", "div", "mod", "get_varp", "get_varbit", "get_varc_int", "pop_int", "abs", "min", "max"]);
// Script argument signatures ("iii", "iiiisiiiY") and similar, never drawn.
const SIGNATURE = /^[isolzIYZ1]{1,24}$/;

function scriptKeys(dump) {
    const out = [];
    for (const block of dump.split(/\n(?=; script )/)) {
        const header = /^; script (\d+)/.exec(block);
        if (!header) continue;
        const id = Number(header[1]);
        let stack = [];
        const locals = new Map();
        const keep = (entry) => {
            if (entry.literal && SIGNATURE.test(entry.text)) return;
            out.push({ id, text: entry.text, joined: !entry.literal });
        };
        const flush = (op) => {
            for (const entry of stack) if (!/seton|setop|_param|enum|db_/.test(op) || !entry.literal) keep(entry);
            stack = [];
        };
        for (const line of block.split("\n")) {
            const m = /^\s*\d+\s+(\S+)\s*(.*)$/.exec(line);
            if (!m) continue;
            const [, op, operand] = m;
            if (op === "sconst") stack.push({ text: JSON.parse(operand), literal: true });
            else if (STRING_PUSH[op]) stack.push({ text: STRING_PUSH[op], literal: false });
            else if (op === "oload") {
                const v = locals.get(operand);
                stack.push(v ? { ...v } : { text: "[x]", literal: false });
            } else if (op === "ostore") {
                const v = stack.pop();
                if (v) {
                    locals.set(operand, v);
                    if (v.literal || !v.stored) keep(v);
                    v.stored = true;
                }
            } else if (op === "join_string") {
                const n = Number(operand);
                const parts = stack.splice(Math.max(0, stack.length - n), n);
                while (parts.length < n) parts.unshift({ text: "[x]", literal: false });
                stack.push({ text: parts.map((p) => p.text).join(""), literal: false });
            } else if (NEUTRAL.has(op)) continue;
            else flush(op);
        }
        flush("");
    }
    return out;
}

function extractScripts() {
    const ids = SCRIPT_GROUPS.flatMap((g) => g.ids);
    const dump = serverScript("dump-cs2.ts", ids);
    const seen = new Set();
    for (const entry of scriptKeys(dump)) {
        const group = SCRIPT_GROUPS.find((g) => g.ids.includes(entry.id));
        let text = entry.text;
        // A value the script looks up (the skill an XP drop is for, the menu option): named per script.
        if (group.value) text = text.replace(/\[x\]/g, group.value);
        // Decimals are built from several numbers ("126" + "." + "75"): one value on screen.
        text = text.replace(/\[number\](?:\.0*\[number\]|\.\d+)+/g, "[number]");
        // XP drop tooltips are "|"-separated lines with "@ttip_list@" layout marks; each line is drawn on its own.
        const parts = group.split ? text.split("|").map((part) => part.replace(/@ttip_list@/g, "")) : [text];
        for (const part of parts) {
            const key = lookupForm(part);
            // A bare plural suffix joined on its own ("[x]s"), or a value alone, is not a key.
            if (/^\[[^\]]+\]s$/.test(key) || key === "null") continue;
            if (seen.has(`${entry.id}\u0000${key}`)) continue;
            seen.add(`${entry.id}\u0000${key}`);
            const notes = [];
            if (entry.joined && /\[/.test(key)) notes.push("Joined in the script with runtime values.");
            if (parts.length > 1) notes.push("One line of a '|'-separated tooltip.");
            add(group.file, key, `cache script ${entry.id} (${group.what})`, notes.join(" ") || undefined);
        }
    }
}

const WIDGET_GROUPS = [
    { group: 399, file: MENU, what: "quest list" },
    { group: 429, file: MENU, what: "" },
    { group: 432, file: MENU, what: "" },
    { group: 182, file: MENU, what: "logout tab" },
    { group: 239, file: MENU, what: "music tab" },
    { group: 162, file: MENU, what: "chatbox tabs", components: [6, 9, 13, 17, 21, 25, 29, 33] },
    { group: 387, file: MENU, what: "equipment tab" },
];

function extractWidgets() {
    for (const { group, file, what, components } of WIDGET_GROUPS) {
        for (const line of serverScript("dump-widget.ts", [group]).split("\n")) {
            const m = /^(\d+): .*?\btext=("(?:[^"\\]|\\.)*")/.exec(line);
            if (!m) continue;
            const component = Number(m[1]);
            if (components && !components.includes(component)) continue;
            add(file, JSON.parse(m[2]), `cache widget ${group}:${component}${what ? ` (${what})` : ""}`);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// B. Server messages.

const require = createRequire(join(SERVER, "package.json"));
const ts = require("typescript");

const CALLS = { __proto__: null,
    sendMessage: { args: [0], file: CHAT, what: "sendMessage" },
    sendTypedMessage: { args: [1], file: CHAT, what: "sendTypedMessage" },
    forceChat: { args: [0], file: DIALOGUE, what: "forceChat (overhead)" },
    setForcedChat: { args: [0], file: DIALOGUE, what: "setForcedChat (overhead)" },
    sendString: { args: [0], file: MENU, what: "sendString (interface)" },
    sendMultiChatboxPrompt: { args: [1], rest: 2, file: DIALOGUE, what: "sendMultiChatboxPrompt" },
};
const CONSTRUCTORS = { __proto__: null,
    NpcDialogue: { args: [2], what: "NpcDialogue" },
    ItemStatementDialogue: { args: [2], what: "ItemStatementDialogue" },
    PlayerDialogue: { args: [1], what: "PlayerDialogue" },
    StatementDialogue: { args: [1], what: "StatementDialogue" },
    OptionDialogue: { args: [], rest: 2, what: "OptionDialogue" },
};
// Local wrappers, matched by name; their text parameter is found by name in the file's own
// declaration, falling back to the usual position.
const WRAPPERS = { __proto__: null,
    statement: { params: ["text", "message", "msg"], fallback: [1], what: "statement()" },
    npcSay: { params: ["text", "message", "msg"], fallback: [2], what: "npcSay()" },
    options: { params: ["title", "prompt"], fallback: [1], restAfterParam: true, what: "options()" },
};
const SKIP_PATH = /(^|[\\/])(commands?|debug|dev|devtools|agent|bots|tests?|__tests__)([\\/]|$)|\.(test|spec|smoke)\.[jt]s$|Command[A-Za-z]*\.[jt]s$|[\/](Dev|Debug|Commands?|Cheats?)\.[^\/]+$/i;

function walk(dir, ext, files = []) {
    if (!existsSync(dir)) return files;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path, ext, files);
        else if (ext.test(entry.name)) files.push(path);
    }
    return files;
}

/** The placeholder a runtime value is keyed as, named from its expression. */
const NUMBER_WORD = /level|lvl|needed|need|required|req|amount|count|number|num$|qty|quantity|xp|exp$|experience|damage|dmg|time|seconds|minutes|ticks|remaining|left|total|price|cost|coins|kills?$|kc$|points?$|charges?$|percent|tolocalestring|tofixed|format|length|size|max|min|^n$|index|tier|wave|round|score|streak|doses?$|hp$|hitpoints|energy|weight|value|bonus|chance|rate/;
const ARITHMETIC = new Set([ts.SyntaxKind.MinusToken, ts.SyntaxKind.AsteriskToken, ts.SyntaxKind.SlashToken, ts.SyntaxKind.PercentToken]);
// Values the file compares with a number (`count === 1 ? "" : "s"`): counts.
let numericNames = new Set();

/** The placeholder a runtime value is keyed as, named from its expression. */
function placeholderFor(node, sf) {
    while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) node = node.expression;
    if (ts.isNumericLiteral(node)) return node.text;
    if (ts.isBinaryExpression(node) && ARITHMETIC.has(node.operatorToken.kind)) return "[number]";
    if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) return "[number]";
    const text = node.getText(sf);
    if (numericNames.has(text)) return "[number]";
    const lower = text.toLowerCase();
    // The last name in the expression says most: `task.npcName`, `items.length`, `getSkillName(id)`.
    const bare = text.replace(/(?:\.(?:toLowerCase|toUpperCase|trim|toString)\(\))+$/, "");
    const tail = (/([A-Za-z_$][\w$]*)\s*(?:\([^()]*\))?\s*$/.exec(bare)?.[1] ?? "").toLowerCase();
    if (/getdisplayname|username|playername|player\.name/.test(lower)) return "[player name]";
    if (/^math\.|number\(|parseint|tolocalestring|tofixed|formatnumber|formatcoins/.test(lower)) return "[number]";
    if (NUMBER_WORD.test(tail)) return "[number]";
    if (/skill/.test(tail)) return "[skill]";
    if (/npc|monster|boss/.test(tail)) return "[npc]";
    if (/item|obj|product|rune|ore$|logs?$|bar$|fish|seed|herb/.test(tail)) return "[item]";
    if (/skill/.test(lower)) return "[skill]";
    if (/\bnpc|npcname|monster/.test(lower)) return "[npc]";
    if (/item|\bobj|getitemname|itemname/.test(lower)) return "[item]";
    if (NUMBER_WORD.test(lower)) return "[number]";
    return "[x]";
}

function collectNumericNames(sf) {
    const out = new Set();
    const compare = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.GreaterThanToken, ts.SyntaxKind.LessThanToken,
        ts.SyntaxKind.GreaterThanEqualsToken, ts.SyntaxKind.LessThanEqualsToken]);
    const visit = (node) => {
        if (ts.isBinaryExpression(node) && compare.has(node.operatorToken.kind)) {
            if (ts.isNumericLiteral(node.right)) out.add(node.left.getText(sf));
            if (ts.isNumericLiteral(node.left)) out.add(node.right.getText(sf));
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

function cross(a, b) {
    const out = [];
    for (const x of a) for (const y of b) {
        out.push({ text: x.text + y.text, holes: x.holes + y.holes, plural: x.plural || y.plural });
        if (out.length > 64) return out;
    }
    return out;
}

/** Every key variant an expression can produce (ternaries expand), or null when it isn't text. */
function variants(node, sf, scope, depth = 0) {
    if (!node || depth > 6) return null;
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) return variants(node.expression, sf, scope, depth);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [{ text: node.text, holes: 0 }];
    if (ts.isTemplateExpression(node)) {
        let acc = [{ text: node.head.text, holes: 0 }];
        for (const span of node.templateSpans) {
            acc = cross(acc, hole(span.expression, sf, scope, depth, acc, span.literal.text));
            acc = acc.map((v) => ({ ...v, text: v.text + span.literal.text }));
        }
        return acc;
    }
    if (ts.isConditionalExpression(node)) {
        const a = variants(node.whenTrue, sf, scope, depth + 1) ?? [{ text: placeholderFor(node.whenTrue, sf), holes: 1 }];
        const b = variants(node.whenFalse, sf, scope, depth + 1) ?? [{ text: placeholderFor(node.whenFalse, sf), holes: 1 }];
        return [...a, ...b];
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = variants(node.left, sf, scope, depth + 1);
        const right = variants(node.right, sf, scope, depth + 1);
        if (!left && !right) return null;
        return cross(left ?? [{ text: placeholderFor(node.left, sf), holes: 1 }], right ?? hole(node.right, sf, scope, depth, left, ""));
    }
    if (ts.isIdentifier(node) && scope.has(node.text)) {
        const init = scope.get(node.text);
        return variants(init, sf, new Map([...scope].filter(([k]) => k !== node.text)), depth + 1);
    }
    return null;
}

/** A template hole: its own text variants when it has them, else a placeholder. */
function hole(expr, sf, scope, depth, before, after) {
    const inner = variants(expr, sf, scope, depth + 1);
    if (inner) return inner;
    const name = placeholderFor(expr, sf);
    // A capture glued to the end of a word is a plural suffix ("coin${s}"): never a capture.
    const glued = before?.some((v) => /\p{L}$/u.test(v.text)) && !/^\p{L}/u.test(after ?? "");
    if (glued && /plural|suffix|^s$|\bs\b/i.test(expr.getText(sf))) return [{ text: "", holes: 0, plural: true }, { text: "s", holes: 0, plural: true }];
    return [{ text: name, holes: 1 }];
}

function constScope(sf) {
    const scope = new Map();
    const visit = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
            const flags = ts.getCombinedNodeFlags(node);
            if (flags & ts.NodeFlags.Const && !scope.has(node.name.text)) scope.set(node.name.text, node.initializer);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return scope;
}

function wrapperParams(sf) {
    const out = new Map();
    const visit = (node) => {
        if (ts.isFunctionDeclaration(node) && node.name && WRAPPERS[node.name.text]) {
            const spec = WRAPPERS[node.name.text];
            const names = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : ""));
            const index = names.findIndex((n) => spec.params.includes(n));
            const restIndex = node.parameters.findIndex((p) => p.dotDotDotToken);
            if (index >= 0) out.set(node.name.text, { args: [index], rest: spec.restAfterParam && restIndex > index ? restIndex : undefined });
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
}

const uncertain = [];

function extractSources() {
    const files = [...walk(join(SERVER, "plugins"), /\.js$/), ...walk(join(SERVER, "src"), /\.ts$/)];
    let calls = 0;
    for (const path of files) {
        const rel = relative(SERVER, path).replace(/\\/g, "/");
        if (SKIP_PATH.test(rel)) continue;
        const sf = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.ES2020, true, path.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);
        const scope = constScope(sf);
        numericNames = collectNumericNames(sf);
        const wrappers = wrapperParams(sf);
        const take = (args, spec, what, file, node) => {
            const indices = [...spec.args];
            if (spec.rest !== undefined) for (let i = spec.rest; i < args.length; i++) indices.push(i);
            const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
            for (const i of indices) {
                const arg = args[i];
                if (!arg || ts.isArrowFunction(arg) || ts.isFunctionExpression(arg) || ts.isSpreadElement(arg)) continue;
                const list = variants(arg, sf, scope);
                if (!list) continue;
                calls++;
                for (const v of list) {
                    const key = lookupForm(v.text);
                    let note;
                    if (list.length > 1) note = "One of several variants of the same message (ternary branches).";
                    if (/\[x\]/.test(key)) note = [note, "[x] is a runtime value the extractor could not name."].filter(Boolean).join(" ");
                    add(file, key, `${rel}:${line} ${what}`, note);
                }
            }
        };
        const visit = (node) => {
            if (ts.isCallExpression(node)) {
                const callee = node.expression;
                if (ts.isPropertyAccessExpression(callee) && /^console$/.test(callee.expression.getText(sf))) return;
                const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : "";
                if (CALLS[name]) take(node.arguments, CALLS[name], CALLS[name].what, CALLS[name].file, node);
                else if (ts.isIdentifier(callee) && WRAPPERS[name]) {
                    const spec = wrappers.get(name) ?? { args: WRAPPERS[name].fallback, rest: name === "options" ? 2 : undefined };
                    take(node.arguments, spec, WRAPPERS[name].what, DIALOGUE, node);
                }
            } else if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && CONSTRUCTORS[node.expression.text]) {
                const spec = CONSTRUCTORS[node.expression.text];
                take(node.arguments ?? [], spec, spec.what, DIALOGUE, node);
            }
            ts.forEachChild(node, visit);
        };
        visit(sf);
    }
    // Message catalogues: data.messages in the plugins' data files, "{name}" as "[name]".
    for (const path of walk(join(SERVER, "plugins"), /\.json$/).filter((p) => /[\\/]data[\\/][^\\/]+\.json$/.test(p))) {
        const rel = relative(SERVER, path).replace(/\\/g, "/");
        let json;
        try {
            json = JSON.parse(readFileSync(path, "utf8"));
        } catch {
            continue;
        }
        const messages = json?.messages ?? json?.data?.messages;
        if (!messages || typeof messages !== "object") continue;
        const each = (value, at) => {
            // "_"-prefixed entries and "source" fields are the authors' provenance notes, not text.
            if (/(^|\.)(_[^.]*|source)$/.test(at)) return;
            if (typeof value === "string") add(CHAT, value.replace(/\{([^}]+)\}/g, "[$1]"), `${rel} messages.${at}`, "Message catalogue entry; the call that sends it decides whether it is chat or overhead.");
            else if (Array.isArray(value)) value.forEach((v, i) => each(v, `${at}[${i}]`));
            else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) each(v, `${at}.${k}`);
        };
        for (const [k, v] of Object.entries(messages)) each(v, k);
    }
    return calls;
}

// ---------------------------------------------------------------------------------------------
// Filter and write.

function keep(entry) {
    const fixed = entry.key.replace(/<br>/g, " ").replace(PLACEHOLDER, " ");
    if (!LETTER.test(fixed)) return false;
    if (entry.key.replace(/<br>/g, " ").split(/\s+/).filter(Boolean).length < 2 && !entry.source.startsWith("cache")) return false;
    if (/::|^\s*\[?debug\b|^debug:|\bTODO\b|undefined|NaN|\$\{/i.test(entry.key)) return false;
    if (entry.source.startsWith("cache") && isProperName(entry.key)) return false;
    return true;
}

const dictionaries = loadDictionaries();
const defs = await loadCache();
extractCacheTables(defs);
extractScripts();
extractWidgets();
const calls = extractSources();

mkdirSync(OUT, { recursive: true });
const summary = {};
for (const [file, entries] of found) {
    const list = [];
    for (const entry of entries.values()) {
        if (!keep(entry)) continue;
        const lookup = entry.key.includes("<br>") ? entry.key.replace(/<br>/g, " ") : entry.key;
        // A catalogue entry may be sent as chat, dialogue or overhead: any of them counts.
        const homes = entry.source.includes(" messages.") ? [CHAT, DIALOGUE, "translations_overhead.json"] : [file];
        const missing = LANGUAGES.filter((language) => homes.every((home) => !covered(dictionaries, home, language, entry.key) && !covered(dictionaries, home, language, lookup)));
        if (missing.length === 0) continue;
        const elsewhere = DICTIONARY_FILES.filter((f) => f !== file && LANGUAGES.some((language) => covered(dictionaries, f, language, lookup)));
        const notes = [entry.note];
        if (missing.length < LANGUAGES.length) notes.push(`Missing only in ${missing.join(", ")}.`);
        if (elsewhere.length) notes.push(`Already in ${elsewhere.join(", ")}.`);
        const out = { key: entry.key, source: entry.source };
        const note = notes.filter(Boolean).join(" ");
        if (note) out.note = note;
        list.push(out);
        if (/\[x\]/.test(out.key)) uncertain.push({ file, ...out });
    }
    list.sort((a, b) => a.source.localeCompare(b.source) || a.key.localeCompare(b.key));
    writeFileSync(join(OUT, file), JSON.stringify(list, null, 1) + "\n");
    summary[file] = list.length;
}
writeFileSync(join(OUT, "_unnamed-placeholders.json"), JSON.stringify(uncertain, null, 1) + "\n");
console.log(`server calls with text: ${calls}`);
console.log(JSON.stringify(summary, null, 1));
