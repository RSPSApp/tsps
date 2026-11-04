import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Inventory } from "../rs/inventory/Inventory";
import { deriveRawMenuEntriesForWidget } from "../widgets/menu/utils";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetRunScript, encodeWidgetSetText, encodeWidgetSetFlagsRange, decodeClientPacket } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
import { buildWidgetActionPayload } from "../game/widgets/widgetActionPayload";
import { shouldTransmitAction } from "../widgets/WidgetFlags";
import { InputManager } from "../game/InputManager";
import { processWidgetKeyboardInput } from "../game/widgets/input/widgetKeyboardInput";
import { createPacket, ClientPacket, queuePacket, flushPackets, setPacketSocket } from "../network/packet";
import { WidgetTransmitProcessor } from "../game/widgets/WidgetTransmitProcessor";
import { getTransmitCycles, markVarTransmit, resetTransmitCycles } from "../game/TransmitCycles";
import { markWidgetInteractionDirty } from "../widgets/WidgetInteraction";
import { HeldWidgetProperties } from "../widgets/HeldWidgetProperties";
import { PendingInterfaceUpdates } from "../widgets/custom/PendingInterfaceUpdates";

// Exercise the cache's actual panels and long-price script, not just the VM opcode.
{
    const { createCacheVm } = require('../scripts/cache/cs2-sweep');
    const { vm: cacheVm } = createCacheVm();
    cacheVm.context.getStatLevel = cacheVm.context.getStatBase = cacheVm.context.getStatBoosted = () => 99;
    const wm = cacheVm.context.widgetManager;
    wm.rootInterface = 161;
    wm.onLoadListener = (_id: number, widget: any) => cacheVm.runScriptEvent({ args: widget.onLoad, widget });
    wm.getGroup(464);
    wm.getGroup(238);
    const checked = new Inventory(28);
    checked.setSlot(0, 1333, 1);
    const backpack = new Inventory(28);
    backpack.setSlot(0, 1511, 10);
    cacheVm.context.inventories = new Map([[90, checked], [93, backpack]]);
    cacheVm.run(cacheVm.context.loadScript(149), [(238 << 16), 93, 4, 7, 1, -1],
        ['Add', 'Add-5', 'Add-10', 'Add-All', 'Add-X']);
    assert.equal(wm.getWidgetByUid(238 << 16).children[0].itemId, 1511);
    cacheVm.run(cacheVm.context.loadScript(785), [], [], undefined,
        [12345678901n, ...Array(27).fill(0n)]);
    assert.equal(wm.getWidgetByUid((464 << 16) | 2).children[0].itemId, 1333);
    assert.ok(wm.getWidgetByUid((464 << 16) | 2).children.some((child: any) =>
        child?.text?.includes('12,345,678,901')), 'guide-price text preserves a 64-bit total');

    // Looting bag prices precede setup: wrong int arguments throw before it can draw the items.
    wm.getGroup(81);
    const runPacket = (packet: Uint8Array) => {
        const { payload } = decodeServerPacket(packet) as any;
        for (const [id, snapshot] of Object.entries(payload.inventories ?? {}) as [string, any][]) {
            const inventory = new Inventory(snapshot.capacity);
            inventory.setSnapshot(snapshot.slots);
            cacheVm.context.inventories.set(Number(id), inventory);
        }
        if (payload.scriptId < 0) return;
        cacheVm.run(cacheVm.context.loadScript(payload.scriptId),
            payload.args.filter((arg: any) => typeof arg === 'number'),
            payload.args.filter((arg: any) => typeof arg === 'string'), undefined,
            payload.args.filter((arg: any) => typeof arg === 'bigint'));
        assert.equal(cacheVm.lastError, null);
    };
    runPacket(encodeWidgetRunScript(-1, [], undefined, undefined, {
        516: { capacity: 28, slots: [{ slot: 0, itemId: 995, quantity: 7 }, { slot: 1, itemId: 1333, quantity: 1 }] },
    }));
    runPacket(encodeWidgetRunScript(1235, [516, 1n, 12_345_678_901n, ...Array(26).fill(-1n)]));
    runPacket(encodeWidgetRunScript(495, ['Looting bag', 0]));
    const bagItems = wm.getWidgetByUid((81 << 16) | 5);
    assert.equal(wm.getWidgetByUid((81 << 16) | 1).text, 'Looting bag');
    assert.deepEqual(bagItems.children.slice(0, 2).map((child: any) => [child.itemId, child.itemQuantity]),
        [[995, 7], [1333, 1]], 'Check draws the decoded bag inventory');
    assert.ok(bagItems.children[1].onMouseRepeat.some((arg: any) =>
        typeof arg === 'string' && arg.includes('12,345,678,901')), 'per-slot prices retain 64 bits');
    runPacket(encodeWidgetRunScript(1235, [93, 42n, ...Array(27).fill(-1n)]));
    runPacket(encodeWidgetRunScript(495, ['Add to bag', 1]));
    assert.equal(bagItems.children[0].itemId, 1511, 'Deposit draws the backpack instead');
    assert.equal(bagItems.children[0].actions[0], 'Store-1');

    wm.getGroup(218);
    const spellbook = wm.getWidgetByUid(218 << 16);
    for (const [book, child] of [[0, 6], [1, 108], [2, 109], [3, 153]]) {
        cacheVm.context.varManager.setVarbit(4070, book);
        cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
        const home = wm.getWidgetByUid((218 << 16) | child);
        assert.ok(deriveRawMenuEntriesForWidget(home).some(entry => entry.option === 'Animation' && entry.opIndex === 10),
            `Home Teleport animation menu entry in spellbook ${book}`);
    }

    wm.getGroup(525);
    cacheVm.context.varManager.setVarp(4559, 4093);
    cacheVm.context.varManager.setVarp(4560, 1);
    cacheVm.run(cacheVm.context.loadScript(7707), [], []);
    assert.equal(cacheVm.lastError, null, 'native Home Teleport animation picker initializes');
    assert.ok(wm.getWidgetByUid((525 << 16) | 3).children.some((child: any) =>
        child?.text === 'Home Teleport Animations'));
    const toggles = wm.getWidgetByUid((525 << 16) | 8).children;
    for (const toggle of [toggles[0], toggles[1]]) {
        cacheVm.runScriptEvent({ args: toggle.onClick, widget: toggle });
        assert.equal(cacheVm.context.varManager.getVarp(4560), 1,
            'Default remains selected: the last animation and locked cosmetics cannot be toggled');
    }

    // Native Castle Wars area packets must drive the cache's own HUD for both teams.
    // Run the production text handler without constructing the browser/game renderer.
    const source = ts.createSourceFile('OsrsClient.ts', fs.readFileSync(path.resolve(__dirname, '../game/OsrsClient.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    let textHandler = '', holdMethod = '';
    const findHandlers = (node: ts.Node) => {
        if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleWidgetPayload') textHandler = node.initializer!.getText(source);
        if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'holdForUnloadedGroup') holdMethod = node.getText(source);
        ts.forEachChild(node, findHandlers);
    };
    findHandlers(source);
    assert.ok(textHandler && holdMethod);
    const compile = (code: string) => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    const holdForUnloadedGroup = new Function('HELD_WIDGET_ACTIONS', compile('class Hold {' + holdMethod + '} return Hold.prototype;'))(new Set(['set_text'])).holdForUnloadedGroup;
    const client = {
        widgetManager: wm, heldWidgetProperties: new HeldWidgetProperties(),
        pendingInterfaceUpdates: new PendingInterfaceUpdates(), holdForUnloadedGroup,
        customInterfaces: { handleSetText: () => false },
    };
    const handleText = new Function('markWidgetInteractionDirty', compile('return ' + textHandler)).call(client, markWidgetInteractionDirty);
    wm.onGroupLoaded = (group: number) => client.heldWidgetProperties.take(group).forEach(handleText);
    wm.resize(958, 973);
    wm.setRootInterface(161);
    resetTransmitCycles();
    const queued: any[] = [];
    const transmits = new WidgetTransmitProcessor({ getWidgetManager: () => wm, getCs2Vm: () => cacheVm,
        getTransmitCycles, queueScriptEvent: event => queued.push(event),
        executeScriptListener: (widget, args) => cacheVm.runScriptEvent({ widget, args }) });
    cacheVm.context.varManager.onVarpChange = (id: number) => cacheVm.isRunning() ? cacheVm.queueVarpChange(id) : markVarTransmit(id);
    cacheVm.onVarpChange = markVarTransmit;
    const tickHud = () => {
        transmits.processWidgetTransmits();
        while (queued.length) cacheVm.runScriptEvent(queued.shift());
        assert.equal(cacheVm.lastError, null);
    };
    const serverRoot = require('node:path').resolve(__dirname, '../../server');
    const serverModules = serverRoot + '/src/main/typescript/elvarg';
    const clientRoot = process.cwd();
    process.chdir(serverRoot);
    require(serverModules + '/Server').Server.installProductionPathResolver();
    require(serverModules + '/game/cache/CachePipeline').CachePipeline.initialize(serverRoot);
    const { PluginManager } = require(serverModules + '/plugins/PluginManager');
    const { Player } = require(serverModules + '/game/entity/impl/player/Player');
    const { World } = require(serverModules + '/game/World');
    const { RegionManager } = require(serverModules + '/game/collision/RegionManager');
    const core = PluginManager.getCoreApi();
    let groupingOpened: ((event: any) => void) | undefined;
    require(serverRoot + '/plugins/interface/MinigameTeleports.plugin').register({
        core, persistAttribute() {}, onPlayerLogin() {}, onInterfaceActionClick() {},
        onCustomEvent(name: string, handler: any) { if (name === 'interface:opened') groupingOpened = handler; },
    });
    wm.getGroup(76);
    cacheVm.context.varManager.setVarcInt(64, 5); // Cache enum848: Castle Wars.
    cacheVm.run(cacheVm.context.loadScript(435), [], []);
    assert.equal(cacheVm.lastError, null);
    const groupingTeleport = wm.getWidgetByUid((76 << 16) | 32).children[5];
    assert.match(groupingTeleport.actions[0], /Castle Wars/);
    assert.equal(shouldTransmitAction(wm.getWidgetFlags(groupingTeleport), 0), false, 'the cache alone has no transmit flag');
    assert.ok(groupingOpened, 'the minigame plugin enables the button on each native mount');
    groupingOpened({ groupId: 76, player: { getPacketSender: () => ({
        sendInterfaceFlagsRange(uid: number, from: number, to: number, flags: number) {
            const { payload } = decodeServerPacket(encodeWidgetSetFlagsRange(uid, from, to, flags)) as any;
            for (let slot = payload.fromSlot; slot <= payload.toSlot; slot++) wm.setWidgetFlagsByKey(payload.uid, slot, payload.flags);
        },
    }) } });
    assert.equal(shouldTransmitAction(wm.getWidgetFlags(groupingTeleport), 0), true);
    assert.equal(shouldTransmitAction(wm.getWidgetFlags(wm.getWidgetByUid((76 << 16) | 32).children[0]), 0), false, 'no selection stays disabled');
    assert.deepEqual(buildWidgetActionPayload(wm, { widget: groupingTeleport, opIndex: 1 }), {
        widgetId: (76 << 16) | 32, groupId: 76, childId: 32, slot: 5, opId: 1,
    });
    RegionManager.init();
    RegionManager.loadMapFiles(2426, 3080);
    let setUp: (event: any) => void;
    const api = {
        core,
        getAreaManager: () => ({}), getBonusManager: () => ({}),
        getObjectManager: () => ({ register() {}, deregister() {} }),
        getRegionManager: () => RegionManager, getTaskManager: () => ({ submit() {} }),
        getWorld: () => World,
        registerArea() {}, onServerStartup() {}, onPlayerLogin() {}, onCanEquip() {}, onCanUnequip() {},
        onCustomEvent() {}, onPlayerDeath() {}, onShouldDropItemsOnDeath() {}, emitCustomEvent() {},
        onItemAction(_name: string, actions: any) { setUp = actions['Set-up']; },
        onNpcDeath() {}, onNpcInteraction() {}, onItemOnNpc() {},
    };
    const game = require(serverRoot + '/plugins/minigames/castlewars/Game.CastleWars')(api);
    require(serverRoot + '/plugins/minigames/castlewars/Areas.CastleWars')(api, game);
    require(serverRoot + '/plugins/minigames/castlewars/Barricades.CastleWars')(api, game);
    require(serverRoot + '/plugins/minigames/castlewars/Settings.CastleWars')(api, game);
    game.isPlaying = () => true;
    cacheVm.context.varManager.setServerVarbit(16207, 1); // A stale split-cap world must be reset.
    const received: any[] = [];
    const player = new Player(null, new core.Location(2426, 3081, 1));
    player.getSession = () => ({ sendClientPacket(packet: Uint8Array) {
        const message = decodeServerPacket(packet) as any;
        received.push(message);
        if (message.type === 'varbit') cacheVm.context.varManager.setServerVarbit(message.payload.varbitId, message.payload.value);
        if (message.type === 'varp') cacheVm.context.varManager.setServerVarp(message.payload.varpId, message.payload.value);
        if (message.type === 'widget' && message.payload.action === 'set_text') handleText(message.payload);
        if (message.type === 'widget' && message.payload.action === 'open_sub') wm.openSubInterface(message.payload.targetUid, message.payload.groupId, message.payload.type);
    }, write() {} });
    player.getInventory().add(new core.Item(core.ItemIdentifiers.BARRICADE, 3));
    const { SARADOMIN, ZAMORAK } = game.TEAM;
    const castleStates = {
        [SARADOMIN]: [75, 1, 1, 0, 1],
        [ZAMORAK]: [40, 0, 0, 1, 0],
    };
    for (const team of [SARADOMIN, ZAMORAK]) {
        Object.values(game.TEAM_VARBIT).forEach((varbit, i) => game.setTeamVar(team, varbit, castleStates[team][i]));
    }
    let mountedHud = -1;
    const checkCastleHud = (team: string, count: number) => {
        game.setTeamId(player, team);
        const group = team === SARADOMIN ? 58 : 59;
        if (mountedHud !== group) {
            player.getPacketSender().sendSubInterface(game.data.OVERLAY_HUD_UID, group, 1);
            mountedHud = group;
        }
        game.gameArea.process(player);
        tickHud();
        const listener = wm.getWidgetByUid((group << 16) | (group === 58 ? 20 : 19));
        cacheVm.runScriptEvent({ args: listener.onVarTransmit, widget: listener });
        assert.equal(cacheVm.lastError, null);
        assert.equal(wm.getWidgetByUid((group << 16) | 15).text, `${count}/${game.getBarricadeLimit()} Barricades`,
            `${team} sees its live count through native cache script ${group === 58 ? 887 : 888}`);
        const [health, unlocked, northSouth, eastWest, broken] = castleStates[team];
        assert.deepEqual([5, 7, 9, 11, 13].map(child => wm.getWidgetByUid((group << 16) | child).text), [
            `Health ${health}%`, unlocked ? '<col=ff0000>Unlocked</col>' : 'Locked',
            northSouth ? '<col=ff0000>Cleared</col>' : 'Collapsed',
            eastWest ? '<col=ff0000>Cleared</col>' : 'Collapsed',
            broken ? '<col=ff0000>Destroyed</col>' : 'Operational',
        ], `${team} sees its own doors, tunnels and catapult`);
        const [, , , , , , , saraFlag, zamFlag, saraScore, zamScore, timer] = listener.onVarTransmit;
        const flagText = ['Safe', '<col=ff0000>Taken</col>', '<col=ffff00>Dropped</col>'];
        assert.deepEqual([saraFlag, zamFlag, saraScore, zamScore, timer].map(uid => wm.getWidgetByUid(uid).text), [
            flagText[game.flagStatus[SARADOMIN]], flagText[game.flagStatus[ZAMORAK]],
            `${game.score[SARADOMIN]} = Saradomin`, `Zamorak = ${game.score[ZAMORAK]}`, `${game.gameMinutesLeft()} Min`,
        ], 'native flag states, both scores and timer remain live');
        assert.ok(!listener.hidden && !listener.isHidden, 'the native score container stays visible');
    };
    checkCastleHud(SARADOMIN, 0);
    setUp!({ player, slot: 0 });
    const first = [...World.getNpcs()].find((npc: any) => game.isBarricade(npc));
    assert.ok(first, 'the real inventory action placed a barricade');
    checkCastleHud(SARADOMIN, 1);
    const unchanged = received.length;
    checkCastleHud(SARADOMIN, 1);
    assert.equal(received.length, unchanged, 'unchanged area ticks do not resend HUD packets');
    checkCastleHud(ZAMORAK, 0);
    player.moveTo(new core.Location(2423, 3076, 1));
    setUp!({ player, slot: 0 });
    checkCastleHud(ZAMORAK, 1);
    // The configured cap only applies while practice bots are in the game.
    const hasPracticeBots = game.hasPracticeBots;
    game.hasPracticeBots = () => true;
    game.settings.barricades = 20;
    checkCastleHud(SARADOMIN, 1);
    checkCastleHud(ZAMORAK, 1);
    const extra = Array.from({ length: 19 }, () => new core.NPC(game.data.BARRICADE_NPC[ZAMORAK], player.getLocation().clone()));
    extra.forEach(npc => game.trackBarricade(npc, ZAMORAK));
    castleStates[ZAMORAK][0] = 33;
    game.setTeamVar(ZAMORAK, game.TEAM_VARBIT.DOOR_HEALTH, 33);
    game.score[SARADOMIN] = 2;
    game.score[ZAMORAK] = 3;
    game.flagStatus[SARADOMIN] = 1;
    game.flagStatus[ZAMORAK] = 2;
    checkCastleHud(ZAMORAK, 20);
    game.releaseBarricade(extra.pop());
    checkCastleHud(ZAMORAK, 19);
    extra.forEach(npc => game.releaseBarricade(npc));
    checkCastleHud(ZAMORAK, 1);
    game.settings.barricades = 10;
    game.hasPracticeBots = hasPracticeBots;
    checkCastleHud(ZAMORAK, 1);
    assert.equal(wm.isServerOwnedWidget((59 << 16) | 15), false, 'normal mode releases cache text ownership');
    game.removeBarricade(first);
    World.getNpcs().remove(first);
    checkCastleHud(SARADOMIN, 0);

    // Ownership survives queued onLoad/transmit work and pre-load ordinary text updates.
    for (const group of [58, 59]) {
        wm.closeSubInterface(game.data.OVERLAY_HUD_UID);
        const uid = (group << 16) | 15;
        const applyText = (text: string, owned?: boolean) => handleText((decodeServerPacket(encodeWidgetSetText(uid, text, owned)) as any).payload);
        applyText('initial', true);
        applyText('6/20 Barricades');
        wm.openSubInterface(game.data.OVERLAY_HUD_UID, group, 1);
        const listener = wm.getWidgetByUid((group << 16) | (group === 58 ? 20 : 19));
        cacheVm.runScriptEvent({ args: listener.onLoad, widget: listener });
        assert.equal(wm.getWidgetByUid(uid).text, '6/20 Barricades');
        assert.equal(wm.isServerOwnedWidget(uid), true);
        applyText('7/20 Barricades');
        cacheVm.runScriptEvent({ args: listener.onVarTransmit, widget: listener });
        assert.equal(wm.getWidgetByUid(uid).text, '7/20 Barricades', 'ordinary live text preserves ownership');
        applyText('release', false);
        cacheVm.runScriptEvent({ args: listener.onVarTransmit, widget: listener });
        assert.equal(wm.getWidgetByUid(uid).text, '0/10 Barricades');
        client.pendingInterfaceUpdates.open(group);
        applyText('pending', true);
        applyText('8/20 Barricades');
        client.pendingInterfaceUpdates.flush(group, handleText);
        cacheVm.runScriptEvent({ args: listener.onVarTransmit, widget: listener });
        assert.equal(wm.getWidgetByUid(uid).text, '8/20 Barricades', 'pending interface updates retain ownership');
        wm.closeSubInterface(game.data.OVERLAY_HUD_UID);
        assert.equal(wm.isServerOwnedWidget(uid), false, 'closing releases widget ownership');
        applyText('release before load', false);
        applyText('ordinary before load');
        wm.openSubInterface(game.data.OVERLAY_HUD_UID, group, 1);
        assert.equal(wm.isServerOwnedWidget(uid), false);
        const reopened = wm.getWidgetByUid((group << 16) | (group === 58 ? 20 : 19));
        cacheVm.runScriptEvent({ args: reopened.onVarTransmit, widget: reopened });
        assert.equal(wm.getWidgetByUid(uid).text, '0/10 Barricades', 'reopened normal mode runs the native counter');
    }
    checkCastleHud(ZAMORAK, 1);
    const remaining = [...World.getNpcs()].filter((npc: any) => game.isBarricade(npc));
    game.hasPracticeBots = () => true;
    game.settings.barricades = 20;
    game.resetMatchState();
    castleStates[SARADOMIN] = castleStates[ZAMORAK] = [100, 0, 0, 0, 0];
    for (const npc of remaining) World.getNpcs().remove(npc);
    World.getRemoveNPCQueue().splice(0);
    checkCastleHud(ZAMORAK, 0);
    checkCastleHud(SARADOMIN, 0);
    game.settings.barricades = 10;
    game.hasPracticeBots = hasPracticeBots;
    checkCastleHud(SARADOMIN, 0);

    // The cache itself grants free runes only with a pouch and an active Castle Wars team.
    const pouchInventory = new Inventory(28);
    cacheVm.context.inventories.set(93, pouchInventory);
    for (const [name, book, free] of [
        ['Wind Strike', 0, true], ['Ice Barrage', 1, true], ['Humidify', 2, true],
        ['Energy Transfer', 2, true], ['Vengeance Other', 2, true], ['Vengeance', 2, true],
        ['Spellbook Swap', 2, true], ['Magic Imbue', 2, false],
    ] as const) {
        const definition = core.CacheDefinitions.getSpellByName(name);
        const params = core.CacheDefinitions.getItem(definition.itemId).params;
        cacheVm.context.varManager.setServerVarbit(4070, book);
        cacheVm.runScriptEvent({ args: spellbook.onLoad, widget: spellbook });
        const spell = wm.getWidgetByUid(definition.widgetId);
        const checkAvailable = (available: boolean) => {
            for (const widget of wm.getGroup(218).widgetsByFileId.values()) {
                cacheVm.invokeEventHandler(widget, 'onInvTransmit');
                cacheVm.invokeEventHandler(widget, 'onVarTransmit');
            }
            assert.equal(cacheVm.lastError, null);
            if (available) assert.equal(cacheVm.context.varManager.getVarbit(144) | cacheVm.context.varManager.getVarbit(154), 1);
            assert.equal(spell.spriteId, params.get(available ? 597 : 598), `${name}: free availability ${available}`);
        };
        pouchInventory.setSlot(0, -1, 0);
        checkAvailable(false);
        pouchInventory.setSlot(0, game.data.RUNE_POUCH, 1);
        for (const team of [SARADOMIN, ZAMORAK]) {
            game.setTeamId(player, team);
            game.gameArea.process(player);
            checkAvailable(free);
            pouchInventory.setSlot(0, -1, 0);
            checkAvailable(false);
            pouchInventory.setSlot(0, game.data.RUNE_POUCH, 1);
            game.closeOverlay(player);
            checkAvailable(false);
        }
    }

    // The server's autocast selector key must populate the native Ancient spell chooser.
    const { Autocasting } = require(serverModules + '/game/content/combat/magic/Autocasting');
    const { CombatSpells } = require(serverModules + '/game/content/combat/magic/CombatSpells');
    require(serverRoot + '/plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
    player.setSpellbook(core.MagicSpellbook.ANCIENT);
    cacheVm.context.varManager.setServerVarbit(4070, 1);
    for (const weapon of [
        core.ItemIdentifiers.MASTER_WAND, core.ItemIdentifiers.NIGHTMARE_STAFF,
        core.ItemIdentifiers.VOLATILE_NIGHTMARE_STAFF, core.ItemIdentifiers.ELDRITCH_NIGHTMARE_STAFF,
        core.ItemIdentifiers.KODAI_WAND, core.ItemIdentifiers.ANCIENT_STAFF,
    ]) {
        player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weapon));
        for (const style of [23, 28]) {
            player.getCombat().setAutocastSpell(null);
            assert.equal(Autocasting.handleWidgetAction(player, 593, style), true);
            wm.getGroup(201);
            const root = wm.getWidgetByUid(201 << 16);
            cacheVm.runScriptEvent({ args: root.onLoad, widget: root });
            assert.equal(cacheVm.lastError, null);
            const choices = wm.getWidgetByUid((201 << 16) | 1).children;
            assert.deepEqual(choices.filter((child: any) => child && !child.hidden && child.childIndex > 0)
                .map((child: any) => child.childIndex), Array.from({ length: 16 }, (_, i) => i + 31),
                `weapon ${weapon}, style ${style} displays all sixteen Ancient combat spells`);
            assert.equal(choices[46].actions[0], 'Ice Barrage');
            Autocasting.handleWidgetAction(player, 201, 1, 46);
            assert.equal(player.getCombat().getAutocastSpell(), CombatSpells.ICE_BARRAGE);
        }
    }
    process.chdir(clientRoot);
}

console.log("Cache panel scripts retain inventory items, 64-bit prices and native Castle Wars HUD state");

// Fairytale II documents use the cache's IF1 models and fairy fonts without rewritten text.
{
    const { vm } = require('../scripts/cache/cs2-sweep').createCacheVm();
    const { encodeWidgetOpenSub, encodeWidgetCloseSub } = require('../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
    const wm = vm.context.widgetManager, errors: unknown[] = [], target = (161 << 16) | 16;
    vm.logError = (error: unknown) => errors.push(error);
    wm.setRootInterface(161); wm.resize(765, 503);
    wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
    const documents = [
        { group: 423, args: [-1, -1], model: 16050, textChild: 1, font: 497, text: 'Certificate of Advanced Healing' },
        { group: 424, args: [4269835, 100], model: 16051, textChild: 4, font: 647, text: 'AIR DLR DJQ AJS' },
        { group: 425, args: [-1, -1], model: 16067, textChild: 1, font: 648, text: 'COSMIC<br>RUNEe<br>ALTAR' },
    ];
    // Opening the front again after the back must restore the ordinary modal arguments.
    for (const document of [...documents, documents[0]]) {
        const script: any = decodeServerPacket(encodeWidgetRunScript(2524, document.args));
        vm.run(vm.context.loadScript(script.payload.scriptId), script.payload.args, []);
        assert.equal(vm.lastError, null);
        assert.equal(vm.context.varManager.getVarcInt(172), document.args[0]);
        assert.equal(vm.context.varManager.getVarcInt(173), document.args[1]);
        const open: any = decodeServerPacket(encodeWidgetOpenSub(target, document.group, 0));
        wm.openSubInterface(open.payload.targetUid, open.payload.groupId, open.payload.type);
        assert.equal(wm.getSubInterface(target)?.group, document.group);
        const model = wm.getWidgetByUid(document.group << 16);
        const text = wm.getWidgetByUid((document.group << 16) | document.textChild);
        assert.equal(model.type, 6); assert.equal(model.modelId, document.model); assert.equal(model.hidden, false);
        assert.equal(text.fontId, document.font); assert.equal(text.hidden, false);
        assert.ok(text.text.includes(document.text));
        const close: any = decodeServerPacket(encodeWidgetCloseSub(target));
        wm.closeSubInterface(close.payload.targetUid);
        assert.equal(wm.getSubInterface(target), undefined);
    }
    assert.deepEqual(errors, []);
}

// Ring pickers use the cache's pause-button routes, with their distinct choice indices.
{
    const { vm } = require('../scripts/cache/cs2-sweep').createCacheVm();
    const { processWidgetClickInput } = require('../game/widgets/input/widgetClickInput');
    const { WidgetActionRouter } = require('../game/widgets/WidgetActionRouter');
    const { decodeClientPackets } = require('../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
    const { state } = require('../network/serverConnection/state');
    const rings = require('../../server/plugins/items/TransformationRings.plugin')._test.RINGS;
    const wm = vm.context.widgetManager, frames: Buffer[] = [], errors: unknown[] = [];
    const socket = { readyState: 1, send: (frame: Uint8Array) => frames.push(Buffer.from(frame)) };
    (globalThis as any).WebSocket ??= { OPEN: 1 };
    state.socket = socket; setPacketSocket(socket as any);
    vm.logError = (error: unknown) => errors.push(error);
    wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
    wm.setRootInterface(161); wm.resize(765, 503);
    const interaction: any = {
        clickedWidget: null, clickedWidgetParent: null, clickedWidgetHandled: false,
        resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false,
        isWidgetDraggable: () => false,
    };
    let router: any;
    const deps: any = new Proxy({
        getWidgetManager: () => wm, getCs2Vm: () => vm, getVarManager: () => vm.context.varManager,
        getCustomInterfaces: () => ({ handleWidgetClick: () => false, rowIdAt: () => undefined, handleWidgetOp() {} }),
        getTransmitCycles: () => ({ cycleCntr: 1 }), getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
        handleTradeWidgetAction: () => false,
        buildWidgetActionPayload: (event: any) => router.buildWidgetActionPayload(event),
        resolveTransmitFlagWidget: (widget: any, payload: any) => router.resolveTransmitFlagWidget(widget, payload),
        executeScriptListener: (widget: any, args: any[], context: any) => vm.runScriptEvent({ args, widget, ...context }),
    }, { get: (target: any, key: any) => target[key] ?? (() => undefined) });
    router = new WidgetActionRouter(deps);
    const click = (widget: any) => {
        frames.length = 0;
        wm.meslayerContinueWidget = null; // A fresh mount/answer releases the native repeat guard.
        interaction.clickedWidget = null; interaction.clickedWidgetParent = null; interaction.clickedWidgetHandled = false;
        processWidgetClickInput(deps, { cachedHoverHits: null }, {
            input: { leftClickX: 10, leftClickY: 10 }, collectFromAllRoots: () => [widget],
            getWidgetFlags: (target: any) => wm.getWidgetFlags(target),
        }, wm, interaction, (target: any) => ({ option: target.actions?.[0] ?? target.text ?? 'Continue', target: '', opIndex: 1 }), true);
        flushPackets();
        return frames.flatMap(frame => decodeClientPackets(frame));
    };
    try {
        wm.openSubInterface((161 << 16) | 16, 187, 0);
        vm.run(vm.context.loadScript(217), [1], ['Choose a form', Object.keys(rings['Ring of 3rd Age'].choices).join('|')]);
        const choices = wm.getDynamicChildrenByParent((187 << 16) | 3);
        assert.equal(choices.length, 24);
        for (const index of [0, 23]) {
            wm.setWidgetFlagsByKey((187 << 16) | 3, index, 1);
            assert.deepEqual(click(choices.find((widget: any) => widget.childIndex === index)),
                [{ type: 'dialogue_continue', childIndex: index, widgetId: (187 << 16) | 3 }]);
        }
        wm.closeSubInterface((161 << 16) | 16);
        wm.openSubInterface((162 << 16) | 567, 219, 0);
        vm.run(vm.context.loadScript(58), [], ['Choose a form', 'Traditional|Tempy|Thermy']);
        const snowmen = wm.getDynamicChildrenByParent((219 << 16) | 1);
        for (const index of [1, 3]) {
            wm.setWidgetFlagsByKey((219 << 16) | 1, index, 1);
            assert.deepEqual(click(snowmen.find((widget: any) => widget.childIndex === index)),
                [{ type: 'dialogue_continue', childIndex: index, widgetId: (219 << 16) | 1 }]);
        }
        wm.openSubInterface((162 << 16) | 567, 136, 0);
        const unmorph = wm.getWidgetByUid(136 << 16);
        assert.deepEqual(unmorph.actions, ['Unmorph']);
        const packets = click(unmorph);
        assert.equal(packets.length, 1); assert.equal(packets[0].type, 'widget_action');
        assert.equal(packets[0].widgetId, 136 << 16); assert.equal(packets[0].buttonNum, 1);
        wm.openSubInterface((162 << 16) | 567, 747, 0);
        for (const [child, label] of ['Unmorph', 'Question', 'Exclaim', 'Shake', 'Survey'].entries()) {
            const button = wm.getWidgetByUid((747 << 16) | child);
            assert.deepEqual(button.actions, [label]);
            const cratePackets = click(button);
            assert.equal(cratePackets.length, 1); assert.equal(cratePackets[0].type, 'widget_action');
            assert.equal(cratePackets[0].widgetId, (747 << 16) | child); assert.equal(cratePackets[0].buttonNum, 1);
        }
        assert.deepEqual(errors, []);
    } finally {
        setPacketSocket(null); state.socket = null;
    }
}

// Native prayer and quick-prayer icons follow the server's Knight Waves unlock varbit.
{
    const { createCacheVm } = require('../scripts/cache/cs2-sweep');
    const { encodeVarbit } = require('../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
    const { vm } = createCacheVm(), wm = vm.context.widgetManager;
    vm.context.getStatLevel = vm.context.getStatBase = vm.context.getStatBoosted = () => 99;
    wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
    wm.resize(765, 503); wm.setRootInterface(161); resetTransmitCycles();
    const queued: any[] = [];
    const transmits = new WidgetTransmitProcessor({ getWidgetManager: () => wm, getCs2Vm: () => vm,
        getTransmitCycles, queueScriptEvent: event => queued.push(event),
        executeScriptListener: (widget, args) => vm.runScriptEvent({ widget, args }) });
    vm.context.varManager.onVarpChange = (id: number) => vm.isRunning() ? vm.queueVarpChange(id) : markVarTransmit(id);
    vm.onVarpChange = markVarTransmit;
    for (const group of [541, 77]) {
        wm.openSubInterface((161 << 16) | 81, group, 1);
        vm.run(vm.context.loadScript(915), [5], []); // The server selects the prayer sidebar.
        for (const [state, sprites] of [[0, [949, 950]], [8, [945, 946]], [0, [949, 950]]] as const) {
            const message = decodeServerPacket(encodeVarbit(3909, state)) as any;
            vm.context.varManager.setServerVarbit(message.payload.varbitId, message.payload.value);
            transmits.processWidgetTransmits();
            while (queued.length) vm.runScriptEvent(queued.shift());
            assert.equal(vm.lastError, null);
            const icons = group === 541 ? [34, 35].map(child => wm.getWidgetByUid((541 << 16) | child).children[1])
                : [79, 81].map(index => wm.getWidgetByUid((77 << 16) | 4).children[index]);
            assert.deepEqual(icons.map(icon => icon.spriteId), sprites,
                `${group} shows the native Chivalry/Piety locked or unlocked sprites`);
        }
    }
    resetTransmitCycles();
}

// Cache trade buttons reach the dedicated binary protocol, including second-screen Accept.
{
    const { vm } = require('../scripts/cache/cs2-sweep').createCacheVm();
    const { handleTradeWidgetAction } = require('../game/widgets/widgetActionTrade');
    const { decodeClientPackets } = require('../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol');
    const { state } = require('../network/serverConnection/state');
    const previousSocket = state.socket, frames: Buffer[] = [];
    (globalThis as any).WebSocket ??= { OPEN: 1 };
    state.socket = { readyState: 1, send: (frame: Uint8Array) => frames.push(Buffer.from(frame)) };
    try {
        for (const [group, child, stage, action] of [
            [335, 10, 'offer', 'accept'], [335, 13, 'offer', 'decline'],
            [334, 13, 'confirm', 'confirm_accept'], [334, 14, 'confirm', 'confirm_decline'],
            [334, 32, 'confirm', 'confirm_decline'],
        ] as const) {
            vm.context.widgetManager.getGroup(group);
            const widget = vm.context.widgetManager.getWidgetByUid((group << 16) | child);
            frames.length = 0;
            assert.equal(handleTradeWidgetAction({ getTradeState: () => ({ open: true, stage }) },
                widget, { option: widget.actions[0] }, group, child), true);
            assert.equal(frames.length, 1);
            const decoded = frames.flatMap(frame => decodeClientPackets(frame));
            assert.equal(decoded.length, 1); assert.equal(decoded[0].type, 'trade_action');
            assert.equal(decoded[0].action, action, 'the native cache option selects the intended binary action');
            if (action === 'confirm_accept') assert.equal(frames[0].toString('hex'), 'b40904000000000000ffff');
        }
    } finally {
        state.socket = previousSocket;
    }
}

// Actual cache key listeners -> native resume packet -> real PlayerSession/DestroyItem policy.
async function nativeDestroyConfirmation() {
    const previousDirectory = process.cwd();
    const serverRoot = path.resolve(__dirname, '../../server');
    process.chdir(serverRoot);
    const serverModules = serverRoot + '/src/main/typescript/elvarg';
    const { PluginManager } = require(serverModules + '/plugins/PluginManager');
    const { Player } = require(serverModules + '/game/entity/impl/player/Player');
    const { PlayerSession } = require(serverModules + '/net/PlayerSession');
    const { ClientConnection } = require(serverModules + '/net/NetworkBuilder');
    const { DropItemPacketListener } = require(serverModules + '/net/packet/impl/DropItemPacketListener');
    const core = PluginManager.getCoreApi();
    const { vm } = require('../scripts/cache/cs2-sweep').createCacheVm();
    const wm = vm.context.widgetManager;
    const scriptErrors: unknown[] = [];
    vm.logError = (error: unknown) => scriptErrors.push(error);
    // Use the production callback, including its native pausebutton repeat guard.
    const source = ts.createSourceFile('OsrsClient.ts', fs.readFileSync(path.resolve(__dirname, '../game/OsrsClient.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
    let resumeCallback = '';
    const findCallback = (node: ts.Node) => {
        if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'sendResumePauseButton') resumeCallback = node.initializer.getText(source);
        ts.forEachChild(node, findCallback);
    };
    findCallback(source);
    assert.ok(resumeCallback);
    const callback = ts.transpile(`const resume = ${resumeCallback}`, { target: ts.ScriptTarget.ES2020 });
    vm.context.sendResumePauseButton = new Function('self', 'createPacket', 'ClientPacketId', 'queuePacket', `${callback}; return resume;`)
        ({ widgetManager: wm }, createPacket, ClientPacket, queuePacket);
    wm.setRootInterface(161);
    wm.openSubInterface((161 << 16) | 96, 162);
    const channel = { kind: 'test', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const player = new Player(session);
    player.setIndex(101); player.setUsername('destroykeys'); player.setRegistered(true);
    const send = session.sendClientPacket.bind(session);
    session.sendClientPacket = (frame: Uint8Array) => {
        const message = decodeServerPacket(frame) as any;
        const payload = message.payload;
        if (message.type === 'widget') {
            if (payload.action === 'set_hidden') wm.getWidgetByUid(payload.uid).hidden = payload.hidden;
            if (payload.action === 'open_sub') wm.openSubInterface(payload.targetUid, payload.groupId, payload.type);
            if (payload.action === 'close_sub') wm.closeSubInterface(payload.targetUid);
        }
        if (message.type === 'runClientScript') vm.run(vm.context.loadScript(payload.scriptId),
            payload.args.filter((arg: any) => typeof arg === 'number'), payload.args.filter((arg: any) => typeof arg === 'string'));
        return send(frame);
    };
    require(serverRoot + '/plugins/interface/DestroyItem.plugin').register(PluginManager.createApi('destroy-keyboard-test'));
    const connection = new ClientConnection(channel); connection.player = player;
    const outgoing: any[] = [];
    const { state } = require('../network/serverConnection/state');
    const { sendWidgetDrag } = require('../network/serverConnection/outgoing/bank');
    const previousSocket = state.socket;
    (globalThis as any).WebSocket ??= { OPEN: 1 };
    const socket = { readyState: 1, send: (frame: Uint8Array) => outgoing.push(decodeClientPacket(Buffer.from(frame))) } as any;
    state.socket = socket;
    setPacketSocket(socket);
    const open = () => {
        player.getInventory().setItem(0, new core.Item(11941, 1));
        DropItemPacketListener.drop(player, 11941, core.Inventory.INTERFACE_ID, 0);
        assert.equal(player.getPacketSender().isChatboxInterface(584), true);
        assert.equal(wm.getWidgetByUid((584 << 16) | 5).itemId, 11941);
        assert.equal(wm.getWidgetByUid((584 << 16) | 6).text, 'Looting bag');
        assert.equal(vm.lastError, null);
    };
    const key = (value: string) => {
        const input = new InputManager();
        input.onKeyDown({ key: value, keyCode: value.toUpperCase().charCodeAt(0), code: value === '1' || value === '2' ? `Digit${value}` : `Key${value.toUpperCase()}`, preventDefault() {} } as any);
        processWidgetKeyboardInput({ getCs2Vm: () => vm, getVarManager: () => vm.context.varManager,
            getPendingInputDialogAction: () => null, getPendingTradeQuantityAction: () => null,
            getCustomInterfaces: () => ({ handleSearchKeyEvents: () => false }),
        } as any, { input, mx: 0, my: 0, allRoots: wm.getAllGroupRoots(161), visibleMap: new Map(),
            getStaticChildren: (uid: number) => wm.getStaticChildrenByParentUid(uid) } as any, wm);
        flushPackets();
        assert.deepEqual(scriptErrors, [], 'native keyboard scripts run without errors');
    };
    const resume = async (action: number) => {
        assert.deepEqual(scriptErrors, [], 'native mouse and keyboard scripts run without errors');
        assert.deepEqual(outgoing, [{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: action }]);
        await connection.dispatch(outgoing.splice(0)); connection.processTurnPackets();
    };
    try {
        for (const [value, action] of [['1', 1], ['y', 1], ['Y', 1], ['2', 0], ['n', 0], ['N', 0]] as const) {
            open(); key(value); await resume(action);
            assert.equal(player.getInventory().getAmount(11941), action === 1 ? 0 : 1, `${value} selects the intended option`);
            await connection.dispatch([{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: 1 }]);
            connection.processTurnPackets();
            assert.equal(player.getInventory().getAmount(11941), action === 1 ? 0 : 1, 'a replay after closing cannot destroy an item');
        }
        for (const [component, action] of [[1, 1], [3, 0]]) {
            open(); vm.invokeEventHandler(wm.getWidgetByUid((584 << 16) | component), 'onOp', { opIndex: 1 });
            flushPackets(); await resume(action);
            assert.equal(player.getInventory().getAmount(11941), action === 1 ? 0 : 1, 'mouse clicks use the same guarded resume');
        }
        open(); key('x'); assert.deepEqual(outgoing, [], 'unrelated keys do not confirm');
        await connection.dispatch([{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: 2 }]); connection.processTurnPackets();
        assert.equal(player.getInventory().getAmount(11941), 1, 'invalid resume options cannot destroy');
        player.getInventory().setItem(0, new core.Item(995, 10)); key('1'); await resume(1);
        assert.equal(player.getInventory().getAmount(995), 10, 'a changed inventory slot is left intact');
        open(); player.getPacketSender().sendInterfaceRemoval();
        await connection.dispatch([{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: 1 }]); connection.processTurnPackets();
        assert.equal(player.getInventory().getAmount(11941), 1, 'a closed or replaced chat interface invalidates confirmation');

        // Bank incinerator: the cache's bankmain:incinerator_target is a drop target for the
        // stack under the cursor. Confirming destroys that bank stack; cancelling keeps it.
        const { PlayerSave } = require(serverModules + '/game/entity/impl/player/persistence/PlayerSave');
        const bankItems = (core.Bank.MAIN_INTERFACE_ID << 16) | core.Bank.ITEMS_CHILD;
        const bankIncinerator = (core.Bank.MAIN_INTERFACE_ID << 16) | core.Bank.INCINERATOR_CHILD;
        const bankSaves: Array<{ save: any; coinsAtEvent: number }> = [];
        PluginManager.createApi('bank-incinerate-save-test').onCustomEvent('persistence:save', (event) => {
            if (event.player !== player || event.reason !== 'bank-incinerate') return;
            bankSaves.push({ save: PlayerSave.fromPlayer(player), coinsAtEvent: player.getBank(0).getAmount(995) });
        });
        const openScene = (currentTab: number, fill: () => void) => {
            if (player.getInterfaceId() >= 0 || player.getPacketSender().isChatboxInterface(584)) {
                player.getPacketSender().sendInterfaceRemoval();
            }
            for (let tab = 0; tab < core.Bank.TOTAL_BANK_TABS; tab++) player.getBank(tab).resetItems();
            fill();
            player.setCurrentBankTab(currentTab);
            player.getBank(currentTab).open();
            assert.equal(player.getInterfaceId(), core.Bank.MAIN_INTERFACE_ID);
            assert.equal(player.getStatus(), core.PlayerStatus.BANKING);
        };
        // Send the actual IF_BUTTOND the client emits when the stack is released on the icon.
        const dragOntoIncinerator = async (sourceSlot: number, itemId: number) => {
            sendWidgetDrag(bankItems, sourceSlot, itemId, bankIncinerator, -1, -1);
            flushPackets();
            await connection.dispatch(outgoing.splice(0));
            connection.processTurnPackets();
        };
        const openBankIncinerator = async (sourceSlot: number, itemId: number) => {
            await dragOntoIncinerator(sourceSlot, itemId);
            assert.equal(player.getPacketSender().isChatboxInterface(584), true);
            assert.equal(wm.getWidgetByUid((584 << 16) | 5).itemId, itemId);
        };

        // Whole stack + neighbouring stack + a save snapshot taken after the mutation.
        openScene(0, () => {
            player.getBank(0).add(new core.Item(995, 5), false);
            player.getBank(0).add(new core.Item(556, 2), false);
        });
        await openBankIncinerator(0, 995); key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(995), 0, 'the whole bank stack is destroyed');
        assert.equal(player.getBank(0).getAmount(556), 2, 'the neighbouring stack is untouched');
        assert.equal(bankSaves.length, 1, 'the confirmed mutation requests a durable save');
        assert.equal(bankSaves[0].coinsAtEvent, 0, 'the save request follows the bank mutation');
        const reloaded = new Player(null);
        bankSaves[0].save.applyToPlayer(reloaded);
        assert.equal(reloaded.getBank(0).getAmount(995), 0, 'the saved snapshot has the stack removed');
        assert.equal(reloaded.getBank(0).getAmount(556), 2);
        assert.equal(player.getInterfaceId(), core.Bank.MAIN_INTERFACE_ID, 'confirming keeps the bank open');
        assert.equal(player.getStatus(), core.PlayerStatus.BANKING);

        // Cancellation leaves the stack, its neighbour and persistence alone.
        openScene(0, () => {
            player.getBank(0).add(new core.Item(995, 5), false);
            player.getBank(0).add(new core.Item(556, 2), false);
        });
        await openBankIncinerator(0, 995); key('2'); await resume(0);
        assert.equal(player.getBank(0).getAmount(995), 5, 'cancelling leaves the bank stack');
        assert.equal(player.getBank(0).getAmount(556), 2);
        assert.equal(bankSaves.length, 1, 'cancelling does not request a save');
        assert.equal(player.getInterfaceId(), core.Bank.MAIN_INTERFACE_ID, 'cancelling keeps the bank open');
        assert.equal(player.getStatus(), core.PlayerStatus.BANKING);

        // A changed amount invalidates the prompt.
        openScene(0, () => player.getBank(0).add(new core.Item(995, 5), false));
        await openBankIncinerator(0, 995);
        player.getBank(0).getItems()[0].setAmount(4);
        key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(995), 4, 'an amount change cannot destroy the stack');
        assert.equal(bankSaves.length, 1, 'a stale prompt does not request a save');

        // Reordering after the prompt cannot destroy the neighbour now in the original slot.
        openScene(0, () => {
            player.getBank(0).add(new core.Item(995, 5), false);
            player.getBank(0).add(new core.Item(556, 2), false);
        });
        await openBankIncinerator(0, 995);
        player.getBank(0).swap(0, 1);
        key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(995), 5, 'the reordered source stack remains');
        assert.equal(player.getBank(0).getAmount(556), 2, 'the new occupant of the old slot remains');
        assert.equal(bankSaves.length, 1, 'a reordered prompt does not request a save');

        // A nested metadata change invalidates the prompt.
        openScene(0, () => player.getBank(0).add(new core.Item(11907, 1, { charges: 5, state: { used: 0 } }), false));
        await openBankIncinerator(0, 11907);
        player.getBank(0).getItems()[0].getMeta().state.used = 1;
        key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(11907), 1, 'a nested metadata change cannot destroy the stack');
        assert.deepEqual(player.getBank(0).getItems()[0].getMeta(), { charges: 5, state: { used: 1 } });
        assert.equal(bankSaves.length, 1, 'a stale metadata prompt does not request a save');

        // A bank item in a nonzero tab resolves through the actual display slot.
        openScene(2, () => {
            player.getBank(1).add(new core.Item(995, 4), false);
            player.getBank(2).add(new core.Item(556, 3), false);
        });
        await openBankIncinerator(1, 556);
        key('1'); await resume(1);
        assert.equal(player.getBank(2).getAmount(556), 0, 'the nonzero-tab stack is destroyed');
        assert.equal(player.getBank(1).getAmount(995), 4);
        assert.equal(bankSaves.length, 2);

        // The all-items view maps its later slots back to the main tab.
        openScene(0, () => {
            player.getBank(1).add(new core.Item(556, 2), false);
            player.getBank(0).add(new core.Item(995, 5), false);
        });
        await openBankIncinerator(1, 995);
        key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(995), 0, 'the all-items stack is destroyed');
        assert.equal(player.getBank(1).getAmount(556), 2);
        assert.equal(bankSaves.length, 3);

        // Search results are a separate display list; the matching bank stack is resolved.
        openScene(0, () => {
            player.getBank(1).add(new core.Item(556, 2), false);
            player.getBank(0).add(new core.Item(995, 5), false);
        });
        core.Bank.search(player, 'coins');
        assert.equal(player.isSearchingBank(), true);
        assert.equal(player.getBank(core.Bank.BANK_SEARCH_TAB_INDEX).getItems()[0].getId(), 995);
        await openBankIncinerator(0, 995);
        key('1'); await resume(1);
        assert.equal(player.getBank(0).getAmount(995), 0, 'the searched stack is destroyed');
        assert.equal(player.getBank(1).getAmount(556), 2);
        assert.equal(bankSaves.length, 4);

        // Closed prompt: the old confirmation cannot destroy anything.
        openScene(0, () => player.getBank(0).add(new core.Item(995, 5), false));
        await openBankIncinerator(0, 995);
        player.getPacketSender().sendInterfaceRemoval();
        await connection.dispatch([{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: 1 }]); connection.processTurnPackets();
        assert.equal(player.getBank(0).getAmount(995), 5, 'a closed prompt cannot destroy');
        assert.equal(bankSaves.length, 4);

        // Replaced 584: a later prompt is not ours, so it is neither confirmed nor closed.
        openScene(0, () => player.getBank(0).add(new core.Item(995, 5), false));
        await openBankIncinerator(0, 995);
        DropItemPacketListener.destroyItemInterface(player, player.getBank(0).getItems()[0]);
        await connection.dispatch([{ type: 'dialogue_continue', widgetId: 584 << 16, childIndex: 1 }]); connection.processTurnPackets();
        assert.equal(player.getBank(0).getAmount(995), 5, 'a replacement prompt cannot destroy the bank stack');
        assert.equal(player.getPacketSender().isChatboxInterface(584), true, 'the replacement UI is left open');
        assert.equal(bankSaves.length, 4);

        // Placeholders have nothing to destroy and never open a prompt.
        openScene(0, () => player.getBank(0).add(new core.Item(995, 0), false));
        await dragOntoIncinerator(0, 995);
        assert.equal(player.getPacketSender().isChatboxInterface(584), false, 'a placeholder is not destroyed');

        // Refresh compacts nonzero tabs: a same-ID neighbour is not the deleted stack.
        const discarded: any[] = [];
        PluginManager.createApi('bank-incinerate-compaction-test').onCustomEvent('item:discarded', event => {
            if (event.player === player) discarded.push(event.item.clone());
        });
        openScene(1, () => {
            player.getBank(1).add(new core.Item(11907, 1, { charges: 5 }), false);
            player.getBank(1).add(new core.Item(11907, 1, { charges: 10 }), false);
        });
        await openBankIncinerator(0, 11907); key('1'); await resume(1);
        assert.deepEqual(player.getBank(1).getValidItems().map((item: any) => item.getMeta()), [{ charges: 10 }]);
        assert.equal(bankSaves.length, 5, 'compaction cannot suppress the successful removal save');
        assert.deepEqual(discarded.map(item => item.getMeta()), [{ charges: 5 }], 'the removed stack reaches its owner');
        const compactedReload = new Player(null);
        bankSaves[4].save.applyToPlayer(compactedReload);
        assert.deepEqual(compactedReload.getBank(1).getValidItems().map((item: any) => item.getMeta()), [{ charges: 10 }]);
    } finally {
        state.socket = previousSocket;
        session.flushPackets(); setPacketSocket(null); player.setRegistered(false);
        process.chdir(previousDirectory);
    }
}
// The cache orb's onOp predicts varp 301 locally, but a click is a native widget operation.
// Forwarding the prediction as well made one click both a varp toggle and a button.
async function nativeSpecialOrbSendsOneServerAuthoritativeInput() {
    const previousDirectory = process.cwd();
    const serverRoot = path.resolve(__dirname, '../../server');
    process.chdir(serverRoot);
    try {
        const serverModules = serverRoot + '/src/main/typescript/elvarg';
        require(serverModules + '/Server').Server.installProductionPathResolver();
        // Reuse the cache initialized above; Gamevals retains that open store.
        const { PluginManager } = require(serverModules + '/plugins/PluginManager');
        const { Player } = require(serverModules + '/game/entity/impl/player/Player');
        const { PlayerSession } = require(serverModules + '/net/PlayerSession');
        const { ClientConnection } = require(serverModules + '/net/NetworkBuilder');
        const { CombatSpecial } = require(serverModules + '/game/content/combat/CombatSpecial');
        const { WeaponInterfaceManager } = require(serverModules + '/game/content/combat/WeaponInterfaceManager');
        const { decodeClientPackets } = require(serverModules + '/net/protocol/ClientProtocol');
        const core = PluginManager.getCoreApi();
        require(serverRoot + '/plugins/items/ItemDefinitionLoader.plugin').register({
            log() {}, onPlayerLogin() {}, registerContentEndpoint() {},
        });
        require(serverRoot + '/plugins/combat/specials/DragonWarhammer.SpecialAttack')({
            core, registerCombatSpecial: CombatSpecial.register,
        });

        const { createCacheVm } = require('../scripts/cache/cs2-sweep');
        const { vm } = createCacheVm();
        const wm = vm.context.widgetManager;
        wm.rootInterface = 161;
        const equipped = new Inventory(14);
        equipped.setSlot(3, core.ItemIdentifiers.DRAGON_WARHAMMER, 1);
        vm.context.inventories = new Map([[94, equipped]]);
        vm.context.varManager.setVarp(300, 1000);
        wm.onLoadListener = (_id: number, widget: any) => vm.runScriptEvent({ args: widget.onLoad, widget });
        const mountOrb = (name: string, root: number) => {
            wm.rootInterface = root;
            const uid = core.CacheDefinitions.getComponentId(name);
            assert.ok(uid, `the active cache names ${name}`);
            wm.getGroup(uid >>> 16);
            const widget = wm.getWidgetByUid(uid);
            const parent = wm.getWidgetByUid(widget.parentUid);
            vm.runScriptEvent({ args: parent.onLoad, widget: parent });
            assert.equal(vm.lastError, null);
            assert.deepEqual(widget.actions, ['Use'], `${name} exposes Use`);
            return widget;
        };
        const orb = mountOrb('orbs:specbutton', 161);

        const source = ts.createSourceFile('OsrsClient.ts', fs.readFileSync(path.resolve(__dirname, '../game/OsrsClient.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
        let varpCallback = '';
        const findVarpCallback = (node: ts.Node) => {
            if (ts.isBinaryExpression(node) && node.left.getText(source) === 'this.varManager.onVarpChange') {
                varpCallback = node.right.getText(source);
            }
            ts.forEachChild(node, findVarpCallback);
        };
        findVarpCallback(source);
        assert.ok(varpCallback, 'the production varp callback is present');

        const { state } = require('../network/serverConnection/state');
        const { sendVarpTransmit } = require('../network/serverConnection/outgoing/movement');
        const { TRANSMIT_VARPS } = require('../common/vars');
        const { setPacketSocket, flushPackets } = require('../network/packet');
        const { WidgetActionRouter } = require('../game/widgets/WidgetActionRouter');
        (globalThis as any).WebSocket ??= { OPEN: 1 };
        const frames: Buffer[] = [];
        const socket: any = { readyState: 1, send: (frame: any) => frames.push(Buffer.from(frame)) };
        state.socket = socket;
        setPacketSocket(socket);
        const client: any = { cs2Vm: vm, varManager: vm.context.varManager, applyAudioVarpChange() {}, setRoofsHidden() {} };
        const body = ts.transpileModule('module.exports = (' + varpCallback + ');', {
            compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
        }).outputText;
        vm.onVarpChange = () => {};
        const installVarpCallback = (transmitted = TRANSMIT_VARPS) => {
            const exported: any = { exports: null };
            new Function(
                'TRANSMIT_VARPS', 'sendVarpTransmit', 'isServerConnected', 'markVarTransmit',
                'VARP_OPTION_RUN', 'VARP_OPTION_ATTACK_PRIORITY_PLAYER', 'VARP_OPTION_ATTACK_PRIORITY_NPC', 'module', body,
            ).call(client, transmitted, sendVarpTransmit, () => true, () => {}, 173, 1107, 1306, exported);
            vm.context.varManager.onVarpChange = exported.exports;
        };
        installVarpCallback();
        const { processWidgetClickInput } = require('../game/widgets/input/widgetClickInput');
        const interaction: any = {
            clickedWidget: null, clickedWidgetParent: null, clickedWidgetHandled: false,
            resolveClickedWidgetParent: () => null, handleTradeRequestChatClick: () => false,
            isWidgetDraggable: () => false,
        };

        const deps: any = new Proxy({
            getWidgetManager: () => wm,
            getCs2Vm: () => vm,
            getVarManager: () => vm.context.varManager,
            getCustomInterfaces: () => ({ handleWidgetClick: () => false, rowIdAt: () => undefined, handleWidgetOp() {} }),
            getWidgetInteraction: () => interaction,
            getTransmitCycles: () => ({ cycleCntr: 1 }),
            getSpellSelection: () => ({ getWidgetTargetMask: () => 0 }),
            handleTradeWidgetAction: () => false,
            buildWidgetActionPayload: (event: any) => router.buildWidgetActionPayload(event),
            resolveTransmitFlagWidget: (widget: any, payload: any) => router.resolveTransmitFlagWidget(widget, payload),
            executeScriptListener: (widget: any, args: any[], context: any) =>
                vm.runScriptEvent({ args, widget, ...context }),
        }, { get: (target: any, key: any) => target[key] ?? (() => undefined) });
        const router = new WidgetActionRouter(deps);
        const click = (widget: any, primary = false) => {
            frames.length = 0;
            interaction.clickedWidget = null;
            interaction.clickedWidgetParent = null;
            interaction.clickedWidgetHandled = false;
            if (primary) {
                processWidgetClickInput(deps, { cachedHoverHits: null }, {
                    input: { leftClickX: 10, leftClickY: 10 },
                    collectFromAllRoots: () => [widget],
                    getWidgetFlags: (target: any) => wm.getWidgetFlags(target),
                }, wm, interaction, (target: any) => ({ option: target.actions[0], target: '', opIndex: 1 }), true);
            } else {
                router.handleWidgetAction({ widget, option: widget.actions[0], opIndex: 1, source: 'menu' });
            }
            assert.equal(vm.lastError, null);
            flushPackets();
            return frames.flatMap(frame => decodeClientPackets(Buffer.from(frame)));
        };

        const channel = {
            kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
            send: () => true, close() {}, onData() {}, onError() {}, onClose() {},
        };
        const session = new PlayerSession(channel);
        const player = new Player(session);
        player.setIndex(321);
        player.setUsername('orbbrowser');
        player.setRegistered(true);
        player.needsPlacement = false;
        player.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(core.ItemIdentifiers.DRAGON_WARHAMMER, 1));
        WeaponInterfaceManager.assign(player);
        const connection = new ClientConnection(channel);
        connection.player = player;

        const layouts: [string, number][] = [
            ['orbs:specbutton', 548], ['orbs:specbutton', 161], ['orbs:specbutton', 164],
            ['orbs_osm:specbutton', 165], ['orbs_nomap:specbutton', 161], ['orbs_osm_nomap:specbutton', 165],
        ];
        for (const [name, root] of layouts) {
            const widget = mountOrb(name, root);
            for (const primary of [false, true]) {
                const label = `${name} root${root} ${primary ? 'primary' : 'menu'}`;
                const first = click(widget, primary);
                assert.deepEqual(first.map((message: any) => message.type), ['widget_action'], `${label} sends only the native operation`);
                assert.equal(first[0].widgetId, widget.uid);
                assert.equal(first[0].buttonNum, 1);
                assert.equal(vm.context.varManager.getVarp(301), 1, `${label} predicts locally`);
                await connection.dispatch(first, true);
                assert.equal(player.isSpecialActivated(), true, `${label} activates once`);
                await connection.dispatch(click(widget, primary), true);
                assert.equal(vm.context.varManager.getVarp(301), 0);
                assert.equal(player.isSpecialActivated(), false, `${label} cancels once`);
            }
        }

        // The previous web bundle forwards 301 AND emits the native button. Recreate its
        // actual callback policy; the prediction must not become a second command.
        mountOrb('orbs:specbutton', 161);
        installVarpCallback(new Set([...TRANSMIT_VARPS, 301]));
        const legacyOn = click(orb);
        assert.deepEqual(legacyOn.map((message: any) => message.type), ['varp_transmit', 'widget_action']);
        await connection.dispatch(legacyOn, true);
        assert.equal(player.isSpecialActivated(), true, 'the previous bundle activates once');
        await connection.dispatch(click(orb), true);
        assert.equal(player.isSpecialActivated(), false, 'the previous bundle cancels once');
        installVarpCallback();

        // A special just swung server-side, while the client's prediction is still on.
        vm.context.varManager.setVarp(301, 1);
        const stale = click(orb, true);
        assert.equal(vm.context.varManager.getVarp(301), 0);
        assert.deepEqual(stale.map((message: any) => message.type), ['widget_action']);
        await connection.dispatch(stale, true);
        assert.equal(player.isSpecialActivated(), true, 'the native click re-arms despite stale prediction');
        await connection.dispatch(click(orb), true);
        assert.equal(player.isSpecialActivated(), false);

        wm.getGroup(593);
        const bar = wm.getWidgetByUid((593 << 16) | 57);
        for (const primary of [false, true]) {
            const barOn = click(bar, primary);
            assert.deepEqual(barOn.map((message: any) => message.type), ['widget_action'],
                'the weapon special bar keeps its single native input');
            await connection.dispatch(barOn, true);
            assert.equal(player.isSpecialActivated(), true);
            await connection.dispatch(click(bar, primary), true);
            assert.equal(player.isSpecialActivated(), false);
        }

        player.setRegistered(false);
        core.TaskManager.cancelTasks(player.getIndex());
        setPacketSocket(null);
        state.socket = null;
    } finally {
        process.chdir(previousDirectory);
    }
}

nativeDestroyConfirmation().then(() => console.log('Native destroy confirmation keyboard and mouse routing passed'))
    .then(() => nativeSpecialOrbSendsOneServerAuthoritativeInput())
    .then(() => console.log('Native special orb and bar send one server-authoritative input'))
    .catch(error => { console.error(error); process.exitCode = 1; });
