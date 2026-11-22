// Elemental Workshop II against the user's rev 242 capture (docs/quests/elemental-workshop-ii/README.md):
// real Player, real map locs, the machine-floor instance and ticks through World.process.
// From server/: node --test tests/elemental-workshop-ii.test.cjs (after yarn build).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, after, test } = require('node:test');
process.env.DISABLE_PLAYER_BOTS = '1';
require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { PlayerSession } = require('../dist/net/PlayerSession');
const { SkillManager } = require('../dist/game/content/skill/SkillManager');
const { MapObjects } = require('../dist/game/entity/impl/object/MapObjects');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const { OptionDialogue } = require('../dist/game/model/dialogues/entries/impl/OptionDialogue');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const Runtime = require('../plugins/quests/QuestRuntime');

let core, I, next = 9600;
const V = {
  MAIN: 2639, HIDE_KEY: 2640, HATCH: 2641, JIG_POS: 2642, JIG_STATE: 2643, FIRE_STATE: 2644, FIRE_POS: 2645,
  PIPE_1: 2646, PIPE_2: 2647, PIPE_3: 2648, WATER_STATE: 2650, VALVE_1: 2651, VALVE_2: 2652, WATER_DOOR: 2653,
  WATER_LEVEL: 2654, COG_1: 2655, COG_2: 2656, COG_3: 2657, AIR_STATE: 2659, FAN_STATE: 2660, MIND_JIG: 2662,
};

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  for (const [x, y] of [[3366, 3335], [2719, 9890], [1950, 5150]]) core.RegionManager.loadMapFiles(x, y);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const ew = (key) => Runtime.getRegisteredQuests().findLast((q) => q.key === key);
const stage = (p) => ew('elemental_workshop_ii').getStage(p);
const ticks = (n) => { for (let i = 0; i < n; i++) core.World.process(); };
const varbit = (p, id) => p.getPacketSender().getVarbit(id);
const amount = (p, id) => p.getInventory().getAmount(id);
const text = (p) => p.getDialogueManager().getCurrent()?.getText?.();
const close = (p) => p.getPacketSender().sendInterfaceRemoval();

function actor(t, { ew1 = true, items = [] } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const name = `ew2t${next++}`;
  player.setUsername(name);
  player.setLongUsername(core.Misc.stringToLongBigInt(name));
  player.setAttribute('bot-skip-persistence', true);
  assert.equal(core.World.getPlayers().add(player), true);
  t.after(() => {
    core.TaskManager.cancelTasks(player);
    if (player.isRegistered()) core.World.getPlayers().remove(player);
  });
  const messages = [];
  const send = player.sendMessage.bind(player);
  player.sendMessage = (line) => { messages.push(String(line)); return send(line); };
  player.messages = messages;
  for (const skill of [core.Skill.MAGIC, core.Skill.SMITHING, core.Skill.CRAFTING, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.HITPOINTS]) {
    player.getSkillManager().setMaxLevels(skill, 70, false).setExperience(skill, SkillManager.getExperienceForLevel(70)).setCurrentLevels(skill, 70, false);
  }
  if (ew1) ew('elemental_workshop_i').setStage(player, 1 << 20);
  for (const [id, n] of items) player.getInventory().adds(id, n ?? 1);
  return player;
}

function place(p, x, y, z = 0) {
  p.moveTo(new core.Location(x, y, z));
  p.setNeedsPlacement(false);
}

/** Stands the player on a source tile of their machine-floor instance. */
function placeAt(p, x, y, z) {
  p.moveTo(at(p, x, y, z));
  p.setNeedsPlacement(false);
}

/** The instance offset: where the player stands minus where the source tile is. */
let offset = null;
function at(p, x, y, z) {
  return new core.Location(x + offset.dx, y + offset.dy, z);
}

function objectAt(p, id, loc) {
  const obj = MapObjects.getObjectsAt(loc, p.getPrivateArea()).find((o) => o.getId() === id)
    ?? MapObjects.getObjectsAt(loc, p.getArea?.() ?? null).find((o) => o.getId() === id);
  assert.ok(obj, `loc ${id} at ${loc}`);
  return obj;
}

function idsAt(p, loc) {
  return [...MapObjects.getObjectsAt(loc, p.getPrivateArea()), ...MapObjects.getObjectsAt(loc, p.getArea?.() ?? null)].map((o) => o.getId());
}

