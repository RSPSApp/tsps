// Run after `yarn build`: node --test tests/chambers-of-xeric.test.cjs
const assert = require('node:assert/strict');
const { test, before } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { RegionManager } = require('../dist/game/collision/RegionManager');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { TaskManager } = require('../dist/game/task/TaskManager');
const { Location } = require('../dist/game/model/Location');
const Shared = require('../plugins/minigames/cox/Shared.ChambersOfXeric');
const Layout = require('../plugins/minigames/cox/Layout.ChambersOfXeric');
const CoxMap = require('../plugins/minigames/cox/Map.ChambersOfXeric');
const Parties = require('../plugins/minigames/cox/Parties.ChambersOfXeric');
const RaidModule = require('../plugins/minigames/cox/RaidState.ChambersOfXeric');
const Lobby = require('../plugins/minigames/cox/Lobby.ChambersOfXeric');
const RaidUnit = require('../plugins/minigames/cox/Raid.ChambersOfXeric');
const Storage = require('../plugins/minigames/cox/Storage.ChambersOfXeric');
const Herblore = require('../plugins/minigames/cox/Herblore.ChambersOfXeric');
const Supplies = require('../plugins/minigames/cox/Supplies.ChambersOfXeric');
const Monsters = require('../plugins/minigames/cox/Monsters.ChambersOfXeric');
const IceDemon = require('../plugins/minigames/cox/IceDemon.ChambersOfXeric');
const Thieving = require('../plugins/minigames/cox/Thieving.ChambersOfXeric');
const Tightrope = require('../plugins/minigames/cox/Tightrope.ChambersOfXeric');
const Crabs = require('../plugins/minigames/cox/Crabs.ChambersOfXeric');
for (const unit of ['Resources', 'Tekton', 'Muttadiles', 'Vanguards', 'Vasa', 'Scavengers', 'Mystics', 'Shamans', 'Guardians', 'Vespula', 'Olm']) require(`../plugins/minigames/cox/${unit}.ChambersOfXeric`);

/** NPCs the raid spawned. */
const spawned = [];

/** Chat-channels: key -> { members, ranks by username }. */
const channels = new Map();
const RANKS = { Unranked: -1, Friend: 0, Recruit: 1, Corporal: 2, Sergeant: 3, Lieutenant: 4, Captain: 5, General: 6, Owner: 7 };

function channelView(key) {
  const channel = channels.get(key);
  if (!channel) return null;
  return {
    key, ownerName: key, name: key, members: [...channel.members], kickRank: RANKS.Corporal,
    rankOf: (member) => channel.ranks.get(member.getUsername()) ?? RANKS.Unranked,
  };
}

function fakeApi() {
  return {
    core: PluginManager.getCoreApi(),
    emitCustomEvent(name, payload) {
      if (name === 'side-channels:replace-chat-channel') {
        payload.player.sideChannelGroup = payload.group;
        payload.onMount?.();
      } else if (name === 'friends-chat:channel') {
        const key = payload.key ?? [...channels].find(([, channel]) => channel.members.has(payload.player))?.[0];
        payload.channel = key ? channelView(key) : null;
        payload.ranks = RANKS;
      } else if (name === 'friends-chat:join') {
        channels.get(payload.owner)?.members.add(payload.player);
        payload.joined = true;
      } else if (name === 'friends-chat:leave') {
        for (const channel of channels.values()) channel.members.delete(payload.player);
      }
    },
    sendMultiChatboxPrompt(player, title, ...args) { player.prompts.push({ title, args }); },
    spawnNpc({ id, x, y, z }) {
      const { NPC } = require('../dist/game/entity/impl/npc/NPC');
      const npc = new NPC(id, new Location(x, y, z));
      spawned.push(npc);
      return npc;
    },
    removeNpc: () => {},
  };
}

