/**
 * Runs every client script in a cache once, in a VM with the cache's real loaders and widgets,
 * and reports:
 *  - stack mismatches: an instruction whose handler popped or pushed other than its signature
 *    (rs/cs2/CommandSignatures.ts) says. Always a VM bug, whatever the script was doing.
 *  - handler crashes: a JavaScript error (TypeError, ...) inside a handler. Always a VM bug.
 *  - handler shapes: the same check for every handler, each run on its own on a stack of neutral
 *    values (0, "", 0n), so instructions no script reaches here are covered too. A handler
 *    that throws on those values is listed as unchecked.
 *  - script errors: a script stopped (bad array index, opcount, ...). Scripts run here with
 *    default arguments and state, so some of these are only the harness; compare two caches
 *    (--compare) to see the ones a revision brought.
 *
 *   npx tsx scripts/cache/cs2-sweep.ts [cacheDir] [--compare otherCacheDir] [--json out.json]
 */
import fs from "fs";
import path from "path";

import { ClientScriptLoader } from "../../game/cs2/ClientScriptLoader";
import { CacheFiles } from "../../rs/cache/CacheFiles";
import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { Dat2CacheLoaderFactory } from "../../rs/cache/loader/Dat2CacheLoaderFactory";
import { VarManager } from "../../rs/config/vartype/VarManager";
import { COMMAND_SIGNATURES } from "../../rs/cs2/CommandSignatures";
import { Cs2Vm, ExecutionState } from "../../rs/cs2/Cs2Vm";
import { DbRepository } from "../../rs/config/db/DbRepository";
import { WidgetLoader } from "../../widgets/WidgetLoader";
import { WidgetManager } from "../../widgets/WidgetManager";
import { loadCache, loadCacheInfos, loadCacheList } from "./load-util";

export interface StackMismatch {
    opcode: number;
    name: string;
    expected: string;
    actual: string;
    count: number;
    example: string;
}

export interface SweepReport {
    cache: string;
    scripts: number;
    mismatches: StackMismatch[];
    shapeMismatches: StackMismatch[];
    /** Opcodes whose handler threw on neutral values: shape not checked. */
    shapeUnchecked: number[];
    /** "message" -> script ids. */
    crashes: Map<string, number[]>;
    /** script id -> first error. */
    errors: Map<number, string>;
}