function op(p, id, loc, option) {
  const obj = objectAt(p, id, loc);
  const def = ObjectDefinition.forPlayer(obj.getId(), p) ?? ObjectDefinition.forId(obj.getId());
  let index = def.getInteractions().findIndex((o) => String(o).toLowerCase() === option.toLowerCase());
  if (index < 0) index = 0;
  return PM.emitObjectInteraction({ player: p, object: obj, objectId: obj.getId(), definition: def, location: { x: loc.getX(), y: loc.getY(), z: loc.getZ() }, clickType: index + 1, handled: false });
}

function use(p, itemId, objectId, loc) {
  const obj = objectAt(p, objectId, loc);
  const slot = p.getInventory().getItems().findIndex((it) => it && it.getId() === itemId);
  assert.ok(slot >= 0, `carries ${itemId}`);
  return PM.emitItemOnObject({ player: p, object: obj, objectId: obj.getId(), item: p.getInventory().getItems()[slot], itemId, itemSlot: slot,
    interfaceType: Inventory.INTERFACE_ID, location: { x: loc.getX(), y: loc.getY(), z: loc.getZ() }, handled: false });
}

function read(p, itemId) {
  const slot = p.getInventory().getItems().findIndex((it) => it && it.getId() === itemId);
  return PM.emitItemAction({ player: p, item: p.getInventory().getItems()[slot], slot, itemId, interfaceId: Inventory.INTERFACE_ID, clickType: 1, option: 'Read', handled: false });
}

function choose(p, option) {
  assert.ok(p.getDialogueManager().getCurrent() instanceof OptionDialogue, 'a menu is open');
  p.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, option);
}

function cart(p) {
  return [...core.World.getNpcs()].find((n) => n && n.getId() === 6285 && n.getOwner?.() === p) ?? null;
}

function enterFloor(p) {
  place(p, 2719, 9892);
  assert.equal(op(p, 3413, new core.Location(2719, 9890, 0), 'Climb-down'), true);
  const here = p.getLocation();
  offset = { dx: here.getX() - 1955, dy: here.getY() - 5155 };
  assert.equal(here.getZ(), 2);
  assert.notEqual(here.getX(), 1955, 'an instance copy, not the real floor');
}

test('the bookcase starts it with the beaten book; reading gives the note, then the book', (t) => {
  const p = actor(t, { ew1: false });
  place(p, 3366, 3336);
  op(p, 17382, new core.Location(3366, 3335, 0), 'Search');
  assert.ok(p.messages.includes('You must have completed Elemental Workshop I before you can start this quest.'));

  const q = actor(t);
  place(q, 3366, 3336);
  op(q, 17382, new core.Location(3366, 3335, 0), 'Search');
  assert.equal(q.getDialogueManager().getCurrent().getTitle(), 'Start the Elemental Workshop II quest?');
  choose(q, 1);
  assert.equal(stage(q), 1);
  assert.equal(varbit(q, V.MAIN), 1);
  assert.equal(amount(q, I.BEATEN_BOOK), 1);
  assert.equal(amount(q, I.SCROLL_3), 0, 'the note is in the book, not on the shelf (capture tick 67)');
  assert.equal(text(q), 'You find an old-looking book.');
  close(q);

  read(q, I.BEATEN_BOOK);
  assert.equal(stage(q), 2);
  assert.ok(q.messages.includes('The book has two parts: an introduction and an instruction section.'));
  assert.equal(amount(q, I.SCROLL_3), 1);
  assert.match(text(q), /^You find a slip of paper/);
  q.getDialogueManager().advance();
  assert.ok(q.messages.includes('You flip the book open to the introduction and start reading.'));
  assert.equal(q.getInterfaceId(), 392);
  close(q);

  read(q, I.SCROLL_3);
  assert.equal(stage(q), 3);
  assert.equal(varbit(q, V.HIDE_KEY), 1);
  assert.equal(q.getInterfaceId(), 222);
});