function fakePlayer(name, location = new Location(1234, 3566, 0)) {
  const varbits = new Map();
  const attributes = new Map();
  const p = {
    name, location, messages: [], scripts: [], interfaces: [], prompts: [], subs: [], statements: [],
    inventory: [],
    getUsername: () => name,
    getHitpoints: () => 99,
    getIndex: () => name.length,
    isPlayer: () => true,
    isNpc: () => false,
    getAsPlayer: () => p,
    isRegistered: () => true,
    getLocation: () => p.location,
    moveTo(location) { p.location = location; },
    setArea() {},
    getArea: () => null,
    getPrivateArea: () => null,
    setPrivateArea() {},
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    sendMessage: (text) => p.messages.push(text),
    performAnimation() {},
    getDialogueManager: () => ({ startDialogues: (chain) => p.statements.push(chain) }),
    level: 90,
    getSkillManager: () => ({
      getCombatLevel: () => 100, getTotalLevel: () => 1500, getMaxLevel: () => p.level, getCurrentLevel: () => p.level,
      addExperiences() {},
    }),
    getInventory: () => fakeInventory(p.inventory),
    getPacketSender() {
      const sender = {
        sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
        getVarbit: (id) => varbits.get(id) ?? 0,
        sendConfig: (id, value) => { varbits.set(`varp${id}`, value); return sender; },
        sendInterface: (id) => { p.interfaces.push(id); return sender; },
        sendInterfaceRemoval: () => sender,
        sendSubInterface: (uid, id) => { p.subs.push([uid, id]); return sender; },
        closeSubInterface: (uid) => { p.subs.push([uid, -1]); return sender; },
        sendClientScript: (id, ...args) => { p.scripts.push([id, ...args]); return sender; },
        sendInterfaceFlagsRange: () => sender,
        sendSound: () => sender,
        sendAreaSound: () => sender,
        sendEnterAmountPrompt: () => sender,
        sendObjectAnimation: () => sender,
        sendGlobalGraphic: () => sender,
      };
      return sender;
    },
    varbits,
  };
  return p;
}

/** A 28-slot inventory over a plain array of core Items. */
function fakeInventory(slots) {
  const { Item, ItemDefinition } = PluginManager.getCoreApi();
  const stackable = (id) => ItemDefinition.forId(id)?.isStackable?.() === true;
  const inventory = {
    getItems: () => Array.from({ length: 28 }, (_, slot) => slots[slot] ?? null),
    setItem(slot, item) { slots[slot] = item; return inventory; },
    refreshItems() {},
    getAmount: (id) => slots.reduce((sum, item) => sum + (item?.getId() === id ? item.getAmount() : 0), 0),
    contains: (id) => slots.some((item) => item?.getId() === id),
    getFreeSlots: () => 28 - slots.filter(Boolean).length,
    add(item) {
      if (stackable(item.getId())) {
        const slot = slots.findIndex((entry) => entry?.getId() === item.getId());
        if (slot >= 0) { slots[slot] = new Item(item.getId(), slots[slot].getAmount() + item.getAmount()); return inventory; }
      }
      const count = stackable(item.getId()) ? 1 : item.getAmount();
      for (let i = 0; i < count; i++) {
        let slot = 0;
        while (slots[slot]) slot++;
        slots[slot] = new Item(item.getId(), stackable(item.getId()) ? item.getAmount() : 1);
      }
      return inventory;
    },
    delete(id, amount) {
      let left = amount;
      for (let slot = 0; slot < 28 && left > 0; slot++) {
        const item = slots[slot];
        if (item?.getId() !== id) continue;
        const take = Math.min(left, item.getAmount());
        left -= take;
        slots[slot] = item.getAmount() > take ? new Item(id, item.getAmount() - take) : null;
      }
      return inventory;
    },
    deleteAtSlot(slot) { slots[slot] = null; return inventory; },
  };
  return inventory;
}

function give(player, ...ids) {
  const { Item } = PluginManager.getCoreApi();
  for (const id of ids) player.getInventory().add(new Item(id, 1), true);
}

function ticks(count) {
  for (let i = 0; i < count; i++) TaskManager.process();
}

before(() => {
  CachePipeline.initialize();
  RegionManager.init();
  Shared.bind(fakeApi());
});

// ------------------------------------------------------------------ layouts

test('every layout pattern reads as two floors of rooms entered from a direction', () => {
  assert.equal(Layout.PATTERNS.length, 26);
  for (const { code, rooms } of Layout.PATTERNS) {
    assert.equal(rooms.length % 2, 0, code);
    const half = rooms.length / 2;
    for (const floor of [rooms.slice(0, half), rooms.slice(half)]) {
      assert.equal(floor[0].kind, 'start', code);
      assert.equal(floor.at(-1).kind, 'end', code);
    }
  }
});

