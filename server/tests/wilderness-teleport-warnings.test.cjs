// Run after `yarn build`: node --test tests/wilderness-teleport-warnings.test.cjs
// The Wilderness teleport spells and tablets warn before they teleport while their All Settings row is on (the
// default), and take runes or the tablet only once the player says yes. The spellbook's op10 and the All Settings
// row change the same saved value, and the four enable/disable-all buttons set every row. Ordinary teleports never
// warn. Real Player, Inventory and ClientConnection, with every plugin loaded.
const assert = require("node:assert/strict");
const path = require("node:path");
const { before, test } = require("node:test");
require("../dist/Server").Server.installProductionPathResolver();
const { CachePipeline } = require("../dist/game/cache/CachePipeline");
const { CacheDefinitions } = require("../dist/game/cache/CacheDefinitions");
const { PluginManager } = require("../dist/plugins/PluginManager");
const { Player } = require("../dist/game/entity/impl/player/Player");
const { PlayerSession } = require("../dist/net/PlayerSession");
const { ClientConnection } = require("../dist/net/NetworkBuilder");
const { MultiChatboxPrompt } = require("../dist/game/model/menu/MultiChatboxPrompt");
const settingsJson = require("../plugins/interface/data/settings.json").settings;

const SPELL_PROMPT = { title: "Are you sure you wish to teleport to the Wilderness?", options: ["Yes, teleport me now.", "No, I want to stay here."] };
const SPELLS = [
  { name: "Dareeyak Teleport", setting: 61, varbit: "dareeyak_teleport_warning" },
  { name: "Carrallanger Teleport", setting: 62, varbit: "carrallagar_teleport_warning" },
  { name: "Annakarl Teleport", setting: 63, varbit: "annakarl_teleport_warning" },
  { name: "Ghorrock Teleport", setting: 64, varbit: "ghorrock_teleport_warning" },
];
const TARGET = { name: "Teleport to Target", setting: 60, varbit: "bounty_teleport_warning" };
const DEEP = "Teleport into the DEEP wilderness?";
const TABLETS = [
  { name: "Ice plateau teleport", setting: 67, varbit: "teletab_ice_plateau_warning", title: DEEP },
  { name: "Cemetery teleport", setting: 68, varbit: "teletab_cemetery_warning", title: DEEP },
  { name: "Wilderness crabs teleport", setting: 69, varbit: "teletab_wildycrabs_warning", title: DEEP },
  { name: "Dareeyak teleport", setting: 70, varbit: "teletab_dareeyak_warning", title: "Teleport into the wilderness?" },
  { name: "Carrallanger teleport", setting: 71, varbit: "teletab_carrallangar_warning", title: "Teleport into the wilderness?" },
  { name: "Annakarl teleport", setting: 72, varbit: "teletab_annakarl_warning", title: DEEP },
  { name: "Ghorrock teleport", setting: 73, varbit: "teletab_ghorrock_warning", title: DEEP },
];
const RUNES = [554, 555, 556, 557, 560, 561, 562, 563, 565, 566];
const LAW_RUNE = 563;

let core;
let playerIndex = 2400;
const settingRows = [];
const settingStructs = new Map();

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, ".."));
  PluginManager.loadFromDirectory(path.resolve(__dirname, "../plugins"));
  core = PluginManager.getCoreApi();
  // All Settings' search view lists every row, categories and rows in key order (Settings.plugin.js catalog()).
  for (const [, structId] of [...CacheDefinitions.getEnumValues(422)].sort(([a], [b]) => a - b)) {
    const category = CacheDefinitions.getStructParams(Number(structId));
    for (const [, s] of [...CacheDefinitions.getEnumValues(Number(category.get(745)))].sort(([a], [b]) => a - b)) {
      const params = CacheDefinitions.getStructParams(Number(s));
      settingRows.push(Number(params.get(1077)));
      settingStructs.set(Number(params.get(1077)), params);
    }
  }
});