test('the key in the third pipe, the locked hatch, the key in the hatch', (t) => {
  const p = actor(t);
  ew('elemental_workshop_ii').setStage(p, 3);
  p.setAttribute('quest.elemental_workshop_ii.scheme', 2);
  p.setAttribute('quest.elemental_workshop_ii.varp896', 1 << 5); // hide_key: the note read
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  place(p, 2715, 9901);
  op(p, 18593, new core.Location(2715, 9902, 0), 'Search');
  assert.equal(stage(p), 4);
  assert.equal(amount(p, I.KEY_11), 1);
  assert.equal(text(p), 'You find a key hidden in the third pipe.');
  close(p);
  op(p, 18593, new core.Location(2715, 9902, 0), 'Search');
  assert.ok(p.messages.includes('You find nothing.'));

  place(p, 2719, 9892);
  p.getInventory().deleteNumber(I.KEY_11, 1);
  op(p, 3413, new core.Location(2719, 9890, 0), 'Open');
  assert.equal(text(p), "You're unable to open the locked hatch.");
  close(p);
  p.getInventory().adds(I.COINS, 1);
  use(p, I.COINS, 3413, new core.Location(2719, 9890, 0));
  assert.equal(text(p), "You try to stuff the object into the keyhole. It doesn't fit.");
  close(p);
  p.getInventory().adds(I.KEY_11, 1);
  op(p, 3413, new core.Location(2719, 9890, 0), 'Open');
  assert.equal(varbit(p, V.HATCH), 1);
  assert.equal(stage(p), 5);
  assert.equal(amount(p, I.KEY_11), 0, 'the key stays in the lock (tick 207)');
  assert.equal(text(p), 'The key fits the lock in the hatch perfectly.');
});

test('down the hatch: an instance with the saved crane, the tank door and the player\'s cart', (t) => {
  const p = actor(t);
  ew('elemental_workshop_ii').setStage(p, 5);
  p.setAttribute('quest.elemental_workshop_ii.scheme', 2);
  p.setAttribute('quest.elemental_workshop_ii.varp896', 1 << 6); // the hatch unlocked
  enterFloor(p);
  assert.equal(stage(p), 6);
  ticks(1);
  assert.ok(p.messages.includes('You climb down the stairs.'));
  assert.ok(idsAt(p, at(p, 1952, 5143, 2)).includes(18635), 'elem2_crane_track_up_broken (tick 213)');
  assert.ok(idsAt(p, at(p, 1953, 5162, 2)).includes(18651), 'elemental_waterdoor_closed_retracted_none');
  const c = cart(p);
  assert.ok(c, 'the cart');
  assert.ok(c.getLocation().equals(at(p, 1954, 5147, 2)));

  op(p, 18598, at(p, 1953, 5154, 2), 'Climb-up');
  assert.ok(p.getLocation().equals(new core.Location(2720, 9892, 0)));
  assert.ok(p.messages.includes('You climb up the stairs.'));
  assert.equal(cart(p), null, 'the cart goes with the instance');
});

/** The machine floor with the hatch open, entered. */
function onFloor(t, items = []) {
  const p = actor(t, { items });
  ew('elemental_workshop_ii').setStage(p, 6);
  p.setAttribute('quest.elemental_workshop_ii.scheme', 2);
  p.setAttribute('quest.elemental_workshop_ii.varp896', 1 << 6);
  enterFloor(p);
  ticks(1);
  return p;
}

function pull(p, id, x, y, wait = 6) {
  placeAt(p, x + 1, y, 2);
  op(p, id, at(p, x, y, 2), 'Pull');
  ticks(wait);
}