test('a normal raid: two floors, two puzzles, combat rooms from one rotation, always 16x8 chunks', () => {
  for (let i = 0; i < 500; i++) {
    const layout = Layout.normalLayout();
    assert.deepEqual(Layout.sizeOf(layout), { width: 16, height: 8 });
    const rooms = layout.floors.flat().map((chunk) => chunk.room);
    assert.equal(rooms[0], 'RAID_START');
    const puzzles = new Set(rooms.filter((room) => Layout.PUZZLE_ROOMS.includes(room)));
    const slots = layout.floors.flat().filter((chunk) => Layout.PUZZLE_ROOMS.includes(chunk.room)).length;
    // Two puzzles are drawn; a layout with a third puzzle slot repeats any of the four there.
    assert.ok(puzzles.size <= (slots > 2 ? 3 : 2), 'two of the four puzzles');
    const combat = rooms.filter((room) => Layout.ROOMS[room].kind === 'combat');
    assert.ok(Layout.BOSS_ROTATIONS.some((rotation) => {
      const start = rotation.indexOf(combat[0]);
      return combat.every((room, k) => rotation[(start + k) % rotation.length] === room);
    }), `combat rooms follow a rotation: ${combat}`);
    for (const floor of layout.floors) {
      const tiles = new Set(floor.map((chunk) => `${chunk.x},${chunk.y}`));
      assert.equal(tiles.size, floor.length, 'no two rooms on one spot');
    }
  }
});

test('Challenge Mode is always the same three floors, every combat and puzzle room in it', () => {
  const first = Layout.challengeLayout();
  const second = Layout.challengeLayout();
  assert.equal(first.floors.length, 3);
  assert.deepEqual(first, second);
  const rooms = new Set(first.floors.flat().map((chunk) => chunk.room));
  for (const room of [...Layout.BOSS_ROTATIONS[0], ...Layout.PUZZLE_ROOMS]) assert.ok(rooms.has(room), room);
  // Each floor's end sits right above the next floor's start.
  for (let floor = 0; floor < 2; floor++) {
    const end = first.floors[floor].at(-1);
    const start = first.floors[floor + 1][0];
    assert.deepEqual([end.x, end.y], [start.x, start.y]);
  }
});

// ------------------------------------------------------------------ the map

test('the map: floors on planes 3, 2 (and 1), the Olm beside them, every landing open', () => {
  const free = (map, tile) => (RegionManager.getClipping(tile.getX(), tile.getY(), tile.getZ(), map) & 0x1280100) === 0;
  for (let i = 0; i < 8; i++) {
    const layout = i === 0 ? Layout.challengeLayout() : Layout.normalLayout();
    const map = CoxMap.createMap(layout);
    assert.deepEqual([...new Set(map.rooms.map((room) => room.plane))], layout.challenge ? [3, 2, 1] : [3, 2]);
    assert.ok(free(map, map.startTile()), 'the first room spawn');
    for (const room of map.rooms) if (room.bound) assert.ok(free(map, map.landing(room.bound)), `${room.key} landing`);
    assert.ok(free(map, map.landing(map.olmEntrance)), 'the Olm chamber entrance');
    assert.ok(map.inOlmChamber(map.olmEntrance));
    assert.equal(map.roomAt(map.startTile())?.key, 'RAID_START');
    map.destroy();
  }
});

test('a room tile turns with its room, an NPC by its south-west corner', () => {
  assert.deepEqual(CoxMap.rotateRoomTile(3, 5, 0), [3, 5]);
  assert.deepEqual(CoxMap.rotateRoomTile(3, 5, 1), [5, 28]);
  assert.deepEqual(CoxMap.rotateRoomTile(3, 5, 2), [28, 26]);
  assert.deepEqual(CoxMap.rotateRoomTile(3, 5, 3), [26, 3]);
  assert.deepEqual(CoxMap.rotateRoomTile(0, 0, 2, 3), [29, 29], 'a 3x3 NPC keeps its footprint in the room');
});

// ------------------------------------------------------------------ parties and the raid

function channelWith(key, ...players) {
  channels.set(key, { members: new Set(players), ranks: new Map(players.map((player, index) => [player.getUsername(), index === 0 ? RANKS.Owner : RANKS.Friend])) });
}

test('parties: a chat-channel is needed, a Recruit makes it, Challenge Mode is the leader\'s toggle', () => {
  Parties.clear();
  const loner = fakePlayer('Loner');
  Lobby.makeParty(loner);
  assert.equal(Parties.all().length, 0);
  const leader = fakePlayer('Leader');
  const friend = fakePlayer('Friend');
  channelWith('Leader', leader, friend);
  Lobby.makeParty(friend);
  assert.equal(Parties.all().length, 0, 'a Friend is below Recruit');
  Lobby.makeParty(leader);
  const party = Parties.partyOf(leader);
  assert.ok(party);
  assert.ok(leader.interfaces.includes(Shared.INTERFACE.PARTY));
  const header = leader.scripts.find(([id]) => id === Shared.SCRIPT.PARTY_HEADER);
  assert.deepEqual(header.slice(1), ['Raiding Party of Leader (2)', 2, 0, 99]);
  const member = leader.scripts.find(([id]) => id === Shared.SCRIPT.PARTY_MEMBER);
  assert.equal(member[2].split('|').length, 4 + Shared.PARTY_SKILLS.length + 1);
  Lobby.clickPartyButton({ player: leader, slot: 8 });
  assert.equal(party.challenge, true);
  assert.equal(leader.varbits.get(Shared.VARBIT.CHALLENGE_MODE), 1);
  Lobby.clickPartyButton({ player: leader, slot: 1 });
  assert.ok(party.isAdvertised());
  Parties.clear();
});

