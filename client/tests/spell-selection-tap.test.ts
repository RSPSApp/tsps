import assert from "node:assert/strict";
import { SpellSelectionController, spellClickNeedsTarget, spellWidgetChildSlot } from "../game/widgets/SpellSelectionController";
import { ClickRegistry } from "../widgets/gl/click-registry";

// Tapping High or Low Level Alchemy on mobile selects that spell (#1696). A tap selects through
// the direct press path, which once passed the component id as a child slot. In the mobile
// layout the spellbook also fills a dynamic list (218:201), and the selection read that list's
// slot instead: High Level Alchemy (218:47) became Wind Wave (218:58), Low Level Alchemy (218:24)
// Wind Blast (218:35). The server got Wind Wave on an inventory item and did nothing.
{
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const { vm: cacheVm } = createCacheVm();
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 601; // toplevel_osm, the mobile layout
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    cacheVm.context.varManager.setVarbit(4070, 0);
    cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
    assert.ok(wm.getWidgetByUid((218 << 16) | 201)?.children?.[47], "the mobile spellbook fills its list");

    const controller = new SpellSelectionController({
        getWidgetManager: () => wm,
        getObjTypeLoader: () => cacheVm.context.objTypeLoader,
        getCs2Vm: () => cacheVm,
        executeScriptListener: () => {},
    });
    for (const [name, child] of [["Low Level Alchemy", 24], ["High Level Alchemy", 47]] as const) {
        const spell = wm.getWidgetByUid((218 << 16) | child);
        assert.equal(spellWidgetChildSlot(spell), -1, `${name} is a static component`);
        const selection = controller.resolveSpellSelectionFromWidget(spell, spell.uid, spellWidgetChildSlot(spell), -1);
        assert.equal(selection.widgetId, spell.uid, `${name} selects itself`);
    }
}

// Selecting a spell happens on the press, which the widget click path consumes before the UI
// click registry sees it. The release then landed on an op-less panel (601:134) that, with a
// spell now selected, cancels the selection on click: the spell was dropped on the same tap.
{
    const clicks = new ClickRegistry();
    let cancels = 0;
    clicks.register({
        id: "widget:panel",
        rect: { x: 0, y: 0, w: 100, h: 100 },
        onClick: () => cancels++,
        requiresPress: true,
    });
    assert.equal(clicks.onPointerUp(10, 10), false, "a release without its press clicks nothing");
    assert.equal(cancels, 0);

    assert.equal(clicks.onPointerDown(10, 10), true);
    assert.equal(clicks.onPointerUp(10, 10), true, "a tap on the panel still cancels");
    assert.equal(cancels, 1);
}

// Clicking Humidify casts it (#1931). Its button has op1 "Cast" and a target mask for Olm's flame
// walls; the click took the mask, entered targeting, and the next click cancelled it, so nothing
// reached the server. Target-only spells (Wind Strike, High Level Alchemy) still select.
{
    const { createCacheVm } = require("../scripts/cache/cs2-sweep");
    const { vm: cacheVm } = createCacheVm();
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 161;
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    const controller = new SpellSelectionController({
        getWidgetManager: () => wm,
        getObjTypeLoader: () => cacheVm.context.objTypeLoader,
        getCs2Vm: () => cacheVm,
        executeScriptListener: () => {},
    });
    for (const [book, child, name, targets] of [
        [2, 115, "Humidify", false], [2, 116, "Moonclan Teleport", false],
        [0, 11, "Wind Strike", true], [0, 47, "High Level Alchemy", true],
    ] as const) {
        cacheVm.context.varManager.setVarbit(4070, book);
        cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
        const spell = wm.getWidgetByUid((218 << 16) | child);
        assert.equal(spellClickNeedsTarget(spell, controller.getWidgetTargetMask(spell)), targets, name);
    }
    const humidify = wm.getWidgetByUid((218 << 16) | 115);
    assert.ok(controller.getWidgetTargetMask(humidify) > 0, "Humidify keeps its flame-wall target");
}

console.log("Spell selection tap regression passed");

