// Elemental Workshop I against the user's rev 242 capture (docs/quests/elemental-workshop-i/README.md):
// real Player, real map locs and NPCs, ticks through World.process.
// From server/: node --test tests/elemental-workshop-i.test.cjs (after yarn build).
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
const { NPCDeathTask } = require('../dist/game/task/impl/NPCDeathTask');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const Runtime = require('../plugins/quests/QuestRuntime');

let core, I, O, next = 9300;
const BIT = { book: 1 << 1, key: 1 << 2, gate1: 1 << 3, gate2: 1 << 4, water: 1 << 5, bellows: 1 << 6, fire: 1 << 7,
  air: 1 << 9, stairs: 1 << 13, leather: 1 << 14, wall: 1 << 16, finished: 1 << 20 };

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  new NpcDefinitionLoader().load();
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  O = core.ObjectIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2709, 3495);
  core.RegionManager.loadMapFiles(2720, 9888);
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

const quest = () => Runtime.getRegisteredQuests().findLast((q) => q.key === 'elemental_workshop_i');
const stage = (p) => quest().getStage(p);
const ticks = (n) => { for (let i = 0; i < n; i++) core.World.process(); };

function actor(t, { stage: initial = 0, items = [] } = {}) {
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  const name = `ew1t${next++}`;
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
  player.sendMessage = (text) => { messages.push(String(text)); return send(text); };
  player.messages = messages;
  for (const skill of [core.Skill.MINING, core.Skill.SMITHING, core.Skill.CRAFTING, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.HITPOINTS]) {
    player.getSkillManager().setMaxLevels(skill, 40, false).setExperience(skill, SkillManager.getExperienceForLevel(40)).setCurrentLevels(skill, 40, false);
  }
  if (initial) quest().setStage(player, initial);
  for (const [id, amount] of items) player.getInventory().adds(id, amount ?? 1);
  return player;
}

function objectAt(player, id, x, y) {
  const loc = new core.Location(x, y, 0);
  const obj = MapObjects.getObjectsAt(loc, player.getPrivateArea()).find((o) => o.getId() === id);
  assert.ok(obj, `map loc ${id} at ${x},${y}`);
  return obj;
}

function locIdsAt(player, x, y) {
  return MapObjects.getObjectsAt(new core.Location(x, y, 0), player.getPrivateArea()).map((o) => o.getId());
}

function place(player, x, y) {
  player.moveTo(new core.Location(x, y, 0));
  player.setNeedsPlacement(false);
}

function op(player, id, x, y, option) {
  const obj = objectAt(player, id, x, y);
  const def = ObjectDefinition.forPlayer(obj.getId(), player);
  const index = def.getInteractions().findIndex((o) => String(o).toLowerCase() === option.toLowerCase());
  assert.ok(index >= 0, `${id} has ${option}`);
  return PM.emitObjectInteraction({ player, object: obj, objectId: obj.getId(), definition: def, location: { x, y, z: 0 }, clickType: index + 1, handled: false });
}

function slotOf(player, id) {
  const slot = player.getInventory().getItems().findIndex((item) => item && item.getId() === id);
  assert.ok(slot >= 0, `carries ${id}`);
  return slot;
}

function use(player, itemId, objectId, x, y) {
  const obj = objectAt(player, objectId, x, y);
  const slot = slotOf(player, itemId);
  return PM.emitItemOnObject({ player, object: obj, objectId: obj.getId(), item: player.getInventory().getItems()[slot], itemId, itemSlot: slot,
    interfaceType: Inventory.INTERFACE_ID, location: { x, y, z: 0 }, handled: false });
}

function useOnItem(player, usedId, withId) {
  const inv = player.getInventory().getItems();
  const a = slotOf(player, usedId), b = slotOf(player, withId);
  return PM.emitItemOnItem({ player, usedItem: inv[a], usedWithItem: inv[b], usedItemId: usedId, usedWithItemId: withId, usedItemSlot: a, usedWithItemSlot: b, handled: false });
}

