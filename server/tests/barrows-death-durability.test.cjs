// Run after `yarn build`: node --test tests/barrows-death-durability.test.cjs
// Every Barrows piece was broken on every death, protected or not, PvM or PvP. Wiki (Items Kept on Death): an
// unprotected piece goes to the grave unbroken after a PvM death, and to the PKer as its broken version; a protected
// piece is kept as it is. Real engine: every plugin loaded, real Players, the real PlayerDeathTask.dropItems.
// The last case covers the shared bank placeholder for partially degraded pieces (Update: Bank Placeholders & PID).
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerDeathTask } = require("../dist/game/task/impl/PlayerDeath");
let core, I, L;
before(async () => { await CachePipeline.initialize(path.resolve(__dirname, "..")); PM.loadFromDirectory(path.resolve(__dirname, "../plugins")); core = PM.getCoreApi(); I = core.ItemIdentifiers; L = require("../plugins/items/LootKeys.plugin"); PM.emitServerStartup({}); });
after(() => PM.emitServerShutdown({}));
let next = 9010;
function wp(t) { const ch = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(ch)); p.setIndex(next++); p.setUsername("dk" + p.getIndex()); p.setRegistered(true); p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3100, 3600, 0)); t.after(() => p.setRegistered(false)); return p; }
const keysOf = (p) => [I.LOOT_KEY, I.LOOT_KEY_2, I.LOOT_KEY_3, I.LOOT_KEY_4, I.LOOT_KEY_5].reduce((n, id) => n + p.getInventory().getAmount(id), 0);
const Barrows = () => require("../plugins/items/BarrowsEquipment.plugin");
const stand = (p) => { p.setLocation(new core.Location(3222, 3218, 0)); return p; }; // Lumbridge, not the Wilderness
function dressed(p) {
  const kept = new core.Item(I.DHAROKS_PLATEBODY, 1);
  const lost = new core.Item(I.DHAROKS_PLATELEGS, 1);
  p.getEquipment().setItem(core.Equipment.BODY_SLOT, kept);
  p.getEquipment().setItem(core.Equipment.LEG_SLOT, lost);
  // Three pricier items take the kept slots after the platebody's place: an AGS and two dragon claws.
  p.getInventory().setItem(0, new core.Item(I.ARMADYL_GODSWORD, 1));
  p.getInventory().setItem(1, new core.Item(I.DRAGON_CLAWS, 1));
  return { kept, lost };
}
const broken = (item) => String(core.ItemDefinition.forId(item.getId()).getName()).endsWith(" 0");

test("a PvM death breaks no Barrows piece, kept or sent to the grave", (t) => {
  const victim = stand(wp(t));
  const { kept, lost } = dressed(victim);
  const keptItems = PlayerDeathTask.dropItems(victim, null, victim.getLocation());
  assert.equal(broken(kept) || broken(lost), false, "neither piece broken");
  assert.ok(keptItems.length > 0);
});

test("a PvP death breaks only the unprotected Barrows piece", (t) => {
  const killer = wp(t), victim = wp(t);
  const { kept, lost } = dressed(victim);
  const keptItems = PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  const wasKept = (item) => keptItems.includes(item);
  assert.notEqual(wasKept(kept), wasKept(lost), "one piece protected, the other lost");
  for (const item of [kept, lost]) assert.equal(broken(item), !wasKept(item), `${wasKept(item) ? "kept" : "lost"} piece`);
});

test("a player kill outside the Wilderness breaks no Barrows piece, as Death.BrokenItems breaks nothing there", (t) => {
  const killer = stand(wp(t)), victim = stand(wp(t));
  const { kept, lost } = dressed(victim);
  PlayerDeathTask.dropItems(victim, killer, victim.getLocation());
  assert.equal(broken(kept) || broken(lost), false, "neither piece broken");
});

