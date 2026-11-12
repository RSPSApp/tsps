// Run after `yarn build`: node --test tests/autocast-god-staves.test.cjs
// The bladed staves open their own autocast list (cache autocast_spellpos: sotd, staff_of_light, staff_of_balance) with
// varp 664 = the staff (live sends 11791 for the Staff of the Dead, rsprox_transcripts/228/02283.txt, 234/00820.txt), and
// enum_1986's god slots are 19 Claws of Guthix, 20 Flames of Zamorak, 52 Saradomin Strike (47 is Iban Blast). A Staff of
// the Dead choosing slot 20 casts Flames (rsprox_transcripts/235/03344.txt). The Blue Moon spear autocasts Ancient Magicks
// (Wiki). Real Players through the selector clicks.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
const { WeaponInterfaceManager } = require("../dist/game/content/combat/WeaponInterfaceManager");

let core;
before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  core = PluginManager.getCoreApi();
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

function wielding(t, weaponId, spellbook = core.MagicSpellbook.NORMAL) {
  const p = new Player(null);
  p.getSession = () => ({ sendClientPacket: () => true, write: () => true });
  p.setUsername("godstaff");
  for (const skill of core.Skill.values()) p.getSkillManager().setMaxLevels(skill, 99, false).setCurrentLevels(skill, 99, false);
  p.setSpellbook(spellbook);
  p.getEquipment().setItem(core.Equipment.WEAPON_SLOT, new core.Item(weaponId, 1));
  WeaponInterfaceManager.assign(p);
  const varps = [];
  const sendConfig = p.getPacketSender().sendConfig.bind(p.getPacketSender());
  t.mock.method(p.getPacketSender(), "sendConfig", (id, value) => { varps.push([id, value]); return sendConfig(id, value); });
  return { p, list: () => varps.filter(([id]) => id === 664).at(-1)?.[1] };
}

function choose(p, slot) {
  Autocasting.handleWidgetAction(p, 593, 23);
  Autocasting.handleWidgetAction(p, 201, 1, slot);
  return p.getCombat().getAutocastSpell();
}

test("each bladed staff opens its own list and autocasts its god spell from its slot", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  for (const [staff, list, slot, spell] of [
    [I.STAFF_OF_THE_DEAD, I.STAFF_OF_THE_DEAD, 20, S.FLAMES_OF_ZAMORAK],
    [I.TOXIC_STAFF_OF_THE_DEAD, I.STAFF_OF_THE_DEAD, 20, S.FLAMES_OF_ZAMORAK],
    [I.STAFF_OF_LIGHT, I.STAFF_OF_LIGHT, 52, S.SARADOMIN_STRIKE],
    [I.STAFF_OF_BALANCE, I.STAFF_OF_BALANCE, 19, S.CLAWS_OF_GUTHIX],
  ]) {
    const f = wielding(t, staff);
    assert.equal(choose(f.p, slot), spell, `${staff} slot ${slot}`);
    assert.equal(f.list(), list, `${staff} varp 664`);
  }
});

test("another god's slot is refused, and slot 19 is Claws, not Iban Blast", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  assert.equal(choose(wielding(t, I.STAFF_OF_THE_DEAD).p, 52), null, "the SotD can't pick Saradomin Strike");
  assert.equal(choose(wielding(t, I.STAFF_OF_LIGHT).p, 19), null);
  assert.equal(Autocasting.autocastSpell(19), S.CLAWS_OF_GUTHIX);
  assert.equal(Autocasting.autocastSpell(47), S.IBAN_BLAST);
  assert.equal(choose(wielding(t, I.IBANS_STAFF).p, 47), S.IBAN_BLAST);
});

test("the Blue Moon spear autocasts Ancient Magicks", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  for (const spear of [I.BLUE_MOON_SPEAR, 29849]) {
    const f = wielding(t, spear, core.MagicSpellbook.ANCIENT);
    assert.equal(choose(f.p, 31), S.SMOKE_RUSH, `${spear}`);
  }
});