test('a raid: in, started by the leader, points, a safe death, and out', () => {
  Parties.clear();
  const leader = fakePlayer('Raider');
  channelWith('Raider', leader);
  Lobby.makeParty(leader);
  leader.setAttribute(Shared.ATTR.WARNED, true);
  Lobby.enterChambers({ player: leader });
  const raid = Parties.partyOf(leader).raid;
  assert.ok(raid?.map, 'built on first entry');
  ticks(3 + 2);
  assert.ok(raid.players.has(leader));
  assert.equal(raid.roomAt(leader.location)?.key, 'RAID_START');
  assert.equal(leader.sideChannelGroup, Shared.INTERFACE.PARTY_TAB);

  const passage = { getLocation: () => leader.location, getFace: () => 0 };
  assert.equal(raid.rooms[0].canPass(leader, passage), false, 'not past the first room before the start');
  RaidUnit.startRaid({ player: leader });
  leader.prompts.at(-1).args[1]();
  assert.equal(raid.stage, RaidModule.STAGE.STARTED);
  assert.equal(raid.rooms[0].canPass(leader, passage), true);

  raid.addPoints(leader, 1000);
  assert.equal(leader.varbits.get(Shared.VARBIT.PERSONAL_POINTS), 1000);
  raid.onDeath(leader);
  assert.equal(raid.pointsOf(leader), 600, 'a death costs 40%');
  assert.equal(raid.totalPoints, 600);

  raid.leave(leader);
  ticks(2);
  assert.deepEqual([leader.location.getX(), leader.location.getY()], [Shared.OUTSIDE.x, Shared.OUTSIDE.y]);
  assert.equal(raid.destroyed, true, 'no one left to lead it');
  ticks(4);
  Parties.clear();
});

test('a death with few points costs the team 5% instead', () => {
  const party = new Parties.Party(fakePlayer('Lead'), { key: 'Lead' });
  const raid = new RaidModule.Raid(party);
  raid.map = { inOlmChamber: () => false, roomAt: () => null };
  raid.respawn = new Location(1, 1, 0);
  const rich = fakePlayer('Rich');
  const poor = fakePlayer('Poor');
  raid.original.add('Rich').add('Poor');
  raid.addPoints(rich, 10000);
  raid.addPoints(poor, 100);
  raid.onDeath(poor);
  assert.equal(raid.pointsOf(poor), 100, 'kept: under 5% of the total');
  assert.equal(raid.totalPoints, 10100 - Math.floor(10100 * 0.05));
  raid.destroyed = true;
});

// ------------------------------------------------------------------ phase 2: supplies

test('storage: stackables share a slot, others take one each, within the size', () => {
  const list = [];
  assert.equal(Storage.addTo(list, 3, 20799, 20), 20, 'kindling stacks');
  assert.equal(Storage.addTo(list, 3, 20799, 5), 5);
  assert.equal(Storage.addTo(list, 3, 20802, 5), 2, 'two slots left for gourds');
  assert.equal(list.length, 3);
  assert.equal(Storage.takeFrom(list, 20799, 30), 25);
  assert.equal(list.length, 2);
  assert.deepEqual(Storage.TIERS.map((tier) => [tier.personal, tier.shared]), [[25, 0], [30, 250], [60, 500], [90, 1000], [120, 1500]]);
  assert.ok(Storage.sharedItem(20801) && Storage.sharedItem(10010) && Storage.sharedItem(25765));
  assert.ok(!Storage.sharedItem(4151), 'a whip is not a raid item');
});

test('herblore: the strength made follows the level, overloads come out no stronger', () => {
  const herbalist = fakePlayer('Herbalist');
  herbalist.level = 80;
  give(herbalist, 20905, 20910, 20801);
  const [elder] = Herblore.mixable(herbalist);
  assert.equal(elder.outcome, 20924, 'elder (+) at 80');
  herbalist.level = 50;
  assert.equal(Herblore.mixable(herbalist)[0].outcome, 20916, 'elder (-) at 50');

  herbalist.inventory.length = 0;
  herbalist.level = 80;
  give(herbalist, 20902, 20924, 20936, 20948);
  const overload = Herblore.mixable(herbalist).find((recipe) => recipe.potion === Herblore.OVERLOAD);
  assert.equal(overload.outcome, 20992, 'strong potions make a normal overload at 80');
  assert.ok(Herblore.mixOne(herbalist, 20992));
  assert.equal(herbalist.getInventory().getAmount(20992), 1);
  assert.equal(herbalist.getInventory().getAmount(20924), 0, 'the potions are used');
});

