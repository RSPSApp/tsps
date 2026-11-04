// Run after `yarn build`: node --test tests/rat-bone-weapons.test.cjs
// Rat bone weapons: the ids against the cache, the rats they're for, the +10 and the rats-only rule,
// making them (yourself or through Historian Aldo), and the bone staff's charges and spell, each
// against the Wiki and the captures in docs/scurrius.md.
const assert = require("node:assert/strict");
const { test, before } = require("node:test");
const path = require("node:path");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { Gamevals, GamevalKind } = require("../dist/game/cache/Gamevals");
const { PluginManager } = require("../dist/plugins/PluginManager");
const RatBoneWeapons = require("../plugins/items/RatBoneWeapons.plugin");
const Common = require("../plugins/items/ratboneweapons/Common.RatBoneWeapons");
const Creation = require("../plugins/items/ratboneweapons/Creation.RatBoneWeapons");
const Staff = require("../plugins/items/ratboneweapons/Staff.RatBoneWeapons");
const Combat = require("../plugins/items/ratboneweapons/Combat.RatBoneWeapons");

const core = PluginManager.getCoreApi();
const I = core.ItemIdentifiers;
const api = new Proxy({ core }, { get: (target, key) => target[key] ?? (() => {}) });
let gamevals = null;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  gamevals = new Gamevals();
  RatBoneWeapons.register(api);
});

function createPlayer({ items = {}, levels = {}, weapon = -1 } = {}) {
  const log = [];
  const inventory = new Map(Object.entries(items).map(([id, amount]) => [Number(id), amount]));
  const added = [];
  const player = {
    log, inventory, added,
    isPlayer: () => true,
    getAsPlayer: () => player,
    sendMessage: (text) => log.push(`message ${text}`),
    performAnimation: (animation) => log.push(`anim ${animation.getId?.() ?? animation.id}`),
    performGraphic: (graphic) => log.push(`gfx ${graphic.id}`),
    getPacketSender: () => new Proxy({}, { get: (_t, method) => (...args) => { if (method === "sendSound") log.push(`sound ${args[0]}`); return undefined; } }),
    getEquipment: () => ({ getItems: () => { const items = []; items[core.Equipment.WEAPON_SLOT] = weapon > 0 ? new core.Item(weapon, 1) : null; return items; } }),
    getSkillManager: () => ({
      getCurrentLevel: (skill) => levels[skill] ?? 99,
      addExperience: (skill, xp) => log.push(`xp ${xp}`),
    }),
    getInventory: () => ({
      contains: (id) => (inventory.get(id) ?? 0) > 0,
      getAmount: (id) => inventory.get(id) ?? 0,
      delete: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      deleteNumber: (id, amount) => inventory.set(id, (inventory.get(id) ?? 0) - amount),
      addItem: (item) => { added.push(item); inventory.set(item.getId(), (inventory.get(item.getId()) ?? 0) + item.getAmount()); },
      getFreeSlots: () => 5,
      getAddableAmount: (item) => item.getAmount(),
      refreshItems: () => {},
    }),
    getDialogueManager: () => ({ startDialogues: () => log.push("dialogue") }),
    getCombat: () => ({ getTarget: () => player.target }),
  };
  return player;
}

const npcNamed = (name, attributes = []) => ({
  isNpc: () => true,
  getCurrentDefinition: () => ({ getName: () => name, hasAttribute: (attribute) => attributes.includes(attribute) }),
});

test("the weapons are the cache's rat bone objs", () => {
  const obj = gamevals.namesOf(GamevalKind.OBJ);
  assert.equal(obj.get(I.BONE_MACE), "rat_bone_mace");
  assert.equal(obj.get(I.BONE_SHORTBOW), "rat_bone_bow");
  assert.equal(obj.get(I.BONE_STAFF), "rat_bone_staff");
  assert.deepEqual(CacheDefinitions.getItem(I.BONE_STAFF).inventoryActions.filter(Boolean), ["Wield", "Check", "Uncharge", "Drop"]);
  const seq = gamevals.namesOf(GamevalKind.SEQ);
  assert.deepEqual(Common.weapons.map((weapon) => seq.get(weapon.anim)), ["human_smithing", "stringing_yew_shortbow", "human_battlestaff_crafting"]);
  const spotanim = gamevals.namesOf(GamevalKind.SPOTANIM);
  assert.equal(spotanim.get(2637), "battlestaff_rat_bone_crafting_spotanim");
  assert.equal(spotanim.get(2645), "vfx_weapon_staff_rat01_spotanim");
  assert.equal(spotanim.get(2646), "vfx_weapon_staff_rat01_impact_01");
  assert.equal(spotanim.get(2647), "spells_ratbone01_travel01");
  assert.equal(RatBoneWeapons.members, true);
});

test("rats are the Wiki's rat attribute list, and its look-alikes aren't", () => {
  for (const name of ["Rat", "Giant rat", "Scurrius", "Brine rat", "Zombie rat"]) assert.ok(Common.isRat(npcNamed(name)), name);
  for (const name of ["Mouse", "Angry giant rat", "Experiment No.2", "Goblin"]) assert.ok(!Common.isRat(npcNamed(name)), name);
  assert.ok(Common.isRat(npcNamed("Anything", ["rat"])), "a dump's rat attribute counts too");
});

