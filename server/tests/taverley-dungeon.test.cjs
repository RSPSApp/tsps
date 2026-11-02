// Shared world route for issue1204; no Scorpion Catcher quest state is required.
const assert = require('node:assert/strict');
const { before, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { ObjectActionPacketListener } = require('../dist/net/packet/impl/ObjectActionPacketListener');
const { UseItemPacketListener } = require('../dist/net/packet/impl/UseItemPacketListener');
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
let index = 1204;

before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  core.RegionManager.init();
});

function setup(order = 'doors-first') {
  const arrays = ['objectInteractionHooks', 'objectRouteHooks', 'npcDialogueVariantHooks',
    'npcDialogueConditionHooks', 'npcInteractionHooks', 'npcAnyInteractionHooks', 'npcDeathHooks',
    'itemOnNpcHooks', 'itemOnObjectHooks', 'itemOnItemHooks', 'loginHooks'];
  const saved = Object.fromEntries([...arrays, 'objectHooksByName', 'objectHooksById',
    'customEventHooks', 'nextObjectHookOrder'].map(key => [key, PluginManager[key]]));
  for (const key of arrays) PluginManager[key] = [];
  for (const key of ['objectHooksByName', 'objectHooksById', 'customEventHooks']) PluginManager[key] = new Map();
  PluginManager.nextObjectHookOrder = 0;
  const api = PluginManager.createApi('taverley-real-dispatch');
  delete require.cache[require.resolve('../plugins/objects/Doors.plugin')];
  const doors = require('../plugins/objects/Doors.plugin');
  const dungeon = require('../plugins/areas/TaverleyDungeon.plugin');
  const registerDoors = () => doors.register({ ...api, onServerStartup: handler => handler() });
  if (order === 'doors-first') { registerDoors(); dungeon.register(api); }
  else { dungeon.register(api); registerDoors(); }
  require('../plugins/quests/quests/TouristTrap.Quest')(api);
  require('../plugins/npcs/NpcDialogues.plugin').register(api);
  const player = new Player(null);
  player.setUsername(`offline${++index}`);
  player.setIndex(index);
  player.isRegistered = () => true;
  const messages = [], varbits = new Map();
  let chatbox = -1;
  let sender;
  sender = new Proxy({
    getVarbit: id => varbits.get(id) ?? 0,
    sendVarbit(id, value) { varbits.set(id, value); return sender; },
    sendChatboxInterface(id) { chatbox = id; return sender; },
    isChatboxInterface: id => chatbox === id,
    sendInterfaceRemoval() { chatbox = -1; player.getDialogueManager().reset(); return sender; },
  }, { get: (target, key) => target[key] ?? (() => sender) });
  player.getPacketSender = () => sender;
  player.sendMessage = text => messages.push(text);
  const place = (x, y, z = 0) => { player.setLocation(new core.Location(x, y, z)); player.setNeedsPlacement(false); };
  const tick = (count = 6) => {
    for (let n = 0; n < count; n++) {
      core.World.processCycle = (core.World.processCycle + 1) & 0x7fffffff;
      core.TaskManager.process(); player.getMovementQueue().beginCycle();
      player.getMovementQueue().process(); core.TaskManager.processWalkTo(player.getIndex());
    }
  };
  const open = (id, x, y) => { new ObjectActionPacketListener().executeAction(player, id, x, y, 1, 'Open'); tick(); };
  const use = (id, key, x, y) => {
    const slot = player.getInventory().getItems().findIndex(item => item.getId() === key);
    assert.ok(slot >= 0);
    UseItemPacketListener.itemOnObject(player, 3214, id, key, slot, x, y); tick();
  };
  const walk = (x, y) => { player.getMovementQueue().requestWalk(new core.Location(x, y, 0)); tick(12); };
  const pos = () => [player.getLocation().getX(), player.getLocation().getY()];
  const npcs = [];
  return { api, player, messages, place, tick, open, use, walk, pos,
    npc(id, x, y) {
      const npc = core.NPC.create(id, new core.Location(x, y, 0));
      core.World.getNpcs().add(npc); npc.setRegistered(true); npcs.push(npc); return npc;
    },
    cleanup() {
      for (const npc of npcs) core.World.getNpcs().remove(npc);
      // Restore closed panels after the generic timed task, using its real state.
      for (const task of [...core.TaskManager.activeTasks]) {
        if (typeof task.key === 'string' && /2931,969[04]|2924,9803/.test(task.key)) { task.execute(); task.stop(); }
      }
      core.TaskManager.cancelTasks(player.getIndex());
      Object.assign(PluginManager, saved);
    },
  };
}

