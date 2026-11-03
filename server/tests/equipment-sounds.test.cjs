// Run after `yarn build`: node --test tests/equipment-sounds.test.cjs
// The sound for wearing and removing an item: its recorded equipSound, else the rules for its kind
// in equipment-sounds.json (docs/equipment-sounds.md).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test, before } = require("node:test");

const { Server } = require("../dist/Server");
Server.installProductionPathResolver();

const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { EquipmentSounds } = require("../dist/game/definition/EquipmentSounds");

const rows = new Map(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/item-gameplay.json"), "utf8")).map((row) => [row.id, row]));
const sound = (id) => EquipmentSounds.soundIdFor(ItemDefinition.forId(id));

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  require("../plugins/items/ItemDefinitionLoader.plugin").register({ log() {}, onPlayerLogin() {}, registerContentEndpoint() {} });
});

test("a recorded item plays its own sound", () => {
  for (const [id, expected] of [[4151, 2249], [1127, 2239], [1079, 2242], [1163, 2240], [1704, 2238], [1201, 2245], [2503, 2241], [1381, 2247]]) {
    assert.equal(rows.get(id).equipSound, expected, `${rows.get(id).name} is recorded`);
    assert.equal(sound(id), expected, rows.get(id).name);
  }
});

test("an unrecorded item plays its kind's: weapon type, then slot, then the default", () => {
  const cases = [
    [1333, 2248, "Rune scimitar: scimitars"],
    [861, 2244, "Magic shortbow: bows"],
    [11283, 2245, "Dragonfire shield: shields"],
    [4720, 2239, "Dharok's platebody: platebodies"],
    [1712, 2238, "Amulet of glory(4): the default"],
  ];
  for (const [id, expected, why] of cases) {
    assert.equal(rows.get(id)?.equipSound, undefined, `${why} has no recording`);
    assert.equal(sound(id), expected, why);
  }
});

test("name rules pick the material within a slot or weapon type", () => {
  // Crystal bows and wands sound unlike other bows and staves; vambraces like leather.
  const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../data/definitions/equipment-sounds.json"), "utf8"));
  const pick = (list, name) => list.find((rule) => !rule.name || new RegExp(rule.name, "i").test(name)).sound;
  assert.equal(pick(rules.weaponTypes.SHORTBOW, "Crystal bow"), 2238);
  assert.equal(pick(rules.weaponTypes.STAFF, "Kodai wand"), 2238);
  assert.equal(pick(rules.weaponTypes.STAFF, "Staff of fire"), 2247);
  assert.equal(pick(rules.slots.hands, "Blue d'hide vambraces"), 2241);
  assert.equal(pick(rules.slots.legs, "Granite legs"), 2238);
  assert.equal(pick(rules.slots.legs, "Bronze plateskirt"), 2242);
});

const { PluginManager } = require('../dist/plugins/PluginManager');
const core = PluginManager.getCoreApi();
const { ClientPacketId } = require('../dist/net/protocol/NativeClientPackets');

