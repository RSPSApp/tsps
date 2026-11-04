// Run after `yarn build`: node --test tests/greegrees.test.cjs
const assert = require("node:assert/strict");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Location } = require("../dist/game/model/Location");
const Greegrees = require("../plugins/items/Greegrees.plugin");

let core;
let area;
const hooks = { canEquip: null, events: {} };

before(async () => {
  await CachePipeline.initialize();
  core = PluginManager.getCoreApi();
  Greegrees.register({
    core,
    registerArea: (registered) => { area = registered; },
    onCanEquip: (handler) => { hooks.canEquip = handler; },
    onCustomEvent: (name, handler) => { hooks.events[name] = handler; },
  });
});

const KARAMJAN = 4031;
const SMALL_NINJA = 4024;
const LARGE_ZOMBIE = 4030;
const MARIM = [2755, 2785, 0];
const ZOO = [2600, 3280, 0];
const LUMBRIDGE = [3222, 3218, 0];

function createPlayer([x, y, z], { weapon = -1, target = null } = {}) {
  let location = new Location(x, y, z);
  let transmog = -1;
  let running = true;
  const worn = Array.from({ length: 14 }, () => new core.Item(-1, 0));
  worn[core.Equipment.WEAPON_SLOT] = new core.Item(weapon, weapon > 0 ? 1 : 0);
  const attributes = new Map();
  const state = { messages: [], sounds: [], graphics: [], spellbookOpened: 0, spellbookClosed: 0, configs: [] };
  const sender = {
    closeSubInterface: () => { state.spellbookClosed++; return sender; },
    sendInterfaceFlagsRange: () => sender,
    sendClientScript: () => sender,
    sendSoundEffect: (id) => { state.sounds.push(id); return sender; },
    sendTabInterface: () => { state.spellbookOpened++; return sender; },
    sendConfig: (id, value) => { state.configs.push([id, value]); return sender; },
  };
  const player = {
    state,
    worn,
    isPlayer: () => true,
    getLocation: () => location,
    moveTo: (next) => { location = next; },
    getEquipment: () => ({ getItems: () => worn }),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getNpcTransformationId: () => transmog,
    setNpcTransformationId: (id) => { transmog = id; return player; },
    getUpdateFlag: () => ({ flag() {} }),
    getPacketSender: () => sender,
    performGraphic: (graphic) => state.graphics.push(graphic.getId()),
    getSpellbook: () => ({ getInterfaceId: () => 218 }),
    sendMessage: (message) => state.messages.push(message),
    getCombat: () => ({ getTarget: () => target, getAttacker: () => null }),
    isRunningReturn: () => running,
    setRunning: (value) => { running = value; return player; },
  };
  return player;
}

function login(player) {
  hooks.events["player:bootstrap-complete"]({ player });
}

function wield(player, itemId) {
  const event = { player, item: new core.Item(itemId, 1), slot: core.Equipment.WEAPON_SLOT, allow: null };
  hooks.canEquip(event);
  if (event.allow === false) return false;
  player.worn[core.Equipment.WEAPON_SLOT] = new core.Item(itemId, 1);
  hooks.events["equipment:changed"]({ player });
  return true;
}

function unwield(player) {
  player.worn[core.Equipment.WEAPON_SLOT] = new core.Item(-1, 0);
  hooks.events["equipment:changed"]({ player });
}

function form(player) {
  const request = { player, form: null };
  hooks.events["greegree:form"](request);
  return request.form;
}

test("every greegree turns the player into its own monkey, an NPC the cache has", () => {
  for (const [itemId, entry] of Greegrees._test.FORMS) {
    assert.ok(core.CacheDefinitions.getItem(itemId)?.name?.endsWith("greegree"), `item ${itemId}`);
    assert.ok(core.CacheDefinitions.getNpc(entry.npc)?.name, `npc ${entry.npc}`);
  }
});

test("wielding on Ape Atoll transforms with the captured graphic and form sound, and closes the spellbook", () => {
  const player = createPlayer(MARIM);
  login(player);
  assert.equal(wield(player, KARAMJAN), true);
  assert.equal(player.getNpcTransformationId(), 1469);
  assert.deepEqual(player.state.graphics, [160]);
  assert.deepEqual(player.state.sounds, [1677]);
  assert.equal(player.state.spellbookClosed, 1);
  assert.deepEqual(player.state.messages, [], "no chat message (rsprox 1440)");
  assert.equal(form(player), "karamjan-monkey");

  unwield(player);
  assert.equal(player.getNpcTransformationId(), -1);
  assert.equal(player.state.spellbookOpened, 1, "the spellbook comes back");
  assert.equal(form(player), null);
});

