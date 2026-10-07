/**
 * Regenerates ItemIdentifiers.ts / NpcIdentifiers.ts / ObjectIdentifiers.ts
 * directly from the currently-active cache, so the constants always describe
 * what the loaded cache actually contains. Re-run this any time the cache
 * version changes.
 *
 * Naming convention (reverse-engineered from the existing files so already-
 * correct constants keep the same generated name run to run):
 *   "Iron dagger"          -> IRON_DAGGER
 *   "Iron dagger(p)"       -> IRON_DAGGER_P_
 *   "Iron dagger(p+)"      -> IRON_DAGGER_P_PLUS_
 *   "Iron dagger(p++)"     -> IRON_DAGGER_P_PLUS_PLUS_
 *   "Amulet of glory(4)"   -> AMULET_OF_GLORY_4_
 *   "Knight's notes"       -> KNIGHTS_NOTES (apostrophes dropped)
 *   nameless/"null" cache slots are skipped entirely.
 *
 * Duplicate display names (the cache genuinely has multiple ids sharing the
 * exact same name - "Coins" alone shows up at both id 617 and id 995 in the
 * live cache, "Banker" dozens of times, etc.) are the dangerous case: a
 * naive "assign _2/_3 in ascending id order" scheme will happily hand the
 * bare name to whichever id happens to be numerically lowest, silently
 * repointing an already-correct, heavily-relied-on constant (e.g. flipping
 * COINS from 995 to 617). To avoid that, generation is seeded from the
 * last git-committed version of each file: for any duplicate-name group,
 * an id that the previous file already named is preferentially given that
 * exact same name again. Only ids with no prior claim (new cache content,
 * or genuinely-renumbered content the old name no longer matches at all)
 * get freshly assigned names. This keeps regeneration a targeted diff
 * instead of a full reshuffle.
 *
 * Usage:
 *   yarn ts-node scripts/generate-identifiers.ts             # regenerate all three
 *   yarn ts-node scripts/generate-identifiers.ts items        # just one
 *   yarn ts-node scripts/generate-identifiers.ts --dry-run    # report only, don't write
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";

function suffixToTokens(inner: string): string[] {
    const poison = inner.match(/^p(\+*)$/i);
    if (poison) {
        const tokens = ["P"];
        for (let i = 0; i < poison[1].length; i++) tokens.push("PLUS");
        return tokens;
    }
    return inner
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((t) => t.toUpperCase());
}

function toConstName(rawName: string | undefined): string | undefined {
    if (!rawName || rawName === "null") return undefined;

    const parenMatch = rawName.match(/^(.*?)\(([^()]*)\)\s*$/);
    let base = rawName;
    let suffixTokens: string[] = [];
    if (parenMatch) {
        base = parenMatch[1].trim();
        suffixTokens = suffixToTokens(parenMatch[2].trim());
    }

    const baseTokens = base
        .replace(/'/g, "")
        .split(/[^a-zA-Z0-9]+/)
        .filter(Boolean)
        .map((t) => t.toUpperCase());

    let tokens = [...baseTokens, ...suffixTokens];
    if (tokens.length === 0) return undefined;

    let constName = tokens.join("_");
    if (suffixTokens.length > 0) constName += "_";
    if (/^[0-9]/.test(constName)) constName = "_" + constName;
    return constName;
}

type GeneratedEntry = { id: number; constName: string; rawName: string };

/** Parses `public static NAME = ID;` declarations (with or without `public`). */
function parseNameToId(source: string): Map<string, number> {
    const re = /(?:public\s+)?static (\w+)\s*=\s*(\d+);/g;
    const map = new Map<string, number>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
        map.set(m[1], Number(m[2]));
    }
    return map;
}

/** Reads the last git-committed version of a file, or null if there isn't one (new file / no git). */
function loadCommittedNameToId(filePath: string): Map<string, number> {
    // `HEAD:./file` resolves against git's working directory (the file's own folder), so this
    // works from any cwd. The item and object files are over 1 MB, past execFileSync's default
    // buffer. Without the committed names every constant is renamed, so say so if it fails.
    try {
        const source = execFileSync("git", ["show", `HEAD:./${path.basename(filePath)}`], {
            cwd: path.dirname(filePath),
            encoding: "utf8",
            maxBuffer: 64 * 1024 * 1024,
        });
        return parseNameToId(source);
    } catch (error) {
        console.warn(`  could not read the committed ${path.basename(filePath)}; names will not be kept stable (${(error as Error).message.split("\n")[0]})`);
        return new Map();
    }
}

