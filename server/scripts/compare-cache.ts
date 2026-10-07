/**
 * What moves between two cache revisions, matched by the cache's own gamevals.
 *
 *   yarn compare:cache <other cache directory> [--older] [--code <checkout>] [--all]
 *
 * Compares the current cache (target.txt) with another cache directory (e.g. a newer revision
 * downloaded elsewhere; with --older, the other one is the older revision) and lists, old to new:
 *   - per interface, the components whose id changed or that are gone, and every literal
 *     `(group << 16) | component` in server and client code that would point elsewhere;
 *   - per DB table, the columns whose id changed or that are gone (code reads columns by id),
 *     and the files that mention each changed table;
 *   - every varp and varbit the code uses (send/get/set calls, varps/varbits maps, VARP_/VARBIT_
 *     constants, "varbit" fields in data files) whose definition is gone or changed: a varbit
 *     on another varp or other bits, or a varp the cache no longer has (rev 241 turned varbit
 *     4398, the GE offer price, into long varp 5753).
 * Code is read as written for the older cache, so audit an update against the code from before
 * it (--code points at that checkout; default this one). Read-only: it changes nothing.
 */
import * as fs from "fs";
import * as path from "path";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheIndexDat2 } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/CacheIndex";
import { FileStore } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/store/FileStore";
import { Gamevals, GamevalKind } from "../src/main/typescript/elvarg/game/cache/Gamevals";
import { IndexType } from "../src/main/typescript/elvarg/game/cache/codec/rs/cache/IndexType";
import { hasLongCounts, readScript } from "./cs2-reader";

const codeFlag = process.argv.indexOf("--code");
const REPO_ROOT = path.resolve(codeFlag >= 0 ? process.argv[codeFlag + 1] : path.resolve(__dirname, "../.."));
const SCAN_DIRS = ["server/plugins", "server/src", "client/game", "client/widgets", "client/ui", "client/common"];
const DATA_DIRS = ["server/data/definitions"];
const CONFIG_INDEX = 2;
const VARP_ARCHIVE = 16;
const VARBIT_ARCHIVE = 14;

type VarKind = "varp" | "varbit";

/** Varbit id -> "base varp:start-end", and the varp ids, as one cache defines them. */
function varDefinitions(store: FileStore): { varbits: Map<number, string>; varps: Set<number> } {
    const index = CacheIndexDat2.fromStore(CONFIG_INDEX, store);
    const varbits = new Map<number, string>();
    const archive = index.getArchive(VARBIT_ARCHIVE);
    for (const id of archive.fileIds) {
        const data = archive.getFile(id)?.data;
        if (!data || data[0] !== 1) continue;
        const base = ((data[1] & 0xff) << 8) | (data[2] & 0xff);
        varbits.set(id, `varp ${base} bits ${data[3] & 0xff}-${data[4] & 0xff}`);
    }
    return { varbits, varps: new Set(index.getArchive(VARP_ARCHIVE).fileIds) };
}

const VAR_CALL = /\b(?:send|get|set)(Varbit|VarpLong|Varp|Config)\s*\(\s*([\w.]+)\s*(?:,\s*([\w.]+))?/g;
const VAR_MAP = /\b(varbits|varps)\s*:\s*\{([^}]*)\}/g;
const VAR_CONSTANT = /\b((?:[A-Z][A-Z0-9]*_)*(?:VARBIT|VARP)(?:_[A-Z0-9]+)*)\s*[=:]\s*(\d+)\b/g;
const VAR_FIELD = /\b([a-z]\w*(?:Varbit|Varp)\w*|varbit|varp)\s*:\s*(\d+)\b/g;
const VAR_ARRAY = /\b(\w*(?:VARBIT|VARP)\w*)\s*[=:]\s*\[([\d,\s]+)\]/g;
const DATA_FIELD = /"(varbit|varp)(?:Id)?"\s*:\s*(\d+)/g;
const NAMED_NUMBER = /\b([A-Za-z_][\w]*)\s*[=:]\s*(-?\d+)\b/g;