test("swapping one greegree for another changes form; the Ardougne Zoo works too (Wiki)", () => {
  const player = createPlayer(ZOO);
  login(player);
  wield(player, KARAMJAN);
  wield(player, SMALL_NINJA);
  assert.equal(player.getNpcTransformationId(), 1462);
  assert.equal(form(player), "small-ninja-monkey");
});

test("a greegree can't be wielded off the island or in combat (rsprox 3342)", () => {
  const away = createPlayer(LUMBRIDGE);
  login(away);
  assert.equal(wield(away, KARAMJAN), false);
  assert.equal(away.getNpcTransformationId(), -1);

  const fighting = createPlayer(MARIM, { target: {} });
  login(fighting);
  assert.equal(wield(fighting, KARAMJAN), false);
  assert.deepEqual(fighting.state.messages, ["You cannot use this whilst in combat."]);
});

test("logging in on the island wearing one is a monkey again, without the effects", () => {
  const player = createPlayer(MARIM, { weapon: SMALL_NINJA });
  hooks.events["equipment:changed"]({ player });
  assert.equal(player.getNpcTransformationId(), -1, "equipment changes during login are ignored");
  login(player);
  assert.equal(player.getNpcTransformationId(), 1462);
  assert.deepEqual(player.state.sounds, []);
});

test("monkeys on the island leave a transformed player alone; zombie forms can only walk", () => {
  const player = createPlayer(MARIM);
  login(player);
  assert.equal(area.npcAggression(player, {}), null);
  wield(player, LARGE_ZOMBIE);
  assert.deepEqual(player.state.sounds, [1680], "rsprox 3342");
  assert.equal(area.npcAggression(player, {}), false);
  area.process(player);
  assert.equal(player.isRunningReturn(), false);
  assert.deepEqual(player.state.configs, [[173, 0]]);
});

test("a monkey can't attack", () => {
  const player = createPlayer(MARIM);
  login(player);
  assert.equal(area.canAttack(player, {}), null);
  wield(player, SMALL_NINJA);
  assert.equal(area.canAttack(player, {}), false);
  assert.deepEqual(player.state.messages, ["You can't attack while you're a monkey."]);
  const npc = { isPlayer: () => false };
  assert.equal(area.canAttack(npc, player), null, "monkeys can still be attacked");
});

test("leaving by logging out keeps the greegree on", () => {
  const player = createPlayer(MARIM);
  login(player);
  wield(player, KARAMJAN);
  area.postLeave(player, true);
  assert.equal(player.worn[core.Equipment.WEAPON_SLOT].getId(), KARAMJAN);
});

test("the island, its dungeons and the zoo pen are the places it works", () => {
  const { canTransformAt } = Greegrees._test;
  for (const tile of [MARIM, [2798, 2798, 1], [2808, 9200, 0], ZOO]) {
    assert.equal(canTransformAt(new Location(...tile)), true, tile.join(","));
  }
  for (const tile of [LUMBRIDGE, [2600, 3280, 1], [2900, 3150, 0]]) {
    assert.equal(canTransformAt(new Location(...tile)), false, tile.join(","));
  }
});