function read(player, itemId) {
  const slot = slotOf(player, itemId);
  return PM.emitItemAction({ player, item: player.getInventory().getItems()[slot], slot, itemId, interfaceId: Inventory.INTERFACE_ID, clickType: 1, option: 'Read', handled: false });
}

const wireVarp = (player) => player.getPacketSender().getVarp(299);
const amount = (player, id) => player.getInventory().getAmount(id);

test('bookcase gives the battered book once, then the slashed book and key back', (t) => {
  const p = actor(t);
  place(p, 2715, 3481);
  assert.equal(op(p, O.BOOKCASE_99, 2716, 3481, 'Search'), true);
  assert.equal(amount(p, I.BATTERED_BOOK), 1);
  assert.equal(stage(p), 0, 'holding the book does not start the quest');
  p.getPacketSender().sendInterfaceRemoval();
  op(p, O.BOOKCASE_99, 2716, 3481, 'Search');
  assert.equal(amount(p, I.BATTERED_BOOK), 1, 'no second book while one is carried');

  const slashed = actor(t, { stage: BIT.book | BIT.key });
  place(slashed, 2715, 3481);
  slashed.getInventory().adds(I.BATTERED_BOOK, 1);
  op(slashed, O.BOOKCASE_99, 2716, 3481, 'Search');
  assert.equal(amount(slashed, I.BATTERED_BOOK), 0, 'Wiki: the battered copies go once the book is slashed');
  assert.equal(amount(slashed, I.SLASHED_BOOK), 1);
  assert.equal(amount(slashed, I.BATTERED_KEY), 1);
});

test('reading asks to start; "Yes." starts it, sends the captured lines and opens the book', (t) => {
  const p = actor(t, { items: [[I.BATTERED_BOOK]] });
  assert.equal(read(p, I.BATTERED_BOOK), true);
  const menu = p.getDialogueManager().getCurrent();
  assert.ok(menu instanceof OptionDialogue);
  assert.equal(menu.getTitle(), 'Start the Elemental Workshop I quest?');
  assert.deepEqual(menu.getOptions(), ['Yes.', 'No.']);
  p.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, 2);
  assert.equal(stage(p), 0, '"No." leaves it unstarted');

  read(p, I.BATTERED_BOOK);
  p.getDialogueManager().handleResume(OptionDialogue.OPTIONS_WIDGET_ID, 1);
  assert.equal(stage(p), BIT.book);
  assert.equal(p.getPacketSender().getVarbit(13718), 1);
  const at = p.messages.findIndex((m) => m.startsWith("You've started a new quest"));
  assert.ok(at >= 0);
  assert.deepEqual(p.messages.slice(at + 1, at + 3), [
    'The book has two parts: an introduction and an instruction section.',
    'You flip the book open to the introduction and start reading.',
  ]);
  assert.equal(p.getInterfaceId(), 392, 'the book interface');

  p.messages.length = 0;
  p.getPacketSender().sendInterfaceRemoval();
  read(p, I.BATTERED_BOOK);
  assert.equal(p.getDialogueManager().getCurrent() instanceof OptionDialogue, false, 'no prompt once started');
  assert.equal(p.messages[0], 'The book has two parts: an introduction and an instruction section.');
});