/** The vars each clientscript reads or writes: "varbit N", "varp N" and "long varp N". */
function scriptVars(store: FileStore, revision: number): Map<number, Set<string>> {
    const VAR_OPS: Record<number, string> = { 1: "varp", 2: "varp", 25: "varbit", 27: "varbit", 64: "long varp", 65: "long varp" };
    const index = CacheIndexDat2.fromStore(IndexType.DAT2.clientScript, store);
    const out = new Map<number, Set<string>>();
    for (const id of index.getArchiveIds()) {
        const data = index.getFileSmart(id)?.data;
        if (!data) continue;
        try {
            const vars = new Set<string>();
            for (const { opcode, operand } of readScript(new Int8Array(data), hasLongCounts(revision)).instructions) {
                if (VAR_OPS[opcode]) vars.add(`${VAR_OPS[opcode]} ${operand}`);
            }
            out.set(id, vars);
        } catch {
            // An unreadable script contributes nothing.
        }
    }
    return out;
}

/** The vars that took over from `key` in the scripts that used it: new in them, by how many. */
function successors(key: string, before: Map<number, Set<string>>, after: Map<number, Set<string>>): Array<[string, number]> {
    const counts = new Map<string, number>();
    for (const [script, vars] of before) {
        if (!vars.has(key)) continue;
        const now = after.get(script);
        if (!now || now.has(key)) continue;
        for (const v of now) if (!vars.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3);
}

const revisionOf = (name: string) => Number(/osrs-(\d+)/.exec(name)?.[1] ?? 0);

interface VarUse {
    kind: VarKind;
    id: number;
    where: string;
}

/** Every varp/varbit id the code names, with where; identifiers resolve through constants. */
function varUses(files: Map<string, string>, unresolved: string[] = []): VarUse[] {
    const global = new Map<string, Set<number>>();
    const local = new Map<string, Map<string, number>>();
    for (const [file, text] of files) {
        const names = new Map<string, number>();
        for (const [, name, value] of text.matchAll(NAMED_NUMBER)) {
            names.set(name, Number(value));
            if (!global.has(name)) global.set(name, new Set());
            global.get(name)!.add(Number(value));
        }
        local.set(file, names);
    }
    const resolve = (file: string, token: string | undefined): number | undefined => {
        if (!token) return undefined;
        if (/^\d+$/.test(token)) return Number(token);
        const name = token.split(".").pop()!;
        const own = local.get(file)?.get(name);
        if (own !== undefined) return own;
        const values = global.get(name);
        return values?.size === 1 ? [...values][0] : undefined;
    };
    const uses: VarUse[] = [];
    for (const [file, text] of files) {
        const lines = text.split("\n");
        const where = (offset: number) => `${path.relative(REPO_ROOT, file)}:${text.slice(0, offset).split("\n").length}`;
        const add = (kind: VarKind, id: number | undefined, offset: number) => {
            if (id !== undefined && id >= 0) uses.push({ kind, id, where: where(offset) });
        };
        for (const match of text.matchAll(VAR_CALL)) {
            const kind: VarKind = match[1] === "Varbit" ? "varbit" : "varp";
            // Helpers that take the player first: the id is the second argument.
            const first = /^[a-z]/.test(match[2]) && !/^\d/.test(match[2]) && resolve(file, match[2]) === undefined;
            const token = first ? match[3] : match[2];
            const id = resolve(file, token);
            // Number(x) wraps a value; a PascalCase name is a client plugin's config class, not a var.
            const last = token?.split(".").pop() ?? "";
            const varLike = /^[A-Z_]/.test(last) && last !== "Number" && !(token === last && /^[A-Z][a-z]/.test(last));
            if (id === undefined && token && varLike && !/(VARBITS|VARPS)$/.test(last)) unresolved.push(`${token} (${where(match.index!)})`);
            add(kind, id, match.index!);
        }
        for (const match of text.matchAll(VAR_MAP)) {
            const kind: VarKind = match[1] === "varbits" ? "varbit" : "varp";
            for (const key of match[2].matchAll(/(?:\[\s*([\w.]+)\s*\]|\b(\d+))\s*:/g)) {
                add(kind, resolve(file, key[1] ?? key[2]), match.index!);
            }
        }
        for (const match of text.matchAll(VAR_CONSTANT)) {
            add(/VARBIT/.test(match[1]) ? "varbit" : "varp", Number(match[2]), match.index!);
        }
        for (const match of text.matchAll(VAR_FIELD)) {
            add(/varbit/i.test(match[1]) ? "varbit" : "varp", Number(match[2]), match.index!);
        }
        for (const match of text.matchAll(VAR_ARRAY)) {
            for (const value of match[2].split(",").map((v) => v.trim()).filter(Boolean)) {
                add(/VARBIT/.test(match[1]) ? "varbit" : "varp", Number(value), match.index!);
            }
        }
        for (const match of text.matchAll(DATA_FIELD)) {
            add(match[1] as VarKind, Number(match[2]), match.index!);
        }
        void lines;
    }
    return uses;
}
const LITERAL_UID = /\(\s*(\d{1,4})\s*<<\s*16\s*\)\s*[|+]\s*(\d{1,5})/g;

function sourceFiles(dir: string, out: string[] = []): string[] {
    if (!fs.existsSync(dir)) return out;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === "dist") continue;
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(file, out);
        else if (/\.(ts|js|cjs)$/.test(entry.name)) out.push(file);
    }
    return out;
}