test("a partially degraded Barrows piece leaves its family's bank placeholder", (t) => {
  const p = wp(t);
  p.setStatus(core.PlayerStatus.BANKING);
  p.setInterfaceId(core.Bank.MAIN_INTERFACE_ID);
  p.setPlaceholders(true);
  const bank = p.getBank(0);
  bank.add(new core.Item(I.DHAROKS_HELM_25, 1), false);
  const slot = bank.getSlotForItemId(I.DHAROKS_HELM_25);
  core.Bank.withdraw(p, I.DHAROKS_HELM_25, slot, 1, 0);

  assert.equal(p.getInventory().getAmount(I.DHAROKS_HELM_25), 1, "the 25% helm is withdrawn");
  const left = bank.getItems()[slot];
  assert.equal(left.getAmount(), 0, "the slot becomes a placeholder");
  assert.equal(left.getId(), I.DHAROKS_HELM, "it holds the family's undegraded item");
  assert.equal(core.Bank.displayItemId(left), I.DHAROKS_HELM_4, "and draws the cache's Dharok's helm placeholder");

  // The real bank shares placeholders between a Barrows item's stages, so the 25% helm goes back
  // into the placeholder slot instead of opening a second one.
  core.Bank.deposits(p, I.DHAROKS_HELM_25, p.getInventory().getSlotForItemId(I.DHAROKS_HELM_25), 1);
  assert.equal(bank.getValidItems().length, 1, "still one bank slot");
  assert.equal(bank.getAmount(I.DHAROKS_HELM_25), 1);
});