test('a knife or slash weapon cuts the key out; anything else refuses', (t) => {
  const p = actor(t, { stage: BIT.book, items: [[I.BATTERED_BOOK], [I.KNIFE], [I.COINS, 5]] });
  const bookSlot = slotOf(p, I.BATTERED_BOOK);
  useOnItem(p, I.COINS, I.BATTERED_BOOK);
  assert.ok(p.messages.includes("You don't want to damage the book."));
  useOnItem(p, I.KNIFE, I.BATTERED_BOOK);
  assert.equal(p.getInventory().getItems()[bookSlot].getId(), I.SLASHED_BOOK, 'the book is slashed in its slot');
  assert.equal(amount(p, I.BATTERED_KEY), 1);
  assert.ok(p.messages.includes('You make a small cut in the spine of the book.'));
  assert.ok(p.messages.includes('Inside you find a small, old, battered key.'));
  assert.ok(stage(p) & BIT.key);

  const sword = actor(t, { stage: BIT.book, items: [[I.BATTERED_BOOK], [I.IRON_SCIMITAR]] });
  useOnItem(sword, I.IRON_SCIMITAR, I.BATTERED_BOOK);
  assert.equal(amount(sword, I.SLASHED_BOOK), 1);

  const full = actor(t, { stage: BIT.book, items: [[I.BATTERED_BOOK], [I.KNIFE]] });
  while (full.getInventory().getFreeSlots() > 0) full.getInventory().adds(I.ASHES, 1);
  useOnItem(full, I.KNIFE, I.BATTERED_BOOK);
  assert.equal(amount(full, I.BATTERED_KEY), 0);
  assert.ok(full.messages.includes('You drop the key on the floor as you have no space in your backpack.'));
  assert.ok(core.ItemOnGroundManager.getGroundItem(full.getUsername(), I.BATTERED_KEY, full.getLocation(), null));
});

test('the odd wall: the key line, the pass-through doors for two ticks, and out without a line', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.key });
  place(p, 2709, 3495);
  op(p, O.ODD_LOOKING_WALL_8, 2709, 3495, 'Open');
  assert.deepEqual(p.messages.slice(-1), ['You see a small hole in the wall but no way to open it.']);
  assert.equal(p.getLocation().getY(), 3495);

  p.getInventory().adds(I.BATTERED_KEY, 1);
  op(p, O.ODD_LOOKING_WALL_8, 2709, 3495, 'Open');
  assert.ok(p.messages.includes('You use the battered key to open the doors.'));
  assert.ok(locIdsAt(p, 2709, 3495).includes(O.ODD_LOOKING_WALL_6), 'inviswall on the wall tile');
  assert.ok(locIdsAt(p, 2709, 3496).includes(26117), 'the open left leaf north');
  ticks(3);
  assert.ok(p.getLocation().equals(new core.Location(2709, 3496, 0)), 'stepped through');
  assert.ok(locIdsAt(p, 2709, 3495).includes(O.ODD_LOOKING_WALL_8), 'the wall is back');
  assert.ok(stage(p) & BIT.wall);
  assert.equal((wireVarp(p) >>> 15) & 1, 1, 'the client wall bit (capture tick 198)');

  p.getInventory().deleteNumber(I.BATTERED_KEY, 1);
  p.messages.length = 0;
  place(p, 2710, 3496);
  op(p, O.ODD_LOOKING_WALL_7, 2710, 3495, 'Open');
  ticks(3);
  assert.deepEqual(p.messages, [], 'leaving sends no line (capture tick 240)');
  assert.ok(p.getLocation().equals(new core.Location(2710, 3495, 0)));

  p.getInventory().adds(I.COINS, 1);
  use(p, I.COINS, O.ODD_LOOKING_WALL_7, 2710, 3495);
  assert.ok(p.messages.includes("You can't unlock the door with that."));
});

test('the stairs land a tick later; the first climb down says the explore line once', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.key | BIT.wall });
  place(p, 2709, 3498);
  op(p, O.STAIRCASE_10, 2710, 3497, 'Climb-down');
  assert.equal(p.getLocation().getY(), 3498);
  ticks(1);
  assert.ok(p.getLocation().equals(new core.Location(2716, 9888, 0)));
  assert.ok(stage(p) & BIT.stairs);
  assert.equal(p.getDialogueManager().getCurrent()?.getText?.(), 'Now to explore this area thoroughly, to find what forgotten secrets it contains.');
  p.getPacketSender().sendInterfaceRemoval();
  op(p, O.STAIRCASE_11, 2714, 9887, 'Climb-up');
  ticks(1);
  assert.ok(p.getLocation().equals(new core.Location(2709, 3497, 0)));
  place(p, 2709, 3498);
  op(p, O.STAIRCASE_10, 2710, 3497, 'Climb-down');
  ticks(1);
  assert.equal(p.getDialogueManager().getCurrent(), undefined, 'only the first time');
});

