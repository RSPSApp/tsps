import * as fs from "fs";
import * as path from "path";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";

// Words that show up in identifier constant names but aren't part of the
// cache item/npc/object's actual display name - variant/quality/state
// suffixes. Stripped before comparing so they don't cause false mismatches.
const NOISE_WORDS = new Set([
    "p", "plus", "or", "noted", "note", "i", "ii", "iii", "iv", "v",
    "deadman", "dmm", "broken", "inactive", "active", "c", "e", "u",
    "charged", "uncharged", "empty", "full", "used", "unused", "kp",
    "l", "r", "t", "b", "unf", "unfinished", "raw", "cooked", "burnt",
]);

type Row = { id: number; constName: string; cacheName: string | undefined; status: "OK" | "MISMATCH" | "MISSING" | "COPY" };

function wordsFromConstName(constName: string): Set<string> {
    // Drop a trailing purely-numeric variant suffix, e.g. _2, _3.
    const stripped = constName.replace(/_\d+$/, "");
    return new Set(
        stripped
            .split("_")
            .map((w) => w.toLowerCase())
            .filter((w) => w.length > 0 && !NOISE_WORDS.has(w) && !/^\d+$/.test(w)),
    );
}

function wordsFromCacheName(cacheName: string): Set<string> {
    return new Set(
        cacheName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, " ")
            .split(" ")
            .filter((w) => w.length > 0 && !NOISE_WORDS.has(w)),
    );
}

function auditFile(
    filePath: string,
    lookup: (id: number) => string | undefined,
    isCopy: (id: number) => boolean = () => false,
): Row[] {
    const source = fs.readFileSync(filePath, "utf8");
    const re = /(?:public\s+)?static (\w+)\s*=\s*(\d+);/g;
    const rows: Row[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
        const constName = match[1];
        const id = Number(match[2]);
        const cacheName = lookup(id);
        if (cacheName === undefined || cacheName === "null") {
            rows.push({ id, constName, cacheName, status: "MISSING" });
            continue;
        }
        const expected = wordsFromConstName(constName);
        const actual = wordsFromCacheName(cacheName);
        let shared = 0;
        for (const w of actual) if (expected.has(w)) shared++;
        const ok = actual.size === 0 || shared > 0;
        rows.push({ id, constName, cacheName, status: ok ? "OK" : "MISMATCH" });
    }
    // A bare name on a bank placeholder or noted copy while a real item has the same display
    // name (generate-identifiers keeps bare names on real items).
    const realNames = new Set(rows.filter((row) => row.status === "OK" && !isCopy(row.id)).map((row) => row.cacheName));
    for (const row of rows) {
        const bare = !/_\d+$/.test(row.constName);
        if (row.status === "OK" && bare && isCopy(row.id) && realNames.has(row.cacheName)) row.status = "COPY";
    }
    return rows;
}

async function main() {
    await CachePipeline.initialize();

    const targets: Array<{
        name: string;
        file: string;
        lookup: (id: number) => string | undefined;
        isCopy?: (id: number) => boolean;
    }> = [
        {
            name: "items",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/ItemIdentifiers.ts"),
            lookup: (id) => CacheDefinitions.getItem(id)?.name,
            isCopy: (id) => {
                const item = CacheDefinitions.getItem(id);
                return !!item && (item.placeholderTemplate >= 0 || item.noteTemplate >= 0);
            },
        },
        {
            name: "npcs",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/NpcIdentifiers.ts"),
            lookup: (id) => CacheDefinitions.getNpc(id)?.name,
        },
        {
            name: "objects",
            file: path.join(__dirname, "../src/main/typescript/elvarg/util/ObjectIdentifiers.ts"),
            lookup: (id) => CacheDefinitions.getObject(id)?.name,
        },
    ];

    for (const target of targets) {
        const rows = auditFile(target.file, target.lookup, target.isCopy);
        const ok = rows.filter((r) => r.status === "OK").length;
        const mismatch = rows.filter((r) => r.status === "MISMATCH");
        const missing = rows.filter((r) => r.status === "MISSING");
        const copies = rows.filter((r) => r.status === "COPY");

        console.log(
            `\n=== ${target.name}: ${rows.length} constants | OK=${ok} MISMATCH=${mismatch.length} ` +
                `MISSING=${missing.length} COPY=${copies.length} ===`,
        );

        const outDir = path.join(__dirname, "../data/audit");
        fs.mkdirSync(outDir, { recursive: true });
        const outFile = path.join(outDir, `${target.name}-identifier-mismatches.json`);
        fs.writeFileSync(outFile, JSON.stringify({ mismatch, missing, copies }, null, 2));
        console.log(`  full mismatch/missing list written to ${outFile}`);

        for (const row of copies) {
            console.log(`  COPY      ${row.constName} = ${row.id} is a placeholder or noted copy; a real item has the same name`);
        }
        for (const row of mismatch.slice(0, 25)) {
            console.log(`  MISMATCH  ${row.constName} = ${row.id}  ->  cache says "${row.cacheName}"`);
        }
        if (mismatch.length > 25) {
            console.log(`  ... and ${mismatch.length - 25} more (see JSON file)`);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