function wornAction(t, group, slot, itemId) {
  const { Player } = require('../dist/game/entity/impl/player/Player');
  const { PlayerSession } = require('../dist/net/PlayerSession');
  const { ClientConnection } = require('../dist/net/NetworkBuilder');
  const { decodeClientPackets } = require('../dist/net/protocol/ClientProtocol');
  const channel = { kind: 'test', remoteAddress: '127.0.0.1', isOpen: () => true,
    send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(2165); player.setRegistered(true); player.setNeedsPlacement(false);
  const item = new core.Item(itemId, 1);
  player.getEquipment().setItem(slot, item);
  const connection = new ClientConnection(channel); connection.player = player;
  // Tab387 is shared by gameframe layouts; screen84 has its own equipment components.
  const widgetId = core.CacheDefinitions.getComponentId(`${group === 387 ? 'wornitems' : 'equipment'}:slot${slot}`);
  assert.equal(widgetId >>> 16, group);
  const messages = []; player.sendMessage = message => messages.push(message);
  t.after(() => { player.setRegistered(false); core.TaskManager.cancelTasks(player.getIndex()); });
  return { player, item, messages, async click(op) {
    const packet = Buffer.alloc(9);
    packet[0] = ClientPacketId[`IF_BUTTON${op}`];
    packet.writeInt32BE(widgetId, 1);
    packet.writeUInt16BE(0xffff, 5); packet.writeUInt16BE(item.getId(), 7);
    const decoded = decodeClientPackets(packet);
    assert.equal(decoded.length, 1); assert.equal(decoded[0].buttonNum, op);
    assert.equal(decoded[0].option, undefined, 'the native packet has no option text');
    await connection.dispatch(decoded, true); connection.processTurnPackets();
  } };
}

for (const group of [387, 84]) {
  for (const [name, itemId, slot, op, option] of [
    ['shield Activate', core.ItemIdentifiers.DRAGONFIRE_SHIELD, core.Equipment.SHIELD_SLOT, 2, 'Activate'],
    ['shield Check', core.ItemIdentifiers.DRAGONFIRE_SHIELD, core.Equipment.SHIELD_SLOT, 3, 'Check'],
    ['tentacle Check', core.ItemIdentifiers.ABYSSAL_TENTACLE, core.Equipment.WEAPON_SLOT, 2, 'Check'],
    ['unsupported shield op', core.ItemIdentifiers.DRAGONFIRE_SHIELD, core.Equipment.SHIELD_SLOT, 10, undefined],
  ]) {
    test(`${group}: an unhandled ${name} leaves the item worn`, async t => {
      const f = wornAction(t, group, slot, itemId);
      assert.equal(core.CacheDefinitions.getItem(itemId).params.get(451 + op - 2), option);
      await f.click(op);
      assert.equal(f.player.getEquipment().getItems()[slot], f.item);
      assert.equal(f.player.getInventory().getAmount(itemId), 0);
    });
  }
  test(`${group}: explicit Remove still unequips shields and weapons`, async t => {
    for (const [id, slot] of [[core.ItemIdentifiers.DRAGONFIRE_SHIELD, core.Equipment.SHIELD_SLOT],
      [core.ItemIdentifiers.ABYSSAL_TENTACLE, core.Equipment.WEAPON_SLOT]]) {
      const f = wornAction(t, group, slot, id);
      await f.click(1);
      assert.equal(f.player.getEquipment().getItems()[slot].getId(), -1);
      assert.equal(f.player.getInventory().getAmount(id), 1);
    }
  });
  test(`${group}: handled Giantsoul Check and jewellery teleport retain plugin behavior`, async t => {
    const Giantsoul = require('../plugins/items/GiantsoulAmulet.plugin');
    Giantsoul.register(PluginManager.createApi(`equipment-giantsoul-${group}`));
    require('../plugins/items/Jewellery.plugin').register(PluginManager.createApi(`equipment-jewellery-${group}`));
    const amulet = wornAction(t, group, core.Equipment.AMULET_SLOT, core.ItemIdentifiers.GIANTSOUL_AMULET);
    amulet.item.setMetaValue(Giantsoul.CHARGES_META_KEY, 3);
    assert.equal(core.CacheDefinitions.getItem(amulet.item.getId()).params.get(454), 'Check');
    await amulet.click(5);
    assert.match(amulet.messages.at(-1), /3 charges left/);
    assert.equal(amulet.player.getEquipment().getItems()[core.Equipment.AMULET_SLOT], amulet.item);
    const glory = wornAction(t, group, core.Equipment.AMULET_SLOT, core.ItemIdentifiers.AMULET_OF_GLORY_4_);
    const teleports = [];
    t.mock.method(core.TeleportHandler, 'checkReqs', () => true);
    t.mock.method(core.TeleportHandler, 'teleport', (_player, target, _type, _warn, onArrival) => {
      teleports.push([target.getX(), target.getY()]); onArrival?.();
    });
    assert.equal(core.CacheDefinitions.getItem(glory.item.getId()).params.get(451), 'Edgeville');
    await glory.click(2);
    assert.deepEqual(teleports, [[3087, 3496]]);
    assert.equal(glory.player.getEquipment().getItems()[core.Equipment.AMULET_SLOT], glory.item);
    assert.equal(glory.item.getId(), core.ItemIdentifiers.AMULET_OF_GLORY_3_);
    assert.equal(glory.player.getInventory().getAmount(core.ItemIdentifiers.AMULET_OF_GLORY_3_), 0);
  });
}