test('the crane: lowered, the claw replaced, a cold bar lifted, heated in the lava and set back hot', (t) => {
  const p = onFloor(t, [[I.CRANE_CLAW], [I.ELEMENTAL_METAL]]);
  placeAt(p, 1953, 5149, 2);
  op(p, 18622, at(p, 1953, 5148, 2), 'Pull');
  assert.equal(p.getAnimation()?.getId(), 4909);
  assert.equal(varbit(p, V.FIRE_POS), 0, 'a tick after the pull');
  ticks(1);
  assert.equal(varbit(p, V.FIRE_POS), 1);
  ticks(3);
  assert.ok(idsAt(p, at(p, 1952, 5143, 2)).includes(18636), 'elem2_crane_track_down_broken (tick 502)');
  use(p, I.CRANE_CLAW, 18636, at(p, 1952, 5143, 2));
  assert.equal(varbit(p, V.FIRE_STATE), 1);
  assert.equal(amount(p, I.CRANE_CLAW), 0);
  assert.equal(text(p), 'You replace the broken claw.');
  assert.ok(idsAt(p, at(p, 1952, 5143, 2)).includes(18624));
  close(p);

  const bar = p.getInventory().getItems().find((it) => it && it.getId() === I.ELEMENTAL_METAL);
  PM.emitItemOnNpc({ player: p, target: cart(p), npc: cart(p), npcId: 6285, item: bar, itemId: I.ELEMENTAL_METAL, handled: false });
  assert.equal(varbit(p, V.JIG_STATE), 1);
  pull(p, 18622, 1953, 5148);
  assert.equal(varbit(p, V.FIRE_STATE), 2, 'the claw took the cold bar');
  assert.equal(varbit(p, V.JIG_STATE), 0);
  pull(p, 18621, 1955, 5148);
  assert.equal(varbit(p, V.FIRE_POS), 2, 'over the lava');
  pull(p, 18622, 1953, 5148);
  assert.equal(varbit(p, V.FIRE_POS), 3);
  assert.equal(varbit(p, V.FIRE_STATE), 3, 'hot (tick 761)');
  placeAt(p, 1955, 5149, 2);
  op(p, 18621, at(p, 1955, 5148, 2), 'Pull');
  assert.equal(text(p), 'The arm cannot be rotated while the claw is down.');
  close(p);
  pull(p, 18622, 1953, 5148);
  pull(p, 18621, 1955, 5148);
  pull(p, 18622, 1953, 5148);
  pull(p, 18622, 1953, 5148);
  assert.equal(varbit(p, V.JIG_STATE), 2, 'the hot bar is back on the cart');
  assert.equal(varbit(p, V.FIRE_STATE), 1);
});

test('the junction box: three pipes, the line, and the press only with the right ones', (t) => {
  const p = onFloor(t);
  placeAt(p, 1943, 5152, 3);
  op(p, 18641, at(p, 1943, 5153, 3), 'Open');
  assert.equal(p.getInterfaceId(), 262);
  assert.equal(p.getPacketSender().getVarp(262), 3);
  const click = (child) => PM.emitInterfaceActionClick({ player: p, buttonId: (262 << 16) | child, action: 1, handled: false });
  click(41); click(40); // a - 3
  assert.equal(varbit(p, V.PIPE_1), 5);
  assert.equal(p.getPacketSender().getVarp(262), 2);
  click(39); click(38); // 2 - 1
  assert.equal(varbit(p, V.PIPE_2), 13);
  click(42); click(37); // b - c
  assert.equal(varbit(p, V.PIPE_3), 6);
  assert.equal(text(p), 'I hope I got that right.');
  close(p);

  const wrong = onFloor(t);
  placeAt(wrong, 1943, 5152, 3);
  op(wrong, 18641, at(wrong, 1943, 5153, 3), 'Open');
  const w = (child) => PM.emitInterfaceActionClick({ player: wrong, buttonId: (262 << 16) | child, action: 1, handled: false });
  w(41); w(42); w(37); w(38); w(39); w(40); // a-b, c-1, 2-3
  close(wrong);
  pull(wrong, 18640, 1950, 5153, 2);
  assert.equal(text(wrong), 'You pull the lever but nothing happens. Maybe the pipes are connected the wrong way round.');
});

test('the cart rides to the press a tile a tick, and the press flattens the hot bar', (t) => {
  const p = onFloor(t);
  const bits = (5 << 16) | (13 << 20) | (6 << 24) | (2 << 9) | (1 << 12) | (1 << 6);
  p.setAttribute('quest.elemental_workshop_ii.varp896', bits >>> 0);
  // Live moves the cart with a plain teleport each tick (jump flag clear, ticks 801-815), which
  // clients walk it over; a telejump or moveTo makes it vanish for the tick (#6502).
  const steps = [];
  const c = cart(p);
  const teleportInView = c.teleportInView.bind(c);
  c.teleportInView = (to) => { const r = teleportInView(to); steps.push(c.isTeleportingWithoutJump() ? String(to) : 'jump'); return r; };
  pull(p, 18620, 1953, 5151, 1);
  ticks(1);
  assert.equal(varbit(p, V.JIG_POS), 1, 'jig_pos a tick after the pull (tick 801)');
  ticks(14);
  assert.ok(cart(p).getLocation().equals(at(p, 1946, 5155, 2)), 'at the press after 15 steps');
  assert.equal(steps.length, 15, 'every step a teleport in view');
  assert.ok(!steps.includes('jump'), 'sent with the jump flag clear');
  assert.equal(steps.at(-1), String(at(p, 1946, 5155, 2)));
  pull(p, 18640, 1950, 5153, 2);
  assert.equal(varbit(p, V.JIG_STATE), 3);
  assert.equal(text(p), 'You pull the lever and the press responds. The hardy comes down, hitting the elemental bar. The bar has been flattened.');
  close(p);
  ticks(2); // the hammer is up again (tick 1095)
  pull(p, 18640, 1950, 5153, 2);
  assert.match(text(p), /but the bar has already been flattened\.$/);
});

