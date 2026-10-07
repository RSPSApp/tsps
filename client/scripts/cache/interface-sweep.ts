/**
 * Opens every interface in a cache offline, as the game does: loads its components and runs
 * their onLoad listeners (static and runtime-set, dynamic children included), then fires each
 * transmit listener and timer once, as when the server's first update arrives (the bank builds
 * its items and tags there, not in onLoad). Then it reports per
 * interface the script errors and suspicious output (components showing item 0, "null" text).
 * The VM has no server state (varps at 0, no inventories), so compare two caches (--compare) to
 * see what a revision changed; interfaces our server opens are marked.
 *
 *   npx tsx scripts/cache/interface-sweep.ts [cacheDir] [--compare olderCacheDir] [--all]
 */
import fs from "fs";
import path from "path";

import { CacheSystem } from "../../rs/cache/CacheSystem";
import { IndexType } from "../../rs/cache/IndexType";
import { createScriptEvent, ExecutionState } from "../../rs/cs2/Cs2Vm";
import { COMMAND_SIGNATURES } from "../../rs/cs2/CommandSignatures";
import { Opcodes } from "../../rs/cs2/Opcodes";
import { createCacheVm } from "./cs2-sweep";

const GAMEVAL_INDEX = 24;
const UPDATES = [
    "onVarTransmit", "onInvTransmit", "onStatTransmit", "onMiscTransmit", "onChatTransmit",
    "onFriendTransmit", "onClanTransmit", "onStockTransmit", "onClanSettingsTransmit",
    "onClanChannelTransmit", "onTimer",
];
const GAMEVAL_INTERFACES = 14;
const SERVER_DIRS = ["../server/plugins", "../server/src"].map((d) => path.resolve(__dirname, "../..", d));

export interface InterfaceResult {
    group: number;
    name: string;
    /** "script N at op: message" -> count */
    errors: Map<string, number>;
    itemZero: number;
    nullText: number;
}

function interfaceName(cache: CacheSystem, group: number): string {
    try {
        const data: Int8Array | undefined = (cache.getIndex(GAMEVAL_INDEX) as any).getArchive(GAMEVAL_INTERFACES).getFile(group)?.data;
        if (!data) return `if${group}`;
        let end = 0;
        while (end < data.length && data[end] !== 0) end++;
        return Buffer.from(data.buffer, data.byteOffset, end).toString("latin1") || `if${group}`;
    } catch {
        return `if${group}`;
    }
}

