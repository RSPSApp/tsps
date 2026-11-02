const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const path = require('node:path');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();
const { PluginManager: PM } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { PlayerSave } = require('../dist/game/entity/impl/player/persistence/PlayerSave');
let core, common, bounty, loot;
before(async () => {
  await require('../dist/game/cache/CachePipeline').CachePipeline.initialize(path.resolve(__dirname, '..'));
  PM.loadFromDirectory(path.resolve(__dirname, '../plugins'));
  core = PM.getCoreApi();
  core.RegionManager.init();
  new (require('../dist/game/definition/loader/impl/NpcDefinitionLoader').NpcDefinitionLoader)().load();
  PM.emitServerStartup({});
  common = require('../plugins/skills/sailing/porttasks/Common.PortTasks');
  bounty = require('../plugins/skills/sailing/porttasks/Bounty.PortTasks');
  loot = require('../plugins/skills/sailing/seacombat/Loot.SeaCombat');
});
after(() => PM.emitServerShutdown({}));
let index = 1600;
function player(t) {
  const p = new Player(null);
  p.setIndex(index++); p.setUsername(`bountyqa${index}`); p.setRegistered(true);
  t.mock.method(p, 'getSession', () => ({ sendClientPacket() { return true; }, write() { return true; } }));
  p.setLocation(new core.Location(3061, 2985, 0)); p.setHitpoints(10);
  t.mock.method(p.getInventory(), 'refreshItems', () => p.getInventory());
  t.after(() => { p.setRegistered(false); });
  return p;
}
function taskFor(id, part) {
  return common.DATA.tasks.find(task => {
    const b = bounty.bountyOf(task);
    return b?.creature === id && (!part || b.part === part);
  });
}
function accept(p, task, slot = 0) {
  const held = common.slots(p); held[slot] = { id: task.id, taken: 0, delivered: 0 };
  common.setSlots(p, held);
  PM.emitCustomEvent('port-tasks:bounty-accepted', { player: p, task, index: slot });
}
function corpse(t, p, id, share = 1, helper = null) {
  const npc = core.NPC.create(id, p.getLocation().clone());
  npc.getCombat().addDamage(p, npc.getMaxHitpoints() * share);
  if (helper) npc.getCombat().addDamage(helper, npc.getMaxHitpoints() * (1 - share));
  PM.emitNpcBeforeDeath({ npc, preventDeath: false });
  npc.getCombat().getKiller(true); // The death task clears the record before emitting death.
  PM.emitNpcDeath({ killer: p, damagers: helper ? [p, helper] : [p], npc, npcId: id, location: {}, remains: null });
  t.after(() => { loot.corpses.delete(npc); core.World.getNpcs().remove(npc); });
  return npc;
}
function roll(p, npc, id, name) {
  const event = { player: p, npc, npcId: id, drops: [], entryFilter: entry => entry.name === name };
  PM.emitCustomEvent('npc-drops:roll-table', event); return event.drops;
}
function harvest(p, npc) {
  assert.equal(PM.emitNpcInteraction({ player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: 1,
    location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: 0 }, handled: false }), true);
  assert.equal(loot.corpses.get(npc)?.harvesting, true, 'the native option reached sea combat harvest');
  for (let i = 0; i < 2; i++) { core.World.processCycle++; core.TaskManager.process(); }
  assert.equal(loot.corpses.has(npc), false, 'the delayed pickup completed');
}

test('on-task armoured kraken bottled storm has the Wiki 1/250 chance', t => {
  const p = player(t); accept(p, taskFor(15210));
  const npc = corpse(t, p, 15210);
  t.mock.method(Math, 'random', () => 1 / 300);
  assert.equal(roll(p, npc, 15210, 'Bottled storm')[0]?.itemId, 31949);
});

test('narwhal on-task nails select existing conditional 5–10 quantity, not base 3–7', t => {
  const p = player(t); accept(p, taskFor(15202));
  const npc = corpse(t, p, 15202);
  t.mock.method(Math, 'random', () => 0);
  assert.equal(roll(p, npc, 15202, 'Dragon nails')[0]?.amount, 5);
});