function createPlayer(t, { spellbook } = {}) {
  const channel = { kind: "test", remoteAddress: "127.0.0.1", isOpen: () => true, send: () => true, close() {}, onData() {}, onError() {}, onClose() {} };
  const player = new Player(new PlayerSession(channel));
  player.setIndex(playerIndex++);
  player.setUsername(`wildy-warn-${playerIndex}`);
  player.setRegistered(true);
  player.needsPlacement = false;
  player.getSkillManager().setCurrentLevel(core.Skill.MAGIC, 99, false);
  if (spellbook) player.setSpellbook(spellbook);
  const connection = new ClientConnection(channel);
  connection.player = player;
  t.after(() => {
    PluginManager.emitPlayerLogout({ player, username: player.getUsername() });
    player.setRegistered(false);
  });
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  return { player, connection };
}

const varbit = (player, name) => player.getPacketSender().getVarbit(CacheDefinitions.getVarbitId(name));
const saved = (player, name) => player.getAttribute("settings:values")?.[`varbit:${CacheDefinitions.getVarbitId(name)}`];
const teleporting = (player) => player.isTeleportingReturn();

function giveRunes(player) {
  for (const id of RUNES) player.getInventory().add(new core.Item(id, 100), false);
}

async function castSpell(connection, name, op = 1) {
  const spell = CacheDefinitions.getSpellByName(name);
  assert.ok(spell, name);
  await connection.dispatch([{ type: "widget_action", widgetId: spell.widgetId, groupId: spell.widgetId >>> 16, childId: spell.widgetId & 0xffff, slot: -1, buttonNum: op, itemId: spell.itemId }]);
  connection.processTurnPackets();
}

function tabletId(name) {
  for (let id = 0; id < CacheDefinitions.getCounts().items; id++) {
    const item = CacheDefinitions.getItem(id);
    if (item?.name === name && item.noteTemplate < 0 && item.placeholderTemplate < 0 && (item.inventoryActions ?? []).includes("Break")) return id;
  }
  throw new Error(`no tablet ${name}`);
}

function breakTablet(player, itemId) {
  const items = player.getInventory().getItems();
  const slot = items.findIndex((item) => item?.getId() === itemId);
  assert.ok(slot >= 0, `tablet ${itemId} held`);
  PluginManager.emitItemAction({ player, interfaceId: 149, item: items[slot], itemId, slot, clickType: 1, option: "Break", handled: false });
}

/** Answers the open warning: 1 is the first option (yes), 2 the second (no). */
function answer(player, option) {
  assert.equal(MultiChatboxPrompt.handleInterfaceActionClick({ player, buttonId: MultiChatboxPrompt.OPTIONS_WIDGET_ID, groupId: 219, childId: 1, action: 0, slot: option }), true);
}

/** A row clicked in All Settings' search results, through its clickzone. */
function clickSetting(player, settingId) {
  player.setAttribute("settings-view", -1);
  const slot = settingRows.indexOf(settingId);
  assert.ok(slot >= 0, `setting ${settingId} listed`);
  PluginManager.emitInterfaceActionClick({ player, buttonId: (134 << 16) | 20, groupId: 134, childId: 20, action: 1, slot, handled: false });
}

test("the warning rows are cache toggles over the spells' and tablets' varbits, on by default as live", () => {
  for (const row of [TARGET, ...SPELLS, ...TABLETS]) {
    const params = settingStructs.get(row.setting);
    assert.ok(params, `setting ${row.setting} in the cache`);
    assert.equal(Number(params.get(1078) ?? 0), 0, `setting ${row.setting} is a toggle`);
    assert.equal(settingsJson[row.setting]?.varbit, CacheDefinitions.getVarbitId(row.varbit), `setting ${row.setting} is ${row.varbit}`);
  }
  // A spell's row is on while its varbit is 1, and live sends 1 at login; a tablet's row reads its varbit inverted
  // (param 1084), so 0, never sent, is on.
  for (const row of [TARGET, ...SPELLS]) {
    assert.equal(settingsJson[row.setting].default, 1, `${row.name} defaults on`);
    assert.equal(settingStructs.get(row.setting).get(1084), undefined);
  }
  for (const row of TABLETS) {
    assert.equal(settingsJson[row.setting].default, undefined, `${row.name} defaults to 0, on`);
    assert.equal(Number(settingStructs.get(row.setting).get(1084)), 1, `${row.name} reads its varbit inverted`);
  }
  for (const id of [74, 75, 76, 77]) assert.equal(Number(settingStructs.get(id).get(1078)), 6, `setting ${id} is a button`);
});

