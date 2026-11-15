// Run after `yarn build`: node --test tests/harmonised-nightmare-staff.test.cjs
//
// Wiki (Harmonised nightmare staff): offensive standard-spellbook spells cast in 4 ticks instead
// of 5, "only when autocasting"; a hand cast with the staff wielded stays at 5 ticks.
//
// Real Player, Equipment, Inventory, NPC and plugins; the combat loop runs as the server's tick
// does. Only the network is stubbed.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
const { Server } = require("../dist/Server");
Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const GUARD = 397;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  await new NpcDefinitionLoader().load();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
  require("../plugins/items/HarmonisedNightmareStaff.plugin").register(PluginManager.createApi("HarmonisedStaffPlugin"));
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(3220, 3220);
  core.Projectile.prototype.sendProjectile = function () {};
});

let index = 3100;
function wielder(t, weapon = I.HARMONISED_NIGHTMARE_STAFF) {
  const player = new Player(null);
  player.setUsername(`harmonised${index}`);
  player.setIndex(index++);
  const sender = new Proxy({}, { get: () => () => sender });
  player.getPacketSender = () => sender;
  player.getSession = () => ({ sendClientPacket: () => true });
  t.mock.method(player, "sendMessage", () => {});
  player.setLocation(new core.Location(3220, 3220));
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  for (const skill of core.Skill.values()) {
    player.getSkillManager().setMaxLevel(skill, 99);
    player.getSkillManager().setCurrentLevel(skill, 99, false);
  }
  player.setSpellbook(MagicSpellbook.NORMAL);
  player.getEquipment().set(core.Equipment.WEAPON_SLOT, new core.Item(weapon));
  player.getInventory().add(new core.Item(I.FIRE_RUNE, 1000));
  player.getInventory().add(new core.Item(I.AIR_RUNE, 1000));
  player.getInventory().add(new core.Item(I.DEATH_RUNE, 1000));
  WeaponInterfaceManager.assign(player);
  core.BonusManager.update(player);
  t.after(() => {
    player.getCombat().reset();
    player.setRegistered(false);
    core.World.unregisterPlayerPosition(player);
  });
  return player;
}

function npc(t) {
  const target = PluginManager.spawnNpc({ id: GUARD, x: 3220, y: 3224 });
  target.setMaxHitpoints(10000);
  target.setHitpoints(10000);
  target.setNeedsPlacement(false);
  target.getMovementQueue().setBlockMovement(true);
  t.after(() => PluginManager.removeNpc(target));
  return target;
}

/** Runs the server's tick for `ticks` ticks and returns the ticks the attacker cast on. */
function castTicks(attacker, target, ticks, recast = null) {
  const casts = [];
  const listener = PluginManager.createApi(`HarmonisedCasts${index++}`);
  let tick = 0;
  listener.onCustomEvent("combat:attack-started", ({ attacker: who }) => { if (who === attacker) casts.push(tick); });
  for (tick = 0; tick < ticks; tick++) {
    if (recast && attacker.getCombat().getAttackDelay() <= 1 && !attacker.getCombat().getCastSpell()) recast();
    core.World.processCycle++;
    core.TaskManager.process();
    attacker.getCombat().preMovementProcess();
    attacker.getMovementQueue().process();
    attacker.getCombat().postMovementProcess();
    target.getCombat().getHitQueue().process(core.World.processCycle);
  }
  return casts;
}

const gaps = (ticks) => ticks.slice(1).map((tick, i) => tick - ticks[i]);

test("an autocast standard spell with the harmonised staff casts every 4 ticks", (t) => {
  const player = wielder(t);
  const target = npc(t);
  Autocasting.setAutocast(player, core.CombatSpells.FIRE_BLAST);
  player.getCombat().attack(target);
  const casts = castTicks(player, target, 18);
  assert.ok(casts.length >= 4, `cast ${casts.length} times`);
  assert.deepEqual([...new Set(gaps(casts))], [4]);
});

test("the same autocast with a plain nightmare staff stays at 5 ticks", (t) => {
  const player = wielder(t, I.NIGHTMARE_STAFF);
  const target = npc(t);
  Autocasting.setAutocast(player, core.CombatSpells.FIRE_BLAST);
  player.getCombat().attack(target);
  const casts = castTicks(player, target, 18);
  assert.ok(casts.length >= 3, `cast ${casts.length} times`);
  assert.deepEqual([...new Set(gaps(casts))], [5]);
});

