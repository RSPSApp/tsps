// Holy Grail route and mechanics contract.
// From server/: node --test tests/holy-grail.test.cjs
//
// Drives the plugin's registered handlers from stage 0 to completion along the
// OSRS Wiki / Quest Helper route. Dialogue playback is simulated by dispatching
// the choice texts and step ids exported in npc-dialogues.json ("Holy Grail"),
// not by running the dialogue UI. World pieces (ground items, the Titan, the
// whistle and bell, the feather) are exercised through the same handlers with
// small fakes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

require('node:test').before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
});
const { PluginManager } = require('../dist/plugins/PluginManager');
const runtime = require('../plugins/quests/QuestRuntime');
const core = PluginManager.getCoreApi();
const noop = () => {};

const I = core.ItemIdentifiers;
const N = core.NpcIdentifiers;
const VARP = 5;

const transcripts = [];
runtime.startTranscript = (_api, _player, npcId, page, variant, _select, npc) => {
  transcripts.push({ npcId, page, variant, npc });
  return true;
};

function makePlayer() {
  const items = new Map();
  const equipment = new Map();
  const attrs = new Map();
  const configs = new Map();
  const messages = [];
  const statements = [];
  const moves = [];
  let location = new core.Location(2763, 3513, 0);
  let full = false;
  let combatLevel = 90;

  const inventory = {
    getAmount: (id) => items.get(id) ?? 0,
    contains: (id) => inventory.getAmount(id) > 0,
    adds(id, amount = 1) {
      if (!items.has(id) && inventory.getFreeSlots() <= 0) return inventory;
      items.set(id, inventory.getAmount(id) + amount);
      return inventory;
    },
    forceAdd(_player, item) {
      items.set(item.getId(), inventory.getAmount(item.getId()) + item.getAmount());
      return true;
    },
    deleteNumber(id, amount = 1) {
      const left = inventory.getAmount(id) - amount;
      if (left > 0) items.set(id, left);
      else items.delete(id);
      return true;
    },
    getFreeSlots: () => (full ? 0 : 28 - [...items.values()].filter((amount) => amount > 0).length),
    isFull: () => full || inventory.getFreeSlots() <= 0,
    getItems: () => [...items].filter(([, amount]) => amount > 0).map(([id]) => ({ getId: () => id })),
  };
  const sender = new Proxy({
    sendConfig(id, value) { configs.set(id, value); return sender; },
    sendVarbit(id, value) { configs.set(id, value); return sender; },
  }, { get: (target, key) => (key in target ? target[key] : () => sender) });

  return {
    items, equipment, attrs, configs, messages, statements, moves, inventory,
    getAttribute: (key) => attrs.get(key),
    setAttribute: (key, value) => attrs.set(key, value),
    getInventory: () => inventory,
    getBanks: () => [{ getAmount: () => 0, contains: () => false }],
    getEquipment: () => ({ get: (slot) => equipment.get(slot), getItems: () => [...equipment.values()], contains: () => false }),
    getSkillManager: () => ({ addExperiences: noop, getMaxLevel: () => 99, getCombatLevel: () => combatLevel }),
    getPacketSender: () => sender,
    getDialogueManager: () => ({
      isActive: () => false,
      getCurrent: () => null,
      startDialogues(chain) {
        const entries = chain.getDialogues();
        statements.push({ text: entries.get(0)?.getText?.(), after: () => entries.get(1)?.send?.() });
      },
    }),
    getCombat: () => ({ reset: noop }),
    getLocation: () => location,
    moveTo(next) { moves.push([next.getX(), next.getY(), next.getZ()]); location = next; },
    sendMessage: (message) => messages.push(message),
    setLocation(x, y, z = 0) { location = new core.Location(x, y, z); },
    setFull(value) { full = value; },
    setCombatLevel(value) { combatLevel = value; },
    isPlayer: () => true,
    isRegistered: () => true,
    getUsername: () => 'holy-grail-test',
    getPrivateArea: () => null,
  };
}

/** Owner-only ground items, as ItemOnGroundManager keeps them. */
function fakeGroundItems() {
  const lying = [];
  return {
    lying,
    ownedBy: (username) => lying.filter((entry) => entry.owner === username),
    registerLocation(player, item, position, _area, options) {
      const entry = {
        owner: player.getUsername(), options,
        getItem: () => item,
        getPosition: () => position,
      };
      lying.push(entry);
      return entry;
    },
  };
}

