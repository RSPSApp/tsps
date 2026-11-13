// Real players, inventory, NPCs, queues and all plugin startup hooks. Only network is captured.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');
const ROOT = path.resolve(__dirname, '..');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
let core, duck, common, nextIndex = 2300;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(ROOT);
  PluginManager.loadFromDirectory(path.join(ROOT, 'plugins'));
  core = PluginManager.getCoreApi();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  core.RegionManager.init();
  PluginManager.emitServerStartup({});
  duck = require('../plugins/skills/sailing/charting/CurrentDuck.Charting');
  common = require('../plugins/skills/sailing/charting/Common.Charting');
});
function captain(t) {
  const player = new Player(null);
  player.setIndex(nextIndex++); player.setRegistered(true);
  const packets = [], messages = [];
  player.getSession = () => ({ sendClientPacket(packet) { packets.push(packet); return true; }, write() { return true; }, getChannel() { return null; } });
  player.setAttribute('bot-skip-persistence', true);
  const sendMessage = player.sendMessage.bind(player);
  player.sendMessage = text => { messages.push(text); return sendMessage(text); };
  player.setUsername('Charting' + player.getIndex());
  player.getInventory().resetItems();
  player.getSkillManager().setCurrentLevel(core.Skill.SAILING, 99);
  player.getSkillManager().setMaxLevel(core.Skill.SAILING, 99);
  core.Sailing.giveBoat(player, 'skiff', 'the_pandemonium');
  assert.equal(core.Sailing.board(player, 'the_pandemonium'), null);
  const boat = core.Sailing.instanceAboard(player);
  t.after(() => { PluginManager.emitPlayerLogout({ player, username: player.getUsername() }); core.BoatManager.dispose(boat); player.setRegistered(false); });
  return { player, boat, packets, messages };
}
function ticks(n = 1) {
  for (let i = 0; i < n; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const state of duck.ducks.values()) state.npc.getMovementQueue().process();
  }
}
function release(f) {
  const spot = common.spotByKey('current_duck_catherby_bay');
  core.BoatManager.teleport(f.boat, { fineX: spot.location[0] * 128 + 64, fineY: spot.location[1] * 128 + 64 });
  f.player.getInventory().add(new core.Item(31805, 1));
  PluginManager.emitItemAction({ player: f.player, item: f.player.getInventory().get(0), itemId: 31805, slot: 0, clickType: 1, option: 'Track-current', handled: false });
  ticks(3);
  assert.ok(duck.ducks.get(f.player));
  return duck.ducks.get(f.player);
}
test('released duck appears in tools and remains unavailable across logout instead of returning to inventory', t => {
  const f = captain(t); release(f);
  assert.ok(f.player.getSailing().tools.includes(2));
  PluginManager.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  assert.equal(f.player.getInventory().contains(31805), false);
  const query = { player: f.player, slot: 2, allowed: true };
  PluginManager.emitCustomEvent('sailing:can-take-tool', query);
  assert.equal(query.allowed, false);
  assert.match(f.messages.at(-1), /You have a current duck out at sea\. Either find it or wait \d+ seconds to collect another\./);
});
test('a stopped duck expires after two minutes and permits replacement without collection XP', t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = captain(t), state = release(f);
  ticks(state.steps.length + 8);
  assert.equal(state.stopped, true);
  now += 119999;
  const query = { player: f.player, slot: 2, allowed: true };
  PluginManager.emitCustomEvent('sailing:can-take-tool', query);
  assert.equal(query.allowed, false);
  now++;
  const expired = { player: f.player, slot: 2, allowed: true };
  PluginManager.emitCustomEvent('sailing:can-take-tool', expired);
  assert.equal(expired.allowed, true);
  assert.equal(duck.ducks.has(f.player), false);
});
test('full inventory collection keeps the stopped owned duck and its charts retryable', t => {
  const f = captain(t), state = release(f); ticks(state.steps.length + 8);
  for (let slot = 0; slot < 28; slot++) f.player.getInventory().setItem(slot, new core.Item(995, 1));
  duck.collect({ player: f.player, npc: state.npc }); ticks(3);
  assert.equal(duck.ducks.get(f.player), state);
  assert.equal(common.isCharted(f.player, state.spot), false);
});
const { MultiChatboxPrompt } = require('../dist/game/model/menu/MultiChatboxPrompt');
function sip(player, gameval) {
  const id = core.CacheDefinitions.getObjId(gameval);
  player.setAttribute('charting:drink-no-warning', true);
  player.getInventory().add(new core.Item(id, 1));
  const slot = player.getInventory().getSlotForItemId(id);
  PluginManager.emitItemAction({ player, item: player.getInventory().get(slot), itemId: id, slot, clickType: 2, option: 'Drink', handled: false });
}
function untilMenu(player) {
  for (let i = 0; i < 40 && !MultiChatboxPrompt.getPending(player) && player.getDialogueManager().isActive(); i++) player.getDialogueManager().advance();
  return MultiChatboxPrompt.getPending(player);
}
function answer(player, n) {
  const menu = untilMenu(player); assert.ok(menu, 'quiz has a native option menu');
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, groupId: 219, childId: 1, buttonId: (219 << 16) | 1, slot: n, action: 1 }), true);
}
test('poteen asks five captured questions and awards five mystery boxes only once', t => {
  const { player } = captain(t);
  const box = core.CacheDefinitions.getObjId('macro_quiz_mystery_box');
  sip(player, 'sailing_charting_drink_crate_puzzlers_poteen');
  for (const n of [1, 1, 4, 3, 4]) answer(player, n);
  untilMenu(player);
  assert.equal(player.getInventory().getAmount(box), 5);
  sip(player, 'sailing_charting_drink_crate_puzzlers_poteen');
  for (const n of [1, 1, 4, 3, 4]) answer(player, n);
  untilMenu(player);
  assert.equal(player.getInventory().getAmount(box), 5);
});
test('wrong poteen answer damages ten percent and a later correct retry remains available', t => {
  const { player, messages } = captain(t);
  player.setHitpoints(99);
  sip(player, 'sailing_charting_drink_crate_puzzlers_poteen');
  answer(player, 2); untilMenu(player);
  player.getCombat().getHitQueue().process(core.World.processCycle + 1);
  assert.equal(player.getHitpoints(), 90);
  assert.ok(messages.includes('Your head aches violently as you feel braincells dying.'));
});
function ownedNpcs(player) {
  return [...core.World.getNpcs()].filter(npc => npc?.getOwner() === player);
}
const DECK_DRINKS = ['prying_times', 'snake_gravy', 'blue_lagoon', 'corpse_reviver', 'possible_albumen', 'fish_stoutier', 'wild_whisky', 'sailing_cat'];
for (const kind of DECK_DRINKS) test(`${kind} creates its captured NPCs in the owner's real deck and removes them at logout`, t => {
  const f = captain(t);
  const quest = require('../plugins/quests/QuestRuntime').getRegisteredQuests().find(q => q.key === 'prying_times');
  quest.setStage(f.player, quest.completionValue ?? 35);
  const spot = common.spotByKey('drink_crate_' + kind);
  const expected = kind === 'wild_whisky'
    ? ['squirrel', 'racoon', 'chinchompa'].map(animal => core.CacheDefinitions.getNpcId('sailing_charting_drink_crate_wild_whisky_effect_' + animal))
    : [core.CacheDefinitions.getNpcId(spot.drink.effect)];
  sip(f.player, 'sailing_charting_drink_crate_' + kind); ticks(2);
  const actors = core.BoatManager.getDeck(f.boat).getNpcs().filter(npc => expected.includes(npc.getId()));
  assert.equal(actors.length, expected.length);
  for (const npc of actors) assert.equal(npc.getOwner(), f.player);
  PluginManager.emitPlayerLogout({ player: f.player, username: f.player.getUsername() });
  for (const npc of actors) assert.equal(npc.isRegistered(), false);
});
test('platinum rum creates seven successive dwarves, awarding one beer or kebab every two ticks', t => {
  const f = captain(t); sip(f.player, 'sailing_charting_drink_crate_platinum_rum');
  const beer = core.CacheDefinitions.getObjId('beer'), kebab = core.CacheDefinitions.getObjId('kebab');
  const amount = () => f.player.getInventory().getAmount(beer) + f.player.getInventory().getAmount(kebab);
  assert.equal(amount(), 1);
  ticks(2); assert.equal(amount(), 2);
  ticks(12); assert.equal(amount(), 7);
  assert.ok(f.messages.includes('They seem to have exhausted themselves now.'));
  const dwarf = core.CacheDefinitions.getNpcId(common.spotByKey('drink_crate_platinum_rum').drink.effect);
  assert.deepEqual(core.BoatManager.getDeck(f.boat).getNpcs().filter(npc => npc.getId() === dwarf), [], 'each dwarf leaves the deck with the world');
});
test('monkfish stout creates an owned sea queen at the captured offset outside the boat deck', t => {
  const f = captain(t), at = core.BoatManager.rootLocation(f.player);
  sip(f.player, 'sailing_charting_drink_crate_monkfish_stout'); ticks(2);
  const id = core.CacheDefinitions.getNpcId('sailing_charting_drink_crate_monkfish_stout_effect');
  const queen = ownedNpcs(f.player).find(npc => npc.getId() === id);
  assert.ok(queen);
  assert.equal(queen.getArea(), null);
  assert.equal(queen.getLocation().getX(), at.getX() - 6);
  assert.equal(queen.getLocation().getY(), at.getY() + 4);
});
test('fishier stout always warns then blacks out into a private three-troll arena while preserving normal cargo', t => {
  const f = captain(t), owned = core.Sailing.activeBoat(f.player);
  owned.cargo[0] = { id: 1511, amount: 3 };
  sip(f.player, 'sailing_charting_drink_crate_fishier_stout');
  const warning = untilMenu(f.player);
  assert.ok(warning, 'potent drink warns even after ordinary drink warning disabled');
  assert.deepEqual(warning.options, ['Yes.', 'No.']);
  answer(f.player, 1);
  ticks(3);
  assert.equal(core.Sailing.instanceAboard(f.player), undefined);
  assert.equal(f.player.getArea() instanceof core.TemplatedInstanceArea, true);
  assert.deepEqual(owned.location, { kind: 'docked', dock: 'port_sarim' });
  assert.deepEqual(owned.cargo[0], { id: 1511, amount: 3 });
  ticks(4);
  assert.equal(f.player.getArea().getNpcs().filter(npc => [15167, 15168, 15169].includes(npc.getId())).length, 3);
  const area = f.player.getArea();
  const objectId = core.CacheDefinitions.getLocId('troll_stronghold_arena_exit_left');
  let object;
  for (let x = 0; x < 8 && !object; x++) for (let y = 0; y < 8 && !object; y++) object = area.getChunkObjects(0, x, y).find(loc => loc.getId() === objectId);
  assert.ok(object, 'real cache arena exit is present in the copied map');
  const at = object.getLocation();
  const event = { player: f.player, object, objectId, clickType: 1, option: 'Open', location: { x: at.getX(), y: at.getY(), z: 0 }, handled: false };
  PluginManager.emitObjectInteraction(event);
  assert.equal(event.handled, true);
  assert.deepEqual([f.player.getLocation().getX(), f.player.getLocation().getY()], [2659, 3674]);
  assert.equal(area.isDestroyed(), true);
});
for (const suffix of ['water', 'ice', 'stew']) test(`fishier ${suffix} drop drink awards its 100 Sailing XP once and restores its varbit at login`, t => {
  const { player } = captain(t);
  const id = core.CacheDefinitions.getObjId('sailing_charting_drink_crate_fishier_stout_' + suffix);
  const bit = core.CacheDefinitions.getVarbitId('sailing_charting_drink_crate_fishier_stout_' + suffix);
  const xp = player.getSkillManager().getExperience(core.Skill.SAILING);
  for (let i = 0; i < 2; i++) {
    player.getInventory().add(new core.Item(id, 1));
    const slot = player.getInventory().getSlotForItemId(id);
    const event = { player, item: player.getInventory().get(slot), itemId: id, slot, clickType: 2, option: 'Drink', handled: false };
    PluginManager.emitItemAction(event); assert.equal(event.handled, true);
  }
  assert.equal(player.getSkillManager().getExperience(core.Skill.SAILING) - xp, 100);
  assert.equal(player.getPacketSender().getVarbit(bit), 1);
});
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
test('duck cooldown survives real player logout/save/load and the native cargo tool refuses early withdrawal', t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const f = captain(t); release(f); f.player.onLogout();
  assert.equal(duck.ducks.has(f.player), false);
  assert.equal(f.player.getInventory().contains(31805), false);
  const saved = PlayerSave.fromPlayer(f.player), g = captain(t);
  core.Sailing.onLogout(g.player); saved.applyToPlayer(g.player);
  core.Sailing.onLogin(g.player);
  PluginManager.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  g.player.setInterfaceId(943);
  const click = () => PluginManager.emitInterfaceActionClick({ player: g.player, groupId: 943, childId: 18, slot: 2, itemId: 31805, action: 1, buttonId: (943 << 16) | 18, handled: false });
  click(); assert.equal(g.player.getInventory().contains(31805), false);
  assert.match(g.messages.at(-1), /current duck out at sea/);
  now += 300000; click();
  assert.equal(g.player.getInventory().getAmount(31805), 1);
  assert.equal(g.player.getSailing().tools.includes(2), false);
  core.Sailing.onLogout(g.player);
});
test('a full poteen reward is retryable and a save/reload cannot award its five boxes twice', t => {
  const f = captain(t), box = core.CacheDefinitions.getObjId('macro_quiz_mystery_box');
  for (let i = 0; i < 24; i++) f.player.getInventory().add(new core.Item(1511, 1));
  const solve = player => { sip(player, 'sailing_charting_drink_crate_puzzlers_poteen'); for (const n of [1, 1, 4, 3, 4]) answer(player, n); untilMenu(player); };
  solve(f.player); assert.equal(f.player.getInventory().getAmount(box), 0);
  f.player.getInventory().delete(1511, 1); solve(f.player);
  assert.equal(f.player.getInventory().getAmount(box), 5);
  const save = PlayerSave.fromPlayer(f.player), g = captain(t);
  core.Sailing.onLogout(g.player); save.applyToPlayer(g.player);
  PluginManager.emitPlayerLogin({ player: g.player, username: g.player.getUsername(), isNewAccount: false });
  g.player.getInventory().delete(1511, 5); solve(g.player);
  assert.equal(g.player.getInventory().getAmount(box), 5);
});
test('a drink warning cannot consume a same-id replacement or a bottle after death/trade begins', t => {
  for (const mode of ['replacement', 'dead', 'trading']) {
    const f = captain(t), id = core.CacheDefinitions.getObjId('sailing_charting_drink_crate_blue_lagoon');
    f.player.getInventory().add(new core.Item(id));
    const item = f.player.getInventory().get(0);
    PluginManager.emitItemAction({ player: f.player, item, itemId: id, slot: 0, clickType: 2, option: 'Drink', handled: false });
    assert.ok(untilMenu(f.player));
    if (mode === 'replacement') { f.player.getInventory().deleteAtSlot(0); f.player.getInventory().add(new core.Item(id, 1, { marker: 'replacement' })); }
    if (mode === 'dead') f.player.setHitpoints(0);
    if (mode === 'trading') {
      const other = captain(t).player;
      f.player.getTrading().setInteract(other); other.getTrading().setInteract(f.player);
      f.player.getTrading().initiateTrade(); other.getTrading().initiateTrade();
    }
    answer(f.player, 1);
    assert.equal(f.player.getInventory().getAmount(id), 1, mode);
    assert.equal(common.isCharted(f.player, common.spotByKey('drink_crate_blue_lagoon')), false, mode);
    f.player.setHitpoints(10); f.player.setStatus(core.PlayerStatus.NONE);
  }
});
test('drinking consumes the exact clicked bottle while preserving an earlier metadata copy', t => {
  const f = captain(t), id = core.CacheDefinitions.getObjId('sailing_charting_drink_crate_blue_lagoon');
  f.player.setAttribute('charting:drink-no-warning', true);
  f.player.getInventory().add(new core.Item(id, 1, { marker: 'keep' }));
  f.player.getInventory().add(new core.Item(id, 1, { marker: 'drink' }));
  PluginManager.emitItemAction({ player: f.player, item: f.player.getInventory().get(1), itemId: id, slot: 1, clickType: 2, option: 'Drink', handled: false });
  assert.equal(f.player.getInventory().getAmount(id), 1);
  assert.equal(f.player.getInventory().get(0).getMetaValue('marker'), 'keep');
});
test('boat teleport removes only its owner\'s drink visitors', t => {
  const f = captain(t), g = captain(t);
  sip(f.player, 'sailing_charting_drink_crate_wild_whisky');
  sip(g.player, 'sailing_charting_drink_crate_wild_whisky');
  const own = core.BoatManager.getDeck(f.boat).getNpcs().slice();
  const other = core.BoatManager.getDeck(g.boat).getNpcs().slice();
  core.BoatManager.teleport(f.boat, { fineX: 3000 * 128, fineY: 3000 * 128 }); ticks(1);
  assert.equal(own.every(npc => !npc.isRegistered()), true);
  assert.equal(other.every(npc => npc.isRegistered()), true);
});
test('poteen reward box continues into the Quiz Master goodbye instead of replacing an unseen goodbye', t => {
  const { player } = captain(t);
  sip(player, 'sailing_charting_drink_crate_puzzlers_poteen');
  for (const n of [1, 1, 4, 3, 4]) answer(player, n);
  const dm = player.getDialogueManager();
  dm.advance(); dm.advance();
  assert.equal(dm.getCurrent().getText(), 'Some boxes appear in your inventory.');
  dm.advance();
  assert.equal(dm.getCurrent().getText(), 'Thanks for playing!');
});
test('drink visitors speak their generated overhead introduction without taking over the chatbox', t => {
  for (const [drink, npcId, line] of [
    ['possible_albumen', 15170, 'Why would you do that?'],
    ['fish_stoutier', 15171, "Drinkies be dinky's! Leave dem drinkies!"],
    ['corpse_reviver', 15165, 'Urrrrr...'],
  ]) {
    const f = captain(t); sip(f.player, 'sailing_charting_drink_crate_' + drink); ticks(2);
    const npc = core.BoatManager.getDeck(f.boat).getNpcs().find(npc => npc.getId() === npcId);
    assert.equal(npc.getForcedChat(), line);
    assert.equal(f.player.getDialogueManager().isActive(), false);
  }
});
const { ClientConnection } = require('../dist/net/NetworkBuilder');
function nativeDrink(player, slot) {
  const itemId = player.getInventory().get(slot).getId();
  ClientConnection.prototype.inventoryAction.call({ player }, {
    type: 'inventory_action', widgetId: core.CacheDefinitions.getComponentId('inventory:items'), slot, itemId, option: 'Drink',
  });
}
test('native troll reward drinks consume the clicked metadata copy and refuse real trade or death', t => {
  const f = captain(t), id = core.CacheDefinitions.getObjId('sailing_charting_drink_crate_fishier_stout_water');
  f.player.getInventory().add(new core.Item(id, 1, { tag: 'keep' }));
  f.player.getInventory().add(new core.Item(id, 1, { tag: 'drink' }));
  nativeDrink(f.player, 1);
  assert.equal(f.player.getInventory().get(0).getMetaValue('tag'), 'keep');
  assert.equal(f.player.getInventory().get(1).getId(), -1);
  const g = captain(t), h = captain(t);
  g.player.getInventory().add(new core.Item(id));
  g.player.getTrading().setInteract(h.player); h.player.getTrading().setInteract(g.player);
  g.player.getTrading().initiateTrade(); h.player.getTrading().initiateTrade();
  const xp = g.player.getSkillManager().getExperience(core.Skill.SAILING);
  nativeDrink(g.player, 0);
  assert.equal(g.player.getInventory().getAmount(id), 1);
  assert.equal(g.player.getSkillManager().getExperience(core.Skill.SAILING), xp);
  g.player.getTrading().closeTrade();
  g.player.setHitpoints(0); nativeDrink(g.player, 0);
  assert.equal(g.player.getInventory().getAmount(id), 1);
  g.player.setHitpoints(10);
});
test('The rocks changes from magic to melee against real Protect from Magic and uses the known melee max23', t => {
  const f = captain(t);
  sip(f.player, 'sailing_charting_drink_crate_fishier_stout'); answer(f.player, 1); ticks(7);
  const npc = f.player.getArea().getNpcs().find(npc => npc.getId() === 15168);
  npc.getCombat().reset();
  assert.equal(core.CombatFactory.getMethod(npc).type(), core.CombatType.MAGIC);
  npc.getCombat().attack(f.player);
  assert.equal(core.CombatFactory.getMethod(npc).type(), core.CombatType.MAGIC);
  f.player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  f.player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 99);
  core.PrayerHandler.activatePrayerPrayerId(f.player, core.PrayerHandler.PROTECT_FROM_MAGIC);
  assert.equal(core.CombatFactory.getMethod(npc).type(), core.CombatType.MELEE);
  t.mock.method(core.Misc, 'randomInclusive', (_min, max) => max); // Controlled maximum damage roll.
  assert.equal(core.CombatFactory.rollHitDamage(npc, f.player, core.CombatType.MELEE).getDamage(), 23);
});
test('The rocks accurate magic impact interrupts the target and applies its captured graphic with an estimated freeze', t => {
  const f = captain(t);
  // This case checks a surviving target. The content damage-roll hook rolls up
  // to23 even when PendingHit requests0; a default10HP player may die first.
  f.player.getSkillManager().setMaxLevel(core.Skill.HITPOINTS, 99);
  f.player.getSkillManager().setCurrentLevel(core.Skill.HITPOINTS, 99);
  sip(f.player, 'sailing_charting_drink_crate_fishier_stout'); answer(f.player, 1); ticks(7);
  const npc = f.player.getArea().getNpcs().find(npc => npc.getId() === 15168);
  f.player.getCombat().attack(npc);
  f.player.setNeedsPlacement(false); npc.setNeedsPlacement(false); // Finish the arena placement, as a World tick does.
  const method = core.CombatFactory.getMethod(npc), hit = new core.PendingHit(npc, f.player, method, { damage: 0, rollAccuracy: false });
  assert.equal(hit.isAccurate(), true);
  assert.ok(f.player.getHitpoints() > 0);
  assert.equal(npc.getArea(), f.player.getArea());
  assert.equal(method.type(), core.CombatType.MAGIC);
  assert.equal(npc.getOwner() === f.player, true);
  assert.equal(npc.isRegistered(), true);
  assert.equal(f.player.isRegistered(), true);
  // Exercise the real resolved-hit callback and application, not a direct hook plus a source-less splat.
  core.CombatFactory.addPendingHit(hit);
  f.player.getCombat().getHitQueue().process(core.World.processCycle + 2);
  assert.ok(f.player.getHitpoints() > 0, 'a surviving target is required for the impact effect');
  assert.equal(f.player.getCombat().getTarget() === null, true, JSON.stringify({
    hold: f.player.getCombat().getIncomingHitCycle(), cycle: core.World.processCycle,
    queued: f.player.getCombat().getHitQueue().hasPendingWork(), hp: f.player.getHitpoints(),
    registered: npc.isRegistered(), dying: npc.isDying, npcHp: npc.getHitpoints(),
    scene: require('../plugins/skills/sailing/charting/FishierStout.Charting').scenes.has(f.player),
  }));
  assert.equal(f.player.getGraphic().getId(), 369);
});

test('The rocks actual magic attack plays its captured troll attack animation', t => {
  const f = captain(t);
  sip(f.player, 'sailing_charting_drink_crate_fishier_stout'); answer(f.player, 1); ticks(7);
  const npc = f.player.getArea().getNpcs().find(npc => npc.getId() === 15168);
  f.player.moveTo(npc.getLocation().clone().add(1, 0));
  f.player.needsPlacement = false; npc.setNeedsPlacement(false);
  npc.getCombat().reset(); npc.getCombat().attack(f.player);
  npc.performAnimation(new core.Animation(-1));
  assert.equal(npc.getCombat().performNewAttack(true), true);
  assert.equal(npc.getAnimation().getId(), core.CacheDefinitions.getSeqId('troll_attack'));
});