/** Interface groups our server code names next to an interface call or as (N << 16). */
export function serverInterfaces(): Set<number> {
    const out = new Set<number>();
    const walk = (dir: string) => {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(file);
            else if (/\.(ts|js)$/.test(entry.name)) {
                const text = fs.readFileSync(file, "utf8");
                for (const m of text.matchAll(/\((\d{1,4})\s*<<\s*16\)/g)) out.add(Number(m[1]));
                for (const m of text.matchAll(/(?:Interface|INTERFACE|_IF|GROUP)\w*\s*[=:]\s*(\d{1,4})\b/g)) out.add(Number(m[1]));
                for (const m of text.matchAll(/send(?:Sub)?Interface\w*\([^;\n]*?\b(\d{2,4})\b/g)) out.add(Number(m[1]));
                // Constants passed where an interface is opened: sendSubInterface(target, GE, ...).
                const consts = new Map([...text.matchAll(/\b(?:const|static(?: readonly)?)\s+([A-Za-z_]\w*)\s*=\s*(\d{1,4})\b/g)].map((m) => [m[1], Number(m[2])]));
                const opened = /(?:sendSubInterface\([^,]+,|sendInterface\(|setInterfaceId\(|openInterface\(|interfaceId\s*===?)\s*([A-Za-z_][\w.]*)/g;
                for (const m of text.matchAll(opened)) {
                    const value = consts.get(m[1].split(".").pop()!);
                    if (value !== undefined) out.add(value);
                }
            }
        }
    };
    SERVER_DIRS.forEach(walk);
    return out;
}

export function sweepInterfaces(dir?: string, maxOpcount = 200_000, only?: number[]): { cache: string; results: InterfaceResult[] } {
    const { name: cacheName, cache, vm } = createCacheVm(dir);
    const wm: any = vm.context.widgetManager;
    // The game's frame (resizable): scripts look components up through it (enum 73, script 900).
    wm.rootInterface = 161;
    let group = -1;
    let errors = new Map<string, number>();
    const record = (message: string) => errors.set(message, (errors.get(message) ?? 0) + 1);
    vm.logError = (error: any) => {
        const at = COMMAND_SIGNATURES[error?.opcode]?.[0] ?? error?.opcode;
        const script = error?.callStack?.[error.callStack.length - 1]?.scriptId ?? error?.scriptId;
        record(`script ${script} at ${at}: ${String(error?.message ?? error).split("\n")[0]}`);
    };
    const run = (widget: any, listener: any[]) => {
        vm.executionState = ExecutionState.FINISHED;
        vm.intStackSize = vm.stringStackSize = vm.longStackSize = 0;
        try {
            vm.runScriptEvent(createScriptEvent({ args: listener, widget }), maxOpcount);
        } catch (error: any) {
            record(`throw: ${String(error?.message ?? error).split("\n")[0]}`);
        }
    };
    // Output as the scripts set it (components nested in runtime children are hard to walk).
    const itemZeroWidgets = new Set<any>();
    const nullTextWidgets = new Set<any>();
    const watch = (opcodes: number[], check: (ctx: any) => boolean, into: Set<any>) => {
        for (const opcode of opcodes) {
            const handler = vm.handlers.get(opcode);
            if (!handler) continue;
            const wrapped = (ctx: any, intOp: number, stringOp: any) => {
                const hit = check(ctx);
                const result = handler(ctx, intOp, stringOp);
                if (hit) into.add(intOp === 1 ? vm.dotWidget : vm.activeWidget);
                return result;
            };
            vm.handlers.set(opcode, wrapped);
            if (opcode < vm.handlerArray.length) vm.handlerArray[opcode] = wrapped;
        }
    };
    const O: any = Opcodes;
    // cc_setobject*(obj, num): obj below num on the int stack.
    watch([O.CC_SETOBJECT, O.CC_SETOBJECT_NONUM, O.CC_SETOBJECT_ALWAYS_NUM].filter((o) => o !== undefined),
        (ctx) => ctx.intStack[ctx.intStackSize - 2] === 0, itemZeroWidgets);
    // if_setobject*(obj, num, component).
    watch([O.IF_SETOBJECT, O.IF_SETOBJECT_NONUM, O.IF_SETOBJECT_ALWAYS_NUM].filter((o) => o !== undefined),
        (ctx) => ctx.intStack[ctx.intStackSize - 3] === 0, itemZeroWidgets);
    watch([O.CC_SETTEXT, O.IF_SETTEXT].filter((o) => o !== undefined),
        (ctx) => /(^|\W)null(\W|$)/.test(String(ctx.stringStack[ctx.stringStackSize - 1] ?? "")), nullTextWidgets);
    wm.onLoadListener = (_id: number, widget: any) => run(widget, widget.onLoad);
    wm.onLoadInvoker = (widget: any) => {
        try {
            vm.invokeEventHandler(widget, "onLoad");
        } catch (error: any) {
            record(`throw: ${String(error?.message ?? error).split("\n")[0]}`);
        }
    };

    const index: any = cache.getIndex(IndexType.DAT2.interfaces);
    const groups: number[] = only ?? Array.from(index.getArchiveIds());
    const results: InterfaceResult[] = [];
    const silenced = [console.log, console.warn, console.error, console.info, console.debug];
    console.log = console.warn = console.error = console.info = console.debug = () => {};
    try {
        for (group of groups) {
            errors = new Map();
            itemZeroWidgets.clear();
            nullTextWidgets.clear();
            let roots: any[] = [];
            try {
                wm.getGroup(group);
                roots = wm.getAllGroupRoots(group) ?? [];
                for (const root of roots) wm.triggerOnLoad(root);
            } catch (error: any) {
                record(`load: ${String(error?.message ?? error).split("\n")[0]}`);
            }
            const nodes = () => {
                const out: any[] = [];
                const seen = new Set<any>();
                const stack = [...roots];
                while (stack.length) {
                    const node = stack.pop();
                    if (!node || seen.has(node)) continue;
                    seen.add(node);
                    out.push(node);
                    stack.push(...wm.getStaticChildrenByParentUid(node.uid), ...wm.getDynamicChildrenByParent(node));
                }
                return out;
            };
            // The first update from the server: every transmit listener and timer once.
            for (const node of nodes()) {
                for (const event of UPDATES) {
                    if (node.eventHandlers?.[event]) {
                        try {
                            vm.invokeEventHandler(node, event);
                        } catch (error: any) {
                            record(`throw: ${String(error?.message ?? error).split("\n")[0]}`);
                        }
                    } else if (Array.isArray(node[event]) && node[event].length) {
                        run(node, node[event]);
                    }
                }
            }
            // What the interface now shows.
            let itemZero = 0;
            let nullText = 0;
            for (const node of nodes()) {
                if (node.itemId === 0 && !node.hidden && !node.isHidden) itemZeroWidgets.add(node);
                if (typeof node.text === "string" && /(^|\W)null(\W|$)/.test(node.text)) nullTextWidgets.add(node);
            }
            itemZero = itemZeroWidgets.size;
            nullText = nullTextWidgets.size;
            results.push({ group, name: interfaceName(cache, group), errors, itemZero, nullText });
        }
    } finally {
        [console.log, console.warn, console.error, console.info, console.debug] = silenced;
    }
    return { cache: cacheName, results };
}

const signature = (message: string) => message.replace(/\d+/g, "N");

if (require.main === module) {
    const args = process.argv.slice(2);
    const flag = (name: string) => {
        const i = args.indexOf(name);
        return i >= 0 ? args.splice(i, 2)[1] : undefined;
    };
    const compare = flag("--compare");
    const all = args.includes("--all");
    const dir = args.find((a) => !a.startsWith("--"));
    const used = serverInterfaces();
    const now = sweepInterfaces(dir);
    const before = compare ? sweepInterfaces(compare) : undefined;
    const old = new Map(before?.results.map((r) => [r.name, r]) ?? []);
    const lines: string[] = [];
    for (const r of now.results) {
        const prev = old.get(r.name);
        const fresh = [...r.errors].filter(([m]) => !prev || ![...prev.errors.keys()].some((p) => signature(p) === signature(m)));
        const itemZero = r.itemZero - (prev?.itemZero ?? 0);
        const nullText = r.nullText - (prev?.nullText ?? 0);
        const problems = [
            ...fresh.map(([m, n]) => `${m}${n > 1 ? ` (${n}x)` : ""}`),
            itemZero > 0 ? `${itemZero} more component(s) showing item 0` : "",
            nullText > 0 ? `${nullText} more "null" text(s)` : "",
        ].filter(Boolean);
        if (!problems.length) continue;
        if (!all && !used.has(r.group)) continue;
        lines.push(`${used.has(r.group) ? "*" : " "} ${r.name} (${r.group}${prev && prev.group !== r.group ? `, was ${prev.group}` : ""})${prev ? "" : " [new]"}\n    ${problems.slice(0, 6).join("\n    ")}`);
    }
    console.log(`${now.cache}: ${now.results.length} interfaces${before ? `, compared with ${before.cache}` : ""}; * = opened by our server${all ? "" : " (others with --all)"}`);
    console.log(lines.join("\n") || "nothing new");
}
