// Run after `yarn build`: node --test tests/nightmare-zone.test.cjs
//
// Nightmare Zone against the rsprox recordings (234/03279: Dominic, the dream menus, the coffer,
// the barrels; 224/01512: a Practice dream from the vial to the arena's potion) and the Wiki (the
// bosses, points, a death in a dream).
const assert = require('node:assert/strict');
const { test, before, beforeEach } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { NpcDefinitionLoader } = require('../dist/game/definition/loader/impl/NpcDefinitionLoader');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');

let Common, Dominic, Coffer, Dream, Potions, PowerUps, hooks, core;

/** Name hooks run in turn until one takes the click, as the plugin manager does. */
function chain(map, key, fn) {
  const prior = map.get(key);
  map.set(key, prior ? (event) => prior(event) || fn(event) : fn);
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  new NpcDefinitionLoader().load();
  core = PluginManager.getCoreApi();
  hooks = { objects: new Map(), npcs: new Map(), items: new Map(), events: {}, death: [], drops: [], npcDeath: [], playerHit: [], npcHit: [], canBank: [] };
  const api = {
    core,
    persistAttribute() {},
    onObjectInteraction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.objects, `${name}:${op}`, fn); },
    onNpcInteraction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.npcs, `${name}:${op}`, fn); },
    onNpcDeath: (fn) => hooks.npcDeath.push(fn),
    onItemAction: (name, actions) => { for (const [op, fn] of Object.entries(actions)) chain(hooks.items, `${name}:${op}`, fn); },
    onPlayerHitModify: (fn) => hooks.playerHit.push(fn),
    onNpcHitModify: (fn) => hooks.npcHit.push(fn),
    onPlayerDeath: (fn) => hooks.death.push(fn),
    onShouldDropItemsOnDeath: (fn) => hooks.drops.push(fn),
    onPlayerLogin() {},
    onPlayerLogout: (fn) => (hooks.logout ??= []).push(fn),
    onPlayerDisconnect: (fn) => (hooks.disconnect ??= []).push(fn),
    onCanBank: (fn) => hooks.canBank.push(fn),
    onInterfaceActionClick: (fn) => { hooks.click = fn; },
    onCustomEvent: (name, fn) => { const prior = hooks.events[name]; hooks.events[name] = prior ? (e) => { prior(e); fn(e); } : fn; },
    emitCustomEvent: (name, payload) => {
      if (name === 'quest:is-complete') payload.complete = payload.player.quests?.has(payload.key) ?? false;
      else if (name === 'ironman:mode') payload.mode = payload.player.ironman ? 'ironman' : 'none';
      else hooks.events[name]?.(payload);
    },
    registerArea: (area) => { hooks.enclosure = area; },
    onInterfaceActionButton: (ids, fn) => { for (const id of [].concat(ids)) (hooks.buttons ??= new Map()).set(id, fn); },
  };
  require('../plugins/minigames/NightmareZone.plugin').register(api);
  Common = require('../plugins/minigames/nightmarezone/Common.NightmareZone');
  Dominic = require('../plugins/minigames/nightmarezone/Dominic.NightmareZone');
  Coffer = require('../plugins/minigames/nightmarezone/Coffer.NightmareZone');
  Dream = require('../plugins/minigames/nightmarezone/Dream.NightmareZone');
  Potions = require('../plugins/minigames/nightmarezone/Potions.NightmareZone');
  PowerUps = require('../plugins/minigames/nightmarezone/PowerUps.NightmareZone');
  Dream.engine.attack = (npc, player) => { npc.target = player; };
  Dream.engine.free = () => true;
});

beforeEach(() => {
  for (const player of [...Dream.dreams.keys()]) Dream.wake({ player });
  ticks(2);
});

function container(capacity = 28) {
  const slots = [];
  return {
    slots,
    add(item) { const stacks = item.getId() === 995; const slot = stacks && slots.find((s) => s.id === item.getId() && s.amount > 0); if (slot) slot.amount += item.getAmount(); else slots.push({ id: item.getId(), amount: item.getAmount() }); },
    delete(id, amount = 1) { for (const s of slots) { if (s.id !== id || amount <= 0) continue; const n = Math.min(s.amount, amount); s.amount -= n; amount -= n; } },
    getAmount: (id) => slots.filter((s) => s.id === id).reduce((sum, s) => sum + s.amount, 0),
    getFreeSlots: () => capacity - slots.filter((s) => s.amount > 0).length,
    getItems: () => slots.map((s) => (s.amount > 0 ? { getId: () => s.id, getAmount: () => s.amount, getMeta: () => s.meta ?? null } : null)),
    setItem(slot, item) { slots[slot] = { id: item.getId(), amount: item.getAmount(), meta: item.getMeta?.() ?? null }; },
    refreshItems() {},
  };
}

