// Run after `yarn build`: node --test tests/neitiznot-faceguard-persistence-gates.test.cjs
//
// Real engine (PluginManager with every plugin loaded, real Player, real PlayerSave and the JSON
// persistence codec, real preset producer):
//  - the story flag, a kept faceguard and the preset restrictions survive a save and reload;
//  - the faceguard's wear gates (Defence 70, The Fremennik Exiles) are its own, not the helm's;
//  - the story needs The Fremennik Exiles (Wiki: the jaw "can be combined with the helm of
//    Neitiznot, after the completion of The Fremennik Exiles"; Exiles itself needs the Trials
//    and The Fremennik Isles). What the game says to a player who has not finished it is not
//    captured, so the jaw used on Olaf simply does nothing for them.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { NpcDefinitionLoader } = require("../dist/game/definition/loader/impl/NpcDefinitionLoader");
const { ItemDefinition } = require("../dist/game/definition/ItemDefinition");
const { EquipmentRequirements } = require("../dist/game/model/equipment/EquipmentRequirements");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { PlayerSave } = require("../dist/game/entity/impl/player/persistence/PlayerSave");

const Presets = require("../plugins/modes/pvp/Presets.PvpMode");
const Json = require("../plugins/persistence/JsonPlayerPersistence.plugin");
const QuestRuntime = require("../plugins/quests/QuestRuntime");

const STORY_ATTRIBUTE = "neitiznot:faceguard-story";
const STORY_VARBIT = 9472;
const EXILES_COMPLETE_STAGE = 130;
let core;
let I;
let next = 3900;

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  new NpcDefinitionLoader().load();
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  I = core.ItemIdentifiers;
  core.RegionManager.init();
  core.RegionManager.loadMapFiles(2673, 3685);
});

function actor(t) {
  const channel = {
    kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true,
    close() {}, onData() {}, onError() {}, onClose() {},
  };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(next++);
  player.setUsername("faceguardsave" + player.getIndex());
  player.setRegistered(true);
  player.setLocation(new core.Location(2673, 3684, 0));
  player.needsPlacement = false;
  const messages = [];
  t.mock.method(player.getPacketSender(), "sendMessage", (message) => {
    messages.push(message);
    return player.getPacketSender();
  });
  return { player, messages };
}

function login(player) {
  PluginManager.emitPlayerLogin({ player, username: player.getUsername(), isNewAccount: false });
}

function exiles() {
  const quest = QuestRuntime.getRegisteredQuests().find((entry) => entry.key === "the_fremennik_exiles");
  assert.ok(quest, "The Fremennik Exiles is registered");
  return quest;
}

function completeExiles(player) {
  exiles().setStage(player, EXILES_COMPLETE_STAGE);
  assert.equal(exiles().isComplete(player), true);
}

/** Saves the player, runs the record through the JSON codec and loads it into a fresh player. */
function relog(t, player) {
  const codec = new Json.JsonPlayerPersistence();
  const saved = JSON.parse(JSON.stringify(PlayerSave.fromPlayer(player), codec.replacer.bind(codec)), codec.reviver.bind(codec));
  const { player: restored } = actor(t);
  codec.hydratePlayerSave(saved).applyToPlayer(restored);
  login(restored);
  return restored;
}

function preset(id) {
  assert.equal(Presets.isEnabled(), true, "the Presets plugin is registered");
  const item = Presets._test.spawnPresetItem(new core.Item(id, 1), Presets.getGlobalPresetPool()[0]);
  assert.equal(item.isPresetItem(), true, "the producer marked the item");
  return item;
}

const real = (id) => new core.Item(id, 1);
const give = (player, ...items) => items.forEach((item) => player.getInventory().add(item, false));
const slotOf = (player, item) => player.getInventory().getItems().findIndex((entry) => entry && entry.equals(item));
const stored = (player, item) => {
  const slot = slotOf(player, item);
  assert.ok(slot >= 0, "the item is in the inventory");
  return player.getInventory().getItems()[slot];
};
const held = (player) => player.getInventory().getItems().filter((item) => item && item.getId() > 0);
const ids = (player) => held(player).map((item) => item.getId()).sort((a, b) => a - b);
const sortedIds = (list) => [...list].sort((a, b) => a - b);
const pending = (player) => core.MultiChatboxPrompt.getPending(player);

