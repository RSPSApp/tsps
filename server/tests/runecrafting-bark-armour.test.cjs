// Swampbark and bloodbark: the runescrolls' Read and splitbark infused at the Nature and Blood
// Altars (docs/runecrafting.md "Swampbark and bloodbark"; rsprox captures 1632 and 1636, Wiki).
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

require('../dist/Server').Server.installProductionPathResolver();
const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { Player } = require('../dist/game/entity/impl/player/Player');
const { Item } = require('../dist/game/model/Item');
const { ItemStatementDialogue } = require('../dist/game/model/dialogues/entries/impl/ItemStatementDialogue');
const { StatementDialogue } = require('../dist/game/model/dialogues/entries/impl/StatementDialogue');

let core;
let confirms = [];

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  core = PluginManager.getCoreApi();
  core.ObjectDefinition.init();
  const api = PluginManager.createApi('RunecraftingBarkArmourTest');
  require('../plugins/skills/Runecrafting.plugin').register(api);
  // Stands in for DestroyItem's prompt: records the request so a test can answer Yes.
  PluginManager.createApi('RunecraftingBarkArmourPrompt').onCustomEvent('destroy-item:confirm', (request) => {
    confirms.push(request);
    request.opened = true;
  });
});

let index = 1400;
function crafter(level, items) {
  const player = new Player(null, new core.Location(3232, 4834, 0));
  player.setIndex(index++);
  player.setUsername('bark-armour-test');
  player.setRegistered(true);
  player.setNeedsPlacement(false);
  player.getSession = () => ({ sendClientPacket: () => true, write() {} });
  player.messages = [];
  player.sendMessage = (text) => player.messages.push(text);
  const sender = player.getPacketSender();
  player.varbits = [];
  player.sounds = [];
  player.spam = [];
  const sendVarbit = sender.sendVarbit.bind(sender);
  sender.sendVarbit = (id, value) => { player.varbits.push([id, value]); return sendVarbit(id, value); };
  const sendSound = sender.sendSound.bind(sender);
  sender.sendSound = (id, ...rest) => { player.sounds.push(id); return sendSound(id, ...rest); };
  const sendTypedMessage = sender.sendTypedMessage.bind(sender);
  sender.sendTypedMessage = (type, text) => {
    if (type === core.ChatType.SPAM) player.spam.push(text);
    return sendTypedMessage(type, text);
  };
  player.getSkillManager().setCurrentLevels(core.Skill.RUNECRAFTING, level);
  player.xp = [];
  const skills = player.getSkillManager();
  const addExperiences = skills.addExperiences.bind(skills);
  skills.addExperiences = (skill, xp) => {
    if (skill === core.Skill.RUNECRAFTING) player.xp.push(xp);
    return addExperiences(skill, xp);
  };
  for (const [id, amount] of items) player.getInventory().add(new Item(id, amount), false);
  return player;
}

function slotOf(player, id) {
  return player.getInventory().getItems().findIndex((item) => item?.getId() === id);
}

function read(player, id) {
  const slot = slotOf(player, id);
  return PluginManager.emitItemAction({
    player, item: player.getInventory().getItems()[slot], itemId: id, slot, interfaceId: 149,
    clickType: 1, option: 'Read', handled: false,
  });
}

function use(player, itemId, objectId) {
  const event = {
    player, object: new core.GameObject(objectId, player.getLocation(), 10, 0, null), objectId,
    item: player.getInventory().getItems()[slotOf(player, itemId)], itemId, itemSlot: slotOf(player, itemId),
    interfaceType: 149, location: { x: 3231, y: 4831, z: 0 }, handled: false,
  };
  PluginManager.emitItemOnObject(event);
  return event;
}

function tick() {
  core.TaskManager.process();
}

/** Past the 5-tick window an infusion holds. */
function ticks(n) {
  for (let i = 0; i < n; i++) tick();
}

const varbit = (name) => core.CacheDefinitions.getVarbitId(name);