test('half damage halves armoured kraken bounty part chance after the live combat record is cleared', t => {
  const p = player(t), helper = player(t); const task = taskFor(15210); accept(p, task);
  const npc = corpse(t, p, 15210, 0.5, helper);
  const event = { player: p, npc, creature: { npc: 15210 }, drops: [], extra: [], claims: [] };
  // Query must use the stored corpse contribution, not a fabricated damage field.
  t.mock.method(Math, 'random', () => 0.075);
  PM.emitCustomEvent('sea-combat:harvest', event);
  assert.equal(event.extra.length, 0);
});

test('boost stops at earned threshold through real PlayerSave reload even after parts are destroyed', t => {
  const p = player(t); const task = taskFor(15210); accept(p, task);
  const b = bounty.bountyOf(task);
  p.getInventory().add(new core.Item(b.part, b.amount));
  // Acceptance credits parts retained from a previous assignment.
  PM.emitCustomEvent('port-tasks:bounty-accepted', { player: p, task, index: 0 });
  p.getInventory().deleteNumber(b.part, b.amount);
  const saved = PlayerSave.fromPlayer(p), reloaded = player(t); saved.applyToPlayer(reloaded); reloaded.setRegistered(true);
  assert.equal(common.slots(reloaded)[0].collected, b.amount);
  const npc = corpse(t, reloaded, 15210);
  t.mock.method(Math, 'random', () => 1 / 300);
  assert.equal(roll(reloaded, npc, 15210, 'Bottled storm').length, 0);
  const harvest = { player: reloaded, npc, creature: { npc: 15210 }, drops: [], extra: [], claims: [] };
  bounty.onHarvest(harvest, () => 0);
  assert.equal(harvest.extra[0]?.itemId, b.part, 'lost parts are replaceable without extending boost');
});

test('a delayed part claim cannot count for a replacement assignment in the same slot', t => {
  const p = player(t), task = taskFor(15210); accept(p, task);
  const npc = corpse(t, p, 15210);
  const event = { player: p, npc, creature: { npc: 15210 }, drops: [], extra: [], claims: [] };
  bounty.onHarvest(event, () => 0);
  assert.equal(event.claims.length, 1);
  accept(p, task); // A fresh assignment, even if its task id matches, owns different progress.
  event.claims[0].commit();
  assert.equal(common.slots(p)[0].collected, 0);
});

test('real queued overkill credits only HP actually removed, including the final death-triggering splat', t => {
  const p = player(t), helper = player(t);
  const npc = core.NPC.create(15210, p.getLocation().clone());
  npc.setRegistered(true); npc.setMaxHitpoints(100); npc.setHitpoints(100);
  const options = { rollAccuracy: false, experience: false, handleAfterHitEffects: false };
  // Both projectiles were rolled at 100 HP. Helper removes40; captain removes only60.
  const first = new core.PendingHit(helper, npc, core.CombatFactory.RANGED_COMBAT, { ...options, damage: 40 });
  const second = new core.PendingHit(p, npc, core.CombatFactory.RANGED_COMBAT, { ...options, damage: 100 });
  core.CombatFactory.executeHit(first); core.CombatFactory.executeHit(second);
  npc.getCombat().getHitQueue().process(core.World.getProcessCycle());
  assert.equal(npc.getHitpoints(), 0);
  for (let i = 0; i < 20; i++) { core.World.processCycle++; core.TaskManager.process(); }
  assert.equal(npc.getCombat().getRecentDamagerEntries().length, 0, 'real death task cleared raw damage');
  const info = { player: p, npc };
  PM.emitCustomEvent('sea-combat:reward-context', info);
  assert.equal(info.damageShare, 0.6);
  t.after(() => { loot.corpses.delete(npc); npc.setRegistered(false); });
});

for (const [id, name, rate] of [[15204, 'Echo pearl', 35], [15200, 'Broken dragon hook', 250],
  [15210, 'Bottled storm', 250], [15212, 'Bottled storm', 175], [15576, 'Dragon cannon barrel', 250]]) {
  test(`${name} on ${id}: exact on-task boundary and off-task control`, t => {
    const p = player(t), npc = corpse(t, p, id);
    t.mock.method(Math, 'random', () => 0.75 / rate);
    assert.equal(roll(p, npc, id, name).length, 0);
    accept(p, taskFor(id));
    assert.equal(roll(p, npc, id, name).length, 1);
    Math.random.mock.mockImplementation(() => 1.001 / rate);
    assert.equal(roll(p, npc, id, name).length, 0);
  });
}