function generateEntries(
    count: number,
    lookup: (id: number) => { name?: string } | undefined,
    previousNameToId: Map<string, number>,
): GeneratedEntry[] {
    // Group every named cache entry by its mechanically-derived base name,
    // in ascending id order.
    const groups = new Map<string, Array<{ id: number; rawName: string }>>();
    for (let id = 0; id < count; id++) {
        const rawName = lookup(id)?.name;
        const base = toConstName(rawName);
        if (!base) continue;
        if (!groups.has(base)) groups.set(base, []);
        groups.get(base)!.push({ id, rawName: rawName! });
    }

    // Reverse index of the previously-committed file: which name(s) did it
    // assign to a given id.
    const previousIdToNames = new Map<number, string[]>();
    for (const [name, id] of previousNameToId) {
        if (!previousIdToNames.has(id)) previousIdToNames.set(id, []);
        previousIdToNames.get(id)!.push(name);
    }

    const entries: GeneratedEntry[] = [];
    const usedNames = new Set<string>();

    // A committed constant stays on its id when that id still exists but has lost its display
    // name (rev 241 blanked Morgan, some walls...: same thing, transformed or renamed to null).
    // Following the name instead would move the constant onto a different object.
    for (const [name, id] of previousNameToId) {
        if (id < 0 || id >= count || toConstName(lookup(id)?.name)) continue;
        usedNames.add(name);
        entries.push({ id, constName: name, rawName: "(no name in this revision)" });
    }

    for (const [base, members] of groups) {
        // Pass 1: honor any id in this group that the previous file already
        // named consistently with this base (NAME, NAME_2, NAME_3, ...).
        const claimedIds = new Set<number>();
        for (const member of members) {
            const priorNames = previousIdToNames.get(member.id) ?? [];
            const match = priorNames.find((n) => n === base || n.startsWith(`${base}_`));
            if (match && !usedNames.has(match)) {
                usedNames.add(match);
                claimedIds.add(member.id);
                entries.push({ id: member.id, constName: match, rawName: member.rawName });
            }
        }
        // Pass 2: assign fresh names (lowest free slot) to whatever's left. A name the committed
        // file gave another id is never reused: a renamed id drops its constant (a compile
        // error to fix) rather than the constant silently pointing at something else.
        for (const member of members) {
            if (claimedIds.has(member.id)) continue;
            let constName = base;
            let suffix = 1;
            while (usedNames.has(constName) || previousNameToId.has(constName)) {
                suffix++;
                constName = `${base}_${suffix}`;
            }
            usedNames.add(constName);
            entries.push({ id: member.id, constName, rawName: member.rawName });
        }
    }

    entries.sort((a, b) => a.id - b.id);
    return entries;
}

function renderClass(className: string, entries: GeneratedEntry[]): string {
    const lines: string[] = [`export class ${className} {`, ""];
    for (const entry of entries) {
        lines.push(`    public static ${entry.constName} = ${entry.id}; // ${entry.rawName}`);
    }
    lines.push("}", "");
    return lines.join("\n");
}

function diffStats(previous: Map<string, number>, entries: GeneratedEntry[]): { added: number; changed: number; removed: number; unchanged: number } {
    const next = new Map(entries.map((e) => [e.constName, e.id]));
    let added = 0, changed = 0, unchanged = 0;
    for (const [name, id] of next) {
        if (!previous.has(name)) added++;
        else if (previous.get(name) !== id) changed++;
        else unchanged++;
    }
    let removed = 0;
    for (const name of previous.keys()) {
        if (!next.has(name)) removed++;
    }
    return { added, changed, removed, unchanged };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes("--dry-run");
    const requested = args.filter((a) => !a.startsWith("--"));
    const only = requested.length > 0 ? new Set(requested) : null;

    await CachePipeline.initialize();
    const counts = CacheDefinitions.getCounts();

    const targets = [
        {
            key: "items",
            className: "ItemIdentifiers",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/ItemIdentifiers.ts"),
            count: counts.items,
            lookup: (id: number) => CacheDefinitions.getItem(id),
        },
        {
            key: "npcs",
            className: "NpcIdentifiers",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/NpcIdentifiers.ts"),
            count: counts.npcs,
            lookup: (id: number) => CacheDefinitions.getNpc(id),
        },
        {
            key: "objects",
            className: "ObjectIdentifiers",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/ObjectIdentifiers.ts"),
            count: counts.objects,
            lookup: (id: number) => CacheDefinitions.getObject(id),
        },
    ];

    for (const target of targets) {
        if (only && !only.has(target.key)) continue;

        const previous = loadCommittedNameToId(target.file);
        const entries = generateEntries(target.count, target.lookup, previous);
        const stats = diffStats(previous, entries);
        console.log(
            `${target.key}: ${entries.length} named entries (of ${target.count} total) | ` +
            `added=${stats.added} changed=${stats.changed} removed=${stats.removed} unchanged=${stats.unchanged}`,
        );

        if (!dryRun) {
            fs.writeFileSync(target.file, renderClass(target.className, entries));
            console.log(`  wrote ${target.file}`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