// A hand-cast clears its combat target in MagicCombatMethod.finished, before the next Barrows task.
// Keep actual Player/Equipment/Combat/HitQueue/TaskManager and only replace the network transport.
function combatant(t, x) {
  const p = wp(t);
  p.setLocation(new core.Location(x, 3600, 0));
  p.setRights(core.PlayerRights.NONE);
  for (const skill of [core.Skill.HITPOINTS, core.Skill.ATTACK, core.Skill.STRENGTH, core.Skill.DEFENCE, core.Skill.MAGIC]) {
    p.getSkillManager().setMaxLevel(skill, 99);
    p.getSkillManager().setCurrentLevel(skill, 99);
  }
  p.setHitpoints(99);
  p.setAutoRetaliate(false);
  p.setNeedsPlacement(false);
  p.getEquipment().setItem(core.Equipment.HEAD_SLOT, new core.Item(4716));
  p.getInventory().adds(556, 100);
  p.getInventory().adds(558, 100);
  PM.emitPlayerLogin({ player: p, username: p.getUsername() });
  p.getPacketSender().sendInterfaceRemoval();
  require('../dist/game/model/areas/AreaManager').AreaManager.process(p);
  t.after(() => { PM.emitPlayerLogout({ player: p }); p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return p;
}
const wear = p => Barrows()._test.durability(p.getEquipment().get(core.Equipment.HEAD_SLOT));
function combatTicks(players, count = 1) {
  for (let i = 0; i < count; i++) {
    core.World.processCycle++;
    core.TaskManager.process();
    for (const p of players) p.getCombat().getHitQueue().process(core.World.getProcessCycle());
  }
}
function handCast(caster, target) {
  caster.getCombat().setCastSpell(core.CombatSpells.WIND_STRIKE);
  caster.getCombat().attack(target);
  assert.equal(caster.getCombat().performNewAttack(true), true, 'real Wind Strike swing accepted');
  assert.equal(caster.getCombat().getTarget(), null, 'manual spell teardown clears the target');
}

test('one manual spell spends the caster first-use point after target teardown, before delayed defender impact', t => {
  const caster = combatant(t, 3100), target = combatant(t, 3107);
  core.World.processCycle = 100;
  caster.getCombat().attack(target);
  combatTicks([caster, target], 2);
  assert.equal(wear(caster), 1000, 'approach without a swing does not wear gear');
  assert.equal(wear(target), 1000);
  handCast(caster, target);
  assert.equal(target.getCombat().getHitQueue().hasPendingWork(), true);
  assert.equal(wear(caster), 1000, 'no wear on the swing tick');
  combatTicks([caster, target]);
  assert.equal(wear(caster), 999, 'a genuine outgoing first use survives manual target teardown');
  assert.equal(wear(target), 1000, 'incoming-only record must wait for impact');
  combatTicks([caster, target], 7);
  assert.equal(wear(caster), 999, 'the isolated cast is consumed only once');
  assert.equal(wear(target), 999, 'delayed incoming impact still spends its first-use point');
});

test('isolated manual casts each consume one entry and do not leave stale wear on a later approach', t => {
  const caster = combatant(t, 3100), target = combatant(t, 3107);
  core.World.processCycle = 200;
  handCast(caster, target);
  combatTicks([caster, target], 8);
  assert.equal(wear(caster), 999);
  handCast(caster, target);
  combatTicks([caster, target], 8);
  assert.equal(wear(caster), 998, 'existing combat-exit policy makes an isolated later cast a new entry');
  caster.getCombat().attack(target);
  combatTicks([caster, target], 100);
  assert.equal(wear(caster), 998, 'an old consumed swing cannot wear gear while merely approaching');
});

test('continuous combat and repeated manual spells keep one entry point and the 90-tick wear cadence', t => {
  const caster = combatant(t, 3100), target = combatant(t, 3101);
  core.World.processCycle = 400;
  target.getCombat().attack(caster);
  assert.equal(target.getCombat().performNewAttack(true), true);
  let firstWear;
  for (let i = 0; i < 8 && firstWear === undefined; i++) {
    combatTicks([caster, target]);
    if (wear(caster) === 999) firstWear = core.World.getProcessCycle();
  }
  assert.ok(firstWear, 'real incoming hit establishes the continuous fight');
  assert.equal(core.CombatFactory.inCombat(caster), true);
  for (let i = 0; i < 3; i++) {
    handCast(caster, target);
    combatTicks([caster, target], 5);
    assert.equal(wear(caster), 999, 'manual target teardown does not double-charge an active fight');
  }
  combatTicks([caster, target], firstWear + 89 - core.World.getProcessCycle());
  assert.equal(wear(caster), 999, 'no second wear before tick 90');
  combatTicks([caster, target]);
  assert.equal(wear(caster), 998, 'next point exactly 90 task ticks after entry');
});

for (const cancellation of ['clearIncoming', 'attacker logout', 'target logout']) {
  test(`cancelled delayed defender hit (${cancellation}) does not consume an incoming first-use point`, t => {
    const caster = combatant(t, 3100), target = combatant(t, 3107);
    core.World.processCycle = 600;
    handCast(caster, target);
    if (cancellation === 'clearIncoming') target.getCombat().getHitQueue().clearIncoming();
    else if (cancellation === 'attacker logout') {
      // A real logout clears outgoing hits and cancels owner tasks.
      caster.onLogout();
      caster.setRegistered(false);
    } else {
      target.onLogout();
      target.setRegistered(false);
    }
    combatTicks([caster, target], 12);
    assert.equal(wear(target), 1000, 'no impact, no defender wear');
    if (cancellation === 'clearIncoming') {
      assert.equal(wear(caster), 999, 'cancelling impact does not undo the outgoing use');
      target.getCombat().attack(caster);
      combatTicks([caster, target], 5);
      assert.equal(wear(target), 1000, 'expired incoming record cannot charge a later approach');
    }
    // A new session must not inherit a pending entry from the logged-out player object.
    const relogged = combatant(t, 3107);
    combatTicks([relogged], 12);
    assert.equal(wear(relogged), 1000);
  });
}

test('real remove and return preserves canonical durability metadata without stale repeated first-use wear', t => {
  const caster = combatant(t, 3100), target = combatant(t, 3107);
  const { EquipPacketListener } = require('../dist/net/packet/impl/EquipPacketListener');
  core.World.processCycle = 800;
  handCast(caster, target);
  combatTicks([caster, target], 8);
  assert.equal(wear(caster), 999);
  assert.equal(EquipPacketListener.unequip(caster, core.Equipment.HEAD_SLOT), true);
  const slot = caster.getInventory().getSlotForItemId(4880);
  assert.ok(slot >= 0);
  assert.deepEqual(caster.getInventory().get(slot).getMetaValue('barrows'), { remaining: 999 });
  EquipPacketListener.equip(caster, 4880, slot, core.Inventory.INTERFACE_ID);
  assert.equal(caster.getEquipment().get(core.Equipment.HEAD_SLOT).getId(), 4880);
  assert.equal(wear(caster), 999);
  combatTicks([caster, target], 100);
  assert.equal(wear(caster), 999, 'returning gear while idle does not replay the consumed swing');
  handCast(caster, target);
  combatTicks([caster, target], 8);
  assert.equal(wear(caster), 998, 'legitimate next use still consumes one point');
});

test('another genuine swing before the next task cannot postpone the first outgoing use', t => {
  const caster = combatant(t, 3100), target = combatant(t, 3107);
  core.World.processCycle = 1000;
  handCast(caster, target);
  // A bypass swing can run before this player's next task; keep the first unconsumed use's tick.
  core.World.processCycle++;
  handCast(caster, target);
  core.TaskManager.process();
  assert.equal(wear(caster), 999, 'later outgoing activity cannot starve first-use wear');
});