test('transformation rings use native inventory inputs, World appearance sync and Unmorph', async t => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');
  const Rings = require('../plugins/items/TransformationRings.plugin');
  const api = PluginManager.createApi('native-transformation-rings');
  Rings.register(api);
  require('../plugins/items/ItemDefinitionLoader.plugin').register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init(); core.RegionManager.loadMapFiles(...LUMBRIDGE);
  const streams = new WeakMap();
  api.onCustomEvent('network:sync-views', event => { streams.get(event.player)?.push(...event.players); });
  let serial = 0;
  function actor(test, x = 3222, y = 3218) {
    const channel = { kind: 'test', binaryTransport: true, isOpen: () => true,
      send: () => true, close() {}, onData() {}, onClose() {}, onError() {} };
    const session = new PlayerSession(channel), p = new Player(session); session.setPlayer(p);
    p.setUsername('native-ring-' + serial++); p.setLocation(new core.Location(x, y));
    p.setNeedsPlacement(false); p.setRunning(false);
    test.mock.method(p, 'onAdd', () => {}); test.mock.method(p, 'onRemove', () => {});
    assert.equal(core.World.getPlayers().add(p), true);
    const connection = new ClientConnection(channel); connection.player = p;
    session.setTurnPacketProcessor(() => connection.processTurnPackets());
    api.emitCustomEvent('player:bootstrap-complete', { player: p, username: p.getUsername() });
    const views = []; streams.set(p, views);
    test.after(() => {
      PluginManager.emitPlayerLogout({ player: p, username: p.getUsername() });
      core.TaskManager.cancelTasks(p); core.TaskManager.cancelTasks(p.getIndex());
      core.World.getPlayers().remove(p); core.World.refreshActiveRegions();
    });
    return { p, session, connection, views };
  }
  function turn() { core.World.refreshActiveRegions(); core.World.process(); }
  async function input(f, packets) { f.connection.inject(packets); await f.connection.idle(); turn(); }
  async function widget(f, uid, op = 1, slot = -1, itemId = -1) {
    const raw = Buffer.alloc(9); raw[0] = ClientPacketId[`IF_BUTTON${op}`];
    raw.writeInt32BE(uid, 1); raw.writeUInt16BE(slot & 65535, 5); raw.writeUInt16BE(itemId & 65535, 7);
    await input(f, decodeClientPackets(raw));
  }
  async function wear(f, id) {
    const slot = f.p.getInventory().getSlotForItemId(id);
    const action = core.CacheDefinitions.getItem(id).inventoryActions.indexOf('Wear');
    assert.ok(action >= 0);
    await widget(f, 149 << 16, [2, 3, 4, 6, 7][action], slot, id);
  }
  async function resume(f, group, child, index) {
    await input(f, [{ type: 'dialogue_continue', widgetId: (group << 16) | child, childIndex: index }]);
  }
  function appearance(observer, p) {
    const view = observer.views.filter(view => view.index === p.getIndex()).at(-1);
    assert.ok(view?.appearance, 'the actual observer session emitted the player appearance');
    const bytes = Buffer.from(view.appearance);
    return bytes.readUInt16BE(3) === 65535 ? bytes.readUInt16BE(5) : -1;
  }
  const cases = [
    ['Ring of coins', 20017, 'coins_transmog'], ['Ring of nature', 20005, 'bush_transmog'],
    ['Ring of stone', 6583, 'tzhaar_morph_rock'], ['Easter ring', 7927, 'easter_egg_rolling_green'],
    ['Crate ring', 26939, 'easter22_reward_crate_npc'],
    ['Snowman ring', 26314, 'xm21_snowman_ring_traditional', 'chat'],
    ['Ring of 3rd Age', 23185, '3rd_age_wand_transmog', 'menu'],
  ];
  for (const [name, id, npcName, picker] of cases) await t.test(name, async test => {
    const f = actor(test), observer = actor(test, 3223); turn(); turn();
    const inventory = f.p.getInventory(); inventory.add(new core.Item(id));
    assert.equal(core.CacheDefinitions.getItem(id).name, name);
    await wear(f, id);
    if (picker === 'menu') {
      assert.equal(f.p.getInterfaceId(), 187, 'all third-age choices use the native list menu');
      await resume(f, 187, 3, 0);
    } else if (picker === 'chat') await resume(f, 219, 1, 1);
    if (id === 26939) { turn(); turn(); }
    const npcId = core.CacheDefinitions.getNpcId(npcName); assert.ok(Number.isInteger(npcId));
    assert.equal(f.p.getNpcTransformationId(), npcId); turn();
    assert.equal(appearance(observer, f.p), npcId);
    assert.equal(f.p.getPacketSender().getChatboxGroupId(), id === 26939 ? 747 : 136, 'the native Unmorph control is mounted');
    await widget(f, (id === 26939 ? 747 : 136) << 16); turn();
    assert.equal(f.p.getNpcTransformationId(), -1); assert.equal(appearance(observer, f.p), -1);
    assert.notEqual(f.p.getPacketSender().getChatboxGroupId(), 136);
    assert.equal(inventory.getAmount(id) + f.p.getEquipment().getAmount(id), 1, 'transformation never consumes or duplicates the ring');
    if (id === 6583) assert.equal(f.p.getEquipment().getAmount(id), 0, 'stone unequips on explicit Unmorph');
  });
  await t.test('every Snowman and third-age choice reaches its own native appearance once', async test => {
    const f = actor(test), observer = actor(test, 3223); turn(); turn();
    for (const [id, ring, group, child, offset] of [
      [26314, 'Snowman ring', 219, 1, 1], [23185, 'Ring of 3rd Age', 187, 3, 0],
    ]) {
      f.p.getInventory().add(new core.Item(id));
      const forms = Object.values(Rings._test.RINGS[ring].choices);
      assert.equal(forms.length, id === 26314 ? 3 : 24);
      for (let index = 0; index < forms.length; index++) {
        await wear(f, id); await resume(f, group, child, index + offset); turn();
        assert.equal(appearance(observer, f.p), core.CacheDefinitions.getNpcId(forms[index]), forms[index]);
        assert.equal(f.p.getDialogueManager().isActive(), false, 'a chosen form closes its picker');
        await resume(f, group, child, index + offset);
        assert.equal(f.p.getPacketSender().getChatboxGroupId(), 136, 'duplicate selection cannot replace Unmorph');
        await widget(f, 136 << 16);
      }
      f.p.getInventory().deleteNumber(id, 1);
    }
  });
  for (const [id, group, child, option] of [[26314, 219, 1, 1], [23185, 187, 3, 0]]) {
    for (const changed of ['cancel', 'removed', 'replaced', 'moved-slot', 'moved-player', 'other-modal', 'trading']) {
      await t.test(`picker ${id} rejects ${changed} source or UI`, async test => {
        const f = actor(test); turn(); turn();
        const inventory = f.p.getInventory(); inventory.add(new core.Item(id));
        await wear(f, id);
        if (changed === 'cancel') await input(f, decodeClientPackets(Buffer.from([ClientPacketId.IF_CLOSE])));
        if (changed === 'removed') inventory.deleteNumber(id, 1);
        if (changed === 'replaced') inventory.setItem(0, new core.Item(id));
        if (changed === 'moved-slot') inventory.swap(0, 1);
        if (changed === 'moved-player') await input(f, [{ type: 'move', worldX: 3224, worldY: 3218, modifierFlags: 0 }]);
        if (changed === 'other-modal') f.p.getPacketSender().sendInterface(core.Equipment.EQUIPMENT_SCREEN_INTERFACE_ID);
        if (changed === 'trading') f.p.setStatus(core.PlayerStatus.TRADING);
        await resume(f, group, child, option);
        assert.equal(f.p.getNpcTransformationId(), -1);
        if (changed === 'other-modal') assert.equal(f.p.getInterfaceId(), core.Equipment.EQUIPMENT_SCREEN_INTERFACE_ID);
        if (changed === 'trading') assert.equal(f.p.getStatus(), core.PlayerStatus.TRADING, 'stale selection cannot reset the new status');
      });
    }
  }
  for (const [name, id, , picker] of cases) await t.test(`${name} ends on native walking`, async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(id));
    await wear(f, id);
    if (picker) await resume(f, picker === 'menu' ? 187 : 219, picker === 'menu' ? 3 : 1, picker === 'menu' ? 0 : 1);
    if (id === 26939) { turn(); turn(); }
    assert.ok(f.p.getNpcTransformationId() >= 0);
    await input(f, [{ type: 'move', worldX: 3224, worldY: 3218, modifierFlags: 0 }]);
    for (let tick = 0; tick < 4; tick++) turn();
    assert.equal(f.p.getNpcTransformationId(), -1);
    assert.notEqual(f.p.getPacketSender().getChatboxGroupId(), 136);
    assert.equal(f.p.getInventory().getAmount(id) + f.p.getEquipment().getAmount(id), 1);
  });
  await t.test('same-id replacement reactivates a worn ring without extra item loss', async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(20017));
    await wear(f, 20017); await widget(f, 136 << 16);
    f.p.getInventory().add(new core.Item(20017)); await wear(f, 20017);
    assert.equal(f.p.getNpcTransformationId(), core.CacheDefinitions.getNpcId('coins_transmog'));
    assert.equal(f.p.getInventory().getAmount(20017) + f.p.getEquipment().getAmount(20017), 2);
  });
  await t.test('other content keeps its newer transformation and dialogue', async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(20017)); await wear(f, 20017);
    f.p.setNpcTransformationId(1469);
    const chain = new core.DialogueChainBuilder().add(new core.StatementDialogue(0, 'Another conversation'));
    f.p.getDialogueManager().startDialogues(chain);
    turn(); await widget(f, 136 << 16);
    assert.equal(f.p.getNpcTransformationId(), 1469);
    assert.equal(f.p.getDialogueManager().getCurrent().getText(), 'Another conversation');
  });
  await t.test('an incoming queued hit and real death entry end an inventory transformation', async test => {
    const f = actor(test), attacker = actor(test, 3223); turn(); turn(); f.p.getInventory().add(new core.Item(7927));
    await wear(f, 7927);
    const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
    const { RangedCombatMethod } = require('../dist/game/content/combat/method/impl/RangedCombatMethod');
    core.CombatFactory.executeHit(new PendingHit(attacker.p, f.p, new RangedCombatMethod(),
      { damage: 1, rollAccuracy: false, experience: false, handleAfterHitEffects: false }));
    turn(); assert.equal(f.p.getNpcTransformationId(), -1);
    await wear(f, 7927); assert.ok(f.p.getNpcTransformationId() >= 0);
    f.p.setHitpoints(0); f.p.appendDeath();
    assert.equal(f.p.isDyingReturn(), true); assert.equal(f.p.getNpcTransformationId(), -1);
  });
  await t.test('native logout clears a form and login does not restore a worn-ring effect', async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(20017)); await wear(f, 20017);
    // Exercise the real logout hooks while excluding only persistence of this fixture account.
    f.p.setAttribute('bot-skip-persistence', true); f.p.onRemove = Player.prototype.onRemove;
    await input(f, [{ type: 'logout' }]); turn(); turn();
    assert.equal(f.p.isRegistered(), false); assert.equal(f.p.getNpcTransformationId(), -1);
    assert.equal(f.p.getEquipment().getAmount(20017), 1);
    const next = actor(test); next.p.getEquipment().setItem(core.Equipment.RING_SLOT, new core.Item(20017));
    api.emitCustomEvent('player:bootstrap-complete', { player: next.p }); turn();
    assert.equal(next.p.getNpcTransformationId(), -1);
  });
  await t.test('transformation and Unmorph never clear an existing freeze', async test => {
    for (const id of [20017, 6583, 7927]) {
      const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(id));
      core.CombatFactory.freezeTicks(f.p, 20, null);
      await wear(f, id);
      assert.ok(f.p.getNpcTransformationId() >= 0);
      await input(f, [{ type: 'move', worldX: 3224, worldY: 3218, modifierFlags: 0 }]);
      assert.ok(f.p.getLocation().equals(new core.Location(...LUMBRIDGE)));
      assert.equal(f.p.getTimers().has(core.TimerKey.FREEZE), true);
      await widget(f, 136 << 16);
      assert.equal(f.p.getTimers().has(core.TimerKey.FREEZE), true);
      assert.equal(f.p.getNpcTransformationId(), -1);
    }
  });
  await t.test('third-age forms work in the Wilderness and still reject a moved picker', async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(23185));
    core.RegionManager.loadMapFiles(3222, 3525);
    f.p.moveTo(new core.Location(3222, 3525)); f.p.setNeedsPlacement(false); f.p.setWildernessLevel(1);
    assert.equal(core.Wilderness.isIn(f.p), true);
    await wear(f, 23185);
    assert.equal(f.p.getInterfaceId(), 187);
    await resume(f, 187, 3, 0);
    assert.equal(f.p.getNpcTransformationId(), core.CacheDefinitions.getNpcId('3rd_age_wand_transmog'),
      'OSRS re-enabled the ring in PvP areas on 25 April 2019');
    await widget(f, 136 << 16);
    await wear(f, 23185);
    f.p.moveTo(new core.Location(3223, 3525)); f.p.setNeedsPlacement(false);
    await resume(f, 187, 3, 0);
    assert.equal(f.p.getNpcTransformationId(), -1, 'moving still invalidates the old picker');
  });
  await t.test('a full inventory never loses the ring when stone unmorphs', async test => {
    const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(6583)); await wear(f, 6583);
    while (f.p.getInventory().getFreeSlots()) f.p.getInventory().add(new core.Item(1511));
    await widget(f, 136 << 16);
    assert.equal(f.p.getNpcTransformationId(), -1);
    assert.equal(f.p.getEquipment().getAmount(6583) + f.p.getInventory().getAmount(6583), 1);
  });
  await t.test('Easter 18103 is a bank placeholder, not a second wearable ring', () => {
    const item = core.CacheDefinitions.getItem(18103);
    assert.equal(item.placeholderTemplate, 14401);
    assert.equal(item.placeholder, 7927);
    assert.equal(item.inventoryActions.includes('Wear'), false);
  });
  await t.test('the crate spawn, four native emotes and Survey use their actual rigs and cache duration', async test => {
    const f = actor(test), observer = actor(test, 3223); turn(); turn();
    f.p.getInventory().add(new core.Item(26939));
    await wear(f, 26939);
    const latest = () => observer.views.filter(view => view.index === f.p.getIndex()).at(-1);
    assert.equal(f.p.getNpcTransformationId(), -1, 'the falling crate is a graphic on the human');
    assert.equal(latest().animation.id, 9406); assert.equal(latest().graphics[0].id, 2070);
    turn(); assert.equal(f.p.getNpcTransformationId(), -1);
    turn(); assert.equal(f.p.getNpcTransformationId(), 11471);
    for (const [child, animation] of [[1, 9409], [2, 9408], [3, 9411]]) {
      await widget(f, (747 << 16) | child);
      assert.equal(latest().animation.id, animation);
      assert.equal(f.p.getNpcTransformationId(), 11471);
    }
    await widget(f, (747 << 16) | 4);
    assert.equal(f.p.getNpcTransformationId(), -1, 'Survey reveals the human below the crate');
    assert.equal(latest().animation.id, 9413); assert.equal(latest().graphics[0].id, 2071);
    for (let tick = 0; tick < 3; tick++) { turn(); assert.equal(f.p.getNpcTransformationId(), -1); }
    turn(); assert.equal(f.p.getNpcTransformationId(), 11471);
    assert.equal(f.p.getPacketSender().getChatboxGroupId(), 747);
    const emote = { player: f.p, allow: true }; api.emitCustomEvent('player:can-emote', emote);
    assert.equal(emote.allow, false, 'generic human emotes cannot run on the crate rig');
    await widget(f, 747 << 16); turn();
    assert.equal(appearance(observer, f.p), -1);
  });
  for (const phase of ['spawn', 'survey']) for (const cancel of ['move', 'unmorph', 'death']) {
    await t.test(`crate ${phase} cannot restore itself after ${cancel}`, async test => {
      const f = actor(test); turn(); turn(); f.p.getInventory().add(new core.Item(26939)); await wear(f, 26939);
      if (phase === 'survey') { turn(); turn(); await widget(f, (747 << 16) | 4); }
      if (cancel === 'move') await input(f, [{ type: 'move', worldX: 3224, worldY: 3218, modifierFlags: 0 }]);
      if (cancel === 'unmorph') await widget(f, 747 << 16);
      if (cancel === 'death') { f.p.setHitpoints(0); f.p.appendDeath(); }
      for (let tick = 0; tick < 6; tick++) turn();
      assert.equal(f.p.getNpcTransformationId(), -1);
      assert.notEqual(f.p.getPacketSender().getChatboxGroupId(), 747);
    });
  }
  await t.test('rings preserve a greegree form and its gameplay state', async test => {
    const f = actor(test, ...MARIM); turn(); turn();
    f.p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(KARAMJAN));
    hooks.events['player:bootstrap-complete']({ player: f.p });
    assert.equal(f.p.getNpcTransformationId(), 1469);
    for (const [name, id, , picker] of cases) {
      f.p.getInventory().add(new core.Item(id));
      await wear(f, id);
      if (picker) await resume(f, picker === 'menu' ? 187 : 219, picker === 'menu' ? 3 : 1, picker === 'menu' ? 0 : 1);
      await widget(f, (id === 26939 ? 747 : 136) << 16);
      for (let tick = 0; tick < 5; tick++) turn();
      hooks.events['equipment:changed']({ player: f.p });
      assert.equal(f.p.getNpcTransformationId(), 1469, name);
      assert.equal(f.p.getAttribute('greegrees:form'), 'karamjan-monkey', name);
    }
  });

});