// #2321: actual compiled-server packets feed the ordinary client consumer and cache scripts.
// The separate plain-Node backend keeps tsx from creating a second server module graph.
{
    const { spawn } = require('node:child_process');
    const { resolve } = require('node:path');
    const { readFileSync } = require('node:fs');
    const ts = require(resolve(__dirname, '../../server/node_modules/typescript'));
    const { handleInboundUi } = require('../network/serverConnection/handlers/inboundUi');
    const { subscribeInventory } = require('../network/serverConnection/subscriptions/ui');
    const { state: networkState } = require('../network/serverConnection/state');
    const { decodeBatchedServerPackets } = require('../network/packet/ServerBinaryDecoder');
    const { handleInboundWorld } = require('../network/serverConnection/handlers/inboundWorld');
    const { Inventory } = require('../rs/inventory/Inventory');
    const { createCacheVm } = require('../scripts/cache/cs2-sweep');
    const { ExecutionState } = require('../rs/cs2/Cs2Vm');
    const { PostProcessedObjTypeLoader } = require('../rs/config/objtype/ObjTypeLoader');
    const { WidgetTransmitProcessor } = require('../game/widgets/WidgetTransmitProcessor');
    const { getTransmitCycles, markVarTransmit, markInvTransmit, markWidgetsLoaded, resetTransmitCycles } = require('../game/TransmitCycles');

    async function joinedBlightedAvailability(profile: 'ordinary' | 'mage-bank' | 'pvp', joinedDeadline: number) {
        const memberDescriptor = Object.getOwnPropertyDescriptor(PostProcessedObjTypeLoader, 'membersWorld');
        assert.ok(memberDescriptor);
        const env = { ...process.env };
        delete env.NODE_OPTIONS; delete env.NODE_PATH;
        const child = spawn(process.execPath,
            ['--max-old-space-size=1024', resolve(__dirname, '../../server/tests/fixtures/blighted-spellbook.backend.cjs'), profile],
            { cwd: resolve(__dirname, '../../server'), env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        let envelope: any, childError: Error | undefined;
        let stdoutBytes = 0, stderr = '';
        child.stdout.on('data', (bytes: Buffer) => {
            stdoutBytes += bytes.length;
            if (stdoutBytes > 8 * 1024 * 1024) childError ??= new Error('Backend stdout exceeded bound');
            else process.stdout.write(bytes); // Keep native backend diagnostics in the actual stage log.
        });
        child.stderr.on('data', (bytes: Buffer) => {
            if (stderr.length < 32768) stderr += bytes.toString('utf8');
            else childError ??= new Error('Backend stderr exceeded bound');
        });
        child.on('error', (error: Error) => { childError ??= error; });
        child.on('message', (message: any) => {
            try {
                assert.equal(envelope, undefined, 'one backend result');
                assert.ok(JSON.stringify(message).length < 262144, 'bounded backend result');
                assert.equal(message.kind, 'complete');
                assert.equal(message.profile, profile, 'matching native profile episode');
                envelope = message;
            } catch (error) { childError ??= error as Error; }
        });
        const remaining = joinedDeadline - Date.now();
        const deadline = setTimeout(() => { childError ??= new Error('Joined episodes exceeded 180 seconds'); child.kill(); }, Math.max(0, remaining));
        try {
            const exit = await new Promise<any>(resolveExit => child.once('close',
                (code: number, signal: string) => resolveExit({ code, signal })));
            assert.equal(childError, undefined, childError?.message);
            assert.equal(exit.signal, null, 'backend self-terminated');
            assert.equal(exit.code, 0, `backend failed: ${stderr}`);
            assert.equal(stderr, '', 'backend stderr must be empty');
            const expectedRows = profile === 'ordinary' ? [
                ['initial-ferox-bootstrap', 1, false], ['unchanged-ferox', 1, true],
                ['ordinary-safe-location', 0, false], ['unchanged-safe-location', 0, true],
                ['true-wilderness-entry', 1, false], ['unchanged-true-wilderness', 1, true],
                ['leave-true-wilderness', 0, false], ['unchanged-after-wilderness', 0, true],
            ] : profile === 'mage-bank' ? [
                ['mage-arena-bank-bootstrap', 1, false], ['unchanged-mage-arena-bank', 1, true],
            ] : [
                ['pvp-world-bootstrap', 1, false], ['unchanged-pvp-world', 1, true],
            ];
            assert.deepEqual(envelope?.rows?.map((row: any) => [row.label, row.expected, row.quiet]), expectedRows);

            PostProcessedObjTypeLoader.membersWorld = true;
            const { vm } = createCacheVm(), context = vm.context, wm = context.widgetManager;
            const inv = new Inventory(28), worn = new Inventory(14);
            context.inventories = new Map([[93, inv], [94, worn]]);
            let magic = 99;
            context.getStatLevel = context.getStatBase = context.getStatBoosted = (skill: number) => skill === 6 ? magic : 99;
            assert.match(context.objTypeLoader.load(24613).name, /blighted entangle sack/i);
            const vars = context.varManager;
            const supportingDefinitions = new Map<number, { baseVar: number; startBit: number; endBit: number }>();
            for (const [id, baseVar, bit] of [[6549, 3465, 27], [5963, 1105, 22]]) {
                const definition = vars.varbitLoader.load(id);
                const actual = { baseVar: definition?.baseVar, startBit: definition?.startBit, endBit: definition?.endBit };
                assert.deepEqual(actual, { baseVar, startBit: bit, endBit: bit },
                    `prerequisite: active client supporting definition ${id}`);
                supportingDefinitions.set(id, actual);
            }
            // Reuse the exact production inventory method, as the existing widget-cache
            // fixture reuses production callbacks. No full graphics client or new package.
            const inventorySource = ts.createSourceFile('OsrsClient.ts',
                readFileSync(resolve(__dirname, '../game/OsrsClient.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
            let inventoryMethod: any, inventoryMethods = 0;
            function findInventoryMethod(node: any) {
                if (ts.isMethodDeclaration(node) && node.name?.getText(inventorySource) === 'handleInventoryServerUpdate') {
                    inventoryMethod = node; inventoryMethods++;
                }
                ts.forEachChild(node, findInventoryMethod);
            }
            findInventoryMethod(inventorySource);
            assert.equal(inventoryMethods, 1, 'one actual inventory consumer');
            assert.equal(inventoryMethod.parameters.length, 1);
            const inventoryCode = ts.transpileModule('module.exports = function(update) ' + inventoryMethod.body.getText(inventorySource), {
                compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS }, reportDiagnostics: true,
            });
            assert.equal((inventoryCode.diagnostics ?? []).filter((item: any) => item.category === ts.DiagnosticCategory.Error).length, 0);
            const inventoryExport: any = { exports: undefined };
            new Function('Inventory', 'markInvTransmit', 'console', 'module', inventoryCode.outputText)(
                Inventory, markInvTransmit, console, inventoryExport);
            assert.equal(typeof inventoryExport.exports, 'function');
            let inventoryUpdates = 0, tradeRenderCalls = 0;
            const inventoryReceiver = { inventory: inv, pendingInventoryMovePredictions: [], inventorySeededFromServer: false,
                rebuildTradeInventoryWidget() { tradeRenderCalls++; } }; // Graphics-only tail is outside this VM fixture.
            const previousInventorySnapshot = Object.getOwnPropertyDescriptor(networkState, 'lastInventorySnapshot');
            let unsubscribeInventory: (() => void) | undefined;
            const oldClient = Object.getOwnPropertyDescriptor(globalThis, '__osrsClient');
            const oldWarn = console.warn, warnings: unknown[][] = [];
            let vmFailure: unknown;
            const nativeInventory = (update: any) => {
                try { inventoryExport.exports.call(inventoryReceiver, update); inventoryUpdates++; }
                catch (error) { vmFailure ??= error; throw error; }
            };
            const observedIds = new Set([1897, 2620, 2614, 2611, 2262, 5743, 915]);
            const observedCalls = new Map<number, { pre: number; post: number }>();
            const observedTail: any[] = [];
            let activeRow = 'initialization';
            const observe = (phase: 'pre' | 'post', id: number) => {
                if (!observedIds.has(id)) return;
                const counts = observedCalls.get(id) ?? { pre: 0, post: 0 };
                counts[phase]++; observedCalls.set(id, counts);
                const size = Number.isFinite(vm.intStackSize) ? vm.intStackSize : 0;
                observedTail.push({ phase, id, row: activeRow, intStackSize: size,
                    intStackTail: Array.from(vm.intStack.slice(Math.max(0, size - 3), size)) });
                if (observedTail.length > 16) observedTail.shift();
            };
            const observePre = (id: number) => observe('pre', id);
            const observePost = (id: number) => observe('post', id);
            function healthy(label: string) {
                if (vmFailure) throw vmFailure;
                try {
                    assert.equal(vm.lastError, null, label);
                    assert.equal(vm.executionState, ExecutionState.FINISHED, label);
                    assert.equal(vm.intStackSize, 0, `${label}: empty int stack`);
                    assert.equal(vm.stringStackSize, 0, `${label}: empty string stack`);
                    assert.equal(vm.longStackSize, 0, `${label}: empty long stack`);
                } catch (error) { vmFailure ??= error; throw vmFailure; }
            }
            const queued: any[] = [];
            const transmits = new WidgetTransmitProcessor({ getWidgetManager: () => wm, getCs2Vm: () => vm,
                getTransmitCycles, queueScriptEvent: (event: any) => queued.push(event),
                executeScriptListener: (widget: any, args: any[]) => {
                    try { assert.equal(vm.runScriptEvent({ widget, args }), true); healthy('transmit listener'); }
                    catch (error) { vmFailure ??= error; throw error; }
                } });
            let updates = 0;
            try {
                resetTransmitCycles();
                assert.equal(networkState.lastInventorySnapshot, undefined, 'fresh sequential inventory state');
                unsubscribeInventory = subscribeInventory(nativeInventory);
                vm.scriptPreListeners.add(observePre); vm.scriptPostListeners.add(observePost);
                vars.onVarpChange = (id: number) => vm.isRunning() ? vm.queueVarpChange(id) : markVarTransmit(id);
                vm.onVarpChange = markVarTransmit;
                Object.defineProperty(globalThis, '__osrsClient', { configurable: true, value: {
                    varManager: vars, updateVars() { updates++; }, _serverVarpSync: false,
                } });
                console.warn = (...args: unknown[]) => { warnings.push(args); };
                wm.onLoadListener = (_id: number, widget: any) => {
                    try { assert.equal(vm.runScriptEvent({ args: widget.onLoad, widget }), true); healthy('load listener'); }
                    catch (error) { vmFailure ??= error; throw error; }
                };
                vars.setVarbit(4070, 0);
                for (const bit of [6605, 6606, 6607, 6608, 6609, 12137, 10031, 10032, 6718, 9730]) vars.setVarbit(bit, 0);
                let book: any;
                let spells: any[] = [];
                let rootPackets = 0, mountPackets = 0, mountUid = -1;
                function consumeMount(payload: any): boolean {
                    if (payload.action === 'set_root') {
                        assert.equal(payload.groupId, 161, 'actual desktop bootstrap root');
                        assert.equal(++rootPackets, 1, 'one initial root packet');
                        wm.resize(765, 503);
                        wm.setRootInterface(payload.groupId);
                        vm.clearHandlerCaches();
                        markWidgetsLoaded();
                        healthy('actual root mount');
                        return true;
                    }
                    if (payload.action !== 'open_sub' || payload.groupId !== 218) return false;
                    assert.equal(rootPackets, 1, 'root packet precedes spellbook mount');
                    assert.equal(payload.targetUid, (161 << 16) | 82, 'actual magic pane');
                    assert.equal(payload.type, 1, 'actual sidebar mount type');
                    // Current native bootstrap has no embedded state/scripts. Refuse changed
                    // payload semantics rather than silently dropping pre/post mount work.
                    for (const key of ['varps', 'varbits', 'hiddenUids', 'preScripts', 'postScripts'])
                        assert.equal(payload[key], undefined, `unexpected embedded mount ${key}`);
                    wm.openSubInterface(payload.targetUid, payload.groupId, payload.type);
                    vm.clearHandlerCaches();
                    markWidgetsLoaded();
                    assert.ok(++mountPackets <= 4, 'bounded actual book mounts');
                    mountUid = payload.targetUid;
                    assert.equal(wm.getSubInterface(mountUid)?.group, 218, 'book is actually mounted');
                    const mountedBook = wm.getWidgetByUid(218 << 16);
                    if (book) assert.equal(mountedBook, book, 'bootstrap remount preserves actual spell widgets');
                    book = mountedBook;
                    if (mountPackets === 1) {
                        // Normal cache UI tab selection, as in the existing prayer-panel fixture.
                        // Selecting Magic once makes its mounted pane visible; no flag/visibility
                        // override or per-transition redraw is used to manufacture updates.
                        vm.run(context.loadScript(915), [6], []);
                        healthy('select actual Magic sidebar');
                    }
                    assert.equal(wm.isEffectivelyHidden(mountUid), false, 'mounted Magic pane is visible');
                    healthy('actual spellbook mount');
                    spells = [['Bind', 23, 20], ['Snare', 42, 50], ['Entangle', 69, 79]].map(([name, child, level]) => {
                        const uid = (218 << 16) | Number(child), widget = wm.getWidgetByUid(uid);
                        assert.equal(widget.onTargetEnter[0], 2617, `${name}: actual spell target handler`);
                        const type = context.objTypeLoader.load(widget.onTargetEnter[3]);
                        assert.equal(type.params.get(596), uid); assert.equal(type.params.get(604), level);
                        assert.ok(Number.isInteger(type.params.get(597)) && Number.isInteger(type.params.get(598)), 'real sprite metadata');
                        assert.notEqual(type.params.get(597), type.params.get(598), 'distinct bright and dim sprites');
                        return { name, widget, bright: type.params.get(597), dim: type.params.get(598) };
                    });
                    return true;
                }
                let observationEmitted = false;
                function observeFailure(row: any, wireFlags: any[], eligibilityPackets: number) {
                    if (observationEmitted) return;
                    observationEmitted = true;
                    try {
                        const cached = vars.varbitLoader.load(11028);
                        const definition = cached?.baseVar !== undefined ? cached : vars.customVarbits.get(11028);
                        const def = definition ? { baseVar: definition.baseVar, startBit: definition.startBit, endBit: definition.endBit } : null;
                        const provider = context.inventories.get(93);
                        const describe = (widget: any) => ({ uid: widget.uid, hidden: widget.isHidden,
                            effectivelyHidden: wm.isEffectivelyHidden(widget.uid), sprite: widget.spriteId,
                            onVar: { script: widget.onVarTransmit?.[0] ?? widget.eventHandlers?.onVarTransmit?.scriptId ?? null,
                                triggers: (widget.varTransmitTriggers ?? []).slice(0, 16), total: widget.varTransmitTriggers?.length ?? 0,
                                mode: widget.varTransmitTriggers?.length ? 'filtered' : 'all',
                                watchesBacking: def ? (!widget.varTransmitTriggers?.length || widget.varTransmitTriggers.includes(def.baseVar)) : null,
                                lastCount: widget.lastChangedVarpCount ?? null },
                            onInv: { script: widget.onInvTransmit?.[0] ?? widget.eventHandlers?.onInvTransmit?.scriptId ?? null,
                                triggers: (widget.invTransmitTriggers ?? []).slice(0, 16), total: widget.invTransmitTriggers?.length ?? 0,
                                mode: widget.invTransmitTriggers?.length ? 'filtered' : 'all',
                                watches93: !widget.invTransmitTriggers?.length || widget.invTransmitTriggers.includes(93),
                                lastCount: widget.lastChangedInvCount ?? null } });
                        const cycles = getTransmitCycles();
                        const data = { row: row.label, server: row.serverObservation, wireFlags, eligibilityPackets,
                            flagsTruncated: eligibilityPackets > wireFlags.length, definition: def,
                            clientFlag: def ? vars.getVarbit(11028) : null,
                            backingValue: def ? vars.values[def.baseVar] : null, backingServerValue: def ? vars.serverValues[def.baseVar] : null,
                            inventoryUpdates, inventorySeededFromServer: inventoryReceiver.inventorySeededFromServer, tradeRenderCalls,
                            sameInventoryProvider: provider === inv, suppliedCount: provider?.count(24613),
                            slots: provider?.getSlots().filter((slot: any) => slot.itemId >= 0).slice(0, 4),
                            magic: { current: context.getStatLevel(6), base: context.getStatBase(6), boosted: context.getStatBoosted(6) },
                            members: PostProcessedObjTypeLoader.membersWorld, rootPackets, mountPackets, mountUid,
                            widgets: [book, ...spells.map(spell => spell.widget)].map(describe),
                            sprites: spells.map(spell => ({ name: spell.name, actual: spell.widget.spriteId, bright: spell.bright, dim: spell.dim })),
                            cycles: { tick: cycles.cycleCntr, varps: cycles.changedVarpCount, inventories: cycles.changedInvCount,
                                lastProcessed: cycles.lastTransmitProcessCycle, dirty: cycles.transmitDirty },
                            scripts: [...observedCalls].map(([id, counts]) => ({ id, ...counts })), scriptTail: observedTail };
                        const text = JSON.stringify(data);
                        console.log('BLIGHTED_2321_OBSERVATION ' + (text.length <= 8192 ? text :
                            JSON.stringify({ row: row.label, truncated: true, originalLength: text.length })));
                    } catch (error) {
                        console.log('BLIGHTED_2321_OBSERVATION ' + JSON.stringify({ row: row.label, diagnosticError: String(error).slice(0, 256) }));
                    }
                }
                let eligiblePacket: any;
                for (const row of envelope.rows) {
                    activeRow = row.label;
                    const wireFlags: any[] = [];
                    let eligibilityPackets = 0, inputBytes = 0, decodedMessages = 0;
                    const supportingWire: { id: number; value: number }[] = [];
                    const decodedTypes = new Map<string, number>();
                    assert.ok(row.packets.length <= 512);
                    for (const encoded of row.packets) {
                        assert.equal(typeof encoded, 'string'); assert.ok(encoded.length < 131072);
                        const bytes = Buffer.from(encoded, 'base64');
                        inputBytes += bytes.length;
                        const batch = decodeBatchedServerPackets(bytes);
                        assert.equal(batch.stalled, false,
                            `native batch stalled: row=${row.label} chunks=${row.packets.length} bytes=${bytes.length}`);
                        for (const message of batch.messages) {
                            decodedMessages++;
                            const kind = message.type === 'widget' ? `widget:${message.payload.action}` : message.type;
                            decodedTypes.set(kind, (decodedTypes.get(kind) ?? 0) + 1);
                            if (message.type === 'inventory') {
                                assert.equal(handleInboundUi(message), true, 'actual native inventory consumer');
                                continue;
                            }
                            if (message.type === 'widget' && consumeMount(message.payload)) continue;
                            if (message.type !== 'varbit' && message.type !== 'varp') continue;
                            if (message.type === 'varbit' && [6549, 5963].includes(message.payload.varbitId)) {
                                assert.ok(supportingWire.length < 8, 'prerequisite: bounded actual supporting packets');
                                supportingWire.push({ id: message.payload.varbitId, value: message.payload.value });
                            }
                            if (message.type === 'varbit' && message.payload.varbitId === 11028) {
                                eligibilityPackets++;
                                if (wireFlags.length < 8) wireFlags.push({ value: message.payload.value, messageIndex: decodedMessages });
                                if (message.payload.value === 1) eligiblePacket = message;
                            }
                            assert.equal(handleInboundWorld(message), true, 'actual client var consumer handled packet');
                        }
                    }
                    // Normal client tick: receive all ordered row messages first, then process
                    // dirty transmit listeners and the queued script events once.
                    const tickCycles = getTransmitCycles();
                    tickCycles.cycleCntr++;
                    transmits.processWidgetTransmits();
                    tickCycles.lastTransmitProcessCycle = tickCycles.cycleCntr | 0;
                    for (let count = 0; queued.length; count++) {
                        assert.ok(count < 128, 'bounded queued transmit work');
                        assert.equal(vm.runScriptEvent(queued.shift()), true); healthy('queued transmit');
                    }
                    healthy('row client tick');
                    const prerequisiteContext = JSON.stringify({ row: row.label, chunks: row.packets.length,
                        inputBytes, decodedMessages, types: [...decodedTypes].slice(0, 16),
                        typesTruncated: decodedTypes.size > 16, rootPackets, mountPackets });
                    assert.equal(warnings.length, 0, 'no swallowed consumer warning');
                    assert.equal(rootPackets, 1, `native root consumed ${prerequisiteContext}`);
                    assert.ok(mountPackets > 0, `native book mount consumed ${prerequisiteContext}`);
                    assert.equal(wm.getSubInterface(mountUid)?.group, 218, `book remains mounted ${prerequisiteContext}`);
                    assert.equal(wm.isEffectivelyHidden(mountUid), false, `book remains visible for transmit traversal ${prerequisiteContext}`);
                    assert.equal(spells.length, 3, 'all three actual spell widgets observed');
                    // Supporting policy is an independent literal precondition, before any sprite verdict.
                    const expectedFerox = profile === 'ordinary' &&
                        ['initial-ferox-bootstrap', 'unchanged-ferox'].includes(row.label) ? 1 : 0;
                    const expectedWilderness = profile === 'pvp' ||
                        ['true-wilderness-entry', 'unchanged-true-wilderness'].includes(row.label) ? 1 : 0;
                    const policy = row.serverObservation?.supportingPolicy;
                    assert.ok(policy, 'prerequisite: native supporting policy observation');
                    for (const [id, expected] of [[6549, expectedFerox], [5963, expectedWilderness]]) {
                        const definition = supportingDefinitions.get(id)!;
                        assert.deepEqual(policy.definitions?.[id], definition, `prerequisite: server/client definition ${id}`);
                        assert.equal(vars.getVarbit(id), expected, `${row.label}: prerequisite client supporting value ${id}`);
                        assert.equal((vars.serverValues[definition.baseVar] >>> definition.startBit) & 1, expected,
                            `${row.label}: prerequisite client supporting server mirror ${id}`);
                    }
                    assert.equal(policy.insideFerox, expectedFerox, `${row.label}: prerequisite native Ferox state`);
                    assert.equal(policy.insideWilderness, expectedWilderness, `${row.label}: prerequisite native Wilderness state`);
                    const actualVarHandler = Array.isArray(book.onVarTransmit) && book.onVarTransmit.length ?
                        book.onVarTransmit[0] : book.eventHandlers?.onVarTransmit?.scriptId;
                    assert.ok(Number.isInteger(actualVarHandler) && actualVarHandler >= 0,
                        'prerequisite: actual loaded book var listener');
                    for (const definition of supportingDefinitions.values())
                        assert.ok(!book.varTransmitTriggers?.length || book.varTransmitTriggers.includes(definition.baseVar),
                            `prerequisite: actual loaded book watches supporting parent ${definition.baseVar}`);
                    for (const [id, required] of [
                        [6549, profile === 'ordinary' && ['initial-ferox-bootstrap', 'ordinary-safe-location'].includes(row.label)],
                        [5963, profile === 'ordinary' && ['true-wilderness-entry', 'leave-true-wilderness'].includes(row.label)],
                    ] as const) {
                        if (!required) continue;
                        const values = supportingWire.filter(event => event.id === id).map(event => event.value);
                        assert.ok(values.length > 0, `${row.label}: prerequisite native supporting delivery ${id}`);
                        assert.equal(values[values.length - 1], id === 6549 ? expectedFerox : expectedWilderness,
                            `${row.label}: prerequisite final native supporting value ${id}`);
                    }
                    if (row.quiet) assert.equal(eligibilityPackets, 0, `${row.label}: no redundant packet`);
                    for (const spell of spells) {
                        if (spell.widget.spriteId !== (row.expected ? spell.bright : spell.dim))
                            observeFailure(row, wireFlags, eligibilityPackets);
                        assert.equal(spell.widget.spriteId,
                            row.expected ? spell.bright : spell.dim, `${row.label}: ${spell.name} sprite availability`);
                    }
                    assert.equal(vars.getVarbit(11028), row.expected, `${row.label}: server eligibility mirror`);
                    if (!row.quiet) assert.equal(eligibilityPackets, 1, `${row.label}: one eligibility update`);
                    assert.equal(inv.count(24613), 2, 'queries do not spend a sack');
                    assert.equal(worn.getSlots().every((slot: any) => slot.itemId === -1), true);
                }
                function redraw(label: string) {
                    assert.equal(vm.runScriptEvent({ args: book.onLoad, widget: book }), true);
                    healthy(label);
                }
                if (profile === 'ordinary') {
                    // Ordinary runes remain usable in the final safe state, without a sack.
                    inv.setSnapshot([{ slot: 0, itemId: 555, quantity: 100 },
                        { slot: 1, itemId: 557, quantity: 100 }, { slot: 2, itemId: 561, quantity: 100 }]);
                    markInvTransmit(93); redraw('ordinary rune fallback');
                    for (const spell of spells) assert.equal(spell.widget.spriteId, spell.bright, `${spell.name}: normal runes`);
                    // Replay an actually emitted eligible packet for controlled supply/level tests;
                    // the test never fabricates an eligibility flag or substitutes the rune predicate.
                    assert.ok(eligiblePacket);
                    assert.equal(handleInboundWorld(eligiblePacket), true);
                    inv.setSnapshot([]); markInvTransmit(93); redraw('eligible but no supplies');
                    for (const spell of spells) assert.equal(spell.widget.spriteId, spell.dim, `${spell.name}: no supplies`);
                    vars.setVarbit(6608, 1); redraw('missing-runes filter');
                    for (const spell of spells) assert.equal(spell.widget.isHidden, true, `${spell.name}: native supply filter`);
                    vars.setVarbit(6608, 0);
                    inv.setSnapshot([{ slot: 0, itemId: 24613, quantity: 2 }]); magic = 78;
                    markInvTransmit(93); redraw('level requirement');
                    assert.equal(spells[0].widget.spriteId, spells[0].bright);
                    assert.equal(spells[1].widget.spriteId, spells[1].bright);
                    assert.equal(spells[2].widget.spriteId, spells[2].dim, 'Entangle78 remains unavailable with eligible supplies');
                    assert.equal(inv.count(24613), 2);
                    assert.ok(updates > 0, 'actual inbound consumer signalled client updates');
                    assert.equal(warnings.length, 0);
                }
            } finally {
                unsubscribeInventory?.();
                networkState.inventoryListeners.delete(nativeInventory);
                if (previousInventorySnapshot) Object.defineProperty(networkState, 'lastInventorySnapshot', previousInventorySnapshot);
                else delete networkState.lastInventorySnapshot;
                vm.scriptPreListeners.delete(observePre); vm.scriptPostListeners.delete(observePost);
                console.warn = oldWarn;
                if (oldClient) Object.defineProperty(globalThis, '__osrsClient', oldClient);
                else delete (globalThis as any).__osrsClient;
                vars.onVarpChange = undefined; vm.onVarpChange = undefined;
                resetTransmitCycles();
            }
        } finally {
            clearTimeout(deadline);
            if (child.exitCode === null && child.signalCode === null) child.kill();
            Object.defineProperty(PostProcessedObjTypeLoader, 'membersWorld', memberDescriptor);
        }
    }
    async function joinedProfiles() {
        const joinedDeadline = Date.now() + 180000;
        for (const profile of ['ordinary', 'mage-bank', 'pvp'] as const) {
            assert.ok(Date.now() < joinedDeadline, 'original joined budget remains');
            await joinedBlightedAvailability(profile, joinedDeadline);
        }
        assert.ok(Date.now() < joinedDeadline, 'all episodes and controls fit original joined budget');
        console.log('BLIGHTED_2321_JOINED_PASS rows=12 spells=3 controls=4 packets=native vm=FINISHED');
    }
    joinedProfiles().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('BLIGHTED_2321_FAILURE: ' + message.split(/\r?\n/, 1)[0]);
        console.error(message);
        process.exitCode = 1;
    });
}