function jawOnOlaf(player) {
  const olaf = core.NPC.create(core.NpcIdentifiers.OLAF_THE_BARD, new core.Location(2673, 3685, 0));
  const item = stored(player, real(I.BASILISK_JAW));
  return PluginManager.emitItemOnNpc({
    player, target: olaf, definition: olaf.getDefinition(), npcId: olaf.getId(), item, itemId: item.getId(),
    slot: slotOf(player, item), handled: false,
  });
}

function playOut(player) {
  const manager = player.getDialogueManager();
  for (let i = 0; i < 60 && manager.isActive(); i++) manager.advance();
}

function itemOnItem(player, usedValue, targetValue) {
  const used = stored(player, usedValue);
  const target = stored(player, targetValue);
  return PluginManager.emitItemOnItem({
    player, usedItem: used, usedItemId: used.getId(), usedItemSlot: slotOf(player, used),
    usedWithItem: target, usedWithItemId: target.getId(), usedWithItemSlot: slotOf(player, target), handled: false,
  });
}

function dismantle(player, itemValue) {
  const item = stored(player, itemValue);
  const index = core.CacheDefinitions.getItem(item.getId()).inventoryActions.indexOf("Dismantle");
  assert.ok(index >= 0, "the cache gives the faceguard a Dismantle option");
  return PluginManager.emitItemAction({
    player, interfaceId: core.Inventory.INTERFACE_ID, item, itemId: item.getId(), slot: slotOf(player, item),
    clickType: index + 1, option: "Dismantle", handled: false,
  });
}

function yes(player) {
  return core.MultiChatboxPrompt.handleInterfaceActionClick({
    player, buttonId: core.MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, slot: 1, action: 1,
  });
}

// --- Persistence ------------------------------------------------------------------------------

test("the story flag survives a save and reload, with varbit 9472 restored and the combine working", (t) => {
  const { player } = actor(t);
  completeExiles(player);
  give(player, real(I.BASILISK_JAW), real(I.HELM_OF_NEITIZNOT));
  assert.equal(jawOnOlaf(player), true);
  playOut(player);
  assert.equal(player.getAttribute(STORY_ATTRIBUTE), true);

  const restored = relog(t, player);
  assert.equal(restored.getAttribute(STORY_ATTRIBUTE), true, "the flag was saved and loaded");
  assert.equal(restored.getPacketSender().getVarbit(STORY_VARBIT), 1, "the varbit is sent again on login");
  assert.deepEqual(ids(restored), sortedIds([I.BASILISK_JAW, I.HELM_OF_NEITIZNOT]));
  itemOnItem(restored, real(I.BASILISK_JAW), real(I.HELM_OF_NEITIZNOT));
  assert.equal(pending(restored)?.title, "Attach the jaw to the helmet?");
  yes(restored);
  assert.deepEqual(ids(restored), [I.NEITIZNOT_FACEGUARD]);
});

test("a player who never heard the story reloads with the flag off and varbit 9472 at 0", (t) => {
  const { player } = actor(t);
  const restored = relog(t, player);
  assert.equal(restored.getAttribute(STORY_ATTRIBUTE) === true, false);
  assert.equal(restored.getPacketSender().getVarbit(STORY_VARBIT), 0);
});

test("a faceguard kept through a reload can still be dismantled", (t) => {
  const { player } = actor(t);
  give(player, real(I.NEITIZNOT_FACEGUARD));
  const restored = relog(t, player);
  assert.deepEqual(ids(restored), [I.NEITIZNOT_FACEGUARD]);
  dismantle(restored, real(I.NEITIZNOT_FACEGUARD));
  assert.equal(pending(restored)?.title, "Remove the jaw from the helmet?");
  yes(restored);
  assert.deepEqual(ids(restored), sortedIds([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW]));
});

