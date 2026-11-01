// Run after `yarn build`: node --test tests/bladed-staff-autocast.test.cjs
// Bladed staves (Staff of the Dead, its toxic form, Staff of Light/Balance) autocast like staves
// (wiki: Autocast); powered staves and polestaves don't. Regression for issue #1670.
const assert = require("node:assert/strict");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Autocasting } = require("../dist/game/content/combat/magic/Autocasting");
const { FightType } = require("../dist/game/content/combat/FightType");
const { WeaponInterfaces } = require("../dist/game/content/combat/WeaponInterfaces");
const { Equipment } = require("../dist/game/model/container/impl/Equipment");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { MagicSpellbook } = require("../dist/game/model/MagicSpellbook");
const { ItemIdentifiers } = require("../dist/util/ItemIdentifiers");

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

/** A player on the standard spellbook wielding `weaponId`, recording what the selector sends. */
function wielding(weaponId, spellbook = MagicSpellbook.NORMAL) {
  const weapon = { getId: () => weaponId, getDefinition: () => ItemDefinition.forId(weaponId) };
  const equipment = Object.create(Equipment.prototype);
  equipment.get = (slot) => (slot === Equipment.WEAPON_SLOT ? weapon : null);
  equipment.getWeapon = () => weapon;
  const sent = { messages: [], subInterfaces: [] };
  const sender = {
    sendConfig: () => sender,
    sendSubInterface: (_, id) => (sent.subInterfaces.push(id), sender),
    sendInterfaceFlagsRange: () => sender,
    sendMessage: (message) => (sent.messages.push(message), sender),
  };
  const player = {
    sent,
    fightType: null,
    getSpellbook: () => spellbook,
    getEquipment: () => equipment,
    getWeapon: () => null,
    setFightType(type) { this.fightType = type; },
    getPacketSender: () => sender,
    sendMessage: (message) => sent.messages.push(message),
  };
  equipment.player = player;
  return player;
}

const BLADED_STAVES = [
  ItemIdentifiers.STAFF_OF_THE_DEAD, ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD,
  ItemIdentifiers.STAFF_OF_LIGHT, ItemIdentifiers.STAFF_OF_BALANCE,
];

test("bladed staves count as staves for autocasting", () => {
  for (const id of BLADED_STAVES) {
    assert.equal(ItemDefinition.forId(id).getWeaponInterface(), WeaponInterfaces.BLADED_STAFF, `${id}`);
    assert.equal(wielding(id).getEquipment().hasStaffEquipped(), true, `${id}`);
  }
  assert.equal(Equipment.canAutocastWith(WeaponInterfaces.STAFF), true);
  assert.equal(Equipment.canAutocastWith(WeaponInterfaces.POWERED_STAFF), false);
  assert.equal(Equipment.canAutocastWith(WeaponInterfaces.POLESTAFF), false);
});

test("the toxic staff of the dead opens the autocast selector on the bladed staff's own styles", () => {
  for (const [childId, expected] of [[23, FightType.BLADED_STAFF_FEND], [28, FightType.BLADED_STAFF_SWIPE]]) {
    const player = wielding(ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD);
    assert.equal(Autocasting.handleWidgetAction(player, 593, childId), true);
    assert.deepEqual(player.sent.subInterfaces, [201]);
    assert.ok(!player.sent.messages.includes("You need to equip a staff to autocast spells."));
    assert.equal(player.fightType, expected);
  }
});

test("a plain staff still uses Focus and Pound", () => {
  const player = wielding(ItemIdentifiers.STAFF_OF_AIR);
  Autocasting.handleWidgetAction(player, 593, 23);
  assert.equal(player.fightType, FightType.STAFF_FOCUS);
});

// Review of #1672: switching from an Ancient staff to a bladed staff mustn't keep autocasting Ice
// Barrage (wiki: Staff of the Dead can't autocast Ancient Magicks), while compatible spells carry over.
const { Player } = require("../dist/game/entity/impl/player/Player");
const { Item } = require("../dist/game/model/Item");
const { Inventory } = require("../dist/game/model/container/impl/Inventory");
const { EquipPacketListener } = require("../dist/net/packet/impl/EquipPacketListener");
const { CombatFactory } = require("../dist/game/content/combat/CombatFactory");
const { CombatSpells } = require("../dist/game/content/combat/magic/CombatSpells");
const { Skill } = require("../dist/game/model/Skill");

/** A real player on `spellbook`, carrying `first` and `second`, wielding `first` with `spell` autocast. */
function switching(spellbook, first, second, spell) {
  const p = new Player(null);
  p.getPacketSender = () => new Proxy({}, { get: () => () => p.getPacketSender() });
  p.setSpellbook(spellbook);
  for (const skill of [Skill.ATTACK, Skill.MAGIC]) p.getSkillManager().setLevel(skill, 99);
  p.getInventory().setItem(0, new Item(first, 1));
  p.getInventory().setItem(1, new Item(second, 1));
  EquipPacketListener.equip(p, first, 0, Inventory.INTERFACE_ID);
  Autocasting.setAutocast(p, spell);
  assert.equal(p.getCombat().getAutocastSpell(), spell, "the first weapon autocasts the spell");
  EquipPacketListener.equip(p, second, 1, Inventory.INTERFACE_ID);
  assert.equal(p.getEquipment().getWeapon().getId(), second);
  return p;
}