test('the tank: the rack takes the bar in, the water cools it, the rack puts it back', (t) => {
  const p = onFloor(t);
  const bits896 = (2 << 7) | (3 << 9) | (1 << 12) | (1 << 28) | (1 << 6);
  p.setAttribute('quest.elemental_workshop_ii.varp896', bits896 >>> 0);
  placeAt(p, 1953, 5160, 2);
  op(p, 18649, at(p, 1955, 5161, 2), 'Turn');
  assert.equal(text(p), 'You cannot extend the rack while the door is closed.');
  close(p);
  op(p, 18648, at(p, 1953, 5161, 2), 'Pull');
  ticks(3);
  assert.equal(varbit(p, V.WATER_DOOR), 1);
  op(p, 18649, at(p, 1955, 5161, 2), 'Turn');
  ticks(2);
  assert.equal(varbit(p, V.WATER_DOOR), 2);
  op(p, 18649, at(p, 1955, 5161, 2), 'Turn');
  assert.equal(varbit(p, V.JIG_STATE), 6, 'the bar is on the rack');
  ticks(3);
  assert.equal(varbit(p, V.WATER_DOOR), 4);
  op(p, 18648, at(p, 1953, 5161, 2), 'Pull');
  ticks(3);
  assert.equal(varbit(p, V.WATER_DOOR), 3);
  placeAt(p, 1949, 5160, 2);
  op(p, 18646, at(p, 1949, 5161, 2), 'Turn');
  assert.equal(varbit(p, V.VALVE_1), 1);
  ticks(4);
  assert.equal(varbit(p, V.WATER_DOOR), 6, 'cooled (tick 885)');
  assert.equal(text(p), 'You open the valve.');
  close(p);
  op(p, 18648, at(p, 1953, 5161, 2), 'Pull');
  assert.equal(text(p), 'You pull the lever but nothing happens. Maybe the tank needs to be empty first.');
  close(p);
  op(p, 18646, at(p, 1949, 5161, 2), 'Turn');
  assert.equal(text(p), 'You close the valve.');
  close(p);
  op(p, 18648, at(p, 1953, 5161, 2), 'Pull');
  ticks(3);
  op(p, 18649, at(p, 1955, 5161, 2), 'Turn');
  ticks(2);
  op(p, 18649, at(p, 1955, 5161, 2), 'Turn');
  assert.equal(varbit(p, V.JIG_STATE), 4, 'the cool flat bar back on the cart (tick 928)');
});