async function main(): Promise<void> {
    const [otherDir] = process.argv.slice(2).filter((a, i, args) => !a.startsWith("--") && args[i - 1] !== "--code");
    const all = process.argv.includes("--all");
    const otherIsOlder = process.argv.includes("--older");
    if (!otherDir || !fs.existsSync(path.join(otherDir, "main_file_cache.dat2"))) {
        console.error("usage: compare-cache <other cache directory> [--all]");
        process.exit(1);
    }
    await CachePipeline.initialize();
    // "current" is the older cache and "other" the newer from here on.
    const otherStore = new FileStore(path.resolve(otherDir));
    const [oldStore, newStore] = otherIsOlder ? [otherStore, CachePipeline.getStore()] : [CachePipeline.getStore(), otherStore];
    const [oldName, newName] = otherIsOlder
        ? [path.basename(path.resolve(otherDir)), CachePipeline.getActive().name]
        : [CachePipeline.getActive().name, path.basename(path.resolve(otherDir))];
    const current = new Gamevals(oldStore);
    const other = new Gamevals(newStore);

    console.log(`== Components by name: ${oldName} -> ${newName}`);
    const otherByName = new Map([...other.allInterfaces()].map(([group, iface]) => [iface.name, { group, iface }]));
    let moved = 0;
    let gone = 0;
    for (const [group, iface] of current.allInterfaces()) {
        const next = otherByName.get(iface.name);
        if (!next) {
            const reused = other.allInterfaces().get(group)?.name;
            console.log(`${iface.name} (${group}): interface gone${reused ? `; group ${group} is now ${reused}` : ""}`);
            continue;
        }
        const ids = new Map([...next.iface.components].map(([id, name]) => [name, id]));
        const changes: string[] = [];
        for (const [id, name] of iface.components) {
            const nextId = ids.get(name);
            if (nextId === undefined) {
                gone++;
                changes.push(`${name} ${id} -> gone`);
            } else if (nextId !== id || next.group !== group) {
                moved++;
                changes.push(`${name} ${id} -> ${next.group !== group ? `${next.group}:` : ""}${nextId}`);
            }
        }
        if (changes.length === 0) continue;
        console.log(`${iface.name} (${group}${next.group !== group ? ` -> ${next.group}` : ""}): ${changes.length} changed`);
        for (const change of all ? changes : changes.slice(0, 8)) console.log(`  ${change}`);
        if (!all && changes.length > 8) console.log(`  ... ${changes.length - 8} more (--all)`);
    }
    console.log(`${moved} components moved, ${gone} gone.`);

    console.log("\n== Literal (group << 16) | component in code");
    let hits = 0;
    for (const dir of SCAN_DIRS) {
        for (const file of sourceFiles(path.join(REPO_ROOT, dir))) {
            const lines = fs.readFileSync(file, "utf8").split("\n");
            lines.forEach((line, index) => {
                for (const match of line.matchAll(LITERAL_UID)) {
                    const uid = (Number(match[1]) << 16) | Number(match[2]);
                    const name = current.componentName(uid);
                    if (!name) continue;
                    const nextUid = other.componentId(name);
                    if (nextUid === uid) continue;
                    hits++;
                    const to = nextUid === null ? "gone" : `(${nextUid >>> 16} << 16) | ${nextUid & 0xffff}`;
                    console.log(`${path.relative(REPO_ROOT, file)}:${index + 1}  ${match[0]}  ${name} -> ${to}`);
                }
            });
        }
    }
    console.log(`${hits} literal component ids would point elsewhere. Ids kept in named constants need the list above.`);

    console.log("\n== DB table columns by name");
    const files = SCAN_DIRS.flatMap((dir) => sourceFiles(path.join(REPO_ROOT, dir)));
    const sources = new Map(files.map((file) => [file, fs.readFileSync(file, "utf8")]));
    let changedTables = 0;
    for (const [id, table] of current.allTables()) {
        const next = other.allTables().get(id);
        const changes: string[] = [];
        if (!next) {
            changes.push("table gone");
        } else if (next.name !== table.name) {
            changes.push(`table gone; table ${id} is now ${next.name}`);
        } else {
            table.columns.forEach((column, index) => {
                const nextIndex = next.columns.indexOf(column);
                if (nextIndex !== index) changes.push(`${column} ${index} -> ${nextIndex < 0 ? "gone" : nextIndex}`);
            });
        }
        if (changes.length === 0) continue;
        changedTables++;
        // A bare "table N" only counts in code that reads DB rows; "table 0" is common elsewhere.
        const direct = new RegExp(`(dbtable\\s*${id}\\b|TABLE[A-Z_]*\\s*=\\s*${id}\\b|getDbTableRows\\(\\s*${id}\\b)`, "i");
        const bare = new RegExp(`\\btable\\s+${id}\\b`, "i");
        const users = [...sources]
            .filter(([, text]) => direct.test(text) || (bare.test(text) && /getDbRow|getDbTableRows/.test(text)))
            .map(([file]) => path.relative(REPO_ROOT, file));
        console.log(`${table.name} (${id}): ${changes.length} changed${users.length ? `; mentioned in ${users.join(", ")}` : ""}`);
        for (const change of all ? changes : changes.slice(0, 8)) console.log(`  ${change}`);
        if (!all && changes.length > 8) console.log(`  ... ${changes.length - 8} more (--all)`);
    }
    console.log(`${changedTables} DB tables changed. Rows reached through getDbRow(row) need checking against the tables they belong to.`);

    console.log("\n== Varps and varbits used in code");
    const before = varDefinitions(oldStore);
    const after = varDefinitions(newStore);
    const dataFiles = DATA_DIRS.flatMap((dir) => fs.existsSync(path.join(REPO_ROOT, dir))
        ? fs.readdirSync(path.join(REPO_ROOT, dir)).filter((f) => f.endsWith(".json")).map((f) => path.join(REPO_ROOT, dir, f))
        : []);
    for (const file of dataFiles) sources.set(file, fs.readFileSync(file, "utf8"));
    const unresolved: string[] = [];
    const uses = varUses(sources, unresolved);
    const scriptsBefore = scriptVars(oldStore, revisionOf(oldName));
    const scriptsAfter = scriptVars(newStore, revisionOf(newName));
    const names = { varp: [current.namesOf(GamevalKind.VARP), other.namesOf(GamevalKind.VARP)], varbit: [current.namesOf(GamevalKind.VARBIT), other.namesOf(GamevalKind.VARBIT)] };
    const byVar = new Map<string, VarUse[]>();
    for (const use of uses) {
        const key = `${use.kind} ${use.id}`;
        if (!byVar.has(key)) byVar.set(key, []);
        byVar.get(key)!.push(use);
    }
    const broken: string[] = [];
    const movedBits: string[] = [];
    let renamed = 0;
    for (const [key, list] of [...byVar].sort((a, b) => a[1][0].id - b[1][0].id)) {
        const { kind, id } = list[0];
        const [oldName, newName] = names[kind].map((n) => n.get(id));
        let problem: string | undefined;
        const nameChanged = oldName !== undefined && newName !== oldName;
        if (kind === "varbit") {
            const was = before.varbits.get(id);
            const now = after.varbits.get(id);
            if (was && !now) problem = "gone";
            else if (was && now && was !== now) {
                // Same variable, other bits: harmless when it is only ever set by its varbit id.
                const oldBase = Number(/varp (\d+)/.exec(was)![1]);
                if (!nameChanged && !byVar.has(`varp ${oldBase}`)) {
                    movedBits.push(`${key} (${oldName ?? "unnamed"}): ${was} -> ${now}`);
                } else {
                    problem = `${was} -> ${now}${byVar.has(`varp ${oldBase}`) ? `; code also uses varp ${oldBase} directly` : ""}`;
                }
            } else if (nameChanged) {
                problem = "same bits, other name";
            }
        } else if (before.varps.has(id) && !after.varps.has(id)) {
            problem = "gone";
        } else if (nameChanged) {
            problem = "other name";
        }
        const label = `${key}${oldName ? ` (${oldName}${nameChanged ? ` -> ${newName ?? "unnamed"}` : ""})` : ""}`;
        if (problem) {
            const sameName = oldName ? [...names[kind][1]].find(([, n]) => n === oldName)?.[0] : undefined;
            const takeover = successors(key, scriptsBefore, scriptsAfter)
                .map(([v, n]) => {
                    const [k, num] = [v.replace(/ \d+$/, ""), Number(v.split(" ").pop())];
                    const vname = k === "varbit" ? names.varbit[1].get(num) : names.varp[1].get(num);
                    return `${v}${vname ? ` (${vname})` : ""} in ${n} script${n === 1 ? "" : "s"}`;
                });
            const hints = [
                sameName !== undefined && sameName !== id ? `the name is now ${kind} ${sameName}` : "",
                takeover.length ? `scripts that used it now use ${takeover.join(", ")}` : "",
            ].filter(Boolean).join("; ");
            broken.push(`${label}: ${problem}${hints ? `\n    -> ${hints}` : ""}\n    ${[...new Set(list.map((u) => u.where))].slice(0, all ? 50 : 4).join("\n    ")}`);
        } else if (nameChanged) {
            renamed++;
        }
    }
    for (const line of broken) console.log(line);
    if (movedBits.length) {
        console.log(`Same name on other bits (fine while only set by varbit id): ${movedBits.join("; ")}`);
    }
    console.log(`${byVar.size} vars used; ${broken.length} to check; ${movedBits.length} moved bits; ${renamed} renamed.`);
    if (unresolved.length) {
        console.log(`${unresolved.length} var ids in code could not be resolved to a number (not checked)${all ? `:\n  ${unresolved.join("\n  ")}` : "; --all lists them"}.`);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