test("they only attack rats, with 10 more maximum hit", () => {
  const player = createPlayer({ weapon: I.BONE_MACE });
  const goblin = { attacker: player, target: npcNamed("Goblin"), allow: null };
  Combat._test.onlyRats(goblin);
  assert.equal(goblin.allow, false);
  assert.ok(player.log.includes("message You can only use this weapon against rats."));
  const rat = { attacker: player, target: npcNamed("Giant rat"), allow: null };
  Combat._test.onlyRats(rat);
  assert.equal(rat.allow, null);
  player.target = npcNamed("Giant rat");
  assert.equal(Combat._test.ratbane(player, 20), 30);
  const unarmed = createPlayer();
  unarmed.target = npcNamed("Giant rat");
  assert.equal(Combat._test.ratbane(unarmed, 20), 20);
});

test("making them needs the tool, level 35 and the materials", () => {
  const { craft, LEVEL, EXPERIENCE } = Creation._test;
  assert.equal(LEVEL, 35);
  const [mace, bow, staff] = Common.weapons;
  const noTool = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.YEW_SHORTBOW]: 1 } });
  craft(noTool, bow);
  assert.deepEqual(noTool.log, ["message You'll need a Knife to do that."]);
  const noRunes = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.BATTLESTAFF]: 1, [I.CHISEL]: 1, [I.CHAOS_RUNE]: 999 } });
  craft(noRunes, staff);
  assert.deepEqual(noRunes.log, ["message You need 1,000 chaos runes and a Scurrius' spine to create the Bone staff."]);
  const fletcher = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.YEW_SHORTBOW]: 1, [I.KNIFE]: 1 } });
  craft(fletcher, bow);
  assert.equal(fletcher.inventory.get(I.BONE_SHORTBOW), 1);
  assert.equal(fletcher.inventory.get(I.SCURRIUS_SPINE), 0);
  assert.ok(fletcher.log.includes("anim 6682") && fletcher.log.includes(`xp ${EXPERIENCE}`));
  const crafter = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.BATTLESTAFF]: 1, [I.CHISEL]: 1, [I.CHAOS_RUNE]: 1500 } });
  craft(crafter, staff);
  assert.equal(crafter.inventory.get(I.CHAOS_RUNE), 500);
  assert.equal(Staff.chargesOf(crafter.added[0]), 1000);
  assert.ok(crafter.log.includes("gfx 2637") && crafter.log.includes("sound 2585"));
  const unskilled = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.RUNE_MACE]: 1, [I.HAMMER]: 1 }, levels: { [core.Skill.SMITHING]: 34 } });
  craft(unskilled, mace);
  assert.deepEqual(unskilled.log, ["message You need a Smithing level of 35 to do that."]);
  const handed = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.RUNE_MACE]: 1 } });
  Creation._test.spineOnItem({ player: handed, usedItemId: I.SCURRIUS_SPINE, usedWithItemId: I.RUNE_MACE });
  assert.deepEqual(handed.log, ["message I should probably smith this at an anvil..."]);
});

test("Historian Aldo makes one for 50,000 coins", () => {
  const { dialogueCondition, dialogueAction, ALDO_FEE } = Creation._test;
  const definition = { getName: () => "Historian Aldo" };
  const poor = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.RUNE_MACE]: 1, [I.COINS]: ALDO_FEE - 1 } });
  assert.equal(dialogueCondition({ player: poor, definition, text: "If the player does not have the materials in their inventory:" }), true);
  const ready = createPlayer({ items: { [I.SCURRIUS_SPINE]: 1, [I.RUNE_MACE]: 1, [I.COINS]: ALDO_FEE } });
  assert.equal(dialogueCondition({ player: ready, definition, text: "If the player does have the materials in their inventory:" }), true);
  const message = { kind: "message", definition, player: ready, text: "Aldo handed the Bone mace to you.", npc: { getId: () => 7615 } };
  dialogueAction(message);
  assert.deepEqual(message.box, { items: [I.BONE_MACE] });
  assert.equal(ready.inventory.get(I.COINS), 0);
  assert.equal(ready.inventory.get(I.BONE_MACE), 1);
});

test("the bone staff's spell and charges", () => {
  const { maxHit, flightCycles, check, uncharge, MAX_CHARGES } = Staff._test;
  assert.equal(MAX_CHARGES, 20000);
  assert.equal(maxHit(createPlayer({ levels: { [core.Skill.MAGIC]: 75 } })), 25 + 5 + 10);
  const at = (x) => ({ getLocation: () => new core.Location(x, 3200, 0) });
  assert.deepEqual([3, 4, 6].map((distance) => flightCycles(at(3200), at(3200 + distance))), [76, 86, 106]);
  const staff = new core.Item(I.BONE_STAFF, 1);
  Staff.setCharges(staff, 1234);
  const player = createPlayer();
  check({ player, item: staff });
  assert.ok(player.log.includes("message Your Bone staff has 1,234 charges remaining."));
  uncharge({ player, item: staff });
  assert.equal(player.inventory.get(I.CHAOS_RUNE), 1234);
  assert.equal(Staff.chargesOf(staff), 0);
  uncharge({ player, item: staff });
  assert.ok(player.log.includes("message Your Bone staff has no charges to remove."));
});

test("the bone staff reaches 8 tiles, 10 on Longrange (Wiki: Attack range)", () => {
  const player = createPlayer({ weapon: I.BONE_STAFF });
  const method = Staff._test.resolveStaff(player);
  // The powered staff styles: Accurate, Accurate, Longrange.
  const [accurate, , longrange] = core.WeaponInterfaces.POWERED_STAFF.getFightType();
  const style = (fightType) => { player.getFightType = () => fightType; return method.attackDistance(player); };
  assert.equal(style(accurate), 8);
  assert.equal(style(longrange), 10);
});