test("a new account's spell warnings are on at login", (t) => {
  const { player } = createPlayer(t);
  for (const row of [TARGET, ...SPELLS]) assert.equal(varbit(player, row.varbit), 1, row.name);
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 0, row.name);
});

test("each Wilderness spell warns first; No casts nothing and Yes casts, taking the runes then", async (t) => {
  for (const spell of SPELLS) {
    const { player, connection } = createPlayer(t, { spellbook: core.MagicSpellbook.ANCIENT });
    giveRunes(player);
    await castSpell(connection, spell.name);
    assert.deepEqual(MultiChatboxPrompt.getPending(player), SPELL_PROMPT, `${spell.name}: warning`);
    assert.equal(player.getInventory().getAmount(LAW_RUNE), 100, `${spell.name}: nothing taken while asked`);
    answer(player, 2);
    assert.equal(MultiChatboxPrompt.getPending(player), null);
    assert.equal(player.getInventory().getAmount(LAW_RUNE), 100, `${spell.name}: No takes nothing`);
    assert.equal(teleporting(player), false, `${spell.name}: No stays`);
    await castSpell(connection, spell.name);
    answer(player, 1);
    assert.equal(player.getInventory().getAmount(LAW_RUNE), 98, `${spell.name}: Yes takes the runes`);
    assert.equal(teleporting(player), true, `${spell.name}: Yes teleports`);
  }
});

test("with its warning off, a Wilderness spell casts at once", async (t) => {
  for (const spell of SPELLS) {
    const { player, connection } = createPlayer(t, { spellbook: core.MagicSpellbook.ANCIENT });
    giveRunes(player);
    await castSpell(connection, spell.name, 10);
    assert.equal(varbit(player, spell.varbit), 0, `${spell.name}: op10 turns it off`);
    await castSpell(connection, spell.name);
    assert.equal(MultiChatboxPrompt.getPending(player), null, `${spell.name}: no warning`);
    assert.equal(player.getInventory().getAmount(LAW_RUNE), 98);
    assert.equal(teleporting(player), true);
  }
});

test("a spell that can't be cast is refused before any warning, and Yes checks again", async (t) => {
  const { player, connection } = createPlayer(t, { spellbook: core.MagicSpellbook.ANCIENT });
  await castSpell(connection, "Ghorrock Teleport");
  assert.equal(MultiChatboxPrompt.getPending(player), null, "no runes: refused, not warned");
  giveRunes(player);
  await castSpell(connection, "Ghorrock Teleport");
  player.getInventory().deleteNumber(LAW_RUNE, 100);
  answer(player, 1);
  assert.equal(teleporting(player), false, "the runes went while asked: refused on Yes");
});

test("Teleport to Target asks through the same warning while its row is on", (t) => {
  const { player } = createPlayer(t);
  let cast = 0;
  const request = { player, name: "teleport to target", proceed: () => { cast++; }, handled: false };
  PluginManager.emitCustomEvent("spell:teleport-confirm", request);
  assert.equal(request.handled, true);
  assert.deepEqual(MultiChatboxPrompt.getPending(player), SPELL_PROMPT);
  answer(player, 2);
  assert.equal(cast, 0);
  PluginManager.emitCustomEvent("spell:teleport-confirm", { ...request, handled: false });
  answer(player, 1);
  assert.equal(cast, 1);
  clickSetting(player, TARGET.setting);
  const off = { player, name: "teleport to target", proceed: () => {}, handled: false };
  PluginManager.emitCustomEvent("spell:teleport-confirm", off);
  assert.equal(off.handled, false, "off: the spell casts at once");
});

test("each Wilderness tablet warns first; No keeps the tablet and Yes breaks it", (t) => {
  for (const tablet of TABLETS) {
    const { player } = createPlayer(t);
    const id = tabletId(tablet.name);
    player.getInventory().add(new core.Item(id, 2), false);
    breakTablet(player, id);
    assert.deepEqual(MultiChatboxPrompt.getPending(player), { title: tablet.title, options: ["Yes", "No"] }, tablet.name);
    answer(player, 2);
    assert.equal(player.getInventory().getAmount(id), 2, `${tablet.name}: No keeps it`);
    assert.equal(teleporting(player), false, `${tablet.name}: No stays`);
    breakTablet(player, id);
    answer(player, 1);
    assert.equal(teleporting(player), true, `${tablet.name}: Yes teleports`);
  }
});