test('orca nails use7–11 while its earned count is incomplete and4–8 afterwards', t => {
  const p = player(t), task = taskFor(15204); accept(p, task);
  const npc = corpse(t, p, 15204);
  t.mock.method(Math, 'random', () => 0);
  assert.equal(roll(p, npc, 15204, 'Dragon nails')[0].amount, 7);
  const held = common.slots(p); held[0].collected = bounty.bountyOf(task).amount; common.setSlots(p, held);
  assert.equal(roll(p, npc, 15204, 'Dragon nails')[0].amount, 4);
});

test('partial damage scales pre-rolls but never doubles Inky paint, narwhal horn or ordinary loot', t => {
  const p = player(t), helper = player(t); accept(p, taskFor(15210));
  const npc = corpse(t, p, 15210, 0.5, helper);
  t.mock.method(Math, 'random', () => 0.75 / 2000);
  assert.equal(roll(p, npc, 15210, 'Inky paint').length, 0, 'half rate, no on-task doubling');
  Math.random.mock.mockImplementation(() => 0.4 / 2000);
  assert.equal(roll(p, npc, 15210, 'Inky paint').length, 1);
  Math.random.mock.mockImplementation(() => 0);
  assert.equal(roll(p, npc, 15210, 'Coins')[0].amount, 16000, 'main table unchanged');
  const narwhal = corpse(t, p, 15202); accept(p, taskFor(15202));
  Math.random.mock.mockImplementation(() => 0.075);
  assert.equal(roll(p, narwhal, 15202, 'Narwhal horn').length, 0, 'not doubled on-task');
});

test('small creatures keep their full bounty chance when another player helped', t => {
  const p = player(t), helper = player(t), task = taskFor(15228); accept(p, task);
  const npc = corpse(t, p, 15228, 0.5, helper);
  const event = { player: p, npc, creature: { npc: 15228 }, drops: [], extra: [], claims: [] };
  bounty.onHarvest(event, () => 0.075);
  assert.equal(event.extra.length, 1);
});

test('native Harvest awards and commits exactly one part through the real shared loot rules', t => {
  const p = player(t), task = taskFor(15210); accept(p, task);
  const b = bounty.bountyOf(task), npc = corpse(t, p, 15210);
  // Zero hits every independent tertiary seed and intentionally overflows28 slots.
  t.mock.method(Math, 'random', () => 0.02);
  harvest(p, npc);
  assert.equal(p.getInventory().getAmount(b.part), 1);
  assert.equal(common.slots(p)[0].collected, 1);
  assert.equal(loot.corpses.has(npc), false);
  const again = { player: p, npc, npcId: npc.getId(), npcIndex: npc.getIndex(), clickType: 1, location: {}, handled: false };
  PM.emitNpcInteraction(again);
  assert.equal(p.getInventory().getAmount(b.part), 1, 'repeat cannot duplicate harvested loot');
});

test('real Ironman shared-kill policy suppresses bounty parts and received progress together', t => {
  const p = player(t), helper = player(t), task = taskFor(15210); accept(p, task);
  p.setAttribute('ironman:mode', 'ironman');
  const npc = corpse(t, p, 15210, 0.5, helper);
  t.mock.method(Math, 'random', () => 0);
  harvest(p, npc);
  assert.equal(p.getInventory().getAmount(bounty.bountyOf(task).part), 0);
  assert.equal(common.slots(p)[0].collected, 0);
});

test('other creatures keep accepted-task order and award one part at a time', t => {
  const p = player(t), first = taskFor(15228);
  const second = common.DATA.tasks.find(task => bounty.bountyOf(task)?.creature === 15228 && bounty.bountyOf(task).part !== bounty.bountyOf(first).part);
  accept(p, first); accept(p, second, 1);
  const firstPart = bounty.bountyOf(first), secondPart = bounty.bountyOf(second);
  t.mock.method(Math, 'random', () => 0.02);
  harvest(p, corpse(t, p, 15228));
  assert.equal(p.getInventory().getAmount(firstPart.part), 1);
  assert.equal(p.getInventory().getAmount(secondPart.part), 0);
  for (let i = 1; i < firstPart.amount; i++) harvest(p, corpse(t, p, 15228));
  harvest(p, corpse(t, p, 15228));
  assert.equal(p.getInventory().getAmount(firstPart.part), firstPart.amount);
  assert.equal(p.getInventory().getAmount(secondPart.part), 1);
});

