// Run after `yarn build`: node --test tests/reanimation-prayer-and-tiers.test.cjs
// Arceuus reanimation (Wiki: Ensouled heads): each head needs its spell tier (dog and chaos druid are Adept, the
// hellhound Expert), and killing the reanimated creature gives its caster the head's Prayer experience. Real
// engine: every plugin loaded, a real Player with real runes and skills, the real ArceuusItemSpells cast (which
// spawns the owned creature), and the creature's death raised as NPCDeathTask raises it.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, after, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager: PM } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");

let core;
let I;
let next = 9910;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PM.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PM.getCoreApi();
  I = core.ItemIdentifiers;
  PM.emitServerStartup({});
});
after(() => PM.emitServerShutdown({}));

function actor(t) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const p = new Player(new PlayerSession(channel));
  p.setIndex(next++);
  p.setUsername("reanimate" + p.getIndex());
  p.setRegistered(true);
  p.setAttribute("bot-skip-persistence", true);
  p.setLocation(new core.Location(3200, 3200, 0));
  p.needsPlacement = false;
  const messages = [];
  t.mock.method(p.getPacketSender(), "sendMessage", (message) => { messages.push(message); return p.getPacketSender(); });
  t.after(() => { p.setRegistered(false); core.TaskManager.cancelTasks(p); });
  return { p, inv: p.getInventory(), messages };
}

function preset(item) {
  item.setMetaValue(core.Item.UNTRADEABLE_META, true);
  item.setMetaValue(core.Item.UNBANKABLE_META, true);
  item.setMetaValue(core.Item.PRESET_META, true);
  return item;
}
const { ArceuusItemSpells: Spells } = require("../dist/game/content/combat/magic/ArceuusItemSpells");
const { World } = require("../dist/game/World");

/** The unnoted "Ensouled <name> head" the spell is cast on. */
function head(name) {
  const C = core.CacheDefinitions;
  for (const suffix of ["", "_2", "_3", "_4"]) {
    const id = I[`ENSOULED_${name}_HEAD${suffix}`];
    const def = id && C.getItem(id);
    if (def && /^Ensouled .+ head$/.test(def.name) && core.ItemDefinition.forId(id).isNoted?.() !== true) return id;
  }
  throw new Error(`no ensouled ${name} head`);
}

function caster(t) {
  const f = actor(t);
  for (const skill of [core.Skill.MAGIC, core.Skill.PRAYER]) f.p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  f.p.getInventory().setItem(10, new core.Item(I.BODY_RUNE, 100));
  f.p.getInventory().setItem(11, new core.Item(I.NATURE_RUNE, 100));
  f.p.getInventory().setItem(12, new core.Item(I.SOUL_RUNE, 100));
  f.p.getInventory().setItem(13, new core.Item(I.BLOOD_RUNE, 100));
  f.p.setSpellbook?.(core.MagicSpellbook?.ARCEUUS ?? f.p.getSpellbook?.());
  return f;
}

/** Casts `spell` on the head in slot 0; returns the creature it spawned, if any. */
function cast(f, spell, headId) {
  f.inv.setItem(0, new core.Item(headId, 1));
  const queue = World.getAddNPCQueue();
  const before = queue.length;
  Spells.castOnItem(f.p, spell, headId, 0);
  return queue.length > before ? queue.splice(before, 1)[0] : null;
}

const prayerXp = (f) => f.p.getSkillManager().getExperience(core.Skill.PRAYER);

test("dog heads need Adept Reanimation, as on the Wiki", (t) => {
  const f = caster(t);
  assert.equal(cast(f, Spells.BASIC_REANIMATION, head("DOG")), null, "Basic is refused");
  assert.equal(f.messages.at(-1), "That head cannot be reanimated by this spell.");
  assert.ok(cast(f, Spells.ADEPT_REANIMATION, head("DOG")), "Adept raises it");
});

test("hellhound heads need Expert Reanimation, as on the Wiki", (t) => {
  const f = caster(t);
  assert.equal(cast(f, Spells.MASTER_REANIMATION, head("HELLHOUND")), null, "Master is refused");
  assert.ok(cast(f, Spells.EXPERT_REANIMATION, head("HELLHOUND")), "Expert raises it");
});