function talk(h, npc) {
  h.player.getPacketSender().sendInterfaceRemoval();
  assert.equal(PluginManager.emitNpcInteraction({ player: h.player, npc,
    npcId: npc.getContentId(h.player), definition: npc.getCurrentDefinition(h.player),
    clickType: 1, handled: false }), true);
}
function menu(h) {
  const manager = h.player.getDialogueManager();
  for (let n = 0; n < 30 && manager.isActive(); n++) manager.advance();
  return MultiChatboxPrompt.getPending(h.player)?.options;
}
function choose(h, option) {
  const options = menu(h), index = options?.indexOf(option) ?? -1;
  assert.ok(index >= 0, `missing canonical option ${option}: ${JSON.stringify(options)}`);
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player: h.player,
    buttonId: (219 << 16) | 1, slot: index + 1 }), true);
}
function finish(h) {
  for (let n = 0; n < 30 && h.player.getDialogueManager().isActive(); n++) h.player.getDialogueManager().advance();
}

for (const order of ['doors-first', 'content-first']) {
  test(`real jail key packets open visible doors and normal walking reaches Velrak/deeper dungeon (${order})`, () => {
    const h = setup(order), inventory = h.player.getInventory();
    try {
      core.RegionManager.loadMapFiles(2931, 9690, false);
      const anchor = new core.Location(2931, 9690, 0);
      const closed = core.MapObjects.get(2631, anchor, null);
      assert.deepEqual([closed.getFace(), closed.getType()], [3, 0]);
      h.place(2931, 9691);
      h.open(2631, 2931, 9690);
      assert.ok(core.MapObjects.get(2631, anchor, null), 'without a key the panel stays closed');
      assert.ok(h.messages.includes('The door is locked.'));
      inventory.add(new core.Item(I.JAIL_KEY, 1), false);
      h.use(2631, I.JAIL_KEY, 2931, 9690);
      assert.equal(core.MapObjects.get(2631, anchor, null), null, 'generic opening visibly removes the closed panel');
      const opened = core.MapObjects.get(2631, new core.Location(2931, 9689, 0), null);
      assert.equal(opened?.getFace(), 0, 'the actual panel swings into its open orientation');
      assert.equal(core.RegionManager.canMove(2931, 9690, 2931, 9689, 0, 1, 1, null), true);
      assert.equal(inventory.getAmount(I.JAIL_KEY), 1, 'jail key is reusable');
      h.walk(2930, 9686);
      assert.deepEqual(h.pos(), [2930, 9686], 'ordinary collision walking enters the cell');
      const velrak = h.npc(core.NpcIdentifiers.VELRAK_THE_EXPLORER, 2930, 9685);
      talk(h, velrak);
      choose(h, 'So... do you know anywhere good to explore?');
      choose(h, 'Yes please!'); finish(h);
      assert.equal(inventory.getAmount(I.DUSTY_KEY), 1, 'actual transcript receipt gives the dusty key');
      talk(h, velrak); finish(h);
      assert.equal(inventory.getAmount(I.DUSTY_KEY), 1, 'held-key branch does not hand out another');

      // Normal Open closes this Open-only panel, then the cell can be exited without the key.
      h.walk(2931, 9688);
      h.open(2631, 2931, 9689);
      assert.ok(core.MapObjects.get(2631, anchor, null));
      inventory.deleteNumber(I.JAIL_KEY, 1);
      h.open(2631, 2931, 9690);
      h.walk(2931, 9691);
      assert.deepEqual(h.pos(), [2931, 9691], 'no jail key is required to exit');

      core.RegionManager.loadMapFiles(2924, 9803, false);
      h.place(2925, 9803);
      h.use(2623, I.DUSTY_KEY, 2924, 9803);
      assert.equal(core.MapObjects.get(2623, new core.Location(2924, 9803, 0), null), null);
      assert.equal(core.MapObjects.get(2623, new core.Location(2923, 9803, 0), null)?.getFace(), 1);
      h.walk(2922, 9803);
      assert.deepEqual(h.pos(), [2922, 9803], 'the blue-dragon side is reachable by normal walking');
      assert.equal(inventory.getAmount(I.DUSTY_KEY), 1, 'dusty key is reusable');
    } finally { h.cleanup(); }
  });
}