test('supplies: potion and food points go to their maker, more when someone else uses them', () => {
  const party = new Parties.Party(fakePlayer('Brewer'), { key: 'Brewer' });
  const raid = new RaidModule.Raid(party);
  raid.stage = RaidModule.STAGE.STARTED;
  const brewer = fakePlayer('Brewer');
  const drinker = fakePlayer('Drinker');
  for (const player of [brewer, drinker]) {
    raid.players.add(player);
    raid.original.add(player.getUsername());
    player.setAttribute(RaidModule.ATTR_RAID, raid);
  }
  Supplies.recordMade(raid, Supplies.supplyKey(20996), brewer);
  Supplies.drank({ player: drinker, itemId: 20995 });
  assert.equal(raid.pointsOf(brewer), 600, 'an overload (+) sip by someone else: 400 x 1.5');
  Supplies.drank({ player: drinker, itemId: 20993 });
  assert.equal(raid.pointsOf(brewer), 1200);
  Supplies.drank({ player: drinker, itemId: 20993 });
  assert.equal(raid.pointsOf(brewer), 1200, 'the finished gourd took its maker off the list');

  Supplies.cooked({ player: brewer, itemId: 20868 });
  Supplies.ate({ player: brewer, itemId: 20868, heal: 20 });
  assert.equal(raid.pointsOf(brewer), 1200 + 4 + 8 * 6, 'a kyren fish eaten by its cook');

  const request = { player: drinker, area: 'chambers-of-xeric', inside: false };
  Supplies.potionArea(request);
  assert.equal(request.inside, true);
  raid.destroy();
});

// ------------------------------------------------------------------ phase 3: scaling and puzzles

test('scaling follows the Wiki DPS calculator (CM Tekton at 126 combat, 99 Hitpoints)', () => {
  const expected = { 1: [450, 585, 246], 2: [900, 631, 248], 3: [900, 637, 250], 4: [1350, 643, 284] };
  for (const [size, [hp, attack, defence]] of Object.entries(expected)) {
    const scaled = Monsters.scale(7540, { size: Number(size), maxCombat: 126, maxHitpoints: 99, challenge: true });
    assert.deepEqual([scaled.hitpoints, scaled.stats[0], scaled.stats[2], scaled.stats[4]], [hp, attack, defence, defence], `size ${size}`);
  }
  for (const monster of Monsters.MONSTERS) {
    const solo = Monsters.scale(monster.ids[0], { size: 1, maxCombat: 126, maxHitpoints: 99 });
    if (!Monsters.ID.OLM_HEAD.has(monster.ids[0]) && !Monsters.ID.OLM_CLAWS.has(monster.ids[0]) && !Monsters.ID.GUARDIAN.has(monster.ids[0])) {
      assert.equal(solo.hitpoints, monster.hp, `${monster.name} solo keeps its base hitpoints`);
    }
  }
  assert.equal(Monsters.scale(7551, { size: 1, maxCombat: 126, maxHitpoints: 99 }).hitpoints, 800, 'the Olm head solo');
});

test('the ice demon follows rsprox captures: the storm bar, the boulder flight, the burst pattern', () => {
  // One 28-kindling brazier thaws 0.71% of the storm a tick (captured: about 0.75%).
  assert.equal(IceDemon.thawRate(28), 71);
  assert.equal(IceDemon.stormFill(10000), 100);
  assert.equal(IceDemon.stormFill(9929), 99);
  assert.equal(IceDemon.stormFill(99), 0);
  // The boulder lands 2 ticks after it is thrown within 3 tiles, 3 ticks at 4-5.
  assert.deepEqual([1, 3, 4, 5].map(IceDemon.boulderCycles), [60, 60, 90, 90]);
  // Ice Burst: nine tiles, the centre first and each side 3 client cycles after the last.
  assert.equal(IceDemon.BURST_TILES.length, 9);
  assert.deepEqual(IceDemon.BURST_TILES[0], [0, 0, 0]);
  assert.equal(new Set(IceDemon.BURST_TILES.map(([dx, dy]) => `${dx},${dy}`)).size, 9);
  assert.deepEqual([...new Set(IceDemon.BURST_TILES.map(([, , delay]) => delay))], [0, 3, 6, 9, 12]);
});