function harness() {
  transcripts.length = 0;
  const custom = new Map();
  const variants = [];
  const conditions = [];
  const objects = new Map();
  const itemActions = new Map();
  const npcTalks = new Map();
  const zoneEnters = [];
  const pickups = [];
  const hitModifiers = [];
  const beforeDeaths = [];
  const spawned = [];
  const ground = fakeGroundItems();

  const api = new Proxy({
    core: { ...core, ItemOnGroundManager: ground },
    persistAttribute: noop,
    onNpcDialogueVariant: (handler) => variants.push(handler),
    onNpcDialogueCondition: (handler) => conditions.push(handler),
    onCustomEvent(name, handler) { custom.set(name, [...(custom.get(name) ?? []), handler]); },
    emitCustomEvent(name, event) { for (const handler of custom.get(name) ?? []) handler(event); },
    onObjectInteraction(name, actions) { objects.set(name, actions); },
    onItemAction(name, actions) { itemActions.set(name, actions); },
    onNpcInteraction(name, actions) { npcTalks.set(name, actions); },
    onZoneEnter(zone, handler) { zoneEnters.push({ zone, handler }); },
    onGroundItemPickup: (handler) => pickups.push(handler),
    onNpcHitModify: (handler) => hitModifiers.push(handler),
    onNpcBeforeDeath: (handler) => beforeDeaths.push(handler),
    spawnNpc(definition) {
      const npc = { definition, getId: () => definition.id, isRegistered: () => true };
      spawned.push(npc);
      return npc;
    },
    removeNpc: noop,
  }, { get: (target, key) => (key in target ? target[key] : noop) });

  require('../plugins/quests/quests/HolyGrail.Quest')(api);
  const quest = runtime.getRegisteredQuests().findLast((entry) => entry.key === 'holy_grail');
  const player = makePlayer();

  const variant = (npcId, npc) => {
    for (const handler of variants) {
      const value = handler({ player, npcId, npc });
      if (value) return value;
    }
    return null;
  };
  const condition = (npcId, text) => {
    for (const handler of conditions) {
      const value = handler({ player, npcId, text });
      if (value !== null && value !== undefined) return value;
    }
    return null;
  };
  const emit = (name, event) => {
    const request = { player, handled: false, ...event };
    for (const handler of custom.get(name) ?? []) handler(request);
    return request;
  };
  const action = (npcId, stepId) => emit('npc-dialogue:action', { npcId, stepId });
  const message = (npcId, stepId) => emit('npc-dialogue:action', { npcId, stepId, kind: 'message' });
  const choice = (npcId, option, npc) => emit('npc-dialogue:choice', { npcId, option, npc });
  const item = (name, option) => itemActions.get(name)[option]({ player });
  const talk = (name, npcId, npc) => npcTalks.get(name)["Talk-to"]({ player, npcId, npc });
  const object = (name, option, x, y, z = 0) => {
    const event = { player, location: { x, y, z }, handled: false };
    return { event, result: objects.get(name)[option](event) };
  };
  const enterZone = (x, y, z) => {
    for (const { zone, handler } of zoneEnters) {
      if (x >= zone.minX && x <= zone.maxX && y >= zone.minY && y <= zone.maxY && (zone.levels ?? [z]).includes(z)) handler({ player, zone });
    }
  };
  const pickUp = (groundItemId) => {
    const event = { player, groundItemId, handled: false };
    for (const handler of pickups) handler(event);
    return event;
  };
  const add = (id, amount = 1) => player.items.set(id, (player.items.get(id) ?? 0) + amount);
  const wield = (id) => player.equipment.set(core.Equipment.WEAPON_SLOT, { getId: () => id });

  function titan() {
    let hitpoints = 0;
    const attacked = [];
    const npc = {
      getId: () => N.BLACK_KNIGHT_TITAN,
      getDefinition: () => ({ getHitpoints: () => 142 }),
      setHitpoints: (value) => { hitpoints = value; },
      getCombat: () => ({ attack: (target) => attacked.push(target), reset: noop, getKiller: () => player }),
      hitpoints: () => hitpoints,
      attacked,
    };
    const hit = () => {
      for (const handler of hitModifiers) handler({ npc, hit: { getAttacker: () => ({ isPlayer: () => true, getAsPlayer: () => player }) } });
    };
    const die = () => {
      const event = { npc, preventDeath: false };
      for (const handler of beforeDeaths) handler(event);
      return event;
    };
    return { npc, hit, die };
  }

  return {
    player, quest, ground, spawned, variant, condition, action, message, choice, item, talk, object,
    enterZone, pickUp, add, wield, titan, transcript: () => transcripts.at(-1),
    stage: () => quest.getStage(player),
  };
}