test('Velrak recovery follows inventory/bank branches, cancellation and full-bag retry', () => {
  const h = setup();
  try {
    h.place(2930, 9686);
    const velrak = h.npc(core.NpcIdentifiers.VELRAK_THE_EXPLORER, 2930, 9685);
    h.player.getBank(0).add(new core.Item(I.DUSTY_KEY, 1), false);
    talk(h, velrak); choose(h, 'So... do you know anywhere good to explore?');
    h.player.getPacketSender().sendInterfaceRemoval();
    assert.equal(h.player.getInventory().getAmount(I.DUSTY_KEY), 0, 'cancelled conversation grants nothing');
    h.player.getInventory().add(new core.Item(I.BRONZE_DAGGER, 28), false);
    talk(h, velrak); choose(h, 'So... do you know anywhere good to explore?'); choose(h, 'Yes please!'); finish(h);
    assert.equal(h.player.getInventory().getAmount(I.DUSTY_KEY), 0, 'full bag creates no false receipt');
    h.player.getInventory().deleteNumber(I.BRONZE_DAGGER, 1);
    talk(h, velrak); choose(h, 'So... do you know anywhere good to explore?'); choose(h, 'Yes please!'); finish(h);
    assert.equal(h.player.getInventory().getAmount(I.DUSTY_KEY), 1, 'a banked copy does not forbid another canonical copy');
    assert.equal(h.player.getBank(0).getAmount(I.DUSTY_KEY), 1);
    h.player.getInventory().deleteNumber(I.DUSTY_KEY, 1);
    talk(h, velrak); choose(h, 'So... do you know anywhere good to explore?'); choose(h, 'Yes please!'); finish(h);
    assert.equal(h.player.getInventory().getAmount(I.DUSTY_KEY), 1, 'lost key can be recovered without a quest flag');
  } finally { h.cleanup(); }
});

test('normal Open supports the other jail cell and requires a carried dusty key at the deep gate', () => {
  const h = setup(), inventory = h.player.getInventory();
  try {
    core.RegionManager.loadMapFiles(2931, 9694, false);
    h.place(2931, 9693);
    inventory.add(new core.Item(I.JAIL_KEY, 1), false);
    h.open(2631, 2931, 9694);
    assert.equal(core.MapObjects.get(2631, new core.Location(2931, 9694, 0), null), null);
    assert.equal(core.MapObjects.get(2631, new core.Location(2931, 9695, 0), null)?.getFace(), 2);
    h.walk(2931, 9696);
    assert.deepEqual(h.pos(), [2931, 9696]);
    inventory.deleteNumber(I.JAIL_KEY, 1);
    h.open(2631, 2931, 9695); // close the open panel
    h.open(2631, 2931, 9694); // leave without the key
    h.walk(2931, 9693);
    assert.deepEqual(h.pos(), [2931, 9693]);

    core.RegionManager.loadMapFiles(2924, 9803, false);
    h.place(2925, 9803);
    h.player.getBank(0).add(new core.Item(I.DUSTY_KEY, 1), false);
    h.open(2623, 2924, 9803);
    assert.ok(core.MapObjects.get(2623, new core.Location(2924, 9803, 0), null), 'a banked key cannot unlock the gate');
    inventory.add(new core.Item(I.JAIL_KEY, 1), false);
    h.use(2623, I.JAIL_KEY, 2924, 9803);
    assert.ok(core.MapObjects.get(2623, new core.Location(2924, 9803, 0), null), 'the wrong carried key cannot unlock the gate');
    inventory.add(new core.Item(I.DUSTY_KEY, 1), false);
    h.open(2623, 2924, 9803);
    h.walk(2922, 9803);
    assert.deepEqual(h.pos(), [2922, 9803]);
    assert.equal(inventory.getAmount(I.DUSTY_KEY), 1);
  } finally { h.cleanup(); }
});