test('Read asks on the destroy prompt; Yes learns bloodbark, removes the scroll and shows it in an item box (capture 1632, t168-175)', () => {
  const { ItemIdentifiers: I } = core;
  const player = crafter(99, [[I.RUNESCROLL_OF_BLOODBARK, 1]]);
  confirms = [];
  assert.equal(read(player, I.RUNESCROLL_OF_BLOODBARK), true);
  assert.equal(confirms.length, 1);
  assert.equal(confirms[0].question, 'Are you sure you wish to learn from the scroll?');
  assert.equal(confirms[0].note, 'It will destroy the scroll in the process.');
  assert.equal(player.getInventory().getAmount(I.RUNESCROLL_OF_BLOODBARK), 1, 'nothing happens before Yes');

  confirms[0].confirm(player, confirms[0].item);
  assert.equal(player.getInventory().getAmount(I.RUNESCROLL_OF_BLOODBARK), 0);
  assert.equal(player.getAttribute('runecrafting:bloodbark-learnt'), true);
  assert.equal(player.getAttribute('runecrafting:swampbark-learnt') === true, false);
  assert.deepEqual(player.varbits.filter(([id]) => id === varbit('shades_blood_unlock')), [[varbit('shades_blood_unlock'), 1]]);
  assert.deepEqual(player.messages, ['As you close the scroll it starts to disintegrate in your hands.']);
  assert.ok(player.sounds.includes(2655));
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof ItemStatementDialogue);
  assert.equal(box.getItemId(), I.RUNESCROLL_OF_BLOODBARK);
  assert.equal(box.getText(), 'Reading through the scroll reveals the secret to infusing<br>Splitbark armour with Blood runes at a Blood altar to<br>create Bloodbark armour!');
});

test('the Nature Altar refuses splitbark until the swampbark scroll is read (capture 1636, t6625)', () => {
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const player = crafter(99, [[I.SPLITBARK_BODY, 1], [I.NATURE_RUNE, 1000]]);
  const event = use(player, I.SPLITBARK_BODY, O.ALTAR_46);
  assert.equal(event.handled, true);
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof StatementDialogue);
  tick();
  assert.equal(player.getInventory().getAmount(I.SPLITBARK_BODY), 1);
  assert.equal(player.getInventory().getAmount(I.NATURE_RUNE), 1000);
  assert.deepEqual(player.xp, []);
});

test('a learnt splitbark piece becomes bloodbark in its slot a tick after the use, for its runes and 0.05 XP a rune (capture 1632, t516-518)', () => {
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const player = crafter(99, [[I.NATURE_RUNE, 1], [I.SPLITBARK_GAUNTLETS, 1], [I.SPLITBARK_HELM, 1], [I.SPLITBARK_BODY, 1], [I.BLOOD_RUNE, 1000]]);
  player.setAttribute('runecrafting:bloodbark-learnt', true);
  const bodySlot = slotOf(player, I.SPLITBARK_BODY);

  assert.equal(use(player, I.SPLITBARK_BODY, O.ALTAR_83).handled, true);
  assert.equal(player.getInventory().getAmount(I.SPLITBARK_BODY), 1, 'the piece waits a tick');
  tick();
  assert.equal(player.getInventory().getItems()[bodySlot].getId(), I.BLOODBARK_BODY);
  assert.equal(player.getInventory().getAmount(I.BLOOD_RUNE), 500);
  assert.deepEqual(player.spam, ["You bind the temple's power into your Splitbark body."]);

  ticks(4);
  use(player, I.SPLITBARK_HELM, O.ALTAR_83); ticks(5);
  use(player, I.SPLITBARK_GAUNTLETS, O.BLOOD_ALTAR); ticks(5);
  assert.equal(player.getInventory().getAmount(I.BLOODBARK_HELM), 1);
  assert.equal(player.getInventory().getAmount(I.BLOODBARK_GAUNTLETS), 1, "Kourend's Blood Altar infuses too (Wiki)");
  assert.equal(player.getInventory().getAmount(I.BLOOD_RUNE), 150);
  assert.deepEqual(player.xp, [25, 12.5, 5]);
});

test('one piece every 5 ticks: a use inside the window is ignored, the next one after it infuses (Wiki; capture 1632, t1551-1572)', () => {
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const player = crafter(99, [[I.SPLITBARK_BODY, 1], [I.SPLITBARK_LEGS, 1], [I.SPLITBARK_HELM, 1], [I.NATURE_RUNE, 1500]]);
  player.setAttribute('runecrafting:swampbark-learnt', true);

  use(player, I.SPLITBARK_BODY, O.ALTAR_46); tick();
  assert.equal(use(player, I.SPLITBARK_LEGS, O.ALTAR_46).handled, true, 'the use is still taken');
  tick();
  use(player, I.SPLITBARK_HELM, O.ALTAR_46); tick();
  assert.equal(player.getInventory().getAmount(I.SWAMPBARK_BODY), 1);
  assert.equal(player.getInventory().getAmount(I.SPLITBARK_LEGS), 1, 'legs used a tick later: ignored');
  assert.equal(player.getInventory().getAmount(I.SPLITBARK_HELM), 1, 'helm used two ticks later: ignored');
  assert.equal(player.getInventory().getAmount(I.NATURE_RUNE), 1000);
  assert.equal(player.spam.length, 1);
  assert.equal(player.sounds.filter((id) => id === 2710).length, 1, 'an ignored use plays nothing');

  ticks(2);
  use(player, I.SPLITBARK_LEGS, O.ALTAR_46); tick();
  assert.equal(player.getInventory().getAmount(I.SWAMPBARK_LEGS), 1, '5 ticks after the body, the legs infuse');
  assert.equal(player.getInventory().getAmount(I.NATURE_RUNE), 500);
});

