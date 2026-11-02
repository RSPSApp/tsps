import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { Inventory } from "../rs/inventory/Inventory";
import { deriveRawMenuEntriesForWidget } from "../widgets/menu/utils";
import { decodeServerPacket } from "../network/packet/ServerBinaryDecoder";
import { encodeWidgetRunScript, encodeWidgetSetText } from "../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol";
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
    game.settings.barricades = 20;
    game.resetMatchState();
    castleStates[SARADOMIN] = castleStates[ZAMORAK] = [100, 0, 0, 0, 0];
    for (const npc of remaining) World.getNpcs().remove(npc);
    World.getRemoveNPCQueue().splice(0);
    checkCastleHud(ZAMORAK, 0);
    checkCastleHud(SARADOMIN, 0);
    game.settings.barricades = 10;
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
