#!/usr/bin/env node
// Import explicit, exact-ID Wiki player-tradeability without changing the cache's GE flag.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export const normalizedItemName = (name) => name.normalize("NFKC").replace(/_/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

export function importTradeability(source, cache) {
    if (source?.schema !== 1 || !/^[a-f0-9]{64}$/.test(source.input_sha256 ?? "") || !Array.isArray(source.rows)) {
        throw new Error("Invalid explicit item-player-tradeability source contract");
    }
    const seen = new Set(), rows = [], rejected = [], disagreements = [];
    for (const row of source.rows) {
        if (!Number.isSafeInteger(row?.id) || row.id < 0 || seen.has(row.id)
            || typeof row.name !== "string" || !row.name.trim()
            || typeof row.playerTradeable !== "boolean" || typeof row.sourcePage !== "string" || !row.sourcePage.trim()
            || !(row.noteable === null || typeof row.noteable === "boolean")
            || !(row.sourceVersion === null || (Number.isSafeInteger(row.sourceVersion) && row.sourceVersion > 0))) {
            throw new Error("Malformed or duplicate explicit item-player-tradeability row");
        }
        seen.add(row.id);
        const active = cache.get(row.id);
        if (!active) { rejected.push({ ...row, reason: "unknown-cache-id" }); continue; }
        if (active.placeholder) { rejected.push({ ...row, reason: "cache-placeholder", cacheName: active.name }); continue; }
        if (normalizedItemName(active.name) !== normalizedItemName(row.name)) {
            rejected.push({ ...row, reason: "cache-name-mismatch", cacheName: active.name }); continue;
        }
        rows.push({ id: row.id, name: active.name, playerTradeable: row.playerTradeable,
            noteable: row.noteable, sourcePage: row.sourcePage, sourceVersion: row.sourceVersion });
        if (active.playerTradeable !== row.playerTradeable) disagreements.push({ ...rows.at(-1),
            cachePlayerTradeable: active.playerTradeable, ge: active.ge, noteBaseId: active.noteBaseId ?? null });
    }
    for (const list of [rows, rejected, disagreements]) list.sort((a, b) => a.id - b.id);
    return { definitions: { schema: 1, input_sha256: source.input_sha256, rows }, report: {
        sourceRows: source.rows.length, accepted: rows.length, rejected, disagreements,
        sourceDiagnostics: source.diagnostics ?? [],
    } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const option = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
    const sourceFile = option("--source"), auditFile = option("--audit"), outFile = option("--out");
    if (!sourceFile || !auditFile) throw new Error("Usage: --source <canonical export> --audit <report> [--out <generated data>] [--check]");
    const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    process.chdir(server);
    const require = createRequire(import.meta.url);
    require("../dist/Server").Server.installProductionPathResolver();
    await require("../dist/game/cache/CachePipeline").CachePipeline.initialize();
    const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
    const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
    const cache = new Map();
    for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
        const item = ItemDefinition.forId(id);
        const raw = CacheDefinitions.getItem(id);
        cache.set(id, { id, name: item.getName(), playerTradeable: item.isPlayerTradeable(), ge: item.isTradeable(),
            placeholder: raw.placeholderTemplate !== -1, noteBaseId: item.isNoted() ? item.getNoteId() : null });
    }
    const sourceBytes = fs.readFileSync(sourceFile), source = JSON.parse(sourceBytes);
    const result = importTradeability(source, cache);
    result.definitions.export_sha256 = crypto.createHash("sha256").update(sourceBytes).digest("hex");
    result.report.export_sha256 = result.definitions.export_sha256;
    result.report.input_sha256 = source.input_sha256;
    const classified = new Set(result.definitions.rows.map((row) => row.id));
    result.report.cacheItems = cache.size;
    result.report.unclassified = [...cache.values()].filter((row) => !classified.has(row.id));
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    fs.writeFileSync(auditFile, JSON.stringify(result.report, null, 2) + "\n");
    if (outFile) {
        const output = JSON.stringify(result.definitions, null, 2) + "\n";
        if (args.includes("--check")) {
            if (fs.readFileSync(outFile, "utf8") !== output) throw new Error("Imported tradeability data is stale");
        } else fs.writeFileSync(outFile, output);
    }
    console.log(JSON.stringify({ accepted: result.report.accepted, rejected: result.report.rejected.length,
        disagreements: result.report.disagreements.length, unclassified: result.report.unclassified.length }));
}