test('water controls: east then west, the gate a few ticks after the handle; the lever starts, resets and stops', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs });
  place(p, 2713, 9907);
  op(p, 3404, 2713, 9908, 'Turn');
  assert.ok(p.messages.includes('You turn the handle.'));
  ticks(2);
  assert.equal(stage(p) & BIT.gate1, 0, 'not yet');
  ticks(1);
  assert.ok(stage(p) & BIT.gate1, 'west green three ticks later');
  place(p, 2726, 9907);
  op(p, 3403, 2726, 9908, 'Turn');
  ticks(3);
  assert.equal(stage(p) & BIT.gate2, 0, 'Wiki: east cannot turn while west is green');

  place(p, 2722, 9905);
  op(p, O.LEVER_22, 2722, 9906, 'Pull');
  assert.deepEqual(p.messages.slice(-2), ['You pull the lever.', 'You hear the sound of the flow gates resetting.']);
  assert.equal(stage(p) & (BIT.gate1 | BIT.gate2), 0);
  assert.ok(locIdsAt(p, 2722, 9906).includes(3417), 'the lever drops');
  ticks(2);
  assert.ok(locIdsAt(p, 2722, 9906).includes(O.LEVER_22), 'and is back two ticks later');

  place(p, 2726, 9907);
  op(p, 3403, 2726, 9908, 'Turn');
  ticks(3);
  place(p, 2713, 9907);
  op(p, 3404, 2713, 9908, 'Turn');
  ticks(3);
  place(p, 2722, 9905);
  op(p, O.LEVER_22, 2722, 9906, 'Pull');
  assert.deepEqual(p.messages.slice(-2), ['You pull the lever.', 'You hear the sound of a water wheel starting up.']);
  assert.ok(stage(p) & BIT.water);
  assert.equal((wireVarp(p) >>> 5) & 1, 1, 'elemental_workshop_switch');
  ticks(2);
  op(p, O.LEVER_22, 2722, 9906, 'Pull');
  assert.deepEqual(p.messages.slice(-1), ['You hear the sound of a water wheel coming to a standstill.']);
  assert.equal(stage(p) & BIT.water, 0);
});

test('bellows and the air lever, with the leather crate', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs, items: [[I.NEEDLE], [I.THREAD, 5]] });
  place(p, 2733, 9887);
  op(p, O.LEVER_23, 2734, 9887, 'Pull');
  assert.deepEqual(p.messages.slice(-3), ['You pull the lever.', 'The bellows pump air out of the hole.', 'Looks like they need fixing. You reset the lever.']);
  op(p, 3407, 2734, 9882, 'Fix');
  assert.deepEqual(p.messages.slice(-1), ['You need a piece of leather, some thread and a needle to fix this.']);

  place(p, 2717, 9893);
  op(p, O.CRATE_27, 2717, 9894, 'Search');
  assert.equal(amount(p, I.LEATHER), 1);
  assert.deepEqual(p.messages.slice(-1), ['You find some leather.']);
  assert.ok(stage(p) & BIT.leather);
  op(p, O.CRATE_27, 2717, 9894, 'Search');
  assert.equal(amount(p, I.LEATHER), 1, 'once');

  place(p, 2733, 9886);
  op(p, 3407, 2734, 9882, 'Fix');
  assert.deepEqual(p.messages.slice(-1), ['You stitch the leather over the hole in the bellows.']);
  assert.equal(amount(p, I.LEATHER), 0);
  assert.equal(amount(p, I.THREAD), 4);
  assert.equal(amount(p, I.NEEDLE), 1, 'the needle is kept');
  assert.equal(p.getAnimation()?.getId(), 4863);
  ticks(2);
  op(p, O.LEVER_23, 2734, 9887, 'Pull');
  assert.deepEqual(p.messages.slice(-1), ['The bellows pump air down the pipe.']);
  assert.ok(stage(p) & BIT.air);
  ticks(2);
  op(p, O.LEVER_23, 2734, 9887, 'Pull');
  assert.deepEqual(p.messages.slice(-1), ['The bellows stop pumping air.']);
});