test('the wind tunnel: the cogs, the fan dries the bar, and the dry bar comes off as the primed bar', (t) => {
  const p = onFloor(t, [[I.SMALL_COG], [I.MEDIUM_COG], [I.LARGE_COG]]);
  p.setAttribute('quest.elemental_workshop_ii.varp896', ((3 << 7) | (4 << 9) | (1 << 12) | (1 << 6)) >>> 0);
  placeAt(p, 1958, 5157, 2);
  use(p, I.SMALL_COG, 18722, at(p, 1959, 5157, 2));
  assert.equal(varbit(p, V.COG_1), 1);
  assert.equal(text(p), 'You put the small cog onto the shaft.');
  close(p);
  use(p, I.MEDIUM_COG, 3429, at(p, 1959, 5157, 2));
  close(p);
  use(p, I.LARGE_COG, 18721, at(p, 1959, 5156, 2));
  close(p);
  assert.equal(varbit(p, V.COG_2), 2);
  assert.equal(varbit(p, V.COG_3), 3);
  placeAt(p, 1958, 5154, 2);
  op(p, 18663, at(p, 1959, 5154, 2), 'Pull');
  ticks(1);
  assert.equal(varbit(p, V.FAN_STATE), 1);
  assert.equal(varbit(p, V.JIG_STATE), 5, 'dried (tick 966)');
  assert.equal(text(p), 'The fan starts to blow.');
  p.getDialogueManager().advance();
  assert.equal(text(p), 'The machine starts rumbling.');
  close(p);
  op(p, 18663, at(p, 1959, 5154, 2), 'Pull');
  ticks(1);
  assert.equal(varbit(p, V.AIR_STATE), 0);
  assert.equal(text(p), 'The machine grinds to a standstill.');
  close(p);
  pull(p, 18620, 1953, 5151, 1);
  ticks(15);
  assert.equal(varbit(p, V.JIG_POS), 0);
  PM.emitNpcInteraction({ player: p, npc: cart(p), npcId: 5226, clickType: 1, handled: false });
  assert.equal(amount(p, I.PRIMED_BAR), 1);
  assert.equal(stage(p), 7);
  assert.equal(text(p), 'You take the primed bar.');
});

test('the extractor charges the primed bar and drains 20 Magic; the mind helmet completes the quest', (t) => {
  const p = onFloor(t, [[I.PRIMED_BAR], [I.HAMMER], [I.BEATEN_BOOK], [I.SCROLL_3]]);
  ew('elemental_workshop_ii').setStage(p, 7);
  placeAt(p, 1950, 5158, 2);
  op(p, 18597, at(p, 1948, 5158, 2), 'Climb-down');
  assert.ok(p.getLocation().equals(at(p, 1947, 5159, 0)));
  placeAt(p, 1953, 5150, 0);
  op(p, 18698, at(p, 1952, 5150, 0), 'Open');
  assert.equal(stage(p), 8);
  assert.ok(idsAt(p, at(p, 1951, 5150, 0)).includes(18699));
  placeAt(p, 1961, 5148, 0);
  use(p, I.PRIMED_BAR, 18725, at(p, 1962, 5148, 0));
  assert.equal(varbit(p, V.MIND_JIG), 1);
  assert.equal(stage(p), 9);
  close(p);
  placeAt(p, 1961, 5150, 0);
  const magic = p.getSkillManager().getCurrentLevel(core.Skill.MAGIC);
  const hat = at(p, 1962, 5150, 0);
  const sent = [];
  const ps = p.getPacketSender();
  const sendObject = ps.sendObject.bind(ps);
  const sendObjectRemoval = ps.sendObjectRemoval.bind(ps);
  ps.sendObject = (o) => { if (o.getLocation().equals(hat)) sent.push(`add ${o.getId()}`); return sendObject(o); };
  ps.sendObjectRemoval = (o) => { if (o.getLocation().equals(hat)) sent.push(`del ${o.getId()}`); return sendObjectRemoval(o); };
  op(p, 18690, hat, 'Operate');
  ticks(2);
  assert.deepEqual(sent, ['del 18690'], 'the hat goes as the player sits (tick 1372)');
  assert.ok(!idsAt(p, hat).includes(18690), 'and is gone from the scene');
  ticks(6);
  assert.deepEqual(sent, ['del 18690', 'add 18690'], 'the hat is put back (loc_add_change, tick 1378; #6502)');
  assert.ok(idsAt(p, hat).includes(18690));
  assert.equal(varbit(p, V.MIND_JIG), 2);
  assert.equal(stage(p), 10);
  assert.equal(p.getSkillManager().getCurrentLevel(core.Skill.MAGIC), magic - 20);
  ticks(4);
  assert.ok(p.messages.includes('You feel magically weakened.'));
  assert.ok(p.getLocation().equals(at(p, 1961, 5150, 0)), 'back off the chair');
  op(p, 18725, at(p, 1962, 5148, 0), 'Take-from');
  assert.equal(amount(p, I.PRIMED_MIND_BAR), 1);
  close(p);

  op(p, 18599, at(p, 1948, 5159, 0), 'Climb-up');
  ticks(1);
  op(p, 18598, at(p, 1953, 5154, 2), 'Climb-up');
  place(p, 2718, 9887, 0);
  const smith = p.getSkillManager().getExperience(core.Skill.SMITHING);
  op(p, 3402, new core.Location(2717, 9887, 0), 'Smith');
  ticks(3);
  assert.equal(amount(p, I.MIND_HELMET), 0, 'not yet');
  ticks(1);
  assert.equal(amount(p, I.MIND_HELMET), 1, 'Wiki: four ticks');
  assert.equal(ew('elemental_workshop_ii').isComplete(p), true);
  assert.equal(varbit(p, V.MAIN), 11);
  assert.equal(amount(p, I.SCROLL_3), 0, 'the note goes at the completion (tick 1454)');
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - smith, 7530);
});

