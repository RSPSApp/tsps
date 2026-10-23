// Cabin Fever (q009) route contract. From server/: node --test tests/qh728-q009.test.cjs
// Fixture start: every skill meets the quest levels; completed quests are set explicitly.
// The transcript runner is captured (not animated) and its action steps are dispatched
// through the same npc-dialogue:action hook the dialogue runtime uses.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(
    require('node:path').resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const groundItemDefinitions = require('../data/definitions/ground-items.json');

const transcripts = [];
runtime.startTranscript = (_api, player, npcId, page, variant, select) => {
  transcripts.push({ player, npcId, page, variant, select });
  return true;
};

function setup(completed = []) {
  transcripts.length = 0;
  const completedQuests = new Set(completed);
  const custom = new Map();
  const hooks = { conditions: [], variants: [], npcActions: {}, object: [], itemOnObject: [], groundItemPickup: [] };
  let tick = 0;
  const tasks = [];
  const api = new Proxy({
    core: {
      ...core,
      CountdownTask: class {
        constructor(player, ticks, run) { Object.assign(this, { player, ticks, run }); }
      },
      TaskManager: {
        submit(task) { task.due = tick + task.ticks; tasks.push(task); },
        cancelTasks() {},
      },
      MultiChatboxPrompt: { getPending: () => null },
    },
    persistAttribute() {},
    onNpcDialogueVariant(handler) { hooks.variants.push(handler); },
    onNpcDialogueCondition(handler) { hooks.conditions.push(handler); },
    onNpcInteraction(_names, actions) { Object.assign(hooks.npcActions, actions); },
    onObjectInteraction(handler) { hooks.object.push(handler); },
    onItemOnObject(handler) { hooks.itemOnObject.push(handler); },
    onGroundItemPickup(handler) { hooks.groundItemPickup.push(handler); },
    onCustomEvent(name, handler) {
      const handlers = custom.get(name) ?? [];
      handlers.push(handler);
      custom.set(name, handlers);
    },
    emitCustomEvent(name, event) {
      if (name === 'quest:is-complete' && completedQuests.has(event.key)) event.complete = true;
      for (const handler of custom.get(name) ?? []) handler(event);
    },
  }, { get(target, key) { return key in target ? target[key] : () => {}; } });
  require('../plugins/quests/quests/CabinFever.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'cabin_fever');

  const attributes = new Map();
  const inventory = new Map();
  let full = false;
  let packet;
  packet = new Proxy({
    varps: new Map(),
    varbits: new Map(),
    sendConfig(id, value) { packet.varps.set(id, value); return packet; },
    getVarp(id) { return packet.varps.get(id) ?? 0; },
    sendVarbit(id, value) { packet.varbits.set(id, value); return packet; },
    getVarbit(id) { return packet.varbits.get(id) ?? 0; },
  }, { get(target, key) { return key in target ? target[key] : () => packet; } });
  let location = new core.Location(3678, 3494, 0);
  const player = {
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getPacketSender: () => packet,
    getInventory: () => ({
      getAmount: (id) => inventory.get(id) ?? 0,
      // A full inventory refuses a new stack (the real ItemContainer.adds sends
      // "You couldn't hold all those items." and adds nothing).
      adds: (id, amount) => {
        if (full && !inventory.has(id)) return false;
        inventory.set(id, (inventory.get(id) ?? 0) + amount);
        return true;
      },
      deleteNumber: (id, amount) => inventory.set(id, Math.max(0, (inventory.get(id) ?? 0) - amount)),
      isFull: () => full,
      getFreeSlots: () => (full ? 0 : 28),
    }),
    getSkillManager: () => ({
      getMaxLevel: (skill) =>
        skill === core.Skill.AGILITY ? 42
          : skill === core.Skill.CRAFTING ? 45
            : skill === core.Skill.SMITHING ? 50
              : skill === core.Skill.RANGED ? 40 : 0,
      addExperiences() {},
    }),
    getLocation: () => location,
    moveTo(next) { location = next; },
    getDialogueManager: () => ({ isActive: () => false }),
    isRegistered: () => true,
    sendMessage() {},
    getUsername: () => 'qh728-q009',
  };
  const emit = (name, event) => {
    for (const handler of custom.get(name) ?? []) handler({ player, handled: false, ...event });
  };
  const choose = (option, npcId = core.NpcIdentifiers.BILL_TEACH) => emit('npc-dialogue:choice', { npcId, option });
  const action = (stepId) => emit('npc-dialogue:action', { stepId });
  const condition = (stepId) => hooks.conditions[0]({ player, stepId });
  const variant = (npcId = core.NpcIdentifiers.BILL_TEACH_3) => hooks.variants[0]({ player, npcId });
  const object = (objectId, option) => hooks.object[0]({
    player,
    objectId,
    clickType: 1,
    definition: { getActions: () => [option] },
    handled: false,
  });
  const itemOnObject = (itemId, objectId) => hooks.itemOnObject[0]({ player, itemId, objectId, handled: false });
  const pickup = (groundItemId, x, y, z) => {
    const event = { player, groundItem: {}, groundItemId, location: { x, y, z }, handled: false };
    hooks.groundItemPickup.forEach((handler) => handler(event));
    return event;
  };
  const npcTalk = (npcId) => hooks.npcActions['Talk-to']({
    player,
    npcId,
    clickType: 1,
    definition: { getName: () => 'Bill Teach', getActions: () => ['Talk-to'] },
    handled: false,
  });
  const advance = (steps = 3) => {
    for (let step = 0; step < steps; step++) {
      tick++;
      for (const task of [...tasks]) {
        if (task.due <= tick && !task.done) { task.done = true; task.run(); }
      }
    }
  };
  const count = (id) => inventory.get(id) ?? 0;
  const varbit = (id) => packet.getVarbit(id);
  const varp = (id) => packet.getVarp(id);
  const stage = () => quest.getStage(player);
  const lastTranscript = () => transcripts.at(-1);
  return {
    quest, player, choose, action, condition, variant, object, itemOnObject, pickup, npcTalk, advance,
    complete: (key) => completedQuests.add(key),
    bootstrap: () => {
      emit('player:bootstrap-complete', {});
      runtime.sendQuestVarps({ player });
    },
    count, varbit, varp, stage, lastTranscript,
    setFullInventory: (value) => { full = value; },
  };
}

test('Cabin Fever starts only after the final confirmation and requires Priest in Peril', () => {
  const h = setup(['pirates_treasure', 'rum_deal']);

  h.choose("Yes, I've always wanted to be a pirate!");
  assert.equal(h.stage(), 0, 'the first yes alone does not start the quest');
  assert.equal(h.condition('tOUrYm'), true, 'missing Priest in Peril fails the start requirement');

  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 0, 'missing Priest in Peril cannot start the quest');

  h.complete('priest_in_peril');
  assert.equal(h.condition('tOUrYm'), false);
  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 1, 'the final confirmation starts the quest');
});