test('every variant the plugin selects exists in the generated transcript data', () => {
  const dialogues = require('../data/definitions/npc-dialogues.json');
  const page = dialogues['Holy Grail'].variants;
  for (const name of [
    'starting-off',
    'starting-off-subsequent-dialogue-with-king-arthur',
    'talking-to-merlin',
    'talking-to-merlin-updating-king-arthur',
    'talking-to-the-high-priest-of-entrana',
    'talking-to-sir-galahad',
    'encountering-the-black-knight-titan',
    'talking-to-the-fisherman',
    'talking-to-the-fisherman-peasant',
    'ringing-the-grail-bell',
    'ringing-the-grail-bell-talking-to-a-grail-maiden',
    'talking-to-the-fisher-king',
    'talking-to-king-arthur',
    'talking-to-sir-percival',
    'talking-to-sir-percival-subsequent-dialogue-with-sir-percival',
    'talking-to-sir-percival-talking-to-sir-percival-at-the-fisher-realm',
    'talking-to-king-arthur-2',
  ]) {
    assert.ok(page[name], name);
  }
  assert.ok(dialogues['King Arthur'].variants['standard-dialogue-after-completing-holy-grail']);
  assert.ok(dialogues.Merlin.variants['after-holy-grail']);
  assert.ok(dialogues.Peasant.variants['standard-dialogue-after-holy-grail']);
  assert.ok(dialogues['Grail Maiden'].variants['talking-to-them-inside-the-castle']);
  assert.ok(dialogues['Sir Percival'].variants['standard-dialogue-after-holy-grail-in-the-goblin-village']);
});