test("a bladed staff's autocast god spell can be cast with it (Wiki), and a plain god staff can't autocast one", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  const runes = (p) => { for (const id of [554, 556, 565]) p.getInventory().add(new core.Item(id, 100), false); };
  for (const [staff, slot, spell] of [
    [I.STAFF_OF_THE_DEAD, 20, S.FLAMES_OF_ZAMORAK],
    [I.TOXIC_STAFF_OF_THE_DEAD, 20, S.FLAMES_OF_ZAMORAK],
    [12902, 20, S.FLAMES_OF_ZAMORAK],
    [I.STAFF_OF_LIGHT, 52, S.SARADOMIN_STRIKE],
    [I.STAFF_OF_BALANCE, 19, S.CLAWS_OF_GUTHIX],
  ]) {
    const { p } = wielding(t, staff);
    runes(p);
    assert.equal(choose(p, slot), spell, `${staff} slot ${slot}`);
    assert.equal(p.getCombat().getAutocastSpell().canCast(p, false), true, `${staff} casts its god spell`);
  }
  for (const sceptre of [I.THAMMARONS_SCEPTRE_A_, I.ACCURSED_SCEPTRE_A_, I.ZAMORAK_STAFF]) {
    const { p } = wielding(t, sceptre);
    runes(p);
    assert.equal(S.FLAMES_OF_ZAMORAK.canCast(p, false), true, `${sceptre} casts Flames of Zamorak`);
  }
  const { p: wrong } = wielding(t, I.STAFF_OF_LIGHT);
  runes(wrong);
  assert.equal(S.FLAMES_OF_ZAMORAK.canCast(wrong, false), false, "the Staff of Light can't cast Flames");
  for (const [staff, slot] of [[I.ZAMORAK_STAFF, 20], [I.SARADOMIN_STAFF, 52], [I.GUTHIX_STAFF, 19]]) {
    assert.equal(choose(wielding(t, staff).p, slot), null, `the plain ${staff} has no god slot`);
  }
});

// Wiki (Claws of Guthix, Void knight mace): the mace casts and autocasts Claws of Guthix; the cache's
// autocast_spellpos gives pest_void_knight_mace its own list (17 Crumble Undead, 19 Claws, waves, surges).
test("the void knight mace opens its own list, autocasts Claws of Guthix and meets its staff requirement", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  const f = wielding(t, I.VOID_KNIGHT_MACE);
  assert.equal(choose(f.p, 19), S.CLAWS_OF_GUTHIX);
  assert.equal(f.list(), I.VOID_KNIGHT_MACE, "varp 664");
  assert.equal(choose(wielding(t, I.VOID_KNIGHT_MACE).p, 17), S.CRUMBLE_UNDEAD);
  assert.equal(choose(wielding(t, I.VOID_KNIGHT_MACE).p, 20), null, "no Flames of Zamorak");
  assert.ok(f.p.getEquipment().containsAllItem(S.CLAWS_OF_GUTHIX.equipmentRequired(f.p)), "it can cast Claws");
});

// rsprox_transcripts/234/03297.txt tick 212 (Lunar), 234/00843.txt tick 465 (Ancient book, a bladed staff);
// none of the 53 recordings that open the selector sends a line (e.g. 236/03914.txt).
test("the selector's recorded refusals, and no line when it opens", (t) => {
  const I = core.ItemIdentifiers, B = core.MagicSpellbook;
  const said = (f) => { const lines = []; t.mock.method(f.p, "sendMessage", (m) => lines.push(m)); return lines; };
  const ancient = wielding(t, I.STAFF_OF_THE_DEAD, B.ANCIENT), ancientLines = said(ancient);
  Autocasting.handleWidgetAction(ancient.p, 593, 23);
  assert.deepEqual(ancientLines, ["You cannot autocast Ancient Magicks with that."]);
  const lunar = wielding(t, I.STAFF_OF_THE_DEAD, B.LUNAR), lunarLines = said(lunar);
  Autocasting.handleWidgetAction(lunar.p, 593, 23);
  assert.deepEqual(lunarLines, ["You cannot autocast Lunar Magicks."]);
  const normal = wielding(t, I.STAFF_OF_THE_DEAD), normalLines = said(normal);
  Autocasting.handleWidgetAction(normal.p, 593, 23);
  assert.equal(normal.list(), I.STAFF_OF_THE_DEAD, "the selector opened");
  assert.deepEqual(normalLines, []);
});