test("switching from an Ancient staff to a Staff of the Dead drops an ancient autocast", () => {
  for (const id of BLADED_STAVES) {
    const p = switching(MagicSpellbook.ANCIENT, ItemIdentifiers.ANCIENT_STAFF, id, CombatSpells.ICE_BARRAGE);
    assert.equal(p.getCombat().getAutocastSpell(), null, `${id}`);
    assert.notEqual(CombatFactory.getMethod(p), CombatFactory.MAGIC_COMBAT, `${id}`);
  }
});

test("bladed staves refuse the ancient selector but keep standard and Arceuus autocasts", () => {
  for (const id of BLADED_STAVES) {
    const player = wielding(id, MagicSpellbook.ANCIENT);
    Autocasting.handleWidgetAction(player, 593, 28);
    assert.deepEqual(player.sent.subInterfaces, [], `${id}`);
  }

  const standard = switching(MagicSpellbook.NORMAL, ItemIdentifiers.STAFF_OF_FIRE,
    ItemIdentifiers.STAFF_OF_THE_DEAD, CombatSpells.FIRE_WAVE);
  assert.equal(standard.getCombat().getAutocastSpell(), CombatSpells.FIRE_WAVE);
  assert.equal(CombatFactory.getMethod(standard), CombatFactory.MAGIC_COMBAT);

  const arceuus = switching(MagicSpellbook.ARCEUUS, ItemIdentifiers.KODAI_WAND,
    ItemIdentifiers.TOXIC_STAFF_OF_THE_DEAD, CombatSpells.SKELETAL_GRASP);
  assert.equal(arceuus.getCombat().getAutocastSpell(), CombatSpells.SKELETAL_GRASP);
});

test("native Zuriel and LMS staff copies can select an Ancient autocast", async (t) => {
  const core = PluginManager.getCoreApi();
  const common = require('../plugins/minigames/lms/Common.LastManStanding');
  common.init({ core });
  require('../plugins/minigames/lms/Items.LastManStanding').registerAliases();
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const cases = [
    ...['zuriels_staff', 'zuriels_staff_bh', 'br_zuriels_staff', 'br_kodai_wand']
      .map(name => ({ name, id: core.CacheDefinitions.getObjId(name), allowed: true, equips: true })),
    { name: 'inactive Zuriel', id: core.CacheDefinitions.getObjId('zuriels_staff_bh_inactive'), allowed: false, equips: false },
    { name: 'Harmonised Nightmare', id: ItemIdentifiers.HARMONISED_NIGHTMARE_STAFF, allowed: false, equips: true },
    { name: 'Staff of the Dead', id: ItemIdentifiers.STAFF_OF_THE_DEAD, allowed: false, equips: true },
  ];
  for (const { name, id, allowed, equips } of cases) {
    assert.ok(id > 0, `${name} exists in the active cache`);
    const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
      send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
    const session = new PlayerSession(channel);
    const p = new Player(session, new core.Location(2426, 3081, 1));
    p.setUsername(`autocast_${name}`);
    p.setSpellbook(MagicSpellbook.ANCIENT);
    p.setRegistered(true);
    session.setPlayer(p);
    t.after(() => p.setRegistered(false));
    for (const skill of [Skill.ATTACK, Skill.MAGIC, Skill.DEFENCE, Skill.HITPOINTS]) p.getSkillManager().setLevel(skill, 99);
    p.getInventory().setItem(0, new Item(id));
    const connection = new ClientConnection(channel);
    connection.player = p;
    const send = async packet => { await connection.dispatch([packet]); connection.processTurnPackets(); };
    await send({ type: 'inventory_action', widgetId: 149 << 16, slot: 0, itemId: id, option: 'Wield', optionIndex: 2 });
    assert.equal(p.getEquipment().getWeapon().getId(), equips ? id : -1, `${name}: native equipment eligibility`);
    assert.equal(Autocasting.canAutocast(p, CombatSpells.ICE_BARRAGE), allowed, `${name}: Ancient Magicks capability`);
    await send({ type: 'widget_action', widgetId: (593 << 16) | 28, groupId: 593, childId: 28, buttonNum: 1 });
    assert.equal(p.getPacketSender().isSubInterfaceOpen(201), allowed, `${name}: native selector eligibility`);
    if (!allowed) continue;
    await send({ type: 'widget_action', widgetId: (201 << 16) | 1, groupId: 201, childId: 1, slot: 46, buttonNum: 1 });
    assert.equal(p.getCombat().getAutocastSpell(), CombatSpells.ICE_BARRAGE, `${name} accepts the selected Ancient spell`);
    assert.equal(CombatFactory.getMethod(p), CombatFactory.MAGIC_COMBAT);
  }
});