test('the workbench menu: shield or claw with the crane schematic, mind shield or helmet after the quest', (t) => {
  const p = onFloor(t, [[I.ELEMENTAL_METAL], [I.SLASHED_BOOK], [I.CRANE_SCHEMATIC], [I.HAMMER]]);
  op(p, 18598, at(p, 1953, 5154, 2), 'Climb-up');
  place(p, 2718, 9887, 0);
  use(p, I.ELEMENTAL_METAL, 3402, new core.Location(2717, 9887, 0));
  const menu = p.getCreationMenu();
  assert.ok(menu, 'skillmulti');
  assert.deepEqual(menu.getItems(), [I.ELEMENTAL_SHIELD, I.CRANE_CLAW]);
  menu.execute(I.CRANE_CLAW, 1);
  ticks(4);
  assert.equal(amount(p, I.CRANE_CLAW), 1);
  assert.ok(p.messages.includes('Following the instructions from the schematic you make an elemental claw.'));

  const done = actor(t, { items: [[I.PRIMED_MIND_BAR], [I.SLASHED_BOOK], [I.BEATEN_BOOK], [I.HAMMER]] });
  ew('elemental_workshop_ii').setStage(done, 11);
  place(done, 2718, 9887, 0);
  use(done, I.PRIMED_MIND_BAR, 3402, new core.Location(2717, 9887, 0));
  assert.deepEqual(done.getCreationMenu().getItems(), [I.MIND_SHIELD, I.MIND_HELMET]);
  done.getCreationMenu().execute(I.MIND_SHIELD, 1);
  ticks(4);
  assert.equal(amount(done, I.MIND_SHIELD), 1);

  // Wiki (Mind shield): only after the quest; mid-quest the slashed book alone gives no recipe.
  const early = actor(t, { items: [[I.PRIMED_MIND_BAR], [I.SLASHED_BOOK], [I.HAMMER]] });
  ew('elemental_workshop_ii').setStage(early, 10);
  place(early, 2718, 9887, 0);
  use(early, I.PRIMED_MIND_BAR, 3402, new core.Location(2717, 9887, 0));
  ticks(4);
  assert.equal(amount(early, I.MIND_SHIELD), 0);
  assert.equal(amount(early, I.PRIMED_MIND_BAR), 1, 'the quest\'s bar is kept');
  assert.equal(text(early), 'This workbench is too complicated. You need instructions to follow.');
});

test('an old save converts once to live\'s stages and the varbit save', (t) => {
  const p = actor(t);
  ew('elemental_workshop_ii').setStage(p, 10); // the old primed-bar stage
  p.setAttribute('quest.elemental_workshop_ii.scheme', 0);
  p.setAttribute('quest.elemental_workshop_ii.flags', 2 | 4);
  p.setAttribute('quest.elemental_workshop_ii.jig', 1 | (5 << 2) | (1 << 7));
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(stage(p), 7);
  assert.equal(varbit(p, V.HATCH), 1);
  assert.equal(varbit(p, V.WATER_STATE), 1);
  assert.equal(varbit(p, V.JIG_POS), 1);
  assert.equal(varbit(p, V.JIG_STATE), 5);
  assert.equal(varbit(p, V.FIRE_STATE), 1);
  ew('elemental_workshop_ii').setStage(p, 3);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  assert.equal(stage(p), 3, 'converted once only');
});