const QUESTS = () => Common.data.bosses.map((boss) => boss.quest);

function fakePlayer({ quests = QUESTS().slice(0, 12), coins = 0 } = {}) {
  const attributes = new Map();
  const p = {
    location: new Location(2608, 3116, 0), messages: [], varbits: new Map(), varps: new Map(), texts: new Map(), pages: [],
    quests: new Set(quests), inventory: container(),
    isPlayer: () => true, getAsPlayer: () => p, isRegistered: () => true, getUsername: () => 'Dreamer',
    getLocation: () => p.location, moveTo(l) { p.location = l; }, setLocation(l) { p.location = l; }, getArea: () => p.area, setArea(a) { p.area = a; },
    getPrivateArea: () => null, getIndex: () => 1,
    getAttribute: (k) => attributes.get(k), setAttribute: (k, v) => attributes.set(k, v),
    getInventory: () => p.inventory,
    sendMessage: (m) => p.messages.push(m),
    hp: 99, levels: {}, damage: [], special: 0,
    getHitpoints: () => p.hp, heal(amount) { p.hp = Math.min(99, p.hp + amount); },
    performAnimation() {}, setSpecialPercentage(v) { p.special = v; }, getSpecialPercentage: () => p.special,
    getCombat: () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => { for (const h of hits) { p.damage.push(h.getDamage()); p.hp -= h.getDamage(); } } }) }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => p.levels[skill.getName?.() ?? skill] ?? 99,
      getMaxLevel: () => 99,
      setCurrentLevel(skill, level) { p.levels[skill.getName?.() ?? skill] = level; return this; },
    }),
    setEnteredAmountAction(action) { p.amount = action; },
    getDialogueManager: () => (p.dialogue ??= dialogueManager(p)),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { p.varbits.set(id, value); return sender; },
        sendConfig: (id, value) => { p.varps.set(id, value); return sender; },
        sendString: (text, id) => { p.texts.set(id, text); return sender; },
        sendSubInterface: () => sender, closeSubInterface: () => sender, sendInterfaceScript: () => sender,
        sendInterface: (id) => { p.interface = id; return sender; },
        sendClientScript: (id, ...args) => { p.script = [id, ...args]; return sender; },
        sendInterfaceFlagsRange: () => sender, sendInterfaceRemoval: () => sender, sendSound: () => sender, sendSong: () => sender,
        sendEnterAmountPrompt: (text) => { p.prompt = text; return sender; },
        sendInventory: (id, capacity, items) => { (p.invs ??= {})[id] = items; return sender; },
      };
      return sender;
    },
  };
  if (coins) p.inventory.add(new core.Item(995, coins));
  return p;
}

function dialogueManager(p) {
  return {
    entries: null, index: -1,
    startDialogues(builder) { this.entries = builder.getDialogues(); this.startDialogue(0); },
    startDialogue(i) {
      this.index = i;
      const page = this.entries?.get(i);
      if (!page) { this.entries = null; return; }
      if (page.constructor.name === 'ActionDialogue') page.send(p);
      else if (page.constructor.name !== 'OptionDialogue') p.pages.push(page);
    },
    reset() { this.entries = null; this.index = -1; },
    current() { return this.entries?.get(this.index); },
    continueAll() { for (let n = 0; n < 200 && this.entries && this.current()?.constructor.name !== 'OptionDialogue'; n++) this.startDialogue(this.index + 1); },
    options() { return this.current()?.getOptions(); },
    title() { return this.current()?.getTitle(); },
    choose(option) { const menu = this.current(); this.reset(); menu.execute(option); },
  };
}

const pageText = (page) => page.text ?? page.getText?.();
const varbit = (p, name) => p.varbits.get(core.CacheDefinitions.getVarbitId(name));
const DOMINIC = { getId: () => 1120 };

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

function talk(p) {
  p.pages.length = 0;
  assert.ok(hooks.npcs.get('Dominic Onion:Talk-to')({ player: p, npc: DOMINIC }));
  p.getDialogueManager().continueAll();
}