test('lava lights the furnace; the ore smelts six ticks later for 8 XP', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs | BIT.water | BIT.bellows | BIT.air, items: [[I.ELEMENTAL_ORE], [I.COAL, 4], [I.TINDERBOX]] });
  place(p, 2724, 9893);
  op(p, O.BOXES_5, 2724, 9894, 'Search');
  assert.equal(amount(p, I.A_STONE_BOWL), 1);
  assert.deepEqual(p.messages.slice(-1), ['You find a stone bowl.']);

  place(p, 2724, 9875);
  use(p, I.ELEMENTAL_ORE, 3410, 2725, 9874);
  assert.deepEqual(p.messages.slice(-1), ['The furnace is cold and useless for anything.']);
  use(p, I.TINDERBOX, 3410, 2725, 9874);
  assert.deepEqual(p.messages.slice(-1), ['The tinderbox cannot make a spark large enough to light this.']);

  place(p, 2717, 9872);
  use(p, I.A_STONE_BOWL, O.LAVA_TROUGH_2, 2717, 9871);
  assert.equal(p.getAnimation()?.getId(), 4862);
  ticks(2);
  assert.equal(amount(p, I.A_STONE_BOWL_2), 1);
  assert.deepEqual(p.messages.slice(-1), ['You fill the bowl with hot lava.']);

  place(p, 2724, 9875);
  use(p, I.A_STONE_BOWL_2, 3410, 2725, 9874);
  assert.deepEqual(p.messages.slice(-1), ['You empty the lava into the furnace.']);
  assert.equal(amount(p, I.A_STONE_BOWL), 1);
  ticks(4);
  assert.deepEqual(p.messages.slice(-1), ['The furnace bursts to life.']);
  assert.equal((wireVarp(p) >>> 7) & 1, 1, 'elemental_workshop_fire');

  const xp = p.getSkillManager().getExperience(core.Skill.SMITHING);
  use(p, I.ELEMENTAL_ORE, 3410, 2725, 9874);
  assert.deepEqual(p.messages.slice(-1), ['You place the elemental ore and four heaps of coal into the furnace.']);
  assert.equal(amount(p, I.ELEMENTAL_ORE), 0);
  assert.equal(amount(p, I.COAL), 0);
  ticks(5);
  assert.equal(amount(p, I.ELEMENTAL_METAL), 0, 'not yet');
  ticks(1);
  assert.equal(amount(p, I.ELEMENTAL_METAL), 1, 'Wiki: six ticks');
  assert.deepEqual(p.messages.slice(-1), ['You retrieve a bar of elemental metal.']);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - xp, 8);
});