test('Tekton follows rsprox captures: swings before the anvil, anvil heals', () => {
  const Tekton = require('../plugins/minigames/cox/Tekton.ChambersOfXeric');
  assert.deepEqual(Tekton.SWINGS, { FIRST: 9, AFTER_REPAIR: 16, ENRAGED: 6 });
  assert.equal(Tekton.anvilHeal(8400), 85);
});

test('Tekton and defence specials (Wiki): the first DWH or elder maul special lands, failed ones still drain', () => {
  const Tekton = require('../plugins/minigames/cox/Tekton.ChambersOfXeric');
  const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
  const { HitMask } = require('../dist/game/content/combat/hit/HitMask');
  const methods = {};
  for (const file of ['DragonWarhammer', 'ElderMaul', 'BandosGodsword']) {
    require(`../plugins/combat/specials/${file}.SpecialAttack`)({
      core: PluginManager.getCoreApi(),
      registerCombatSpecial: (entry) => { methods[entry.id] = entry.combatMethod; },
      emitCustomEvent: (name, event) => { if (name === 'combat-special:missed-drain') Tekton.missedDrain(event); },
    });
  }
  const npc = (id, defence) => ({
    defence,
    getId: () => id,
    isPlayer: () => false,
    isNpc: () => true,
    getAsNpc() { return this; },
    performGraphic() {},
    getCurrentLevel() { return this.defence; },
    setCurrentLevels(skill, level) { this.defence = Math.max(0, level); },
    getDefenceLevel() { return this.defence; },
    setDefenceLevel(level) { this.defence = Math.max(0, level); },
  });
  const raider = (specialId, activated = true) => ({
    isPlayer: () => true,
    getAsPlayer() { return this; },
    isSpecialActivated: () => activated,
    getCombatSpecial: () => ({ getId: () => specialId }),
    sendMessage() {},
  });
  const impact = (attacker, target, damage, accurate) => ({
    getAttacker: () => attacker, getTarget: () => target, getTotalDamage: () => damage, isAccurate: () => accurate,
  });
  const swing = (attacker, target, rolled = 0) => {
    const roll = { attacker, target, forceAccurate: false };
    Tekton.guaranteeFirstSpecial(roll);
    const event = { attacker, target, damage: new HitDamage(rolled, rolled > 0 ? HitMask.RED : HitMask.BLUE), accurate: roll.forceAccurate };
    Tekton.landGuaranteedSpecial(event);
    return { forced: roll.forceAccurate, accurate: event.accurate, damage: event.damage.getDamage() };
  };

  // The first DWH / elder maul special on a Tekton is accurate and deals damage; only one.
  const tekton = npc(7540, 205);
  const dwh = raider('dragon_warhammer');
  assert.deepEqual(swing(raider('dragon_warhammer', false), tekton), { forced: false, accurate: false, damage: 0 }, 'a normal swing');
  assert.deepEqual(swing(raider('bandos_godsword'), tekton), { forced: false, accurate: false, damage: 0 }, 'not a BGS');
  assert.deepEqual(swing(dwh, tekton, 0), { forced: true, accurate: true, damage: 1 }, 'a rolled 0 still damages');
  assert.deepEqual(swing(raider('elder_maul'), tekton), { forced: false, accurate: false, damage: 0 }, 'only the first');
  const enraged = npc(7544, 205);
  assert.deepEqual(swing(raider('elder_maul'), enraged, 40), { forced: true, accurate: true, damage: 40 }, 'every Tekton form, its own first');
  assert.deepEqual(swing(dwh, npc(7413, 100)), { forced: false, accurate: false, damage: 0 }, 'not Tekton');

  // A failed DWH or elder maul special drains 5% of his Defence; a failed BGS 10 levels.
  methods.dragon_warhammer.handleAfterHitEffects(impact(dwh, tekton, 0, true));
  assert.equal(tekton.defence, 195, 'DWH dealing no damage: 205 - floor(10.25)');
  methods.elder_maul.handleAfterHitEffects(impact(dwh, tekton, 0, false));
  assert.equal(tekton.defence, 186, 'elder maul miss: 195 - floor(9.75)');
  methods.bandos_godsword.handleAfterHitEffects(impact(dwh, tekton, 0, false));
  assert.equal(tekton.defence, 176, 'BGS miss: 10 levels');
  methods.dragon_warhammer.handleAfterHitEffects(impact(dwh, tekton, 30, true));
  assert.equal(tekton.defence, 124, 'a damaging Smash is the usual 30%');

  const other = npc(7413, 100);
  methods.dragon_warhammer.handleAfterHitEffects(impact(dwh, other, 0, true));
  methods.elder_maul.handleAfterHitEffects(impact(dwh, other, 0, false));
  methods.bandos_godsword.handleAfterHitEffects(impact(dwh, other, 0, false));
  assert.equal(other.defence, 100, 'other monsters lose nothing to a failed special');
});