test('stage 0 reaches completion along the wiki route', () => {
  const h = harness();
  const p = h.player;

  // King Arthur starts it; Merlin, then the High Priest (and crone) on Entrana.
  assert.equal(h.variant(N.KING_ARTHUR), 'starting-off');
  h.choice(N.KING_ARTHUR, 'Yes.');
  assert.equal(h.stage(), 2);
  assert.equal(p.configs.get(VARP), 2);
  assert.equal(h.variant(N.HIGH_PRIEST), null, 'the High Priest is not the quest\'s before Merlin');
  assert.equal(h.variant(N.MERLIN), 'talking-to-merlin');
  assert.equal(h.stage(), 3);
  assert.equal(h.variant(N.KING_ARTHUR), 'talking-to-merlin-updating-king-arthur');
  assert.equal(h.variant(N.HIGH_PRIEST), 'talking-to-the-high-priest-of-entrana');
  assert.equal(h.stage(), 4);
  assert.equal(h.variant(N.KING_ARTHUR), 'talking-to-merlin-updating-king-arthur', 'no "speak to Merlin" again');

  // Galahad lends the napkin, and only the napkin.
  assert.equal(h.variant(N.GALAHAD), 'talking-to-sir-galahad');
  assert.equal(h.condition(N.GALAHAD, 'If the player talked to the High Priest of Entrana first:'), true);
  h.message(N.GALAHAD, 'TCOaoy');
  h.action(N.GALAHAD, 'IWEKeT');
  assert.equal(p.inventory.getAmount(I.HOLY_TABLE_NAPKIN), 1);
  assert.equal(p.inventory.getAmount(I.MAGIC_WHISTLE), 0, 'the whistles are in Draynor Manor');

  // Draynor Manor: two whistles on the table, for the napkin holder.
  h.enterZone(3108, 3359, 2);
  const whistles = h.ground.lying.filter((entry) => entry.getItem().getId() === I.MAGIC_WHISTLE);
  assert.equal(whistles.length, 2);
  assert.deepEqual([whistles[0].getPosition().getX(), whistles[0].getPosition().getY(), whistles[0].getPosition().getZ()], [3107, 3359, 2]);
  assert.equal(whistles[0].options.goesGlobal, false, 'nobody else sees them');
  h.ground.lying.length = 0;
  h.add(I.MAGIC_WHISTLE, 2);

  // The tower north of the Brimhaven gold rocks.
  p.setLocation(2742, 3235);
  h.item('Magic whistle', 'Blow');
  assert.deepEqual(p.moves.at(-1), [2793, 4724, 0], 'the withered realm, east of the bridge');

  // The Titan: Excalibur for the killing blow, then over the bridge.
  const t = h.titan();
  assert.equal(h.talk('Black Knight Titan', N.BLACK_KNIGHT_TITAN, t.npc), true);
  assert.equal(h.transcript().variant, 'encountering-the-black-knight-titan', 'his page is not indexed, so Talk-to starts it');
  assert.equal(h.condition(N.BLACK_KNIGHT_TITAN, 'If the player uses the excalibur to defeat the Black Knight Titan:'), false);
  h.choice(N.BLACK_KNIGHT_TITAN, 'Okay, have at ye oh evil knight!', t.npc);
  assert.deepEqual(t.npc.attacked, [p], 'he attacks once challenged');
  p.setLocation(2792, 4722);
  h.wield(I.EXCALIBUR);
  t.hit();
  assert.equal(t.die().preventDeath, false);
  assert.ok(p.messages.includes('Well done! You have defeated the Black Knight Titan!'));
  assert.equal(h.stage(), 7);
  assert.deepEqual(p.moves.at(-1), [2790, 4722, 0], 'carried past him');

  // The fisherman leaves a bell; ringing it by the bricks takes the player in.
  h.choice(N.FISHERMAN_2, 'Any idea how to get into the castle?');
  const bell = h.ground.lying.find((entry) => entry.getItem().getId() === I.GRAIL_BELL);
  assert.ok(bell, 'a bell by the bricks');
  assert.deepEqual([bell.getPosition().getX(), bell.getPosition().getY()], [2762, 4694]);
  h.ground.lying.length = 0;
  h.add(I.GRAIL_BELL);
  p.setLocation(2762, 4694);
  h.item('Grail bell', 'Ring');
  assert.equal(h.transcript().variant, 'ringing-the-grail-bell');
  assert.equal(h.condition(N.GRAIL_MAIDEN, 'If the player rings the Grail bell and is at least four tiles by the dismantled bricks:'), true);
  assert.equal(h.condition(N.GRAIL_MAIDEN, 'If the player rings the Grail bell but is not by the dismantled bricks:'), false);
  const inside = h.message(N.GRAIL_MAIDEN, 'TXKuhf');
  assert.deepEqual(inside.box, { statement: true });
  inside.after();
  assert.deepEqual(p.moves.at(-1), [2762, 4691, 0]);

  // The Grail can't be moved yet.
  assert.equal(h.pickUp(I.HOLY_GRAIL).handled, true);
  assert.match(p.statements.at(-1).text, /shouldn't be moved/);

  // The Fisher King asks for his son.
  assert.equal(h.variant(N.THE_FISHER_KING), 'talking-to-the-fisher-king');
  h.choice(N.THE_FISHER_KING, 'I seek the Holy Grail.');
  assert.equal(h.stage(), 7);
  h.choice(N.THE_FISHER_KING, "You don't look too well.");
  assert.equal(h.stage(), 8);
  p.setLocation(2762, 4688, 1);
  h.item('Magic whistle', 'Blow');
  assert.deepEqual(p.moves.at(-1), [2742, 3236, 0], 'back under the Brimhaven tower');

  // King Arthur's feather.
  assert.equal(h.variant(N.KING_ARTHUR), 'talking-to-king-arthur');
  assert.equal(h.condition(N.KING_ARTHUR, 'If the player has one free inventory space:'), true);
  assert.deepEqual(h.message(N.KING_ARTHUR, 'Vfcrb6').box, { items: [I.MAGIC_GOLD_FEATHER] });
  h.action(N.KING_ARTHUR, 'QFSQAR');
  assert.equal(p.inventory.getAmount(I.MAGIC_GOLD_FEATHER), 1);

  // The feather leads to the sacks; opening them frees Percival.
  p.setLocation(2964, 3420);
  h.item('Magic gold feather', 'Blow-on');
  assert.equal(p.messages.at(-1), 'The feather points to the north.');
  p.setLocation(2960, 3506);
  h.item('Magic gold feather', 'Blow-on');
  assert.equal(p.messages.at(-1), 'The feather points at the sacks.');
  const opened = h.object('Sacks', 'Open', 2962, 3506);
  assert.equal(opened.event.handled, true);
  assert.equal(h.spawned.at(-1).definition.id, N.SIR_PERCIVAL);
  assert.equal(h.transcript().variant, 'talking-to-sir-percival');
  assert.equal(h.condition(N.SIR_PERCIVAL, 'If the player prods at the sacks:'), false);
  assert.equal(h.condition(N.SIR_PERCIVAL, 'If the player attempts to open the sack:'), true);
  h.message(N.SIR_PERCIVAL, 'VHDHnK');
  assert.equal(h.condition(N.SIR_PERCIVAL, 'If the player attempts to open the sack:'), false);
  assert.equal(h.condition(N.SIR_PERCIVAL, 'If the player has the magic whistle:'), true);
  h.message(N.SIR_PERCIVAL, 'xUC5cW');
  assert.equal(h.stage(), 9);
  assert.equal(p.inventory.getAmount(I.MAGIC_WHISTLE), 1, 'one whistle went to Percival');
  assert.equal(p.inventory.getAmount(I.HOLY_GRAIL), 0, 'the Grail is still in the castle');
  assert.equal(h.variant(N.SIR_PERCIVAL), 'talking-to-sir-percival-subsequent-dialogue-with-sir-percival');

  // Back to the restored realm, where the Grail may be taken.
  p.setLocation(2741, 3234);
  h.item('Magic whistle', 'Blow');
  assert.deepEqual(p.moves.at(-1), [2665, 4724, 0], 'the restored realm');
  assert.equal(h.talk('King Percival', N.KING_PERCIVAL), true);
  assert.equal(h.transcript().variant, 'talking-to-sir-percival-talking-to-sir-percival-at-the-fisher-realm');
  assert.equal(h.variant(N.KING_ARTHUR), 'talking-to-merlin-updating-king-arthur', 'Arthur waits for the Grail');
  assert.equal(h.pickUp(I.HOLY_GRAIL).handled, false);
  h.add(I.HOLY_GRAIL);
  assert.equal(h.pickUp(I.HOLY_GRAIL).handled, true);
  assert.match(p.statements.at(-1).text, /might be greedy/);

  // King Arthur.
  assert.equal(h.variant(N.KING_ARTHUR), 'talking-to-king-arthur-2');
  h.action(N.KING_ARTHUR, 'MtgzHp');
  assert.equal(h.stage(), 10);
  assert.equal(p.configs.get(VARP), 10);
  assert.equal(p.inventory.getAmount(I.HOLY_GRAIL), 1, 'the player keeps the Grail');
});

test('a Titan killed without Excalibur regenerates and keeps the bridge', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 4);
  p.setLocation(2792, 4722);
  h.wield(I.BRONZE_SWORD);
  const t = h.titan();
  t.hit();
  const death = t.die();
  assert.equal(death.preventDeath, true);
  assert.equal(t.npc.hitpoints(), 142);
  assert.equal(p.statements.at(-1).text, 'Puny mortal... You cannot defeat me...');
  assert.equal(p.messages.at(-1), 'Maybe you need something more to beat the titan?');
  assert.equal(p.moves.length, 0);
  assert.equal(h.stage(), 4);

  // A Ranged or Magic blow still counts if Excalibur is wielded when it lands.
  h.wield(I.EXCALIBUR);
  t.hit();
  assert.equal(t.die().preventDeath, false);
});