test('the workbench makes the shield in the bar\'s slot four ticks on and completes the quest once', (t) => {
  const done = BIT.book | BIT.key | BIT.stairs | BIT.water | BIT.bellows | BIT.air | BIT.fire;
  const p = actor(t, { stage: done, items: [[I.ELEMENTAL_METAL]] });
  place(p, 2718, 9887);
  use(p, I.ELEMENTAL_METAL, O.WORKBENCH_5, 2717, 9887);
  assert.equal(p.getDialogueManager().getCurrent()?.getText?.(), 'You need a hammer to work the metal with.');
  p.getPacketSender().sendInterfaceRemoval();
  p.getInventory().adds(I.HAMMER, 1);
  use(p, I.ELEMENTAL_METAL, O.WORKBENCH_5, 2717, 9887);
  assert.equal(p.getDialogueManager().getCurrent()?.getText?.(), 'This workbench is too complicated. You need instructions to follow.');
  p.getPacketSender().sendInterfaceRemoval();
  p.getInventory().adds(I.SLASHED_BOOK, 1);
  const barSlot = slotOf(p, I.ELEMENTAL_METAL);
  const smith = p.getSkillManager().getExperience(core.Skill.SMITHING);
  const craft = p.getSkillManager().getExperience(core.Skill.CRAFTING);
  use(p, I.ELEMENTAL_METAL, O.WORKBENCH_5, 2717, 9887);
  assert.equal(p.getAnimation()?.getId(), 896);
  ticks(3);
  assert.equal(amount(p, I.ELEMENTAL_SHIELD), 0, 'not yet');
  ticks(1);
  assert.equal(p.getInventory().getItems()[barSlot].getId(), I.ELEMENTAL_SHIELD, 'the shield takes the bar\'s slot');
  assert.equal(amount(p, I.ELEMENTAL_SHIELD), 1, 'exactly one shield');
  assert.ok(p.messages.includes('Following the instructions in the book, you make an elemental shield.'));
  assert.equal(quest().isComplete(p), true);
  assert.equal(p.getPacketSender().getVarbit(13718), 2);
  assert.equal((wireVarp(p) >>> 20) & 1, 1, 'elemental_workshop_finished');
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - smith, 5020, '5,000 reward + 20 for the shield');
  assert.equal(p.getSkillManager().getExperience(core.Skill.CRAFTING) - craft, 5000);

  ticks(1); // the completion scroll opens a tick after the completion
  p.getPacketSender().sendInterfaceRemoval();
  p.getInventory().adds(I.ELEMENTAL_METAL, 1);
  use(p, I.ELEMENTAL_METAL, O.WORKBENCH_5, 2717, 9887);
  ticks(4);
  assert.equal(amount(p, I.ELEMENTAL_SHIELD), 2);
  assert.equal(p.getSkillManager().getExperience(core.Skill.SMITHING) - smith, 5040, 'only the shield XP again');
});

test('a mined elemental rock rises, says its line and becomes the earth elemental, then drops ore and rock', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs, items: [[I.BRONZE_PICKAXE]] });
  place(p, 2704, 9894);
  const rock = core.NPC.create(1368, new core.Location(2703, 9894, 0));
  assert.equal(core.World.getNpcs().add(rock), true);
  t.after(() => { if (rock.isRegistered()) core.World.getNpcs().remove(rock); });
  const said = [];
  const forceChat = rock.forceChat.bind(rock);
  rock.forceChat = (text) => { said.push(text); return forceChat(text); };
  assert.ok(rock, 'the elemental rock at 2703,9894');
  const handled = PM.emitNpcInteraction({ player: p, npc: rock, npcId: 1368, definition: rock.getCurrentDefinition(), clickType: 1, handled: false });
  assert.equal(handled, true);
  assert.equal(rock.getAnimation()?.getId(), 4865, 'emerge');
  ticks(1);
  assert.equal(rock.getNpcTransformationId(), -1, 'still rising');
  ticks(1);
  assert.equal(rock.getNpcTransformationId(), 1367);
  assert.deepEqual(said, ["Grr... Ge'roff us!"], 'Transcript:Earth elemental, capture tick 438');
  assert.equal(rock.getCurrentDefinition().getCombatLevel?.() ?? 35, 35);

  rock.getCombat().addDamage(p, 1);
  const task = new NPCDeathTask(rock);
  task.execute();
  task.execute();
  const ore = core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.ELEMENTAL_ORE, rock.getLocation(), null);
  assert.ok(ore, 'the ore on the death tile');
  assert.ok(core.ItemOnGroundManager.getGroundItem(p.getUsername(), 1480, rock.getLocation(), null), 'and the rock');
  assert.equal(rock.getNpcTransformationId(), -1, 'back to a rock for its respawn');
  assert.equal(core.NpcDefinition.forId(1368).getRespawn(), 4, 'a rock again four ticks after the drop (capture ticks 471-475)');
});