test('opening the Cauldron of Thunder prison door wakes one suit of armour per click, then opens', () => {
  const h = setup();
  const { awakeSuits } = require('../plugins/areas/TaverleyDungeon.plugin').__internals;
  const O = core.ObjectIdentifiers, SUIT = O.SUIT_OF_ARMOUR_2;
  const south = new core.Location(2887, 9829, 0), north = new core.Location(2887, 9832, 0);
  const door = new core.Location(2889, 9830, 0);
  try {
    core.RegionManager.loadMapFiles(2889, 9830, false);
    const standing = core.MapObjects.get(SUIT, south, null);
    assert.deepEqual([standing?.getType(), standing?.getFace()], [10, 1], 'the suit loc is shape 10 rotation 1 (live loc_del)');
    assert.ok(core.MapObjects.get(SUIT, north, null));
    assert.ok(core.MapObjects.get(O.PRISON_DOOR_4, door, null));
    h.place(2888, 9830);

    h.open(O.PRISON_DOOR_4, 2889, 9830);
    assert.equal(core.MapObjects.get(SUIT, south, null), null, 'the nearest suit comes off its stand first');
    assert.ok(core.MapObjects.get(SUIT, north, null));
    const first = awakeSuits.get('2887,9829,0');
    assert.equal(first?.getId(), core.NpcIdentifiers.SUIT_OF_ARMOUR);
    assert.equal(first.isRegistered(), true);
    assert.equal(first.getCombat().getTarget(), h.player, 'the suit attacks whoever woke it');
    assert.deepEqual(h.messages.filter(text => text === 'Suddenly the suit of armour comes to life!').length, 1);
    assert.ok(core.MapObjects.get(O.PRISON_DOOR_4, door, null), 'the door stays shut while a suit wakes');

    h.open(O.PRISON_DOOR_4, 2889, 9830);
    assert.equal(core.MapObjects.get(SUIT, north, null), null, 'the next click wakes the other suit');
    assert.equal(awakeSuits.size, 2);
    assert.equal(h.messages.filter(text => text === 'Suddenly the suit of armour comes to life!').length, 1,
      'live sent the message for the first suit only');

    h.open(O.PRISON_DOOR_4, 2889, 9830);
    assert.equal(core.MapObjects.get(O.PRISON_DOOR_4, door, null), null, 'with no suit left standing the door opens');
    assert.equal(awakeSuits.size, 2, 'no suit is woken twice');

    // A killed (removed) suit goes back on its stand; the other stays awake.
    h.api.removeNpc(first);
    h.tick(1);
    assert.ok(core.MapObjects.get(SUIT, south, null), 'the suit loc returns once its NPC is gone');
    assert.equal(awakeSuits.has('2887,9829,0'), false);
    assert.equal(core.MapObjects.get(SUIT, north, null), null, 'the other suit is still awake');
  } finally {
    for (const npc of [...awakeSuits.values()]) h.api.removeNpc(npc);
    h.tick(1);
    for (const task of [...core.TaskManager.activeTasks]) {
      if (typeof task.key === 'string' && /2889,983[01]/.test(task.key)) { task.execute(); task.stop(); }
    }
    h.cleanup();
  }
});

test('a suit that is left alone stands down and its loc returns', () => {
  const h = setup();
  const { awakeSuits } = require('../plugins/areas/TaverleyDungeon.plugin').__internals;
  const O = core.ObjectIdentifiers, south = new core.Location(2887, 9829, 0);
  try {
    core.RegionManager.loadMapFiles(2889, 9830, false);
    h.place(2888, 9830);
    h.open(O.PRISON_DOOR_4, 2889, 9830);
    const suit = awakeSuits.get('2887,9829,0');
    assert.ok(suit?.isRegistered());
    suit.getCombat().reset();
    h.player.moveTo(new core.Location(2900, 9800, 0));
    h.tick(310);
    assert.equal(suit.isRegistered(), false, 'the idle suit is removed');
    assert.ok(core.MapObjects.get(O.SUIT_OF_ARMOUR_2, south, null), 'and stands on its tile again');
    assert.equal(awakeSuits.size, 0);
  } finally {
    for (const npc of [...awakeSuits.values()]) h.api.removeNpc(npc);
    h.tick(1);
    h.cleanup();
  }
});