/** Talk-to, "Can I choose a dream?", then `path` through the menus. */
function chooseDream(p, ...path) {
  talk(p);
  p.getDialogueManager().choose(4);
  p.getDialogueManager().continueAll();
  for (const option of path) {
    p.getDialogueManager().choose(option);
    p.getDialogueManager().continueAll();
  }
}

test('Dominic: the recorded greeting and menu; "Who are you?" and back to the menu', () => {
  const p = fakePlayer();
  talk(p);
  assert.equal(pageText(p.pages[0]), 'Welcome to the Nightmare Zone! Would you like me to create a dream for you?');
  assert.deepEqual(p.getDialogueManager().options(), ['Who are you?', 'What is this place?', 'Can you tell me about the dreams?', 'Can I choose a dream?', "I'll come back another time."]);
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  assert.equal(pageText(p.pages.at(-1)), 'Good times...');
  assert.equal(p.getDialogueManager().title(), 'Select an option');
});

test('an Endurance dream, normal: the price, "Agree to pay 1,000 coins?", prepared (code 124) and nothing taken yet', () => {
  const p = fakePlayer();
  chooseDream(p, 2, 1);
  assert.match(pageText(p.pages.at(-1)), /^For an Endurance dream, normal mode, I'll want 1,000 coins\./);
  assert.equal(p.getDialogueManager().title(), 'Agree to pay 1,000 coins?');
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  assert.equal(varbit(p, 'nzone_purchaseddream'), 124);
  assert.match(pageText(p.pages.at(-1)), /I'll deduct 1,000 coins from the coffer when you do\.$/);
  // Op3 with a dream prepared offers to cancel it.
  p.pages.length = 0;
  hooks.npcs.get('Dominic Onion:Dream')({ player: p, npc: DOMINIC });
  p.getDialogueManager().continueAll();
  assert.equal(pageText(p.pages[0]), "I've already created a dream for you. Do you want me to cancel it?");
  p.getDialogueManager().choose(1);
  p.getDialogueManager().continueAll();
  assert.equal(varbit(p, 'nzone_purchaseddream'), 0);
});

test('Practice: the boss list, an unfinished quest shown "not complete"; Trapped Soul is code 47', () => {
  const p = fakePlayer();
  chooseDream(p, 1, 1);
  const [, , title, labels] = p.script;
  assert.equal(title, 'Practice: Normal mode');
  const list = labels.split('|');
  assert.equal(list.length, 50);
  assert.equal(list[0], 'The Ascent of Arceuus: Trapped Soul');
  assert.equal(list[49], 'Dream Mentor: <col=ff0000>not complete</col>');
  hooks.click({ player: p, groupId: core.CacheDefinitions.getInterfaceId('menu'), childId: 3, slot: 0, handled: false });
  assert.equal(varbit(p, 'nzone_purchaseddream'), 47);
});

test('a dream needs five of the quests (Wiki)', () => {
  const p = fakePlayer({ quests: QUESTS().slice(0, 2) });
  chooseDream(p);
  assert.ok(p.messages.includes(Common.message('notEnoughQuests', { needed: 5 })));
});

test('the coffer: "The coffer is empty.", Deposit money., in thousands (nzone_cash 10000 for 10,000,000)', () => {
  const p = fakePlayer({ coins: 10_000_500 });
  hooks.objects.get("Dominic's coffer:Use")({ player: p });
  assert.equal(pageText(p.pages[0]), 'The coffer is empty.');
  p.getDialogueManager().continueAll();
  assert.equal(p.getDialogueManager().title(), "Dominic's Coffer (Empty)");
  assert.deepEqual(p.getDialogueManager().options(), ['Deposit money.', 'Cancel.']);
  p.getDialogueManager().choose(1);
  assert.equal(p.prompt, 'How much do you wish to deposit? (10,000,500)');
  p.amount.execute(10_000_500);
  assert.equal(varbit(p, 'nzone_cash'), 10000);
  assert.equal(Common.coffer(p), 10_000_000);
  assert.equal(p.inventory.getAmount(995), 500, 'only whole thousands go in');
  assert.equal(p.getDialogueManager().title(), "Dominic's Coffer (10,000,000 coins)");
  assert.deepEqual(p.getDialogueManager().options(), ['Deposit money.', 'Withdraw money.', 'Cancel.']);
});

test('the vial: "Start dream", the fee from the coffer, then the arena, a boss and points; the potion wakes you', () => {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setCoffer(p, 5000);
  Common.setPreparedDream(p, { mode: 'endurance', difficulty: 'normal' });
  hooks.objects.get('<col=ff9040>Potion:Drink')({ player: p, object: { getId: () => core.CacheDefinitions.getLocId('nzone_lobby_vial') } });
  assert.equal(p.getDialogueManager().title(), 'Start dream: Endurance');
  p.getDialogueManager().choose(1);
  assert.equal(Common.coffer(p), 4000);
  ticks(3);
  assert.ok(p.messages.includes('Welcome to the Nightmare Zone.'));
  const state = Dream.dreams.get(p);
  assert.deepEqual([p.location.getX() - state.area.getBaseX() + state.area.origin[0], p.location.getY() - state.area.getBaseY() + state.area.origin[1]], [2276, 4680]);
  assert.equal(varbit(p, 'nzone_purchaseddream'), 0);
  ticks(Common.data.arena.firstSpawnTicks);
  const [boss] = state.npcs;
  assert.equal(boss.getId(), core.CacheDefinitions.getNpcId('nzone_arceuusquest_soul_normal'));
  Dream.bossDied({ npc: boss });
  assert.equal(varbit(p, 'nzone_currentpoints'), 183, "every boss unlocked: the full figure, on the dream's counter");
  assert.equal(Common.points(p), 0, 'paid when the dream ends');
  assert.ok(Dream.wake({ player: p }));
  assert.equal(Common.points(p), 183);
  assert.equal(varbit(p, 'nzone_currentpoints'), 0);
  assert.deepEqual([p.location.getX(), p.location.getY()], [2608, 3115]);
  assert.equal(Dream.dreams.has(p), false);
});

test("bosses with several forms fight through them all (Witch's experiment); a death in a dream is safe", () => {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setPreparedDream(p, { mode: 'practice', difficulty: 'normal', boss: 6 });
  Dream.start(p);
  ticks(3 + Common.data.arena.firstSpawnTicks);
  const state = Dream.dreams.get(p);
  for (const form of ['shapeshifterglob', 'shapeshifterspider', 'shapeshifterbear', 'shapeshifterwolf']) {
    const [npc] = state.npcs;
    assert.equal(npc.getId(), core.CacheDefinitions.getNpcId(`nzone_${form}_normal`));
    Dream.bossDied({ npc });
  }
  assert.equal(state.npcs.size, 0);
  assert.equal(Common.points(p), 0, 'Practice gives no points');
  const again = fakePlayer({ quests: QUESTS() });
  Common.setCoffer(again, 6000);
  Common.setPreparedDream(again, { mode: 'rumble', difficulty: 'hard' });
  Dream.start(again);
  ticks(3 + Common.data.arena.firstSpawnTicks);
  assert.equal(Dream.dreams.get(again).npcs.size, Common.data.rumbleBosses);
  const event = { player: again, handled: false };
  for (const fn of hooks.death) fn(event);
  assert.equal(event.handled, true);
  assert.equal(Dream.dreams.has(again), false);
  assert.deepEqual([again.location.getX(), again.location.getY()], [2608, 3115]);
});

// ------------------------------------------------------------------ potions and power-ups

/** A player in a running Rumble with every boss unlocked. */
function dreamer() {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setCoffer(p, 2000);
  Common.setPreparedDream(p, { mode: 'rumble', difficulty: 'normal' });
  Dream.start(p);
  ticks(3);
  return p;
}

const drink = (p, id) => hooks.items.get(`${core.CacheDefinitions.getItem(id).name}:Drink`)({ player: p, itemId: id });

test("absorption: only in a dream; 50 a dose up to 1,000; it takes monsters' damage first and is gone after the dream", () => {
  const outside = fakePlayer();
  outside.inventory.add(new core.Item(11734, 1));
  assert.ok(drink(outside, 11734));
  assert.ok(outside.messages.includes(Common.message('onlyInDream')));
  assert.equal(outside.inventory.getAmount(11734), 1);
  const p = dreamer();
  p.inventory.add(new core.Item(11734, 1));
  drink(p, 11734);
  assert.equal(varbit(p, 'nzone_absorb_potion_effects'), 50);
  assert.equal(p.inventory.getAmount(11735), 1, 'the next dose is left');
  for (let i = 0; i < 25; i++) {
    p.inventory.add(new core.Item(11737, 1));
    drink(p, 11737);
  }
  assert.equal(varbit(p, 'nzone_absorb_potion_effects'), 1000, 'capped');
  let total = 30;
  const hit = { getTotalDamage: () => total, setTotalDamage(d) { total = d; }, getAttacker: () => ({ isNpc: () => true }) };
  for (const fn of hooks.playerHit) fn({ player: p, hit });
  assert.equal(total, 0);
  assert.equal(varbit(p, 'nzone_absorb_potion_effects'), 970);
  Dream.wake({ player: p });
  assert.equal(varbit(p, 'nzone_absorb_potion_effects'), 0);
});

test('real executeHit protects before absorption spends points', () => {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { CombatFactory } = require('../dist/game/content/combat/CombatFactory');
  const { PendingHit } = require('../dist/game/content/combat/hit/PendingHit');
  const { CombatType } = require('../dist/game/content/combat/CombatType');

  const channel = { isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel), new core.Location(2608, 3116, 0));
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.setHitpoints(99);
  player.setAutoRetaliate(false);
  player.getSkillManager().setMaxLevel(core.Skill.PRAYER, 99);
  player.getSkillManager().setCurrentLevel(core.Skill.PRAYER, 99, false);
  player.getPrayerActive()[core.PrayerHandler.PROTECT_FROM_MELEE] = true;
  player.setAttribute('nightmare-zone:absorb', 50);

  const npc = new core.NPC(1, new core.Location(2608, 3117, 0));
  npc.setRegistered(true);
  npc.setHitpoints(100);

  const method = { type: () => CombatType.MELEE, accuracyDefenceType: () => undefined, handleAfterHitEffects() {} };
  const hit = new PendingHit(npc, player, method, {
    damage: 20, rollAccuracy: false, experience: false, handleAfterHitEffects: false,
  });

  Common.dreams.set(player, { player });
  PluginManager.createApi('NightmareZoneOrderRegression').onPlayerHitModify(Potions.absorb);
  try {
    CombatFactory.executeHit(hit);
  } finally {
    Common.dreams.delete(player);
  }

  assert.equal(Potions.absorbOf(player), 50, 'the prayer blocked the 20 before absorption could spend points');
  assert.equal(player.getHitpoints(), 99, 'the protected hit dealt no damage');
});

test('overload: not under 51 Hitpoints; +floor(15%)+5 to the combat skills, 50 damage of its own, 5 minutes, 50 back at the end', () => {
  const p = dreamer();
  p.hp = 50;
  p.inventory.add(new core.Item(11730, 1));
  drink(p, 11730);
  assert.ok(p.messages.includes(Common.message('overloadLowHp', { hp: 51 })));
  p.hp = 99;
  drink(p, 11730);
  assert.equal(p.levels.Strength, 99 + 14 + 5);
  assert.equal(varbit(p, 'nzone_overload_potion_effects'), 20);
  ticks(10);
  assert.deepEqual(p.damage.slice(0, 5), [10, 10, 10, 10, 10]);
  ticks(500);
  assert.equal(varbit(p, 'nzone_overload_potion_effects'), 0);
  assert.equal(p.levels.Strength, 99);
  assert.ok(p.messages.includes(Common.message('overloadEnds')));
  Dream.wake({ player: p });
});

test('barrels: Store takes every dose of the potion carried; Check counts them; Take makes potions of 4', () => {
  const p = fakePlayer();
  const barrel = { getDefinition: () => ({ getName: () => 'Absorption potion' }) };
  p.inventory.add(new core.Item(11734, 1));
  p.inventory.add(new core.Item(11736, 1));
  hooks.objects.get('Absorption potion:Store')({ player: p, object: barrel });
  assert.equal(varbit(p, 'nzone_potion_4'), 6);
  assert.equal(p.inventory.getAmount(11734) + p.inventory.getAmount(11736), 0);
  hooks.objects.get('Absorption potion:Check')({ player: p, object: barrel });
  assert.equal(pageText(p.pages.at(-1)), 'This barrel contains 6 doses of absorption potion.');
  hooks.objects.get('Absorption potion:Take')({ player: p, object: barrel });
  p.amount.execute(6);
  assert.equal(p.inventory.getAmount(11734), 1);
  assert.equal(p.inventory.getAmount(11736), 1);
  assert.equal(varbit(p, 'nzone_potion_4'), 0);
});

test('power-ups: one appears in a Rumble; Power surge fills the special bar; Ultimate force kills everything for no points', () => {
  const p = dreamer();
  ticks(Common.data.arena.firstSpawnTicks);
  const state = Dream.dreams.get(p);
  ticks(Common.data.powerUps.spawnEvery[1] + 1);
  const power = PowerUps.powerState(state);
  assert.ok(power.floor, 'a power-up is on the floor');
  power.floor.kind = 'surge';
  assert.ok(PowerUps.activate({ player: p, object: power.floor.object }));
  assert.equal(p.special, 100);
  assert.equal(power.floor, null);
  const before = [...state.npcs];
  PowerUps.nuke(state);
  assert.ok(before.length > 0 && before.every((npc) => npc.__noPoints));
  for (const npc of before) Dream.bossDied({ npc });
  assert.equal(varbit(p, 'nzone_currentpoints'), 0, 'no points');
  Dream.wake({ player: p });
});

test('Recurrent damage: a hit the dreamer lands brings another of 3/4 of it, a tick later', () => {
  const p = dreamer();
  ticks(Common.data.arena.firstSpawnTicks);
  const state = Dream.dreams.get(p);
  PowerUps.powerState(state).active.recurrent = state.tick + 75;
  const [npc] = state.npcs;
  const queued = [];
  npc.getCombat = () => ({ getHitQueue: () => ({ addPendingDamage: (hits) => queued.push(...hits.map((h) => h.getDamage())) }) });
  for (const fn of hooks.npcHit) fn({ npc, hit: { getAttacker: () => p, getTotalDamage: () => 35 } });
  ticks(1);
  assert.deepEqual(queued, [26]);
  Dream.wake({ player: p });
});

// ------------------------------------------------------------------ rewards

const button = (name, event) => hooks.buttons.get(core.CacheDefinitions.getComponentId(`nzone_rewards:${name}`))(event);

test('the rewards chest: the recorded opening (invs 464 and 108, the modal, the panes\' ops)', () => {
  const p = fakePlayer();
  assert.ok(hooks.objects.get('Rewards chest:Search')({ player: p, object: { getId: () => core.CacheDefinitions.getLocId('nzone_lobby_chest') } }));
  assert.equal(p.invs[464].find((item) => item.id === 1779).amount, 75, 'flax: 75 points');
  assert.equal(p.invs[464].find((item) => item.id === 11737).amount, 1000, 'absorption: 1,000 a dose');
  assert.equal(p.invs[108].find((item) => item.id === 11864).amount, 1250, 'slayer helmet: 1,250,000 / 1000');
  assert.equal(hooks.objects.get('Rewards chest:Search')({ player: p, object: { getId: () => 1 } }), false, 'only its own chest');
});

test('Resources: Buy-10 of flax (sub 0) gives noted flax for 750 points; too few points buys nothing', () => {
  const p = fakePlayer();
  Common.addPoints(p, 1000);
  button('resources', { player: p, slot: 0, opId: 3 });
  assert.equal(p.inventory.getAmount(1780), 10);
  assert.equal(Common.points(p), 250);
  button('resources', { player: p, slot: 0, opId: 3 });
  assert.ok(p.messages.includes(Common.message('notEnoughPoints')));
  assert.equal(p.inventory.getAmount(1780), 10);
});

test('Benefits: Buy-5 of absorption (sub 9) puts 5 doses in its barrel for 5,000 points', () => {
  const p = fakePlayer();
  Common.addPoints(p, 6000);
  button('benefits', { player: p, slot: 9, opId: 2 });
  assert.equal(varbit(p, 'nzone_potion_4'), 5);
  assert.equal(Common.points(p), 1000);
});

test('Upgrades: Imbue (sub = 2 x the backpack slot) quotes the price when short, as recorded, and imbues when not', () => {
  const p = fakePlayer();
  p.inventory.slots.push({ id: 995, amount: 1 }, { id: 11864, amount: 1 });
  button('upgrades', { player: p, slot: 2, opId: 1 });
  assert.ok(p.messages.includes('Slayer helmet: This item costs 1,250,000 points to imbue.'));
  Common.addPoints(p, 1_300_000);
  button('upgrades', { player: p, slot: 2, opId: 1 });
  assert.equal(p.inventory.slots[1].id, 11865, 'the slayer helmet (i)');
  assert.equal(Common.points(p), 50_000);
});

test('a logout during the entry fade cancels the dream: the fee back in the coffer, the dream still prepared', () => {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setCoffer(p, 5000);
  Common.setPreparedDream(p, { mode: 'endurance', difficulty: 'normal' });
  Dream.start(p);
  assert.equal(Common.coffer(p), 4000);
  ticks(1);
  for (const fn of hooks.logout) fn({ player: p });
  p.isRegistered = () => false;
  ticks(3);
  assert.equal(Dream.dreams.has(p), false);
  assert.equal(Common.coffer(p), 5000, 'the fee is back');
  assert.deepEqual(Common.preparedDream(p), { mode: 'endurance', difficulty: 'normal' });
  assert.deepEqual([p.location.getX(), p.location.getY()], [2608, 3116], 'never moved into the arena');
});

test('a logout on the very first tick of the fade keeps the dream prepared too', () => {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setPreparedDream(p, { mode: 'practice', difficulty: 'normal', boss: 1 });
  Dream.start(p);
  for (const fn of hooks.logout) fn({ player: p });
  p.isRegistered = () => false;
  ticks(4);
  assert.deepEqual(Common.preparedDream(p), { mode: 'practice', difficulty: 'normal', boss: 1 });
  assert.equal(Dream.dreams.has(p), false);
});

test('Upgrades: an imbue keeps what the item carries (a charged ring of suffering, a preset)', () => {
  const p = fakePlayer();
  p.inventory.slots.push({ id: 20655, amount: 1, meta: { 'ring-of-suffering': 1000, preset: true } });
  Common.addPoints(p, 725_000);
  button('upgrades', { player: p, slot: 0, opId: 1 });
  assert.equal(p.inventory.slots[0].id, 20657);
  assert.deepEqual(p.inventory.slots[0].meta, { 'ring-of-suffering': 1000, preset: true });
});

test('a dropped connection during the entry fade cancels the dream and refunds the fee too', () => {
  const p = fakePlayer({ quests: QUESTS() });
  Common.setCoffer(p, 5000);
  Common.setPreparedDream(p, { mode: 'endurance', difficulty: 'normal' });
  Dream.start(p);
  assert.equal(Common.coffer(p), 4000);
  ticks(1);
  for (const fn of hooks.disconnect) fn({ player: p, username: 'Dreamer', source: 'connection-lost' });
  p.isRegistered = () => false;
  ticks(3);
  assert.equal(Dream.dreams.has(p), false);
  assert.equal(Common.coffer(p), 5000, 'the fee is back');
  assert.deepEqual(Common.preparedDream(p), { mode: 'endurance', difficulty: 'normal' });
  assert.deepEqual([p.location.getX(), p.location.getY()], [2608, 3116], 'never moved into the arena');
});

test('a dropped connection inside a dream ends it, pays its points and leaves nothing in the instance', () => {
  const p = dreamer();
  ticks(Common.data.arena.firstSpawnTicks);
  const [boss] = Dream.dreams.get(p).npcs;
  Dream.bossDied({ npc: boss });
  const earned = varbit(p, 'nzone_currentpoints');
  assert.ok(earned > 0, 'a boss was killed before the connection dropped');
  assert.equal(Dream.dreams.has(p), true);
  for (const fn of hooks.disconnect) fn({ player: p, username: 'Dreamer', source: 'connection-lost' });
  assert.equal(Dream.dreams.has(p), false);
  assert.equal(varbit(p, 'nzone_currentpoints'), 0);
  assert.equal(Common.points(p), earned, 'the dream is paid as it ends');
  assert.deepEqual([p.location.getX(), p.location.getY()], [2608, 3115], 'saved by Dominic');
});

test('banking is refused inside a dream and allowed outside it', () => {
  const outside = fakePlayer();
  const allowed = { player: outside, allow: true };
  for (const fn of hooks.canBank) fn(allowed);
  assert.equal(allowed.allow, true, 'no dream, no refusal');
  assert.equal(outside.messages.includes(Common.message('noBank')), false);

  const p = dreamer();
  const refused = { player: p, allow: true, source: 'open' };
  for (const fn of hooks.canBank) fn(refused);
  assert.equal(refused.allow, false);
  assert.ok(p.messages.includes(Common.message('noBank')));
  Dream.wake({ player: p });
});