export function loadCacheSystem(dir?: string): { name: string; cache: CacheSystem; info: any } {
    if (!dir) {
        const info = loadCacheList(loadCacheInfos()).latest;
        return { name: info.name, info, cache: CacheSystem.fromFiles(info, loadCache(info).files) };
    }
    const meta = JSON.parse(fs.readFileSync(path.join(dir, "info.json"), "utf8"));
    const info: any = {
        name: path.basename(dir), game: meta.game, environment: meta.environment,
        revision: meta.builds[0].major, timestamp: meta.timestamp, size: meta.size,
    };
    const files = new Map<string, ArrayBuffer>();
    for (const file of fs.readdirSync(dir)) {
        const bytes = fs.readFileSync(path.join(dir, file));
        files.set(file, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    }
    return { name: info.name, info, cache: CacheSystem.fromFiles(info, new CacheFiles(files)) };
}

const count = (stacks: string, kind: string) => [...stacks].filter((s) => s === kind).length;
const expectedDelta = (signature: [string, string, string]) =>
    ["i", "s", "l"].map((k) => count(signature[2], k) - count(signature[1], k));
const describe = (d: number[]) => `int ${d[0]}, obj ${d[1]}, long ${d[2]}`;
const isChecked = (signature?: [string, string, string]) =>
    !!signature && !signature[1].includes("?") && !signature[2].includes("?");

const NEUTRAL_DEPTH = 64;

/** Runs each checked handler alone on a stack of neutral values and compares its stack effect. */
function checkHandlerShapes(vm: any): { mismatches: StackMismatch[]; unchecked: number[] } {
    const ctx = (vm.cachedHandlerContext ??= vm.createHandlerContext());
    const mismatches: StackMismatch[] = [];
    const unchecked: number[] = [];
    for (const [opcode, handler] of [...vm.handlers.entries()] as [number, Function][]) {
        const signature = COMMAND_SIGNATURES[opcode];
        if (!isChecked(signature)) continue;
        vm.intStack.fill(0, 0, NEUTRAL_DEPTH);
        vm.stringStack.fill("", 0, NEUTRAL_DEPTH);
        vm.longStack.fill(0n, 0, NEUTRAL_DEPTH);
        vm.intStackSize = vm.stringStackSize = vm.longStackSize = NEUTRAL_DEPTH;
        try {
            handler(ctx, 0, "");
        } catch {
            unchecked.push(opcode);
            continue;
        }
        const actual = [vm.intStackSize, vm.stringStackSize, vm.longStackSize].map((n) => n - NEUTRAL_DEPTH);
        const expected = expectedDelta(signature);
        if (actual.some((delta, i) => delta !== expected[i])) {
            mismatches.push({
                opcode, name: signature[0], count: 1,
                expected: describe(expected), actual: describe(actual), example: "alone",
            });
        }
    }
    vm.intStackSize = vm.stringStackSize = vm.longStackSize = 0;
    return { mismatches, unchecked };
}
const isVmBug = (error: unknown) =>
    error instanceof TypeError || error instanceof RangeError || error instanceof ReferenceError;

/** A VM over one cache's real loaders and widgets, with what the game client supplies stubbed. */
export function createCacheVm(dir?: string) {
    const { name, info, cache } = loadCacheSystem(dir);
    const loaders = new Dat2CacheLoaderFactory(info, "dat2", cache);
    const scripts = new ClientScriptLoader({ getCacheSystem: () => cache } as any);
    const vm: any = new Cs2Vm({
        loadScript: (id: number) => scripts.load(id),
        widgetManager: new WidgetManager(cache, new WidgetLoader(cache)),
        varManager: new VarManager(loaders.getVarBitTypeLoader(), loaders.getVarcIntTypeLoader()),
        objTypeLoader: loaders.getObjTypeLoader(),
        paramTypeLoader: loaders.getParamTypeLoader(),
        enumTypeLoader: loaders.getEnumTypeLoader(),
        structTypeLoader: loaders.getStructTypeLoader(),
        npcTypeLoader: loaders.getNpcTypeLoader(),
        locTypeLoader: loaders.getLocTypeLoader(),
        dbRepository: new DbRepository(cache),
        clientRevision: info.revision,
        windowMode: 2,
        // What the game client (game/OsrsClient.ts) supplies for the camera, minimap and tiles.
        setViewportFovValues: () => {},
        getViewportFovValues: () => ({ low: 256, high: 205 }),
        setViewportZoomRange: () => {},
        configureTileHighlight: () => {},
        clearTileHighlights: () => {},
        hasTileHighlight: () => false,
        setTileHighlight: () => {},
        removeTileHighlight: () => {},
        // Text metrics (game/OsrsClient.ts measures with the cache fonts); sizes only need to be sane.
        getTextWidth: (text: string) => String(text ?? "").replace(/<[^>]*>/g, "").length * 6,
        getTextHeight: () => 12,
        splitTextLines: (text: string) => String(text ?? "").split(/<br>/i),
        getMinimapZoom: () => 4,
        setMinimapZoom: () => {},
        setMinimapZoomable: () => {},
        setMinimapIconZoomLimit: () => {},
    } as any);
    return { name, info, cache, scripts, vm };

}

export function sweepScripts(dir?: string, maxOpcount = 100_000): SweepReport {
    const { name, cache, scripts, vm } = createCacheVm(dir);

    const silenced = [console.log, console.warn, console.error, console.info, console.debug];
    console.log = console.warn = console.error = console.info = console.debug = () => {};
    let shapes: ReturnType<typeof checkHandlerShapes>;
    try {
        shapes = checkHandlerShapes(vm);
    } finally {
        [console.log, console.warn, console.error, console.info, console.debug] = silenced;
    }

    const mismatches = new Map<number, StackMismatch>();
    const crashes = new Map<string, number[]>();
    let handlerError: { error: unknown; opcode: number } | undefined;
    for (const [opcode, handler] of [...vm.handlers.entries()] as [number, Function][]) {
        const signature = COMMAND_SIGNATURES[opcode];
        const checked = isChecked(signature);
        const wrapped = (ctx: any, intOp: number, stringOp: any) => {
            const before = [vm.intStackSize, vm.stringStackSize, vm.longStackSize];
            // The int-stack setter clamps underflow to 0; catch it in the counts instead.
            let result;
            try {
                result = handler(ctx, intOp, stringOp);
            } catch (error) {
                handlerError ??= { error, opcode };
                throw error;
            }
            if (checked) {
                const actual = [vm.intStackSize - before[0], vm.stringStackSize - before[1], vm.longStackSize - before[2]];
                const expected = expectedDelta(signature);
                if (actual.some((delta, i) => delta !== expected[i])) {
                    const entry = mismatches.get(opcode) ?? {
                        opcode, name: signature[0], count: 0,
                        expected: describe(expected),
                        actual: describe(actual),
                        example: `script ${vm.currentScriptId}`,
                    };
                    entry.count++;
                    mismatches.set(opcode, entry);
                }
            }
            return result;
        };
        vm.handlers.set(opcode, wrapped);
        if (opcode < vm.handlerArray.length) vm.handlerArray[opcode] = wrapped;
    }

    const errors = new Map<number, string>();
    let lastError: string | undefined;
    vm.logError = (error: any) => {
        const at = COMMAND_SIGNATURES[error?.opcode]?.[0] ?? error?.opcode;
        lastError = `${error?.message ?? String(error)}`.split("\n")[0] + (at !== undefined ? ` at ${at}` : "");
    };
    console.log = console.warn = console.error = console.info = console.debug = () => {};
    const index: any = cache.getIndex(IndexType.DAT2.clientScript);
    const ids: number[] = index.getArchiveIds?.() ?? index.archiveIds ?? [];
    try {
        for (const id of ids) {
            const script: any = scripts.load(id);
            if (!script) continue;
            handlerError = undefined;
            lastError = undefined;
            try {
                vm.intStackSize = vm.stringStackSize = vm.longStackSize = 0;
                vm.execute(
                    script,
                    new Array(script.intArgCount ?? 0).fill(0),
                    new Array(script.objArgCount ?? script.stringArgCount ?? 0).fill(""),
                    maxOpcount,
                );
            } catch (error: any) {
                lastError ??= error?.message ?? String(error);
            }
            if (handlerError && isVmBug(handlerError.error)) {
                const err = handlerError.error as Error;
                const key = `op ${handlerError.opcode} ${COMMAND_SIGNATURES[handlerError.opcode]?.[0] ?? ""}: ${err.name}: ${err.message}`;
                crashes.set(key, [...(crashes.get(key) ?? []), id]);
            } else if (lastError) {
                errors.set(id, lastError.split("\n")[0].slice(0, 120));
            }
            vm.executionState = ExecutionState.FINISHED;
        }
    } finally {
        [console.log, console.warn, console.error, console.info, console.debug] = silenced;
    }
    return {
        cache: name, scripts: ids.length, mismatches: [...mismatches.values()],
        shapeMismatches: shapes.mismatches, shapeUnchecked: shapes.unchecked, crashes, errors,
    };
}

function summarise(report: SweepReport): void {
    console.log(`${report.cache}: ${report.scripts} scripts`);
    console.log(`\nstack mismatches (${report.mismatches.length} instructions):`);
    for (const m of report.mismatches.sort((a, b) => b.count - a.count)) {
        console.log(`  ${m.opcode} ${m.name}: expected ${m.expected}, got ${m.actual} (${m.count}x, e.g. ${m.example})`);
    }
    console.log(`\nhandler shapes, each alone (${report.shapeMismatches.length} wrong, ${report.shapeUnchecked.length} unchecked):`);
    for (const m of report.shapeMismatches) console.log(`  ${m.opcode} ${m.name}: expected ${m.expected}, got ${m.actual}`);
    console.log(`  unchecked: ${report.shapeUnchecked.join(" ")}`);
    console.log(`\nhandler crashes (${report.crashes.size} kinds):`);
    for (const [key, ids] of [...report.crashes].sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  ${ids.length}x ${key.slice(0, 160)} (e.g. script ${ids[0]})`);
    }
    const byMessage = new Map<string, number[]>();
    for (const [id, message] of report.errors) {
        const key = message.replace(/\d+/g, "N");
        byMessage.set(key, [...(byMessage.get(key) ?? []), id]);
    }
    console.log(`\nscript errors (${report.errors.size} scripts):`);
    for (const [key, ids] of [...byMessage].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
        console.log(`  ${ids.length}x ${key} (e.g. ${ids.slice(0, 5).join(", ")})`);
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    const flag = (name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args.splice(i, 2)[1] : undefined;
    };
    const compare = flag("--compare");
    const json = flag("--json");
    const report = sweepScripts(args[0]);
    summarise(report);
    if (compare) {
        const before = sweepScripts(compare);
        const fresh = [...report.errors].filter(([id, message]) => {
            const old = before.errors.get(id);
            return !old || old.replace(/\d+/g, "N") !== message.replace(/\d+/g, "N");
        });
        console.log(`\nscript errors new since ${before.cache} (${fresh.length}):`);
        for (const [id, message] of fresh.slice(0, 200)) console.log(`  ${id}: ${message}`);
    }
    if (json) {
        fs.writeFileSync(json, JSON.stringify({
            ...report, crashes: Object.fromEntries(report.crashes), errors: Object.fromEntries(report.errors),
        }, null, 1));
    }
}