test('a bench job stops when the player walks away, loses the hammer or the book, and never works a preset bar', (t) => {
  const bench = new core.Location(2717, 9887, 0);
  const start = (items) => {
    const p = actor(t, { items });
    ew('elemental_workshop_ii').setStage(p, 11);
    place(p, 2718, 9887, 0);
    return p;
  };
  const walker = start([[I.ELEMENTAL_METAL], [I.BEATEN_BOOK], [I.HAMMER]]);
  use(walker, I.ELEMENTAL_METAL, 3402, bench);
  ticks(1);
  place(walker, 2719, 9888, 0);
  ticks(4);
  assert.equal(amount(walker, I.ELEMENTAL_METAL), 1, 'walked away: the bar is kept');
  assert.equal(amount(walker, I.ELEMENTAL_HELMET), 0);

  for (const lost of [I.HAMMER, I.BEATEN_BOOK]) {
    const p = start([[I.ELEMENTAL_METAL], [I.BEATEN_BOOK], [I.HAMMER]]);
    use(p, I.ELEMENTAL_METAL, 3402, bench);
    ticks(1);
    p.getInventory().deleteNumber(lost, 1);
    ticks(4);
    assert.equal(amount(p, I.ELEMENTAL_METAL), 1, `lost ${lost}: the bar is kept`);
  }

  const preset = start([[I.BEATEN_BOOK], [I.HAMMER]]);
  preset.getInventory().add(new core.Item(I.ELEMENTAL_METAL, 1, { preset: true }));
  use(preset, I.ELEMENTAL_METAL, 3402, bench);
  ticks(5);
  assert.equal(amount(preset, I.ELEMENTAL_HELMET), 0, 'a preset bar is never worked');

  // Capture 1446-1454: the product goes to the first free slot, not necessarily the bar's.
  const gap = start([[I.COINS, 1], [I.ELEMENTAL_METAL], [I.BEATEN_BOOK], [I.HAMMER]]);
  gap.getInventory().deleteAtSlot(0, 1);
  use(gap, I.ELEMENTAL_METAL, 3402, bench);
  ticks(4);
  assert.equal(gap.getInventory().getItems()[0].getId(), I.ELEMENTAL_HELMET, 'into the free slot before the bar');
  assert.equal(gap.getInventory().getItems()[1].getId(), -1, 'the bar\'s slot empties');

  const ok = start([[I.ELEMENTAL_METAL], [I.BEATEN_BOOK], [I.HAMMER]]);
  const slot = ok.getInventory().getItems().findIndex((it) => it && it.getId() === I.ELEMENTAL_METAL);
  use(ok, I.ELEMENTAL_METAL, 3402, bench);
  ticks(4);
  assert.equal(ok.getInventory().getItems()[slot].getId(), I.ELEMENTAL_HELMET, 'the helmet goes to the first free slot, here the bar\'s (Wiki: 4 ticks)');
});

test('the press strikes only a jig that is under it by then; replacement cogs come back after the quest', (t) => {
  const early = onFloor(t);
  const bits = (5 << 16) | (13 << 20) | (6 << 24) | (2 << 9) | (1 << 12) | (1 << 6);
  early.setAttribute('quest.elemental_workshop_ii.varp896', bits >>> 0);
  pull(early, 18620, 1953, 5151, 1);
  ticks(3); // the cart is on its way, far from the press
  pull(early, 18640, 1950, 5153, 2);
  assert.equal(varbit(early, V.JIG_STATE), 0, 'not flattened in transit');
  assert.equal(text(early), 'You pull the lever but nothing happens. Maybe the jig needs to be under the press first.');
  close(early);

  const late = onFloor(t);
  late.setAttribute('quest.elemental_workshop_ii.varp896', bits >>> 0);
  pull(late, 18620, 1953, 5151, 1);
  ticks(12); // two steps out, as live pulled it (ticks 1091-1093)
  placeAt(late, 1951, 5153, 2);
  op(late, 18640, at(late, 1950, 5153, 2), 'Pull');
  ticks(2);
  assert.equal(varbit(late, V.JIG_STATE), 3, 'flattened as the cart arrives');

  // After the quest: a cog taken back off its pin and lost comes back from its crate (the small cog in box 1 here).
  const done = onFloor(t);
  ew('elemental_workshop_ii').setStage(done, 11);
  done.setAttribute('quest.elemental_workshop_ii.crates', 0 | (1 << 3) | (2 << 6) | (3 << 9) | (1 << 12));
  placeAt(done, 1951, 5149, 2);
  op(done, 18612, at(done, 1951, 5148, 2), 'Search');
  assert.equal(amount(done, I.SMALL_COG), 1);
  assert.ok(done.messages.includes('You find a small cog.'));
});