test("killing a reanimated creature gives its caster the head's Prayer experience", (t) => {
  const f = caster(t);
  const npc = cast(f, Spells.BASIC_REANIMATION, head("GOBLIN"));
  assert.ok(npc, "a reanimated goblin");
  assert.equal(npc.getOwner(), f.p);
  const before = prayerXp(f);
  PM.emitNpcDeath({ npc, npcId: npc.getId(), killer: f.p, damagers: [f.p], location: { x: 0, y: 0, z: 0 } });
  assert.equal(prayerXp(f) - before, 130 * (f.p.getSkillManager().getExperienceRate?.(core.Skill.PRAYER) ?? 1));
});

test("someone else killing it gives the caster nothing", (t) => {
  const f = caster(t);
  const other = actor(t);
  const npc = cast(f, Spells.BASIC_REANIMATION, head("GOBLIN"));
  const before = prayerXp(f);
  const otherBefore = other.p.getSkillManager().getExperience(core.Skill.PRAYER);
  PM.emitNpcDeath({ npc, npcId: npc.getId(), killer: other.p, damagers: [other.p], location: { x: 0, y: 0, z: 0 } });
  assert.equal(prayerXp(f), before);
  assert.equal(other.p.getSkillManager().getExperience(core.Skill.PRAYER), otherBefore);
});

// Wiki (Ensouled head, Zealot's robes): each worn piece gives a 1.25% chance, the full set 5%, that a reanimation
// spares the head; the message is "Your Zealot's robes save the ensouled head but still grant you experience."
function wearZealot(f, pieces) {
  const slots = [
    [core.Equipment.HEAD_SLOT, I.ZEALOTS_HELM],
    [core.Equipment.BODY_SLOT, I.ZEALOTS_ROBE_TOP],
    [core.Equipment.LEG_SLOT, I.ZEALOTS_ROBE_BOTTOM],
    [core.Equipment.FEET_SLOT, core.CacheDefinitions.getObjId("shades_prayer_boots")],
  ];
  for (const [slot, id] of slots.slice(0, pieces)) f.p.getEquipment().set(slot, new core.Item(id, 1));
}

const headCount = (f, id) => f.inv.getItems().filter((item) => item?.getId() === id).length;
const magicXp = (f) => f.p.getSkillManager().getExperience(core.Skill.MAGIC);

test("Zealot's robes can save the head: the creature rises, the runes and Magic XP are still spent", (t) => {
  const f = caster(t);
  wearZealot(f, 4);
  t.mock.method(Math, "random", () => 0.04); // under the full set's 5%
  const id = head("GOBLIN");
  const xp = magicXp(f);
  const npc = cast(f, Spells.BASIC_REANIMATION, id);
  assert.ok(npc, "the creature still rises");
  assert.equal(headCount(f, id), 1, "the head is kept");
  assert.equal(f.messages.at(-1), "Your Zealot's robes save the ensouled head but still grant you experience.");
  assert.equal(f.inv.getAmount?.(I.BODY_RUNE) ?? f.inv.getItems()[10].getAmount(), 96, "runes are still used");
  assert.ok(magicXp(f) > xp);
});

test("without the robes, or when the roll fails, the head is used up", (t) => {
  const f = caster(t);
  t.mock.method(Math, "random", () => 0);
  const id = head("GOBLIN");
  assert.ok(cast(f, Spells.BASIC_REANIMATION, id));
  assert.equal(headCount(f, id), 0, "no robes, no save even on a 0 roll");
  wearZealot(f, 1);
  Math.random.mock.mockImplementation(() => 0.0126); // above one piece's 1.25%
  assert.ok(cast(f, Spells.BASIC_REANIMATION, id));
  assert.equal(headCount(f, id), 0);
  Math.random.mock.mockImplementation(() => 0.0124);
  assert.ok(cast(f, Spells.BASIC_REANIMATION, id));
  assert.equal(headCount(f, id), 1, "one piece saves under 1.25%");
});