test('declining the final confirmation leaves Cabin Fever unstarted', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);

  h.choose("Yes, I've always wanted to be a pirate!");
  h.choose('No, if it\'s so dangerous your crew left, count me out.');
  assert.equal(h.stage(), 0, 'declining Bill does not start the quest');

  h.choose("Yes, I've always wanted to be a pirate!");
  h.choose('Yes, I am a man of my word.');
  assert.equal(h.stage(), 1);
});

test('Cabin Fever completes from stage 0 through the real route handlers', () => {
  const originalRandom = Math.random;
  Math.random = () => 0; // Fixture: every cannon shot hits.
  try {
    const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
    const I = core.ItemIdentifiers;
    const N = core.NpcIdentifiers;
    const O = core.ObjectIdentifiers;
    // Object ids below are the cache's registered multi-loc parents/placements.
    const CANNON = 11213;
    const ENEMY_POWDER_BARREL = 11237;
    const FUSE_1 = 11241;
    const HOISTS = 11292;
    const CHEST = 11230;
    const CRATE = 11227;
    const BARREL = 11233;
    const HOLES = [11221, 11222, 11223];

    // Start and set sail.
    h.choose("Yes, I've always wanted to be a pirate!");
    h.choose('Yes, I am a man of my word.');
    assert.equal(h.stage(), 1);
    assert.equal(h.varp(655), 10, 'started wire value');
    h.npcTalk(N.BILL_TEACH_3);
    h.choose("Let's go Cap'n!");
    h.advance();
    assert.equal(h.stage(), 2);
    assert.equal(h.varp(655), 20, 'sailing wire value');
    assert.equal(h.lastTranscript().variant, 'cutscene-on-the-ship');
    h.action('cabin-fever:arrive');
    assert.equal(h.stage(), 3);
    assert.equal(h.varp(655), 30, 'sabotage wire value');
    assert.equal(h.varbit(1741), 2, 'the cannon arrives stripped');

    // Sabotage supplies and the enemy cannon.
    h.object(O.REPAIR_LOCKER, 'Open');
    h.object(O.GUN_LOCKER, 'Open');
    assert.equal(h.count(I.ROPE), 4);
    assert.equal(h.count(I.FUSE), 4);
    const tinderbox = h.pickup(I.TINDERBOX_3, 1814, 4825, 0);
    assert.equal(tinderbox.handled, true);
    assert.equal(h.count(I.TINDERBOX), 1);
    h.object(O.CLIMBING_NET_2, 'Climb');
    h.itemOnObject(I.ROPE, HOISTS);
    assert.equal(h.player.getLocation().getZ(), 1, 'swung onto the enemy deck');
    assert.equal(h.count(I.ROPE), 3, 'one ordinary rope is used per swing');
    h.itemOnObject(I.FUSE, ENEMY_POWDER_BARREL);
    assert.equal(h.varbit(1761), 1, 'fuse attached');
    h.itemOnObject(I.TINDERBOX, FUSE_1);
    h.action('jL6Wr9');
    assert.equal(h.varbit(1749), 1, 'enemy cannon destroyed');
    h.object(O.CLIMBING_NET_2, 'Climb');
    h.itemOnObject(I.ROPE, HOISTS);
    assert.equal(h.count(I.ROPE), 2, 'the return swing uses a second rope');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 4);
    assert.equal(h.varp(655), 50, 'repair-phase wire value');

    // Patch and waterproof all three hull holes.
    for (const hole of HOLES) {
      h.itemOnObject(I.REPAIR_PLANK, hole);
      h.itemOnObject(I.SWAMP_PASTE, hole);
    }
    assert.equal(h.varbit(1759), 3);
    assert.equal(h.varbit(1760), 3);
    assert.equal(h.count(I.REPAIR_PLANK), 0);
    assert.equal(h.count(I.TACKS), 0);
    assert.equal(h.count(I.SWAMP_PASTE), 0);
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 5);
    assert.equal(h.varp(655), 70, 'plunder-phase wire value');

    // Swing back to the enemy ship, loot 6, relog to respawn, loot 5 more,
    // then swing back with 10 stored and 1 surplus.
    h.object(O.CLIMBING_NET_2, 'Climb');
    h.itemOnObject(I.ROPE, HOISTS);
    assert.equal(h.count(I.ROPE), 1, 'the looting trip uses a third rope');
    assert.equal(h.player.getLocation().getZ(), 1, 'back on the enemy deck');
    h.object(CHEST, 'Plunder');
    h.object(CRATE, 'Loot');
    h.object(BARREL, 'Ransack');
    assert.equal(h.count(I.PLUNDER), 6);
    h.bootstrap();
    h.object(CHEST, 'Plunder');
    h.object(CRATE, 'Loot');
    assert.equal(h.count(I.PLUNDER), 11);
    h.object(O.CLIMBING_NET_2, 'Climb');
    h.itemOnObject(I.ROPE, HOISTS);
    assert.equal(h.count(I.ROPE), 0, 'the return swing uses the fourth rope');
    h.itemOnObject(I.PLUNDER, O.PLUNDER_STORAGE);
    assert.equal(h.varbit(1752), 10);
    assert.equal(h.count(I.PLUNDER), 1, 'surplus stays for Bill to confiscate');
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 6);
    assert.equal(h.varp(655), 90, 'barrel-phase wire value');

    // Replace the cannon barrel.
    h.object(O.GUN_LOCKER, 'Open');
    assert.equal(h.count(I.CANNON_BARREL), 1);
    h.itemOnObject(I.CANNON_BARREL, CANNON);
    assert.equal(h.varbit(1741), 0);
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 7);
    assert.equal(h.varp(655), 110, 'canister-phase wire value');

    // Fire canister rounds until three pirates are hit, cleaning between shots.
    h.object(O.GUN_LOCKER, 'Open');
    assert.equal(h.count(I.RAMROD), 1);
    assert.equal(h.count(I.CANISTER), 1);
    for (let hit = 1; hit <= 3; hit++) {
      h.itemOnObject(I.RAMROD, CANNON);
      h.object(O.POWDER_BARREL_2, 'Take-powder');
      h.itemOnObject(I.GUNPOWDER, CANNON);
      h.itemOnObject(I.RAMROD, CANNON);
      if (h.count(I.CANISTER) === 0) h.object(O.GUN_LOCKER, 'Open');
      h.itemOnObject(I.CANISTER, CANNON);
      if (h.count(I.FUSE) === 0) h.object(O.GUN_LOCKER, 'Open');
      h.itemOnObject(I.FUSE, CANNON);
      assert.equal(h.varbit(1741), 3, 'cannon armed');
      h.object(CANNON, 'Fire!');
      assert.match(h.lastTranscript().variant, /firing-the-cannon$/);
      if (hit < 3) {
        h.variant(N.BILL_TEACH_3);
        assert.equal(h.stage(), 7, 'Bill only moves on after the third canister hit');
      }
    }
    h.variant(N.BILL_TEACH_3);
    assert.equal(h.stage(), 8);
    assert.equal(h.varp(655), 130, 'cannonball-phase wire value');

    // Fire three cannonballs, cleaning between shots.
    h.object(O.GUN_LOCKER, 'Open');
    assert.equal(h.count(I.CANNON_BALL_2), 4);
    for (let shot = 1; shot <= 3; shot++) {
      h.itemOnObject(I.RAMROD, CANNON);
      h.object(O.POWDER_BARREL_2, 'Take-powder');
      h.itemOnObject(I.GUNPOWDER, CANNON);
      h.itemOnObject(I.RAMROD, CANNON);
      h.itemOnObject(I.CANNON_BALL_2, CANNON);
      h.itemOnObject(I.FUSE, CANNON);
      h.object(CANNON, 'Fire!');
      assert.equal(h.varbit(1750), shot);
    }
    assert.equal(h.lastTranscript().variant, 'sinking-the-enemy-ship-after-the-third-and-final-hit');

    // End cutscene and rewards.
    h.action('7Zv7QG');
    h.advance();
    assert.equal(h.lastTranscript().variant, 'end-of-quest-cutscene');
    h.action('V-4Bls');
    assert.equal(h.stage(), 9);
    assert.equal(h.varp(655), 140, 'canonical Cabin Fever completion varp');
    assert.ok(h.varp(655) >= 140, 'completion wire reaches the cache threshold');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.player.getLocation().getX(), 3665, 'arrived at Mos Le\'Harmless');
    assert.equal(h.count(I.ROPE), 0, 'the four supplied ropes were used for the four swings');

    // Post-quest: claim the 10,000 coins once, then recover a lost Book o' Piracy.
    assert.equal(
      h.variant(N.BILL_TEACH_4),
      'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest'
    );
    h.action('RMIMnr');
    assert.equal(h.count(I.COINS), 10000);
    assert.equal(
      h.variant(N.BILL_TEACH_4),
      'standard-dialogue-after-completing-cabin-fever-on-board-the-adventurous'
    );

    h.player.getInventory().deleteNumber(I.BOOK_O_PIRACY, 1);
    assert.equal(h.condition('hO36Ny'), true, 'lost book condition');
    h.action('5mdRTN');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1, 'replacement book');

    // Repeat completion and relog must not duplicate the reward.
    h.action('V-4Bls');
    assert.equal(h.stage(), 9);
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.count(I.COINS), 10000);
    h.bootstrap();
    assert.equal(h.stage(), 9);
    assert.equal(h.varp(655), 140, 'login re-sends the canonical completion varp');
    assert.equal(h.count(I.BOOK_O_PIRACY), 1);
    assert.equal(h.count(I.COINS), 10000);
  } finally {
    Math.random = originalRandom;
  }
});

