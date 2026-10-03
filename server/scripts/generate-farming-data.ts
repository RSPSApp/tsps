// Cache audit/data export, not a server or smoke test.
// node -r ts-node/register/transpile-only scripts/generate-farming-data.ts <RuneLite checkout>
import fs = require("fs");
import path = require("path");
import { CachePipeline } from "../src/main/typescript/elvarg/game/cache/CachePipeline";
import { CacheDefinitions } from "../src/main/typescript/elvarg/game/cache/CacheDefinitions";
import { CacheMaps } from "../src/main/typescript/elvarg/game/cache/CacheMaps";
import { ByteBuffer } from "../src/main/typescript/elvarg/game/cache/codec/rs/io/ByteBuffer";
import { ObjectIdentifiers } from "../src/main/typescript/elvarg/util/ObjectIdentifiers";

const SOURCE = "Crop timings and patch states from RuneLite's PatchImplementation.java and Produce.java "
    + "(Copyright (c) 2019 Abex, BSD-2-Clause, https://github.com/runelite/runelite), adapted for this cache.";

function inline(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
    if (value && typeof value === "object") {
        return `{ ${Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`).join(", ")} }`;
    }
    return JSON.stringify(value);
}

/** Top-level keys on their own lines, then one line per crop, patch type, patch and loc. */
function oneEntryPerLine(data: Record<string, unknown>): string {
    const fields = Object.entries(data).map(([key, value]) => {
        if (Array.isArray(value)) return `  ${JSON.stringify(key)}: [\n${value.map((entry) => `    ${inline(entry)}`).join(",\n")}\n  ]`;
        if (value && typeof value === "object") {
            const rows = Object.entries(value).map(([name, entry]) => `    ${JSON.stringify(name)}: ${inline(entry)}`);
            return `  ${JSON.stringify(key)}: {\n${rows.join(",\n")}\n  }`;
        }
        return `  ${JSON.stringify(key)}: ${inline(value)}`;
    });
    return `{\n${fields.join(",\n")}\n}\n`;
}

async function main() {
    const root = path.resolve(__dirname, "..");
    await CachePipeline.initialize(root);
    const rl = process.argv[2];
    if (!rl) throw new Error("Pass the RuneLite checkout path");
    const reference = path.join(rl, "runelite-client/src/main/java/net/runelite/client/plugins/timetracking/farming");
    const source = fs.readFileSync(path.join(reference, "PatchImplementation.java"), "utf8");
    const produceSource = fs.readFileSync(path.join(reference, "Produce.java"), "utf8");
    const timing: Record<string, any> = {};
    for (const match of produceSource.matchAll(/^\s*([A-Z_]+)\("([^"\n]+)", (?:"[^"\n]+", )?PatchImplementation\.([A-Z_]+), ItemID\.\w+, (\d+), (\d+)(?:, (\d+), (\d+))?\)/gm)) {
        timing[match[1]] = { name: match[2], type: match[3], minutes: +match[4], stages: +match[5] - 1, regrow: +(match[6] ?? 0), lives: +(match[7] ?? 1) - 1 };
    }
    const states: Record<string, Record<string, Record<string, number[]>>> = {};
    const firstObjects = new Map<number, string>();
    for (const match of source.matchAll(/\t([A-Z_]+)\(Tab\.[^\n]+\n\s*\{\s*@Override\s*PatchState forVarbitValue\(int value\)\s*\{([\s\S]*?)\n\t\t\t\}/g)) {
        const type = match[1];
        const body = match[2].replace(/\/\/[^\n]*/g, "")
            .replace(/Produce\.([A-Z_]+)\.getStages\(\)/g, (_, crop) => String((timing[crop]?.stages ?? 0) + 1))
            .replace(/Produce\.([A-Z_]+)/g, '"$1"').replace(/CropState\.([A-Z_]+)/g, '"$1"')
            .replace(/new PatchState\(([^;]+)\)/g, "[$1]");
        const decode = new Function("value", body);
        states[type] = {};
        for (let value = 0; value < 256; value++) {
            const decoded = decode(value);
            if (!decoded) continue;
            const [crop, status, stage] = decoded;
            const entries = states[type][crop] ??= {};
            const values = entries[status] ??= [];
            if (values[stage] === undefined) values[stage] = value;
            else if (["ALLOTMENT", "FLOWER", "HOPS"].includes(type) && status === "GROWING" && crop !== "WEEDS" && value === values[stage] + 64) {
                (entries.WATERED ??= [])[stage] = value;
            }
        }
        const comment = match[2].match(/\/\/[^\n]*?\]\s+(\d+)/);
        if (comment) firstObjects.set(+comment[1], type);
    }
    // Every real patch is a multiloc. Its first variant identifies its family.
    const patchObjects = new Map<number, { type: string; varbit: number }>();
    for (let id = 0; id < CacheDefinitions.getCounts().objects; id++) {
        const loc = CacheDefinitions.getObject(id);
        const type = loc.transforms && firstObjects.get(loc.transforms[0]);
        if (type && loc.transformVarbit >= 0) patchObjects.set(id, { type, varbit: loc.transformVarbit });
    }
    const signatures = [...patchObjects].map(([id, patch]) => ({ type: patch.type, transforms: CacheDefinitions.getObject(id).transforms }));
    for (let id = 0; id < CacheDefinitions.getCounts().objects; id++) {
        const loc = CacheDefinitions.getObject(id);
        if (!loc.transforms || loc.transformVarbit < 0 || patchObjects.has(id)) continue;
        // Regional variants can use different models for the same farming states
        // (notably Port Phasmatys's flower patch and compost bin).
        const match = signatures.find(s => loc.transforms.length === s.transforms.length
            && (loc.transforms.slice(4, 14).filter((value, i) => value >= 0 && value === s.transforms[i + 4]).length >= 8
                || ["FLOWER", "COMPOST"].includes(s.type)
                    && CacheDefinitions.getObject(loc.transforms[0]).name === CacheDefinitions.getObject(s.transforms[0]).name
                    && loc.transforms.slice(4, 14).filter((value, i) => value >= 0 && s.transforms[i + 4] >= 0
                        && CacheDefinitions.getObject(value).name === CacheDefinitions.getObject(s.transforms[i + 4]).name).length >= 8));
        if (match) patchObjects.set(id, { type: match.type, varbit: loc.transformVarbit });
        if (loc.transforms.length > 100 && CacheDefinitions.getObject(loc.transforms[0]).name === "Herb patch") {
            patchObjects.set(id, { type: "HERB", varbit: loc.transformVarbit });
        }
        if (CacheDefinitions.getObject(loc.transforms[0]).name === "Vine patch" && CacheDefinitions.getObject(loc.transforms[1]).name === "Treated patch") {
            patchObjects.set(id, { type: "GRAPES", varbit: loc.transformVarbit });
        }
    }
    for (const [id, patch] of patchObjects) {
        const transforms = CacheDefinitions.getObject(id).transforms;
        for (const visual of Object.values(states[patch.type])) {
            if (!visual.HARVESTABLE || !visual.GROWING) continue;
            const start = Math.min(...visual.GROWING.filter(Number.isFinite));
            const last = Math.max(...[...visual.HARVESTABLE, ...visual.GROWING].filter(Number.isFinite));
            for (let value = start; value <= last + 1; value++) {
                const stump = transforms[value];
                if (stump >= 0 && /stump/i.test(CacheDefinitions.getObject(stump).name)) visual.STUMP = [value];
            }
        }
    }
    const patches: any[] = [];
    const scenery: any[] = [];
    const unreadable: number[] = [];
    for (const region of CacheMaps.getRegionIds()) {
        const data = CacheMaps.getRegion(region)?.objectData;
        if (!data) continue;
        const regionPatches: any[] = [];
        const regionScenery: any[] = [];
        try {
        const buffer = new ByteBuffer(new Int8Array(data));
        let objectId = -1;
        for (;;) {
            const delta = buffer.readSmart3();
            if (!delta) break;
            objectId += delta;
            let packed = 0;
            for (;;) {
                const step = buffer.readUnsignedShortSmart();
                if (!step) break;
                packed += step - 1;
                const info = buffer.readUnsignedByte();
                const x = (region >> 8) * 64 + (packed >> 6 & 63), y = (region & 255) * 64 + (packed & 63), z = packed >> 12;
                const patch = patchObjects.get(objectId);
                if (patch) regionPatches.push({ id: objectId, ...patch, x: (region >> 8) * 64 + (packed >> 6 & 63), y: (region & 255) * 64 + (packed & 63), z: packed >> 12 });
                if (objectId === ObjectIdentifiers.TITHE_PATCH && y >= 3485) {
                    regionScenery.push({ id: objectId, x, y, z, shape: info >> 2, face: info & 3 });
                }
            }
        }
        patches.push(...regionPatches);
        scenery.push(...regionScenery);
        } catch { unreadable.push(region); }
    }
    const directory = path.join(root, "data/definitions");
    // Allotments and hops have a separate multiloc on each tile of ONE patch.
    const grouped: any[] = [];
    for (const patch of patches) {
        const existing = grouped.find(p => p.id === patch.id && p.z === patch.z && Math.abs(p.x - patch.x) < 32 && Math.abs(p.y - patch.y) < 32);
        if (!existing) grouped.push({ ...patch, maxX: patch.x, maxY: patch.y });
        else { existing.maxX = Math.max(existing.maxX, patch.x); existing.maxY = Math.max(existing.maxY, patch.y); }
    }
    const data = { revision: CachePipeline.getActive().revision, source: SOURCE, timing, states, patches: grouped, scenery };
    fs.writeFileSync(path.join(directory, "farming-data.json"), oneEntryPerLine(data));
    console.log(JSON.stringify({ crops: Object.keys(timing).length, patchObjects: patchObjects.size, patches: grouped.length, unreadable }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