test('levels and rune counts are checked before anything is spent (Wiki)', () => {
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const low = crafter(45, [[I.SPLITBARK_HELM, 1], [I.NATURE_RUNE, 1000]]);
  low.setAttribute('runecrafting:swampbark-learnt', true);
  assert.equal(use(low, I.SPLITBARK_HELM, O.ALTAR_46).handled, true);
  tick();
  assert.equal(low.getInventory().getAmount(I.SPLITBARK_HELM), 1, 'the helm needs 46');
  assert.equal(low.getInventory().getAmount(I.NATURE_RUNE), 1000);

  const poor = crafter(48, [[I.SPLITBARK_LEGS, 1], [I.NATURE_RUNE, 499]]);
  poor.setAttribute('runecrafting:swampbark-learnt', true);
  use(poor, I.SPLITBARK_LEGS, O.ALTAR_46);
  tick();
  assert.equal(poor.getInventory().getAmount(I.SPLITBARK_LEGS), 1, 'the legs need 500 nature runes');

  const ok = crafter(46, [[I.SPLITBARK_HELM, 1], [I.NATURE_RUNE, 250]]);
  ok.setAttribute('runecrafting:swampbark-learnt', true);
  use(ok, I.SPLITBARK_HELM, O.ALTAR_46);
  tick();
  assert.equal(ok.getInventory().getAmount(I.SWAMPBARK_HELM), 1);
  assert.equal(ok.getInventory().getAmount(I.NATURE_RUNE), 0);
});

test('the wrong altar, and a piece moved away before the tick, change nothing', () => {
  const { ItemIdentifiers: I, ObjectIdentifiers: O } = core;
  const player = crafter(99, [[I.SPLITBARK_BOOTS, 1], [I.BLOOD_RUNE, 1000]]);
  player.setAttribute('runecrafting:bloodbark-learnt', true);
  player.setAttribute('runecrafting:swampbark-learnt', true);
  assert.equal(use(player, I.SPLITBARK_BOOTS, O.ALTAR_37).handled, false, 'the Fire Altar is not a bark altar');
  use(player, I.SPLITBARK_BOOTS, O.ALTAR_46);
  tick();
  assert.equal(player.getInventory().getAmount(I.SPLITBARK_BOOTS), 1, 'the Nature Altar needs nature runes');

  use(player, I.SPLITBARK_BOOTS, O.ALTAR_83);
  player.getInventory().deleteNumber(I.SPLITBARK_BOOTS, 1);
  tick();
  assert.equal(player.getInventory().getAmount(I.BLOODBARK_BOOTS), 0);
  assert.equal(player.getInventory().getAmount(I.BLOOD_RUNE), 1000);
});

test('Read once learnt shows the known box with no prompt and keeps the scroll; a stale prompt keeps it too (Wiki transcript)', () => {
  const { ItemIdentifiers: I } = core;
  const player = crafter(99, [[I.RUNESCROLL_OF_SWAMPBARK, 1], [I.RUNESCROLL_OF_SWAMPBARK, 1]]);
  confirms = [];
  read(player, I.RUNESCROLL_OF_SWAMPBARK);
  const stale = confirms[0];
  read(player, I.RUNESCROLL_OF_SWAMPBARK);
  assert.equal(confirms.length, 2);
  confirms[1].confirm(player, confirms[1].item);
  assert.equal(player.getAttribute('runecrafting:swampbark-learnt'), true);
  assert.equal(player.getInventory().getAmount(I.RUNESCROLL_OF_SWAMPBARK), 1);

  stale.confirm(player, stale.item);
  assert.equal(player.getInventory().getAmount(I.RUNESCROLL_OF_SWAMPBARK), 1, 'the open prompt cannot use up a second scroll');

  confirms = [];
  player.messages = [];
  assert.equal(read(player, I.RUNESCROLL_OF_SWAMPBARK), true);
  assert.equal(confirms.length, 0, 'no prompt once learnt');
  assert.equal(player.getInventory().getAmount(I.RUNESCROLL_OF_SWAMPBARK), 1);
  assert.deepEqual(player.messages, []);
  const box = player.getDialogueManager().getCurrent();
  assert.ok(box instanceof ItemStatementDialogue);
  assert.equal(box.getItemId(), I.RUNESCROLL_OF_SWAMPBARK);
  assert.equal(box.getText(), "You've already gained the knowledge to infuse Splitbark armour with Nature runes.");
});