test('completion removes quest supplies but leaves rope, hammer, tinderbox and swamp paste', () => {
  // Fixture start: the final cutscene stage, with one extra rope and leftover supplies.
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  h.quest.setStage(h.player, 8);
  const inventory = h.player.getInventory();
  inventory.adds(I.ROPE, 1);
  inventory.adds(I.FUSE, 1);
  inventory.adds(I.CANNON_BALL_2, 1);
  inventory.adds(I.HAMMER, 1);
  inventory.adds(I.TINDERBOX, 1);
  inventory.adds(I.SWAMP_PASTE, 1);

  h.action('V-4Bls');
  assert.equal(h.stage(), 9);
  assert.equal(h.count(I.ROPE), 1, 'rope is excluded from the cleanup');
  assert.equal(h.count(I.HAMMER), 1, 'hammer is excluded from the cleanup');
  assert.equal(h.count(I.TINDERBOX), 1, 'tinderbox is excluded from the cleanup');
  assert.equal(h.count(I.SWAMP_PASTE), 1, 'swamp paste is excluded from the cleanup');
  assert.equal(h.count(I.FUSE), 0);
  assert.equal(h.count(I.CANNON_BALL_2), 0);
});


test('old Cabin Fever saves restore the canonical completion varp on login', () => {
  // Fixture: a durable save written with the old internal stage 9 and no new wire mapping.
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  h.player.setAttribute('quest.cabin_fever.stage', 9);
  assert.equal(h.varp(655), 0, 'no wire value before the login bootstrap');

  h.bootstrap();
  assert.equal(h.stage(), 9, 'the internal durable stage is preserved');
  assert.equal(h.varp(655), 140, 'the login bootstrap sends the canonical completion value');
  assert.ok(h.varp(655) >= 140);
});