test("a hand cast with the harmonised staff stays at 5 ticks", (t) => {
  const player = wielder(t);
  const target = npc(t);
  const cast = () => player.getCombat().castSpellOn(target, core.CombatSpells.FIRE_BLAST);
  cast();
  const casts = castTicks(player, target, 18, cast);
  assert.ok(casts.length >= 3, `cast ${casts.length} times`);
  assert.deepEqual([...new Set(gaps(casts))], [5]);
});

test("a hand cast while autocasting keeps its 5 ticks; the autocasts after it are 4 apart", (t) => {
  const player = wielder(t);
  const target = npc(t);
  Autocasting.setAutocast(player, core.CombatSpells.WIND_BLAST);
  const spells = [];
  const listener = PluginManager.createApi("HarmonisedSpells");
  listener.onCustomEvent("combat:attack-started", ({ attacker }) => {
    if (attacker === player) spells.push(player.getCombat().getCastSpell());
  });
  player.getCombat().castSpellOn(target, core.CombatSpells.FIRE_BLAST);
  const casts = castTicks(player, target, 18);
  assert.equal(spells[0], core.CombatSpells.FIRE_BLAST, "the hand cast first");
  assert.ok(spells.slice(1).every((spell) => spell === core.CombatSpells.WIND_BLAST), "then the autocast");
  const [first, ...rest] = gaps(casts);
  assert.equal(first, 5, "the hand cast's delay");
  assert.deepEqual([...new Set(rest)], [4], "the autocasts'");
});

test("Dismantle gives back the Nightmare staff in the staff's slot and the orb in a free one (Wiki)", (t) => {
  const plugin = require("../plugins/items/HarmonisedNightmareStaff.plugin");
  const player = wielder(t, I.NIGHTMARE_STAFF);
  const messages = [];
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  const inventory = player.getInventory();
  t.mock.method(inventory, "refreshItems", () => inventory);
  inventory.resetItems();
  inventory.setItem(5, new core.Item(I.HARMONISED_NIGHTMARE_STAFF, 1));
  const staff = inventory.getItems()[5];
  // Through the real item-action path, by the cache's own option.
  const index = core.CacheDefinitions.getItem(I.HARMONISED_NIGHTMARE_STAFF).inventoryActions.indexOf("Dismantle");
  assert.ok(index >= 0, "the cache gives the staff a Dismantle option");
  assert.equal(PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item: staff, itemId: staff.getId(), slot: 5,
    clickType: index + 1, option: "Dismantle", handled: false,
  }), true);
  assert.equal(inventory.getItems()[5].getId(), I.NIGHTMARE_STAFF, "the staff's slot");
  assert.equal(inventory.getAmount(I.HARMONISED_ORB), 1);
  assert.equal(inventory.getAmount(I.HARMONISED_NIGHTMARE_STAFF), 0);
  assert.deepEqual(messages, []);
  // A second click on the same (now gone) item does nothing.
  assert.equal(plugin._test.dismantle({ player, item: staff }), false);
  assert.equal(inventory.getAmount(I.HARMONISED_ORB), 1);
});

test("Dismantle with a full inventory, or on a preset copy, keeps the staff", (t) => {
  const plugin = require("../plugins/items/HarmonisedNightmareStaff.plugin");
  const player = wielder(t, I.NIGHTMARE_STAFF);
  const inventory = player.getInventory();
  t.mock.method(inventory, "refreshItems", () => inventory);
  const full = t.mock.method(inventory, "full", () => inventory);
  inventory.resetItems();
  for (let slot = 0; slot < 28; slot++) inventory.setItem(slot, new core.Item(I.HARMONISED_NIGHTMARE_STAFF, 1));
  const last = inventory.getItems()[27];
  assert.equal(plugin._test.dismantle({ player, item: last }), true);
  assert.equal(full.mock.callCount(), 1);
  assert.equal(inventory.getAmount(I.HARMONISED_NIGHTMARE_STAFF), 28);
  assert.equal(inventory.getAmount(I.HARMONISED_ORB), 0);

  const messages = [];
  t.mock.method(player, "sendMessage", (text) => messages.push(text));
  inventory.resetItems();
  const preset = new core.Item(I.HARMONISED_NIGHTMARE_STAFF, 1);
  preset.setMetaValue(core.Item.PRESET_META, true);
  inventory.setItem(0, preset);
  assert.equal(plugin._test.dismantle({ player, item: inventory.getItems()[0] }), true);
  assert.deepEqual(messages, ["Preset items cannot be used for this."]);
  assert.equal(inventory.getAmount(I.HARMONISED_NIGHTMARE_STAFF), 1);
  assert.equal(inventory.getAmount(I.NIGHTMARE_STAFF), 0);
});