// The variants of the staves with their own lists: Iban's staff (o) and (u) (o) (Wiki: the (o) autocasts the standard
// book "including Iban Blast"), the Void knight mace (l), Thammaron's/accursed sceptre (a) (cache autocast_spellpos
// wild_cave_*_recol: the standard list and Flames; live sends 664 = 27679, rsprox_transcripts/232/03126.txt) and Last
// Man Standing's br_sotd, a copy of the Staff of the Dead.
test("staff variants open their own list and autocast and cast its special spell", (t) => {
  const I = core.ItemIdentifiers, S = core.CombatSpells;
  const common = require("../plugins/minigames/lms/Common.LastManStanding");
  common.init({ core });
  require("../plugins/minigames/lms/Items.LastManStanding").registerAliases();
  const runes = (p) => { for (const id of [554, 556, 560, 565]) p.getInventory().add(new core.Item(id, 100), false); };
  for (const [staff, list, slot, spell] of [
    [I.IBANS_STAFF_O_, I.IBANS_STAFF, 47, S.IBAN_BLAST],
    [I.IBANS_STAFF_U_O_, I.IBANS_STAFF, 47, S.IBAN_BLAST],
    [I.VOID_KNIGHT_MACE_L_, I.VOID_KNIGHT_MACE, 19, S.CLAWS_OF_GUTHIX],
    [I.THAMMARONS_SCEPTRE_A_, I.THAMMARONS_SCEPTRE_A_, 20, S.FLAMES_OF_ZAMORAK],
    [I.ACCURSED_SCEPTRE_A_, I.ACCURSED_SCEPTRE_A_, 20, S.FLAMES_OF_ZAMORAK],
    [core.CacheDefinitions.getObjId("br_sotd"), I.STAFF_OF_THE_DEAD, 20, S.FLAMES_OF_ZAMORAK],
  ]) {
    const f = wielding(t, staff);
    runes(f.p);
    assert.equal(choose(f.p, slot), spell, `${staff} slot ${slot}`);
    assert.equal(f.list(), list, `${staff} varp 664`);
    assert.equal(f.p.getCombat().getAutocastSpell().canCast(f.p, false), true, `${staff} casts it`);
  }
});

test("Last Man Standing's Ancient staff copy refuses the standard book like the Ancient staff", (t) => {
  require("../plugins/minigames/lms/Common.LastManStanding").init({ core });
  require("../plugins/minigames/lms/Items.LastManStanding").registerAliases();
  const f = wielding(t, core.CacheDefinitions.getObjId("br_ancient_staff"));
  const messages = [];
  t.mock.method(f.p, "sendMessage", (line) => messages.push(line));
  Autocasting.handleWidgetAction(f.p, 593, 28);
  assert.deepEqual(messages, ["You can only autocast ancient magicks with that."]);
  assert.equal(f.list(), undefined, "the selector did not open");
  assert.equal(Autocasting.canAutocast(f.p, core.CombatSpells.FIRE_WAVE), false);
});

// Cache scripts 243 (autocast_spellpos) and 4512/its Ancient and Arceuus forms: each selector list places only its own
// slots, so a click on any other slot (a modified client) sets nothing.
test("a selector click outside the weapon's list sets no autocast", (t) => {
  const I = core.ItemIdentifiers, B = core.MagicSpellbook;
  for (const [weapon, book, slot] of [
    [I.STAFF_OF_FIRE, B.NORMAL, 17], // Crumble Undead: not in the standard list
    [I.STAFF_OF_FIRE, B.NORMAL, 18], // Magic Dart
    [I.SLAYERS_STAFF, B.NORMAL, 1], // Wind Strike: the slayer's staff lists waves, surges, Crumble Undead and Magic Dart
    [I.VOID_KNIGHT_MACE, B.NORMAL, 18],
    [I.STAFF_OF_FIRE, B.NORMAL, 31], // an Ancient slot on the standard book
    [I.STAFF_OF_FIRE, B.NORMAL, 53], // an Arceuus slot
  ]) {
    assert.equal(choose(wielding(t, weapon, book).p, slot), null, `${weapon} book ${book} slot ${slot}`);
  }
  assert.equal(choose(wielding(t, I.SLAYERS_STAFF).p, 17), core.CombatSpells.CRUMBLE_UNDEAD);
  assert.equal(choose(wielding(t, I.SLAYERS_STAFF).p, 18), core.CombatSpells.MAGIC_DART);
  assert.equal(choose(wielding(t, I.STAFF_OF_FIRE).p, 16), core.CombatSpells.FIRE_WAVE);
});

// A forged autocast click on the Ancient book with a standard staff: the selector refuses to open, and a slot click
// for a standard spell must not set it either (the list for the Ancient book is the Ancient one).
test("a forged standard slot on the Ancient book sets no autocast", (t) => {
  const I = core.ItemIdentifiers;
  for (const weapon of [I.STAFF_OF_FIRE, I.STAFF_OF_THE_DEAD]) {
    const f = wielding(t, weapon, core.MagicSpellbook.ANCIENT);
    t.mock.method(f.p, "sendMessage", () => {});
    Autocasting.handleWidgetAction(f.p, 201, 1, 16);
    assert.equal(f.p.getCombat().getAutocastSpell(), null, `${weapon}`);
  }
});