test('the whistle only works under the Brimhaven tower or in the realm', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 4);
  p.setLocation(2743, 3175);
  h.item('Magic whistle', 'Blow');
  assert.equal(p.moves.length, 0, 'the old, wider area is not the realm crossing');
  assert.equal(p.statements.at(-1).text, 'The whistle makes no noise. It will not work in this location.');
});

test('the bell is only left once, and ringing away from the bricks does nothing', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 7);
  h.choice(N.FISHERMAN_2, 'Any idea how to get into the castle?');
  h.choice(N.FISHERMAN_2, 'Any idea how to get into the castle?');
  assert.equal(h.ground.lying.length, 1, 'one bell, not one per ask');
  h.add(I.GRAIL_BELL);
  h.ground.lying.length = 0;
  h.choice(N.FISHERMAN_2, 'Any idea how to get into the castle?');
  assert.equal(h.ground.lying.length, 0, 'not while one is owned');
  p.setLocation(2780, 4700);
  assert.equal(h.condition(N.GRAIL_MAIDEN, 'If the player rings the Grail bell but is not by the dismantled bricks:'), true);
  assert.equal(h.condition(N.GRAIL_MAIDEN, 'If the player rings the Grail bell and is at least four tiles by the dismantled bricks:'), false);
});

test('the whistles need the napkin, and the sacks need the feather', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 4);
  h.enterZone(3108, 3359, 2);
  assert.equal(h.ground.lying.length, 0, 'unseen without the napkin');

  h.quest.setStage(p, 8);
  const prodded = h.object('Sacks', 'Open', 2962, 3506);
  assert.equal(prodded.event.handled, true);
  assert.equal(p.statements.at(-1).text, 'You hear a muffled groan. The sack wriggles slightly.');
  assert.equal(h.spawned.length, 0, 'no Percival without the feather');
  assert.equal(h.object('Sacks', 'Open', 2951, 3507).result, false, 'other sacks are not his');
});