test('puzzle rules from the Wiki: brazier, chest and grub rolls, stuns, tightrope guards', () => {
  assert.equal(IceDemon.lightChance(1), 0.08);
  assert.ok(Math.abs(IceDemon.lightChance(99) - 0.78) < 1e-9);
  assert.equal(Thieving.openChance(1, false), 0.39);
  assert.ok(Math.abs(Thieving.openChance(99, true) - 0.82) < 1e-9);
  for (let i = 0; i < 200; i++) {
    const grubs = Thieving.grubsFound(99);
    assert.ok(grubs >= 2 && grubs <= 3);
    assert.equal(Thieving.grubsFound(20), 1);
    const stun = Crabs.stunTicks(1);
    assert.ok(stun >= 50 && stun <= 60);
  }
  assert.deepEqual(Tightrope.counts(1), { rangers: 2, mages: 2 });
  assert.deepEqual(Tightrope.counts(10), { rangers: 4, mages: 4 });
});

test('a Challenge Mode raid loads every room without errors', () => {
  Parties.clear();
  spawned.length = 0;
  const leader = fakePlayer('Challenger');
  channelWith('Challenger', leader);
  Lobby.makeParty(leader);
  Lobby.clickPartyButton({ player: leader, slot: 8 });
  leader.setAttribute(Shared.ATTR.WARNED, true);
  Lobby.enterChambers({ player: leader });
  const raid = Parties.partyOf(leader).raid;
  ticks(5);
  assert.equal(raid.challenge, true);
  const warnings = [];
  const warn = console.warn;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    RaidUnit.startRaid({ player: leader });
    leader.prompts.at(-1).args[1]();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, []);
  const keys = raid.rooms.map((room) => room.key);
  for (const key of ['ICE_DEMON', 'CREATURE_KEEPER', 'DEATHLY_ROOM', 'CRAB_PUZZLE']) assert.ok(keys.includes(key), key);
  const demon = spawned.find((npc) => npc.getId() === 7584);
  assert.ok(demon, 'the frozen ice demon');
  assert.equal(demon.getMaxHitpoints(), Monsters.scale(7584, raid.scaling).hitpoints, 'scaled at spawn');
  assert.ok(spawned.some((npc) => npc.getId() === 7586), 'an icefiend');
  // rsprox captures: the bar reaching 0 thaws the storm; the demon turns hostile 8 ticks later.
  const ice = raid.rooms.find((room) => room.key === 'ICE_DEMON');
  demon.isRegistered = () => true;
  ice.stormLeft = 50;
  ice.tick();
  assert.equal(ice.stage, 'thawing');
  assert.equal(ice.icefiends.size, 0);
  ticks(8);
  assert.equal(ice.stage, 'fighting');
  assert.equal(demon.getNpcTransformationId(), 7585);
  // rsprox captures: Vasa's special runs 13 ticks from 7409 to lighting his next crystal.
  const vasa = raid.rooms.find((room) => room.key === 'VASA_NISTIRIO');
  vasa.vasa.isRegistered = () => true;
  vasa.special();
  assert.equal(vasa.state, 'special');
  ticks(12);
  assert.equal(vasa.state, 'special');
  ticks(1);
  assert.equal(vasa.state, 'walking');
  assert.ok(vasa.crystals.some(Boolean), 'a crystal is lit');
  assert.ok(spawned.some((npc) => npc.getId() === 7602), 'the corrupted scavenger');
  assert.ok(spawned.filter((npc) => npc.getId() === 7576).length === 4, 'four crabs');
  assert.ok(spawned.some((npc) => npc.getId() === 7540), 'Tekton at his anvil');
  assert.equal(spawned.filter((npc) => npc.getId() === 7525).length, 3, 'three buried vanguards');
  assert.ok(spawned.some((npc) => npc.getId() === 7565), 'Vasa asleep');
  assert.ok(spawned.some((npc) => npc.getId() === 7564), 'the meat tree');
  assert.equal(spawned.find((npc) => npc.getId() === 7540).getMaxHitpoints(), Monsters.scale(7540, raid.scaling).hitpoints);
  assert.equal(spawned.filter((npc) => [7604, 7605, 7606].includes(npc.getId())).length, 3, 'three mystics solo');
  assert.equal(spawned.filter((npc) => [7573, 7574].includes(npc.getId())).length, 2, 'two shamans solo');
  const guardian = spawned.find((npc) => npc.getId() === 7569);
  const Guardians = require('../plugins/minigames/cox/Guardians.ChambersOfXeric');
  assert.equal(guardian.getMaxHitpoints(), Guardians.guardianHitpoints(1, 90, true), 'Wiki: 151 x (1 + team/2) + mining x team, +50% CM');
  assert.ok(raid.olmRoom, 'the Olm\'s chamber has its room');
  assert.equal(raid.olmRoom.totalPhases, 3, 'solo: three claw phases, then the final stand');
  assert.equal(raid.roomAt(raid.map.olmTile(3232, 5734)), raid.olmRoom);
  for (let i = 0; i < 20; i++) raid.tick();
  raid.destroy();
  Parties.clear();
});