test('the once-only coin claim is not consumed when the coins cannot fit', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const N = core.NpcIdentifiers;
  h.quest.setStage(h.player, 9);
  h.setFullInventory(true);

  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest'
  );
  h.action('RMIMnr');
  assert.equal(h.count(I.COINS), 0, 'no coins were added to the full inventory');
  assert.equal(h.varbit(1765), 0, 'the claim is not consumed when the coins do not fit');
  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'end-of-quest-cutscene-claiming-the-loot-from-bill-teach-after-the-quest',
    'the claim stays available for a retry'
  );

  h.setFullInventory(false);
  h.action('RMIMnr');
  assert.equal(h.count(I.COINS), 10000, 'the coins are granted once the bag has room');
  assert.equal(h.varbit(1765), 1, 'the claim is consumed once the coins landed');
  assert.equal(
    h.variant(N.BILL_TEACH_4),
    'standard-dialogue-after-completing-cabin-fever-on-board-the-adventurous'
  );
});

test('permanent Cabin Fever floor piles return ordinary rope and tinderbox and retry when full', () => {
  const h = setup(['pirates_treasure', 'rum_deal', 'priest_in_peril']);
  const I = core.ItemIdentifiers;
  const ropePile = groundItemDefinitions.find(({ id, location }) => id === I.ROPE_5
    && location.x === 1822 && location.y === 4827 && location.z === 1);
  const tinderPile = groundItemDefinitions.find(({ id, location }) => id === I.TINDERBOX_3
    && location.x === 1814 && location.y === 4825 && location.z === 0);
  assert.equal(ropePile?.respawn, 0, 'the canonical enemy-deck rope is permanent');
  assert.equal(tinderPile?.respawn, 0, 'the canonical hold tinderbox is permanent');

  h.setFullInventory(true);
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 0, 'a full bag leaves the rope pile available');
  assert.equal(h.pickup(I.TINDERBOX_3, 1814, 4825, 0).handled, true);
  assert.equal(h.count(I.TINDERBOX), 0, 'a full bag leaves the tinderbox pile available');

  h.setFullInventory(false);
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 1, 'the quest display variant gives an ordinary rope');
  assert.equal(h.pickup(I.ROPE_5, 1822, 4827, 1).handled, true);
  assert.equal(h.count(I.ROPE), 2, 'the permanent pile supports later loss recovery');
  assert.equal(h.pickup(I.TINDERBOX_3, 1814, 4825, 0).handled, true);
  assert.equal(h.count(I.TINDERBOX), 1, 'the hold pile gives an ordinary tinderbox');
});