for (const id of [15210, 15212]) {
  test(`${id} tentacle task precedes earlier-accepted ink sac task until its parts are earned`, t => {
    const p = player(t), ink = taskFor(id);
    assert.match(core.ItemDefinition.forId(bounty.bountyOf(ink).part).getName(), /ink sac/i);
    const tentacle = common.DATA.tasks.find(task => bounty.bountyOf(task)?.creature === id &&
      /tentacle/i.test(core.ItemDefinition.forId(bounty.bountyOf(task).part).getName()));
    accept(p, ink); accept(p, tentacle, 1);
    const npc = corpse(t, p, id), creature = { npc: id };
    const event = { player: p, npc, creature, drops: [], extra: [], claims: [] };
    bounty.onHarvest(event, () => 0);
    assert.equal(event.extra[0].itemId, bounty.bountyOf(tentacle).part);
    event.claims[0].commit();
    assert.equal(common.slots(p)[0].collected, 0);
    assert.equal(common.slots(p)[1].collected, 1);
    const held = common.slots(p); held[1].collected = bounty.bountyOf(tentacle).amount; common.setSlots(p, held);
    const next = { player: p, npc, creature, drops: [], extra: [], claims: [] };
    bounty.onHarvest(next, () => 0);
    assert.equal(next.extra[0].itemId, bounty.bountyOf(ink).part, 'no port hand-in required to switch');
  });
}

test('real cancellation keeps physical parts and reassignment credits them without a new boost', t => {
  const p = player(t), task = taskFor(15210), b = bounty.bountyOf(task); accept(p, task);
  t.mock.method(Math, 'random', () => 0.02);
  for (let i = 0; i < b.amount; i++) harvest(p, corpse(t, p, 15210));
  require('../plugins/skills/sailing/porttasks/PortMaster.PortTasks').cancel(p, 0);
  assert.equal(p.getInventory().getAmount(b.part), b.amount);
  accept(p, task);
  assert.equal(common.slots(p)[0].collected, b.amount);
  Math.random.mock.mockImplementation(() => 1 / 300);
  assert.equal(roll(p, corpse(t, p, 15210), 15210, 'Bottled storm').length, 0);
});

test('full inventory puts the actual bounty part on owned ground and still closes its receipt once', t => {
  const p = player(t), task = taskFor(15210), b = bounty.bountyOf(task); accept(p, task);
  for (let i = 0; i < 28; i++) p.getInventory().add(new core.Item(391, 1));
  t.mock.method(Math, 'random', () => 0.02);
  harvest(p, corpse(t, p, 15210));
  assert.equal(p.getInventory().getAmount(b.part), 0);
  assert.equal(common.slots(p)[0].collected, 1);
  const ground = core.ItemOnGroundManager.getGroundItem(p.getUsername(), b.part, p.getLocation(), p.getPrivateArea());
  assert.equal(ground?.getItem().getAmount(), 1);
  core.ItemOnGroundManager.deregister(ground);
});

test('native drop/destroy of a completed stack leaves the boost closed and permits replacements', t => {
  const p = player(t), task = taskFor(15210), b = bounty.bountyOf(task);
  p.getInventory().add(new core.Item(b.part, b.amount)); accept(p, task);
  const slot = p.getInventory().getSlotForItemId(b.part);
  require('../dist/net/packet/impl/DropItemPacketListener').DropItemPacketListener.drop(p, b.part, core.Inventory.INTERFACE_ID, slot);
  if (p.getAttribute('destroy-item:pending')) {
    PM.emitInterfaceActionClick({ player: p, buttonId: 584 << 16, action: 1, slot: -1, itemId: -1,
      groupId: 584, childId: 0, handled: false });
  }
  assert.equal(p.getInventory().getAmount(b.part), 0);
  assert.equal(common.slots(p)[0].collected, b.amount);
  const npc = corpse(t, p, 15210);
  t.mock.method(Math, 'random', () => 1 / 300);
  assert.equal(roll(p, npc, 15210, 'Bottled storm').length, 0);
  harvest(p, npc);
  assert.equal(p.getInventory().getAmount(b.part), 1);
  assert.equal(common.slots(p)[0].collected, b.amount);
});