// ------------------------------------------------------------------ phase 6: the Great Olm

test('the Great Olm rises when the barrier is passed: head, claws and a power', () => {
  Parties.clear();
  spawned.length = 0;
  const leader = fakePlayer('Olmer');
  channelWith('Olmer', leader);
  Lobby.makeParty(leader);
  leader.setAttribute(Shared.ATTR.WARNED, true);
  Lobby.enterChambers({ player: leader });
  const raid = Parties.partyOf(leader).raid;
  ticks(5);
  RaidUnit.startRaid({ player: leader });
  leader.prompts.at(-1).args[1]();
  const olm = raid.olmRoom;
  leader.location = raid.map.olmTile(3232, 5740);
  olm.rise();
  ticks(15);
  assert.ok(spawned.some((npc) => npc.getId() === 7554), 'the head');
  assert.ok(spawned.some((npc) => npc.getId() === 7555) && spawned.some((npc) => npc.getId() === 7553), 'both claws');
  assert.ok([0, 1, 2].includes(olm.power), 'a power');
  assert.equal(olm.head.getMaxHitpoints(), Monsters.scale(7554, raid.scaling).hitpoints);
  assert.ok(olm.inChamber(leader.location));
  assert.equal(olm.zoneWithMostPlayers(), 1, 'the middle');
  raid.destroy();
  Parties.clear();
});

// ------------------------------------------------------------------ phase 7: rewards

test('rewards follow the Wiki: unique odds, common amounts, target times', () => {
  const Rewards = require('../plugins/minigames/cox/Rewards.ChambersOfXeric');
  // 8,676 points per 1%; 570,000 points per roll at most.
  let hits = 0;
  for (let i = 0; i < 20000; i++) hits += Rewards.uniqueRolls(86760);
  assert.ok(hits > 1800 && hits < 2200, `~10% at 86,760 points (${hits / 200}%)`);
  assert.equal(Rewards.uniqueRolls(570000, () => 0.6), 1, '65.7% at the cap');
  assert.equal(Rewards.uniqueRolls(855000, () => 0.3), 2, 'the rest rolls a second time');
  const drops = Rewards.commonLoot(131071, () => 0);
  assert.equal(drops.length, 2);
  assert.deepEqual(drops[0], { id: 560, amount: 3640, noted: false }, 'death runes at their maximum');
  assert.notEqual(drops[0].id, drops[1].id, 'two different drops');
  assert.equal(Rewards.commonLoot(0, () => 0)[0].amount, 1, 'at least one');
  assert.equal(Rewards.targetTicks(1), 7000, 'solo: 70 minutes');
  assert.equal(Rewards.targetTicks(5), 4200, '5-10: 42 minutes');
  assert.equal(Rewards.UNIQUES.reduce((sum, item) => sum + item.weight[0], 0), 60);
  assert.equal(Rewards.UNIQUES.reduce((sum, item) => sum + item.weight[1], 0), 56);
});

test('a completed raid: counts, the chest\'s loot for each raider', () => {
  const Rewards = require('../plugins/minigames/cox/Rewards.ChambersOfXeric');
  const party = new Parties.Party(fakePlayer('Winner'), { key: 'Winner' });
  const raid = new RaidModule.Raid(party);
  raid.stage = RaidModule.STAGE.STARTED;
  raid.startCycle = 0;
  const winner = fakePlayer('Winner');
  winner.getBank = () => ({ contains: () => false });
  raid.players.add(winner);
  raid.original.add('Winner');
  winner.setAttribute(RaidModule.ATTR_RAID, raid);
  raid.addPoints(winner, 20000);
  raid.complete();
  Rewards.completed(raid);
  assert.equal(raid.completed, true);
  assert.equal(winner.getAttribute(Shared.ATTR.KILLS), 1);
  const loot = raid.rewards.get('Winner');
  assert.ok(loot.length >= 2, 'commons (or a unique) and the dark journal');
  assert.ok(loot.some((entry) => entry.id === 20899), 'the dark journal');
  assert.ok(winner.messages.some((text) => text.includes('count is')));
  raid.destroy();
});