test("restricted metadata survives a reload and the preset items stay refused", (t) => {
  const { player } = actor(t);
  player.setAttribute(STORY_ATTRIBUTE, true);
  give(player, preset(I.HELM_OF_NEITIZNOT), real(I.BASILISK_JAW), preset(I.NEITIZNOT_FACEGUARD));
  const restored = relog(t, player);
  const helm = held(restored).find((item) => item.getId() === I.HELM_OF_NEITIZNOT);
  const faceguard = held(restored).find((item) => item.getId() === I.NEITIZNOT_FACEGUARD);
  for (const item of [helm, faceguard]) {
    assert.equal(item.isPresetItem(), true, "the preset flag was saved");
    assert.equal(item.isUnbankable(), true);
    assert.equal(item.isTradeable(), false);
  }
  itemOnItem(restored, helm, real(I.BASILISK_JAW));
  assert.equal(pending(restored), null, "the preset helm is still refused");
  dismantle(restored, faceguard);
  assert.equal(pending(restored), null, "the preset faceguard is still refused");
  assert.deepEqual(ids(restored), sortedIds([I.HELM_OF_NEITIZNOT, I.BASILISK_JAW, I.NEITIZNOT_FACEGUARD]));
});

// --- Wear gates -------------------------------------------------------------------------------

test("the faceguard needs 70 Defence (item data), the helm 55", (t) => {
  const { player } = actor(t);
  const faceguard = ItemDefinition.forId(I.NEITIZNOT_FACEGUARD);
  const helm = ItemDefinition.forId(I.HELM_OF_NEITIZNOT);
  player.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 69, false);
  assert.deepEqual(EquipmentRequirements.getUnmet(player, faceguard), { label: "Defence", level: 70 });
  player.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 70, false);
  assert.equal(EquipmentRequirements.getUnmet(player, faceguard), null);
  player.getSkillManager().setMaxLevels(core.Skill.DEFENCE, 55, false);
  assert.equal(EquipmentRequirements.getUnmet(player, helm), null, "the helm's own level is lower");
  assert.notEqual(EquipmentRequirements.getUnmet(player, faceguard), null, "55 Defence does not wear the faceguard");
});

test("the quest gates are per item: the faceguard names The Fremennik Exiles, the helm The Fremennik Isles", (t) => {
  const { player, messages } = actor(t);
  const HEAD = core.Equipment.HEAD_SLOT;
  assert.equal(PluginManager.emitCanEquip(player, HEAD, new core.Item(I.NEITIZNOT_FACEGUARD, 1)), false);
  assert.match(messages.join("\n"), /Fremennik Exiles/);
  messages.length = 0;
  assert.equal(PluginManager.emitCanEquip(player, HEAD, new core.Item(I.HELM_OF_NEITIZNOT, 1)), false);
  assert.match(messages.join("\n"), /Fremennik Isles/);
  assert.doesNotMatch(messages.join("\n"), /Fremennik Exiles/);

  completeExiles(player);
  messages.length = 0;
  assert.notEqual(PluginManager.emitCanEquip(player, HEAD, new core.Item(I.NEITIZNOT_FACEGUARD, 1)), false,
    "finishing Exiles opens the faceguard gate on its own");
  assert.equal(messages.length, 0);
});

// --- Story gate -------------------------------------------------------------------------------

test("the jaw used on Olaf does nothing until The Fremennik Exiles is complete", (t) => {
  const { player } = actor(t);
  give(player, real(I.BASILISK_JAW));
  assert.equal(jawOnOlaf(player), false, "the use is left unhandled");
  assert.equal(player.getDialogueManager().isActive(), false, "no conversation starts");
  assert.equal(player.getAttribute(STORY_ATTRIBUTE) === true, false);
  assert.deepEqual(ids(player), [I.BASILISK_JAW]);
});

test("with The Fremennik Exiles complete the jaw used on Olaf plays the story and learns it", (t) => {
  const { player } = actor(t);
  completeExiles(player);
  give(player, real(I.BASILISK_JAW));
  assert.equal(jawOnOlaf(player), true);
  assert.ok(player.getDialogueManager().isActive());
  playOut(player);
  assert.equal(player.getAttribute(STORY_ATTRIBUTE), true);
});