test('shared loot zeroing a part does not count it as received', t => {
  const p = player(t), task = taskFor(15210), b = bounty.bountyOf(task); accept(p, task);
  PM.createApi('BountyZeroDrop').onCustomEvent('npc-drops:roll', event => {
    if (event.player === p) for (const drop of event.drops) if (drop.itemId === b.part) drop.amount = 0;
  });
  t.mock.method(Math, 'random', () => 0.02);
  harvest(p, corpse(t, p, 15210));
  assert.equal(p.getInventory().getAmount(b.part), 0);
  assert.equal(common.slots(p)[0].collected, 0);
});

test('a real recruited crewmate cannon hit contributes to its captain rather than a separate helper', t => {
  const p = player(t);
  p.getSkillManager().setMaxLevel(core.Skill.SAILING, 99);
  p.getSkillManager().setCurrentLevel(core.Skill.SAILING, 99);
  const crew = require('../plugins/skills/sailing/crew/Common.Crew');
  crew.update(p, state => { state.recruited.push(3); state.met.push(3); state.slots[0] = 3; });
  const facilities = require('../plugins/skills/sailing/BoatFacilities.Sailing');
  const owned = core.Sailing.giveBoat(p, 'sloop', 'the_pandemonium');
  let hotspot;
  for (const h of facilities.hotspotsOf(owned.type)) {
    const row = h.allowed.find(row => facilities.facilityRequirements(row).name.toLowerCase() === 'rune cannon');
    if (row !== undefined) { facilities.setFacility(owned, h.id, row); hotspot = h; break; }
  }
  assert.ok(hotspot);
  assert.equal(core.Sailing.board(p, 'the_pandemonium'), null);
  const boat = core.Sailing.instanceAboard(p);
  t.after(() => { core.Sailing.disembark(p, 'the_pandemonium'); });
  core.World.processCycle++; core.TaskManager.process();
  const member = crew.crewAboard(boat)[0]; assert.ok(member, 'the recruited real NPC boarded');
  const cannon = require('../plugins/skills/sailing/seacombat/Cannon.SeaCombat');
  const job = cannon.manByCrew(p, boat, owned, member, hotspot.id); assert.ok(job);
  t.after(() => job.stop());
  const gunner = cannon._test.gunners.get(cannon._test.keyOf(boat, hotspot.id));
  assert.ok(gunner);
  require('../plugins/skills/sailing/Cargo.Sailing').store(owned, 31914, 10);
  const npc = core.NPC.create(15210, core.BoatManager.rootLocation(p).clone());
  core.World.getNpcs().add(npc, true); npc.setNeedsPlacement(false);
  t.after(() => { core.World.getNpcs().remove(npc); loot.corpses.delete(npc); });
  const rolls = [0, 0.5];
  t.mock.method(Math, 'random', () => rolls.shift() ?? 0.5);
  const before = npc.getHitpoints(), rolled = cannon.fire(gunner, { npc });
  assert.ok(rolled > 0);
  for (let i = 0; i < 16; i++) {
    core.World.processCycle++; core.TaskManager.process(); npc.getCombat().getHitQueue().process(core.World.getProcessCycle());
  }
  const taken = before - npc.getHitpoints(); assert.ok(taken > 0);
  PM.emitNpcBeforeDeath({ npc, preventDeath: false });
  npc.getCombat().getKiller(true);
  PM.emitNpcDeath({ killer: p, damagers: [p], npc, npcId: 15210, location: {}, remains: null });
  const info = { player: p, npc }; PM.emitCustomEvent('sea-combat:reward-context', info);
  assert.equal(info.damageShare, taken / before);
  assert.deepEqual(loot.corpses.get(npc).damagers, [p]);
});