test("with its row off, a Wilderness tablet breaks at once", (t) => {
  for (const tablet of TABLETS) {
    const { player } = createPlayer(t);
    clickSetting(player, tablet.setting);
    assert.equal(varbit(player, tablet.varbit), 1, `${tablet.name}: row off sets 1`);
    const id = tabletId(tablet.name);
    player.getInventory().add(new core.Item(id, 1), false);
    breakTablet(player, id);
    assert.equal(MultiChatboxPrompt.getPending(player), null, `${tablet.name}: no warning`);
    assert.equal(teleporting(player), true, tablet.name);
  }
});

test("the spellbook's op10 and the All Settings row change the same saved value", async (t) => {
  for (const spell of SPELLS) {
    const { player, connection } = createPlayer(t, { spellbook: core.MagicSpellbook.ANCIENT });
    await castSpell(connection, spell.name, 10);
    assert.equal(varbit(player, spell.varbit), 0, `${spell.name}: op10 off`);
    assert.equal(saved(player, spell.varbit), 0, `${spell.name}: saved by All Settings`);
    clickSetting(player, spell.setting);
    assert.equal(varbit(player, spell.varbit), 1, `${spell.name}: row back on`);
    await castSpell(connection, spell.name, 10);
    assert.equal(varbit(player, spell.varbit), 0, `${spell.name}: op10 reads the row's value`);
    PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
    assert.equal(varbit(player, spell.varbit), 0, `${spell.name}: kept over a relog`);
  }
});

test("the enable/disable-all buttons set every spell's and every tablet's warning", (t) => {
  const { player } = createPlayer(t);
  clickSetting(player, 76);
  for (const row of [TARGET, ...SPELLS]) assert.equal(varbit(player, row.varbit), 0, `76 turns off ${row.name}`);
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 0, `76 leaves ${row.name}`);
  clickSetting(player, 74);
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 1, `74 turns off ${row.name}`);
  clickSetting(player, 77);
  for (const row of [TARGET, ...SPELLS]) assert.equal(varbit(player, row.varbit), 1, `77 turns on ${row.name}`);
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 1, `77 leaves ${row.name}`);
  clickSetting(player, 75);
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 0, `75 turns on ${row.name}`);
  clickSetting(player, 74);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  for (const row of TABLETS) assert.equal(varbit(player, row.varbit), 1, `${row.name} kept over a relog`);
  for (const row of [TARGET, ...SPELLS]) assert.equal(varbit(player, row.varbit), 1, `${row.name} kept over a relog`);
});

test("ordinary teleports never warn", async (t) => {
  for (const [name, spellbook] of [["Varrock Teleport", core.MagicSpellbook.NORMAL], ["Paddewwa Teleport", core.MagicSpellbook.ANCIENT], ["Lassar Teleport", core.MagicSpellbook.ANCIENT]]) {
    const { player, connection } = createPlayer(t, { spellbook });
    giveRunes(player);
    await castSpell(connection, name);
    assert.equal(MultiChatboxPrompt.getPending(player), null, `${name}: no warning`);
    assert.equal(teleporting(player), true, `${name}: teleports`);
  }
  for (const name of ["Varrock teleport", "Lassar teleport", "Lumbridge teleport"]) {
    const { player } = createPlayer(t);
    const id = tabletId(name);
    player.getInventory().add(new core.Item(id, 1), false);
    breakTablet(player, id);
    assert.equal(MultiChatboxPrompt.getPending(player), null, `${name} tablet: no warning`);
    assert.equal(teleporting(player), true, `${name} tablet: teleports`);
  }
});

test("the spells' old warning attribute is cleared at login", (t) => {
  const { player } = createPlayer(t);
  player.setAttribute("spell-teleports:wilderness-warnings", 0b10001);
  PluginManager.emitPlayerLogin({ player, username: player.getUsername() });
  assert.equal(player.getAttribute("spell-teleports:wilderness-warnings"), 0);
  for (const row of [TARGET, ...SPELLS]) assert.equal(varbit(player, row.varbit), 1, `${row.name} on`);
});