test('feather directions near, far and underground', () => {
  const h = harness();
  const p = h.player;
  p.setLocation(2958, 3510);
  h.item('Magic gold feather', 'Blow-on');
  assert.equal(p.messages.at(-1), 'The feather points to somewhere nearby.');
  p.setLocation(3000, 3506);
  h.item('Magic gold feather', 'Blow-on');
  assert.equal(p.messages.at(-1), 'The feather points to the west.');
  p.setLocation(2900, 9800);
  h.item('Magic gold feather', 'Blow-on');
  assert.equal(p.messages.at(-1), "The feather doesn't seem to work here...");
});

test('quest NPCs keep their own pages outside the quest', () => {
  const h = harness();
  const p = h.player;
  assert.equal(h.variant(N.GALAHAD), null);
  assert.equal(h.variant(N.HIGH_PRIEST), null);
  assert.equal(h.variant(N.SIR_GAWAIN), null);
  assert.equal(h.variant(N.PEASANT), 'talking-to-the-fisherman-peasant');
  assert.deepEqual(h.variant(N.PEASANT_2), { page: 'Peasant', variant: 'standard-dialogue-after-holy-grail' });
  const restoredMaiden = { getLocation: () => new core.Location(2631, 4677, 0) };
  assert.deepEqual(h.variant(N.GRAIL_MAIDEN, restoredMaiden), { page: 'Grail Maiden', variant: 'talking-to-them-inside-the-castle' });

  h.quest.setStage(p, 10);
  assert.deepEqual(h.variant(N.KING_ARTHUR), { page: 'King Arthur', variant: 'standard-dialogue-after-completing-holy-grail' });
  assert.deepEqual(h.variant(N.MERLIN), { page: 'Merlin', variant: 'after-holy-grail' });
  assert.equal(h.variant(N.GALAHAD), null);
  assert.equal(h.variant(N.HIGH_PRIEST), null);
  assert.deepEqual(h.variant(N.SIR_PERCIVAL), { page: 'Sir Percival', variant: 'standard-dialogue-after-holy-grail-in-the-goblin-village' });
});

test('Galahad pours a cup of tea, once per line', () => {
  const h = harness();
  const p = h.player;
  h.quest.setStage(p, 3);
  const tea = h.message(N.GALAHAD, 'lIuD4R');
  assert.deepEqual(tea.box, { statement: true });
  assert.equal(p.inventory.getAmount(I.CUP_OF_TEA_2), 1);
  assert.equal(h.action(N.GALAHAD, '7SPxqF').handled, true);
  assert.equal(p.inventory.getAmount(I.CUP_OF_TEA_2), 1, 'the receive marker does not pour a second');
});