test('mining while another elemental attacks the miner gives the rock its second line', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs, items: [[I.BRONZE_PICKAXE]] });
  place(p, 2704, 9894);
  const fire = core.NPC.create(core.NpcIdentifiers.FIRE_ELEMENTAL, new core.Location(2705, 9895, 0));
  const rock = core.NPC.create(1368, new core.Location(2703, 9894, 0));
  for (const npc of [fire, rock]) {
    assert.equal(core.World.getNpcs().add(npc), true);
    t.after(() => { if (npc.isRegistered()) core.World.getNpcs().remove(npc); });
  }
  p.getCombat().setUnderAttack(fire);
  assert.equal(core.CombatFactory.inCombat(p), true);
  const said = [];
  const forceChat = rock.forceChat.bind(rock);
  rock.forceChat = (text) => { said.push(text); return forceChat(text); };
  PM.emitNpcInteraction({ player: p, npc: rock, npcId: 1368, definition: rock.getCurrentDefinition(), clickType: 1, handled: false });
  ticks(2);
  assert.deepEqual(said, ["I told you... Ge'roff us!"], 'Transcript:Earth elemental');
});

test('logging out mid-smelt or mid-pour finishes the step instead of losing what it took', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs | BIT.water | BIT.bellows | BIT.air | BIT.fire, items: [[I.ELEMENTAL_ORE], [I.ELEMENTAL_ORE], [I.COAL, 4]] });
  place(p, 2724, 9875);
  use(p, I.ELEMENTAL_ORE, 3410, 2725, 9874);
  use(p, I.ELEMENTAL_ORE, 3410, 2725, 9874);
  assert.equal(p.messages.filter((m) => m.startsWith('You need four heaps of coal')).length, 0, 'a second click mid-smelt is ignored');
  assert.equal(amount(p, I.ELEMENTAL_ORE), 1, 'and takes nothing');
  PM.emitPlayerLogout({ player: p, username: p.getUsername() });
  core.TaskManager.cancelTasks(p);
  assert.equal(amount(p, I.ELEMENTAL_METAL), 1, 'the bar is in the saved inventory');
  assert.equal(amount(p, I.COAL), 0);

  const cold = actor(t, { stage: BIT.book | BIT.stairs, items: [[I.A_STONE_BOWL_2]] });
  place(cold, 2724, 9875);
  use(cold, I.A_STONE_BOWL_2, 3410, 2725, 9874);
  PM.emitPlayerLogout({ player: cold, username: cold.getUsername() });
  core.TaskManager.cancelTasks(cold);
  assert.ok(stage(cold) & BIT.fire, 'the furnace the lava went into is lit');
});

test('a bag filled during the smelt gets the bar on the floor, not lost', (t) => {
  const p = actor(t, { stage: BIT.book | BIT.stairs | BIT.water | BIT.bellows | BIT.air | BIT.fire, items: [[I.ELEMENTAL_ORE], [I.COAL, 4]] });
  place(p, 2724, 9875);
  use(p, I.ELEMENTAL_ORE, 3410, 2725, 9874);
  while (p.getInventory().getFreeSlots() > 0) p.getInventory().adds(I.ASHES, 1);
  ticks(6);
  assert.equal(amount(p, I.ELEMENTAL_METAL), 0);
  assert.ok(core.ItemOnGroundManager.getGroundItem(p.getUsername(), I.ELEMENTAL_METAL, p.getLocation(), null), 'the bar is under the player');
});
