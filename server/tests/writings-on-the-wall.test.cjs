// Run after `yarn build`: node --test tests/writings-on-the-wall.test.cjs
//
// Focused regression for The Writing's on the Wall, flight 1 (rev 242 quest 219): start, Hudson's
// permission, the soldiers, Betty, Hugor, Lan, the report to Hudson, and Betty at Hosidius. It
// dispatches the plugin's real NPC hooks and asserts the stage varbit, flags, spawns and text.
const assert = require('node:assert/strict');
const path = require('node:path');
const { before, test } = require('node:test');

const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { CachePipeline } = require('../dist/game/cache/CachePipeline');
const { CacheDefinitions } = require('../dist/game/cache/CacheDefinitions');
const { Gamevals, GamevalKind } = require('../dist/game/cache/Gamevals');
const { Inventory } = require('../dist/game/model/container/impl/Inventory');
const { PluginManager } = require('../dist/plugins/PluginManager');
const { ItemIdentifiers } = require('../dist/util/ItemIdentifiers');
const { ObjectDefinition } = require('../dist/game/definition/ObjectDefinition');
const runtime = require('../plugins/quests/QuestRuntime');
const { questRowById } = require('../plugins/quests/QuestList.QuestRuntime');

const STAGE_VARBIT = 16800;
const BETTY = 16850;
const HUDSON = 16861;
const BREIMAN = 16866;
const CAMPTER = 16871;
const MONK = 16873;
const JOYCE = 16874;
const HUGOR = 7478;
const LAN = 16805; // the resolved child of the multi-NPC 7479

let api;
let quest;
let handlers;
let spawned;

function createPlayer(levels = { agility: 22, thieving: 20 }) {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const sender = new Proxy(
    {
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
      sendConfig: () => sender,
      sendJingle: () => sender,
      sendInterface: (id) => { player.opened.push(id); return sender; },
    },
    { get(target, property) { return property in target ? target[property] : () => sender; } },
  );
  const { Skill } = api.core;
  const player = {
    attributes, messages, varbits, lastDialogues: null, opened: [], moved: [], xp: [],
    location: new api.core.Location(1519, 3438, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'wotw-test',
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.AGILITY ? levels.agility : skill === Skill.THIEVING ? levels.thieving : 1),
      addExperiences: (skill, amount) => player.xp.push([skill.getName(), amount]), addExperience() {}, getExperience: () => 0,
    }),
    getDialogueManager: () => ({ startDialogues: (builder) => { player.lastDialogues = builder; }, reset: () => {} }),
    getLocation: () => player.location,
    getInventory: () => player.inventory,
    moveTo: (location) => { player.moved.push(location); player.location = location; },
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  return player;
}

const entries = (player) => [...player.lastDialogues.getDialogues().values()];
const lines = (player) => entries(player).filter((entry) => typeof entry.getText === 'function').map((entry) => entry.getText());
const menu = (player) => entries(player).find((entry) => entry instanceof api.core.OptionDialogue);
const choose = (player, option) => menu(player).execute(option);
function runAction(player) {
  const action = entries(player).find((entry) => entry instanceof api.core.ActionDialogue);
  assert.ok(action, 'the conversation ends in an action');
  action.send(player);
}
const talk = (player, name, npcId) => handlers.npc.get(name)['Talk-to']({ player, npcId });
const owned = (player, id) => spawned.filter((npc) => npc.owner === player && npc.id === id && !npc.removed);
const login = (player) => { for (const hook of handlers.login) hook({ player }); };
const flag = (player, name) => (player.getAttribute('writings-on-the-wall:flags')?.[name] ?? 0) >= 1;

const seed = (player, levels) => player.setAttribute('writings-on-the-wall:flags', { ...(player.getAttribute('writings-on-the-wall:flags') ?? {}), ...levels });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  ObjectDefinition.init(); // the object-definition table the real dispatcher resolves against
  spawned = [];
  handlers = { npc: new Map(), login: [], events: [], areas: [] };
  const realApi = PluginManager.createApi('WritingsOnTheWallTest');
  api = {
    core: { ...PluginManager.getCoreApi() },
    persistAttribute() {},
    spawnNpc(definition) {
      const npc = {
        id: definition.id, owner: definition.owner, removed: false,
        getId: () => definition.id,
        getOwner: () => definition.owner,
        getLocation: () => ({ getX: () => definition.x, getY: () => definition.y, getZ: () => 0 }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.removed = true; },
    onNpcInteraction: (name, actions) => { handlers.npc.set(name, actions); realApi.onNpcInteraction(name, actions); },
    onObjectInteraction: (name, actions) => realApi.onObjectInteraction(name, actions),
    onBeforeObjectInteraction: (handler) => realApi.onBeforeObjectInteraction(handler),
    onItemAction: (name, actions) => realApi.onItemAction(name, actions),
    onPlayerLogin: (handler) => handlers.login.push(handler),
    registerArea(area) { handlers.areas.push(area); },
    onCustomEvent() {},
    emitCustomEvent(name, event) { handlers.events.push({ name, event }); },
    onInterfaceActionButton() {},
    onPlayerLevelUp() {},
    onPlayerLogout() {},
  };
  require('../plugins/quests/quests/TheWritingsOnTheWall.Quest')(api);
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === "The Writing's on the Wall");
  assert.ok(quest, "The Writing's on the Wall registers");
});

test('the quest is keyed on the cache: row 219, varbit wotw, completion 48, and the NPC ids by name', () => {
  const row = questRowById(219, CacheDefinitions);
  assert.equal(row.displayname[0], "The Writing's on the Wall");
  assert.equal(row.endstate[0], 48);
  assert.deepEqual(row.requirement_stats, [16, 22, 17, 20]);
  assert.equal(row.startnpc[0], 16845);
  const gamevals = new Gamevals();
  assert.equal(gamevals.namesOf(GamevalKind.VARBIT).get(STAGE_VARBIT), 'wotw');
  assert.equal(gamevals.namesOf(GamevalKind.VARP).get(6242), 'wotw_primary');
  const npcs = gamevals.namesOf(GamevalKind.NPC);
  assert.deepEqual([BETTY, HUDSON, BREIMAN, CAMPTER, MONK, JOYCE, HUGOR, LAN].map((id) => npcs.get(id)), [
    'wotw_betty_child', 'wotw_hudson_child', 'wotw_soldier_child_1', 'wotw_soldier_child_2', 'wotw_monk', 'wotw_farmer', 'kw_hugor', 'kw_butcher_lan_vis']);
  // Lan's placed NPC (7479) is a multi-NPC keyed on wotw; the server hands plugins the resolved child.
  const sender = (stage) => ({ getVarbit: (id) => (id === STAGE_VARBIT ? stage : 0), getVarp: () => 0 });
  for (const stage of [0, 1, 4, 8, 48]) assert.equal(CacheDefinitions.resolveNpc(7479, sender(stage))?.id, LAN, `stage ${stage}`);
  for (const stage of [9, 12, 20]) assert.equal(CacheDefinitions.resolveNpc(7479, sender(stage)), undefined, `stage ${stage}`);
  // Every id a handler or spawn uses must be what the server passes to interactions: the id itself resolves to itself.
  for (const id of [BETTY, HUDSON, BREIMAN, CAMPTER, MONK, JOYCE, HUGOR, LAN]) assert.equal(CacheDefinitions.resolveNpc(id, sender(4))?.id, id, `npc ${id} is not a multi-NPC parent`);
  assert.equal(quest.varbitId, STAGE_VARBIT);
  assert.equal(quest.completionValue, 48);
  assert.equal(quest.questPoints, 1);
});

test('Betty will not start the quest without 22 Agility and 20 Thieving, and starts it on Yes', () => {
  const weak = createPlayer({ agility: 21, thieving: 20 });
  talk(weak, 'Betty', BETTY);
  assert.equal(lines(weak).at(-1), 'Nothing you can help me with.');
  assert.equal(quest.getStage(weak), 0);

  const player = createPlayer();
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[0], 'Hello there. Who are you?');
  assert.equal(lines(player).at(-1), "You... You'd do that?");
  choose(player, 2); // No.
  assert.equal(quest.getStage(player), 0);
  talk(player, 'Betty', BETTY);
  choose(player, 1);
  runAction(player);
  assert.equal(quest.getStage(player), 1);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 1);
  assert.ok(player.messages.includes("You've started a new quest: <col=081190>The Writing's on the Wall</col>"));
  assert.equal(lines(player)[1], "Thank you. Talk to Sergeant Hudson. He's in charge of the investigation. You'll need his permission to help.");
  talk(player, 'Betty', BETTY);
  assert.deepEqual(lines(player), ['Have you spoken to Sergeant Hudson yet?', 'Not yet.', 'Please hurry.']);
});

test('the soldiers speak before and after the start, and Hudson grants permission', () => {
  const player = createPlayer();
  login(player);
  talk(player, 'Sergeant Hudson', HUDSON);
  assert.deepEqual(lines(player), ["What's going on here?", "I'm afraid there's been a murder. Now please, move along. We need space to conduct our investigation."]);
  quest.setStage(player, 1);
  talk(player, 'Corporal Breiman', BREIMAN);
  assert.equal(lines(player)[3], "We have things under control. That said, if you think you can contribute, you might want to speak to Sergeant Hudson. He's in charge here.");
  talk(player, 'Sergeant Hudson', HUDSON);
  assert.equal(lines(player).at(-1), "Hmm... Well if it makes Betty feel better, then fine. Feel free to have a look around the house. Just don't go messing up any evidence.");
  runAction(player);
  assert.equal(quest.getStage(player), 4);
  talk(player, 'Sergeant Hudson', HUDSON);
  assert.equal(lines(player)[0], 'What do I need to be doing?');
  talk(player, 'Corporal Campter', CAMPTER);
  assert.equal(lines(player)[5], "That's right. He's the brains of the operation you see. I'm Corporal Sarah Campter. It's my job, along with my partner, to gather up any evidence and interview the witnesses.");
});

test('the cache windows decide who is spawned: soldiers and Betty at Land\'s End, then Betty at the house', () => {
  const player = createPlayer();
  quest.setStage(player, 4);
  login(player);
  for (const id of [HUDSON, BREIMAN, CAMPTER, BETTY]) assert.equal(owned(player, id).length, 1, `npc ${id} at Land's End`);
  assert.equal(owned(player, MONK).length, 0);
  quest.setStage(player, 12);
  login(player);
  assert.equal(owned(player, HUDSON).length, 0, 'Hudson and the corporals are gone from 9');
  assert.equal(owned(player, JOYCE).length, 1);
  assert.equal(owned(player, MONK).length, 1);
  assert.equal(owned(player, BETTY).length, 1, 'Betty stands outside the uncle\'s house');
});

test('Hugor and Lan answer the Wiki questions and set the evidence flags; the last piece of evidence moves the quest to the report', () => {
  const player = createPlayer();
  quest.setStage(player, 4);
  talk(player, 'Hugor', HUGOR);
  assert.equal(lines(player)[0], 'Got any *hic* wine?');
  runAction(player);
  choose(player, 1); // What do you know about the victim?
  assert.equal(flag(player, 'hugorAlibi'), false, 'only the witness question sets the flag');
  talk(player, 'Lan the Butcher', LAN);
  assert.equal(lines(player)[0], "What d'ya want?");
  runAction(player);
  choose(player, 1);
  runAction(player); // the flag is set when the answer has been read
  assert.equal(flag(player, 'butcherQuestioned'), true);
  // Betty's family question sets the history flag.
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[1], "I've found a few things, but I think there's still more to uncover.");
  runAction(player);
  choose(player, 2);
  runAction(player);
  assert.equal(flag(player, 'history'), true);
  assert.equal(quest.getStage(player), 4, 'not everything is found yet');
  seed(player, { letter: 2, news: 2, wall: 1, knife: 1 });
  talk(player, 'Hugor', HUGOR);
  runAction(player);
  choose(player, 2); // Did you see or hear anything around the time of the murder?
  assert.equal(lines(player).at(-1), 'Hmm... Interesting...');
  runAction(player);
  assert.equal(flag(player, 'hugorAlibi'), true);
  assert.equal(player.getPacketSender().getVarbit(16809), 1);
  assert.equal(quest.getStage(player), 8, 'all the Land\'s End evidence is found');
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[2], 'I guess you should let Sergeant Hudson know.');
});

test('Hudson takes the report and sends the player to Betty at her uncle\'s house', () => {
  const player = createPlayer();
  quest.setStage(player, 8);
  login(player);
  talk(player, 'Sergeant Hudson', HUDSON);
  assert.equal(lines(player)[0], "I've found some interesting things that you should know about.");
  assert.equal(lines(player).at(-1), "Thank you. My uncle lives south of the city itself, just north west of the Tithe Farm. I'll meet you there.");
  runAction(player);
  assert.equal(quest.getStage(player), 12);
  assert.equal(owned(player, HUDSON).length, 0);
});

test('Betty outside the uncle\'s house, then the Hosidius witnesses and Betty\'s Keystone Lodge question', () => {
  const player = createPlayer();
  quest.setStage(player, 12);
  login(player);
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[0], 'You made it.');
  talk(player, 'Betty', BETTY);
  assert.deepEqual(lines(player), ['Have you found a way inside yet?', 'Not yet. I\'ll keep working on it.', 'Thanks. This is very unusual...']);
  quest.setStage(player, 16);
  login(player);
  talk(player, 'Monk', MONK);
  runAction(player);
  choose(player, 1);
  runAction(player);
  assert.equal(flag(player, 'strangerInfo'), true);
  talk(player, 'Joyce', JOYCE);
  runAction(player);
  choose(player, 1);
  runAction(player);
  assert.equal(flag(player, 'uncleJob'), true);
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[0], 'Have you found anything yet?');
  seed(player, { certificate: 2 });
  talk(player, 'Betty', BETTY);
  runAction(player);
  choose(player, 3); // Have you heard of the Keystone Lodge?
  runAction(player);
  assert.equal(flag(player, 'confrontationInfo'), true);
});

const carries = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

/** Clicks a placed loc through the real object dispatcher, with the definition the player's varbits resolve (cache names and options). */
function object(player, baseId, optionName) {
  const definition = ObjectDefinition.forPlayer(baseId, player);
  assert.ok(definition, `loc ${baseId} resolves for the player`);
  const clickType = definition.getInteractions().findIndex((option) => option?.toLowerCase() === optionName.toLowerCase()) + 1;
  assert.ok(clickType > 0, `loc ${baseId} offers ${optionName} at this stage (has ${JSON.stringify(definition.getInteractions())})`);
  const here = player.getLocation();
  const event = {
    player, definition, objectId: baseId, clickType, option: optionName.toLowerCase(), handled: false,
    object: { getId: () => baseId, getDefinition: () => definition, getLocation: () => here },
    location: { x: here.getX(), y: here.getY(), z: 0 },
  };
  return PluginManager.emitObjectInteraction(event);
}

/** Uses an inventory item through the real item-action dispatcher. */
function item(player, itemId, optionName) {
  const definition = CacheDefinitions.getItem(itemId);
  const clickType = definition.inventoryActions.indexOf(optionName) + 1;
  assert.ok(clickType > 0, `item ${itemId} has ${optionName}`);
  let slot = -1;
  for (let index = 0; index < 28; index++) if (player.getInventory().get(index)?.getId() === itemId) slot = index;
  assert.ok(slot >= 0, `item ${itemId} is carried`);
  return PluginManager.emitItemAction({ player, item: player.getInventory().get(slot), slot, itemId, clickType, handled: false });
}

test('loc, item and interface ids are the cache names the handlers expect', () => {
  const gamevals = new Gamevals();
  const locs = gamevals.namesOf(GamevalKind.LOC);
  const expectedLocs = { 50789: 'wotw_bed_lands_end', 50793: 'wotw_blood_lands_end', 50798: 'wotw_shelves_lands_end', 50799: 'wotw_butcher_bed_lands_end',
    50800: 'wotw_hosidius_front_door', 50801: 'wotw_hosidius_back_door', 50803: 'wotw_hosidius_window', 50804: 'wotw_table_hosidius',
    50808: 'wotw_compost_bin_hosidius', 50810: 'wotw_bookcase_hosidius' };
  for (const [id, name] of Object.entries(expectedLocs)) assert.equal(locs.get(Number(id)), name);
  const objs = gamevals.namesOf(GamevalKind.OBJ);
  assert.deepEqual([ItemIdentifiers.LETTER_18, ItemIdentifiers.NEWSPAPER_CUTTING, ItemIdentifiers.BLOODY_KNIFE_2, ItemIdentifiers.HUMAN_HEAD, ItemIdentifiers.LETTER_19, ItemIdentifiers.CERTIFICATE_11].map((id) => objs.get(id)),
    ['wotw_letter_lands_end', 'wotw_news_lands_end', 'wotw_knife_lands_end', 'wotw_head_hosidius', 'wotw_letter_hosidius', 'wotw_certificate_hosidius']);
  const interfaces = gamevals.allInterfaces();
  assert.deepEqual([984, 986, 987, 988, 990].map((id) => interfaces.get(id)?.name),
    ['wotw_certificate_hosidius', 'wotw_letter_hosidius', 'wotw_letter_lands_end', 'wotw_news_lands_end', 'wotw_wall_lands_end']);
  // The names and options the hooks key on, as the cache spells them for the stage that offers them.
  const player = createPlayer();
  quest.setStage(player, 4);
  const resolved = (id) => ObjectDefinition.forPlayer(id, player);
  assert.deepEqual([resolved(50789).getName(), resolved(50789).getInteractions().filter(Boolean)], ['Dead Body', ['Inspect']]);
  assert.deepEqual([resolved(50793).getName(), resolved(50793).getInteractions().filter(Boolean)], ['Blood', ['Inspect']]);
  for (const [id, name, option] of [[50798, 'Shelves', 'Search'], [50799, 'Bed', 'Search'], [50800, 'Door', 'Open'], [50801, 'Door', 'Open'],
    [50803, 'Window', 'Climb-through'], [50808, 'Compost Bin', 'Search'], [50810, 'Bookcase', 'Search'], [41428, 'Ladder', 'Climb-up'], [41427, 'Ladder', 'Climb-down']]) {
    assert.deepEqual([resolved(id).getName(), resolved(id).getInteractions().filter(Boolean)], [name, [option]], `loc ${id}`);
  }
  const itemName = (id, option) => [CacheDefinitions.getItem(id).name, CacheDefinitions.getItem(id).inventoryActions[0]];
  assert.deepEqual([ItemIdentifiers.LETTER_18, ItemIdentifiers.LETTER_19].map((id) => itemName(id)), [['Letter', 'Read'], ['Letter', 'Read']]);
  assert.deepEqual(itemName(ItemIdentifiers.NEWSPAPER_CUTTING), ['Newspaper cutting', 'Read']);
  assert.deepEqual(itemName(ItemIdentifiers.CERTIFICATE_11), ['Certificate', 'Read']);
  assert.deepEqual(itemName(ItemIdentifiers.BLOODY_KNIFE_2), ['Bloody knife', 'Inspect']);
  assert.deepEqual(itemName(ItemIdentifiers.HUMAN_HEAD), ['Human head', 'Inspect']);
});

test('Land\'s End through the real dispatcher: the body menu, the letter, the blood wall, the shelves and Lan\'s bed, until the report is due', () => {
  const player = createPlayer();
  assert.equal(object(player, 50789, 'Search'), true, 'before the investigation the body can only be searched');
  assert.equal(player.messages.at(-1), 'You search the body, but find nothing of note.');
  quest.setStage(player, 4);
  assert.equal(object(player, 50789, 'Inspect'), true);
  choose(player, 2); // arms
  assert.equal(lines(player)[0], 'You inspect the victim\'s arms. They are coated in blood and both hands have been removed.');
  runAction(player);
  assert.equal(flag(player, 'hands'), true);
  choose(player, 3); // torso
  runAction(player);
  choose(player, 1); // Take the letter? Yes.
  assert.equal(carries(player, ItemIdentifiers.LETTER_18), true);
  assert.equal(player.getAttribute('writings-on-the-wall:flags').letter, 2);
  assert.equal(player.getPacketSender().getVarbit(16801), 2);
  assert.equal(item(player, ItemIdentifiers.LETTER_18, 'Read'), true);
  assert.deepEqual(player.opened, [987]);
  assert.equal(object(player, 50793, 'Inspect'), true);
  assert.deepEqual(player.opened.slice(-1), [990]);
  assert.equal(player.getAttribute('writings-on-the-wall:flags').wall, 1);
  assert.equal(object(player, 50798, 'Search'), true);
  assert.equal(carries(player, ItemIdentifiers.NEWSPAPER_CUTTING), true);
  assert.equal(item(player, ItemIdentifiers.NEWSPAPER_CUTTING, 'Read'), true);
  assert.deepEqual(player.opened.slice(-1), [988]);
  assert.equal(object(player, 50799, 'Search'), true);
  assert.equal(lines(player)[0], 'You search the bed and find a bloody knife under it.');
  assert.equal(carries(player, ItemIdentifiers.BLOODY_KNIFE_2), true);
  assert.equal(item(player, ItemIdentifiers.BLOODY_KNIFE_2, 'Inspect'), true);
  assert.equal(lines(player)[0], "It's a sharp knife that's covered in blood.");
  object(player, 50799, 'Search');
  assert.equal(player.messages.at(-1), 'You search the bed, but find nothing of note.');
  assert.equal(quest.getStage(player), 4, 'the talk evidence is still missing');
  seed(player, { butcherQuestioned: 1, history: 1 });
  talk(player, 'Hugor', HUGOR);
  runAction(player);
  choose(player, 2);
  runAction(player);
  assert.equal(quest.getStage(player), 8, 'all Land\'s End evidence found through the world and conversations');
  assert.equal(object(player, 50789, 'Search'), true, 'from stage 8 the body is searchable again, as the cache shows');
});

test('Hosidius through the real dispatcher: locked doors, the window, the door sequence, the basement, the way back up, the clues', () => {
  const player = createPlayer();
  quest.setStage(player, 12);
  login(player);
  player.location = new api.core.Location(1785, 3518, 0);
  assert.equal(object(player, 50800, 'Open'), true);
  assert.equal(lines(player)[0], 'The door is securely locked.');
  assert.equal(object(player, 50803, 'Climb-through'), true);
  assert.equal(player.messages.at(-1), 'You climb through the window.');
  assert.equal(player.getPacketSender().getVarbit(16811), 1);
  assert.equal(player.location.getX(), 1784, 'now inside the house');
  assert.equal(object(player, 50801, 'Open'), true);
  assert.equal(lines(player)[0], "That's the door open. No sign of your uncle though...");
  runAction(player);
  assert.equal(quest.getStage(player), 16);
  assert.equal(player.location.getY(), 9936, 'in the basement');
  assert.equal(owned(player, BETTY).filter((npc) => npc.getLocation().getY() === 9936).length, 1, 'Betty is in the basement');
  assert.equal(object(player, 50804, 'Inspect'), true);
  choose(player, 1);
  assert.equal(lines(player)[0], "You can't inspect the victim's head as it has been completely removed.");
  // The only way out is the basement ladder; it climbs to the house through the generic ladder event.
  // This test captures that event through a mock: it does not run the real Ladders plugin or a real player move.
  assert.equal(object(player, 41428, 'Climb-up'), true);
  const climb = handlers.events.filter((entry) => entry.name === 'ladders:climbUp').at(-1);
  assert.deepEqual([climb.event.destination.getX(), climb.event.destination.getY()], [1785, 3524]);
  player.location = climb.event.destination;
  assert.equal(object(player, 50810, 'Search'), true);
  assert.equal(carries(player, ItemIdentifiers.CERTIFICATE_11), true);
  assert.equal(player.getPacketSender().getVarbit(16813), 2);
  assert.equal(item(player, ItemIdentifiers.CERTIFICATE_11, 'Read'), true);
  assert.deepEqual(player.opened.slice(-1), [984]);
  assert.equal(object(player, 50808, 'Search'), true);
  assert.equal(lines(player)[0], 'You search the compost bin and find a decapitated head hidden in it.');
  seed(player, { uncleJob: 1, strangerInfo: 1, drinkingHabits: 1 });
  assert.equal(item(player, ItemIdentifiers.HUMAN_HEAD, 'Inspect'), true);
  assert.equal(carries(player, ItemIdentifiers.LETTER_19), true);
  assert.equal(player.getAttribute('writings-on-the-wall:flags').hosidiusHead, 2);
  assert.equal(item(player, ItemIdentifiers.LETTER_19, 'Read'), true);
  assert.deepEqual(player.opened.slice(-1), [986]);
  assert.equal(quest.getStage(player), 16, 'Betty\'s Keystone Lodge answer is still missing');
  talk(player, 'Betty', BETTY);
  runAction(player);
  choose(player, 3);
  runAction(player);
  assert.equal(quest.getStage(player), 20, 'every Hosidius clue found');
});

test('the stage-20 conversation offers the trip to Port Piscarilius and ends in the cell', () => {
  const player = createPlayer();
  quest.setStage(player, 20);
  login(player);
  talk(player, 'Betty', BETTY);
  assert.deepEqual(entries(player).find((entry) => entry instanceof api.core.OptionDialogue).getOptions(), ["Let's get going.", 'I need to do something else first.']);
  choose(player, 2);
  assert.equal(quest.getStage(player), 20);
  talk(player, 'Betty', BETTY);
  choose(player, 1);
  runAction(player);
  assert.equal(quest.getStage(player), 24, 'the arrest ends in the cell');
});

test('Port Piscarilius ids are the cache names the handlers expect, resolved per stage through the real path', () => {
  const gamevals = new Gamevals();
  const locs = gamevals.namesOf(GamevalKind.LOC);
  const expected = { 50812: 'wotw_piscarilius_cell_wall', 50815: 'wotw_armour_stand_piscarilius', 50819: 'wotw_drawers_piscarilius', 63314: 'wotw_wardrobe_piscarilius',
    63315: 'wotw_bed_piscarilius', 63309: 'wotw_blood_piscarilius', 63311: 'wotw_blood_wall_piscarilius' };
  for (const [id, name] of Object.entries(expected)) assert.equal(locs.get(Number(id)), name);
  const npcs = gamevals.namesOf(GamevalKind.NPC);
  assert.deepEqual([16867, 16872].map((id) => npcs.get(id)), ['wotw_soldier_cutscene_1', 'wotw_soldier_cutscene_2']);
  const interfaces = gamevals.allInterfaces();
  assert.deepEqual([985, 991].map((id) => interfaces.get(id)?.name), ['wotw_drawers_piscarilius', 'wotw_wall_piscarilius']);
  const player = createPlayer();
  const at = (stage) => { quest.setStage(player, stage); return (id) => { const d = ObjectDefinition.forPlayer(id, player); return d ? [d.getName(), (d.getInteractions() ?? []).filter(Boolean)] : null; }; };
  assert.deepEqual(at(26)(50815), ['Dead Body', ['Inspect']]);
  assert.deepEqual(at(26)(50819), ['Drawers', ['Inspect']]);
  assert.deepEqual(at(26)(63314), ['Wardrobe', ['Search']]);
  assert.deepEqual(at(26)(63315), ['Bed', ['Search']]);
  assert.deepEqual(at(24)(50812), ['Wall', ['Remove-plank']]);
  player.getPacketSender().sendVarbit(16834, 1);
  assert.deepEqual(at(26)(50812), ['Wall', ['Climb-over']]);
  assert.deepEqual(at(32)(63309), ['Blood', ['Inspect']]);
  assert.equal(at(20)(50815)?.[1].includes('Inspect'), false, 'Jensen\'s body is not inspectable before the quest reaches Piscarilius');
});

test('Port Piscarilius: the cell, the plank, Jensen\'s house, the guards, the cell blood (Piscarilius enabled)', () => {
  try {
    const player = createPlayer();
    quest.setStage(player, 20);
    login(player);
    talk(player, 'Betty', BETTY);
    choose(player, 1); // Let's get going.
    runAction(player);
    assert.equal(quest.getStage(player), 24);
    assert.deepEqual([player.location.getX(), player.location.getY()], [1788, 3781], 'in the cell');
    assert.equal(owned(player, BETTY).length >= 1, true);
    talk(player, 'Betty', BETTY);
    assert.deepEqual(lines(player), ['Have you found a way out yet?', 'Not yet.', "Please hurry. We need to find out what's happened."]);
    const cell = handlers.areas.find((area) => area.constructor.name === 'CellArea');
    assert.equal(cell.canTeleport(player), false);
    assert.equal(player.messages.at(-1), "A teleport block has been placed on this cell. You'll need to find another way out.");
    assert.equal(object(player, 50812, 'Remove-plank'), true);
    assert.equal(lines(player)[0], 'You remove a loose plank to reveal a gap in the wall.');
    runAction(player);
    assert.equal(quest.getStage(player), 26);
    assert.equal(player.getPacketSender().getVarbit(16834), 1);
    assert.equal(object(player, 50812, 'Climb-over'), true);
    assert.equal(player.messages.at(-1), 'You climb through the gap at the top of the wall.');
    assert.equal(player.location.getY(), 3783, 'outside the cell');
    talk(player, 'Betty', BETTY);
    assert.equal(lines(player)[0], "What are you doing back here? You need to get over to Captain Jensen's house and then investigate whatever has happened there! Hurry!");
    // After a Jensen clue the Wiki has no Betty line, so she says nothing (the default dialogue applies).
    // The guards send the player back to the cell.
    const house = handlers.areas.find((area) => area.constructor.name === 'JensenHouseArea');
    player.location = new api.core.Location(1758, 3777, 0);
    house.process({ isPlayer: () => true, getAsPlayer: () => player });
    assert.deepEqual([player.location.getX(), player.location.getY()], [1788, 3781]);
    assert.equal(lines(player)[0], "You're spotted and are sent back to the cell in the nearby guardhouse.");
    player.location = new api.core.Location(1754, 3779, 1);
    // The ladder (1754,3782) and its neighbours are well clear of both guards under the rule.
    for (const [x, y] of [[1753, 3782], [1755, 3782], [1754, 3781], [1754, 3783]]) {
      player.location = new api.core.Location(x, y, 0);
      house.process({ isPlayer: () => true, getAsPlayer: () => player });
      assert.deepEqual([player.location.getX(), player.location.getY()], [x, y], `the ladder neighbour ${x},${y} is not caught`);
    }
    // Jensen's house, floor by floor.
    assert.equal(object(player, 50815, 'Inspect'), true);
    choose(player, 1);
    assert.match(lines(player)[0], /^You inspect the victim's head\. Beneath the helmet, there is a bruise on her forehead/);
    runAction(player);
    choose(player, 3);
    runAction(player);
    choose(player, 4);
    runAction(player);
    assert.deepEqual(['piscHead', 'piscTorso', 'piscFeet'].map((name) => flag(player, name)), [true, true, true]);
    assert.equal(object(player, 50819, 'Inspect'), true);
    choose(player, 1); // Inspect the blood.
    assert.deepEqual(player.opened.slice(-1), [985]);
    assert.equal(object(player, 50819, 'Inspect'), true);
    choose(player, 2); // Search the drawers.
    assert.equal(lines(player)[0], 'You go to search the drawers and notice one is open. There is a dagger inside.');
    assert.equal(flag(player, 'piscDagger'), true);
    assert.equal(quest.getStage(player), 26);
    assert.equal(object(player, 63314, 'Search'), true);
    assert.equal(object(player, 63315, 'Search'), true);
    assert.equal(quest.getStage(player), 30, 'every Jensen clue found');
    // Back into the cell: Betty is gone and the east wall shows its message.
    player.location = new api.core.Location(1787, 3783, 0);
    assert.equal(object(player, 50812, 'Climb-over'), true);
    assert.equal(quest.getStage(player), 32);
    assert.equal(owned(player, BETTY).filter((npc) => !npc.removed).length, 0, 'Betty is gone from stage 32');
    assert.equal(object(player, 63309, 'Inspect'), true);
    assert.deepEqual(player.opened.slice(-1), [991]);
    assert.equal(quest.getStage(player), 34);
    assert.equal(cell.canTeleport(player), null, 'the teleport block ends with the cell stages');
  } finally {
  }
});

test('Shayzien ids are the cache names the handlers expect, resolved per stage', () => {
  const gamevals = new Gamevals();
  const locs = gamevals.namesOf(GamevalKind.LOC);
  for (const [id, name] of Object.entries({ 63316: 'wotw_bed_shayzien', 63320: 'wotw_blood_shayzien', 63322: 'wotw_drink_shelves_shayzien' })) assert.equal(locs.get(Number(id)), name);
  assert.equal(gamevals.namesOf(GamevalKind.NPC).get(16875), 'wotw_forester');
  assert.equal(gamevals.allInterfaces().get(992)?.name, 'wotw_wall_shayzien');
  const player = createPlayer();
  const at = (stage, id) => { quest.setStage(player, stage); const d = ObjectDefinition.forPlayer(id, player); return d ? [d.getName(), (d.getInteractions() ?? []).filter(Boolean)] : null; };
  assert.deepEqual(at(36, 63316), ['Dead Body', ['Inspect']]);
  assert.deepEqual(at(36, 63320), ['Blood', ['Inspect']]);
  assert.deepEqual(at(36, 63322), ['Shelves', ['Search']]);
  assert.equal(at(34, 63316)?.[1].includes('Inspect'), false, 'Edwards is not on the bed before Shayzien');
  assert.equal(at(41, 63316)?.[1].includes('Inspect'), false, 'nor after');
});

test('Shayzien: the war tent scene, Hudson, Kyle, Edwards\' body, the shelves and the blood, then the final Hudson conversation (Piscarilius enabled)', () => {
  try {
    const player = createPlayer();
    quest.setStage(player, 34);
    login(player);
    const tent = handlers.areas.find((area) => area.constructor.name === 'WarTentArea');
    player.location = new api.core.Location(1485, 3636, 0);
    tent.process({ isPlayer: () => true, getAsPlayer: () => player });
    assert.equal(lines(player)[0], 'Going somewhere?');
    assert.equal(lines(player).includes("I don't think it was them, Sergeant. A hooded figure was spotted leaving the crime scene, literally just now!"), true);
    assert.equal(quest.getStage(player), 36, 'the stage moves on when the scene starts');
    const scene = player.lastDialogues;
    tent.process({ isPlayer: () => true, getAsPlayer: () => player }); // the next tick must not restart the conversation
    assert.equal(player.lastDialogues, scene);
    runAction(player);
    assert.equal(quest.getStage(player), 36);
    assert.deepEqual([player.location.getX(), player.location.getY()], [1451, 3638]);
    for (const id of [HUDSON, BREIMAN, CAMPTER, 16875]) assert.equal(owned(player, id).length >= 1, true, `npc ${id} at the crime scene`);
    // Not before the wall is read: the scene only runs at stage 34.
    tent.process({ isPlayer: () => true, getAsPlayer: () => player });
    assert.equal(quest.getStage(player), 36);
    talk(player, 'Corporal Breiman', BREIMAN);
    assert.equal(lines(player)[0], "Sorry, but I do need to keep an eye on you. Sergeant's orders.");
    talk(player, 'Sergeant Hudson', HUDSON);
    assert.equal(lines(player)[0], "What a mess... Let's hope we can find something here that can lead us to the killer. I needn't remind you that if we can't, then you're still the prime suspect.");
    runAction(player);
    choose(player, 1);
    runAction(player);
    assert.equal(flag(player, 'shayzienVictimInfo'), true);
    talk(player, 'Kyle', 16875);
    runAction(player);
    choose(player, 2); // saw or heard anything
    runAction(player);
    assert.equal(flag(player, 'shayzienWitness'), true);
    assert.equal(object(player, 63316, 'Inspect'), true);
    choose(player, 1);
    runAction(player);
    choose(player, 2);
    runAction(player);
    assert.equal(flag(player, 'shayzienEyes') && flag(player, 'shayzienHands'), true);
    assert.equal(object(player, 63322, 'Search'), true);
    assert.equal(lines(player)[0], "You search the shelves and find various bottles of wine. You notice one of the bottles has an inscription on it: 'We shape the stone. The stone shapes us.'");
    assert.equal(quest.getStage(player), 36, 'the wall is still unread');
    assert.equal(object(player, 63320, 'Inspect'), true);
    assert.deepEqual(player.opened.slice(-1), [992]);
    assert.equal(quest.getStage(player), 40, 'every Shayzien clue found');
    talk(player, 'Sergeant Hudson', HUDSON);
    assert.equal(lines(player)[0], 'Yes?');
    assert.equal(lines(player)[1], "I've found a few potential things of note, but nothing obvious that could lead us to the killer.");
    talk(player, 'Sergeant Hudson', HUDSON);
    assert.equal(lines(player)[1], "I've still not managed to piece things together yet.");
    assert.equal(quest.getStage(player), 40, 'the island and the finale are flight 3');
  } finally {
  }
});

const { NpcDefinition } = require('../dist/game/definition/NpcDefinition');

/** Talks to an NPC through the real NPC dispatcher: the placed id resolves for the player's varbits, as NPC.getContentId does. */
function npc(player, placedId, option = 'Talk-to') {
  const contentId = CacheDefinitions.resolveNpc(placedId, player.getPacketSender())?.id;
  assert.ok(contentId !== undefined, `npc ${placedId} is visible to the player at this stage`);
  const definition = NpcDefinition.forId(contentId);
  const clickType = definition.getActions().indexOf(option) + 1;
  assert.ok(clickType > 0, `npc ${contentId} has ${option}`);
  const placed = { getId: () => placedId, getCurrentDefinition: () => definition };
  return PluginManager.emitNpcInteraction({ player, npc: placed, npcId: contentId, clickType, definition, handled: false });
}

test('Port Piscarilius, Shayzien and the island ids are the cache names the handlers expect', () => {
  const gamevals = new Gamevals();
  const locs = gamevals.namesOf(GamevalKind.LOC);
  for (const [id, name] of Object.entries({ 63323: 'wotw_hideout_trapdoor', 63325: 'wotw_hideout_trapdoor_bush', 63326: 'wotw_hideout_ladder', 63327: 'wotw_blood_hideout' })) assert.equal(locs.get(Number(id)), name);
  assert.equal(gamevals.namesOf(GamevalKind.OBJ).get(ItemIdentifiers.AMULET_OF_SIGHT), 'amulet_of_sight');
  assert.equal(gamevals.allInterfaces().get(989)?.name, 'wotw_wall_hideout');
  assert.equal(gamevals.namesOf(GamevalKind.NPC).get(16853), 'wotw_betty_cutscene_pre_reveal');
  const player = createPlayer();
  const at = (stage, id) => { quest.setStage(player, stage); const d = ObjectDefinition.forPlayer(id, player); return d ? [d.getName(), (d.getInteractions() ?? []).filter(Boolean)] : null; };
  assert.deepEqual(at(40, 63325), ['Plant', ['Inspect']]);
  assert.deepEqual(at(40, 63326), ['Ladder', ['Climb-up']]);
  assert.deepEqual(at(40, 63327), ['Blood', ['Inspect']]);
  assert.deepEqual(at(44, 63327), ['Blood', ['Inspect']]);
  assert.equal(at(36, 63327)?.[1].includes('Inspect') ?? false, false, 'the hideout wall is not readable before the Shayzien clues');
  assert.equal(at(48, 63327)?.[1].includes('Inspect') ?? false, false, 'nor after the quest');
});

test('every stage after a relog has its NPCs and a next action (no soft-lock), resolved through the real paths', () => {
  const npcsAt = {
    0: [16861, 16866, 16871, 16850], 1: [16861, 16866, 16871, 16850], 4: [16861, 16866, 16871, 16850], 8: [16861, 16866, 16871, 16850],
    12: [16850, 16874, 16873], 16: [16850, 16874, 16873], 20: [16850, 16874, 16873],
    24: [16850, 16867, 16872], 26: [16850, 16867, 16872], 30: [16850, 16867, 16872], 32: [16867, 16872], 34: [],
    36: [16861, 16866, 16871, 16875], 40: [16861, 16866, 16871, 16875], 44: [16861], 48: [16861],
  };
  const nextActions = {
    4: [[50789, 'Inspect']], 12: [[50803, 'Climb-through']], 16: [[41428, 'Climb-up'], [41427, 'Climb-down'], [50804, 'Inspect'], [50810, 'Search'], [50808, 'Search']],
    20: [[41427, 'Climb-down']],
    24: [[50812, 'Remove-plank']], 26: [[50812, 'Climb-over'], [50815, 'Inspect'], [50819, 'Inspect'], [63314, 'Search'], [63315, 'Search']],
    30: [[50812, 'Climb-over']], 32: [[63309, 'Inspect']], 36: [[63316, 'Inspect'], [63320, 'Inspect'], [63322, 'Search']],
    40: [[63325, 'Inspect'], [63327, 'Inspect'], [63326, 'Climb-up']], 44: [[63327, 'Inspect'], [63326, 'Climb-up']],
  };
  for (const [stage, ids] of Object.entries(npcsAt)) {
    const player = createPlayer();
    quest.setStage(player, Number(stage));
    if (Number(stage) >= 26) seed(player, { plankRemoved: 1 }); // the login resends the saved flags
    login(player);
    login(player); // a second login (a relog) must not duplicate anything
    const present = spawned.filter((entry) => entry.owner === player && !entry.removed).map((entry) => entry.id).sort((a, b) => a - b);
    assert.deepEqual(present, [...ids].sort((a, b) => a - b), `stage ${stage} NPCs`);
    for (const [baseId, option] of nextActions[stage] ?? []) {
      const definition = ObjectDefinition.forPlayer(baseId, player);
      assert.ok(definition?.getInteractions()?.some((entry) => entry?.toLowerCase() === option.toLowerCase()), `stage ${stage}: loc ${baseId} offers ${option}`);
    }
  }
});

test('Quest start to completion through the real dispatchers, with no gate, ending at value 48 with the rewards', () => {
  const player = createPlayer();
  login(player);
  const stage = () => quest.getStage(player);
  // Land's End
  npc(player, BETTY); choose(player, 1); runAction(player);
  assert.equal(stage(), 1);
  npc(player, HUDSON); runAction(player);
  assert.equal(stage(), 4);
  object(player, 50789, 'Inspect'); choose(player, 3); runAction(player); choose(player, 1);
  object(player, 50793, 'Inspect');
  object(player, 50798, 'Search');
  object(player, 50799, 'Search');
  npc(player, 7479); runAction(player); choose(player, 1); runAction(player); // Lan, resolved from the placed parent
  npc(player, BETTY); runAction(player); choose(player, 2); runAction(player);
  npc(player, HUGOR); runAction(player); choose(player, 2); runAction(player);
  assert.equal(stage(), 8);
  npc(player, HUDSON); runAction(player);
  assert.equal(stage(), 12);
  // Hosidius
  player.location = new api.core.Location(1785, 3518, 0);
  object(player, 50800, 'Open');
  object(player, 50803, 'Climb-through');
  object(player, 50801, 'Open'); runAction(player);
  assert.equal(stage(), 16);
  object(player, 41428, 'Climb-up');
  player.location = handlers.events.filter((entry) => entry.name === 'ladders:climbUp').at(-1).event.destination;
  // Betty is still in the basement: the house ladder leads back down to her, and up again.
  object(player, 41427, 'Climb-down');
  assert.deepEqual([handlers.events.at(-1).name, handlers.events.at(-1).event.destination.getY()], ['ladders:climbDown', 9936]);
  object(player, 50810, 'Search');
  object(player, 50808, 'Search');
  item(player, ItemIdentifiers.HUMAN_HEAD, 'Inspect');
  npc(player, JOYCE); runAction(player); choose(player, 1); runAction(player);
  npc(player, MONK); runAction(player); choose(player, 1); runAction(player);
  npc(player, BETTY); runAction(player); choose(player, 2); runAction(player); // drinking
  npc(player, BETTY); runAction(player); choose(player, 3); runAction(player); // Keystone Lodge
  assert.equal(stage(), 20);
  npc(player, BETTY); choose(player, 1); runAction(player);
  assert.equal(stage(), 24);
  // Port Piscarilius
  object(player, 50812, 'Remove-plank'); runAction(player);
  assert.equal(stage(), 26);
  object(player, 50812, 'Climb-over');
  player.location = new api.core.Location(1754, 3779, 1);
  object(player, 50815, 'Inspect'); choose(player, 1); runAction(player); choose(player, 3); runAction(player); choose(player, 4); runAction(player);
  object(player, 50819, 'Inspect'); choose(player, 2);
  object(player, 63314, 'Search');
  object(player, 63315, 'Search');
  assert.equal(stage(), 30);
  player.location = new api.core.Location(1787, 3783, 0);
  object(player, 50812, 'Climb-over');
  assert.equal(stage(), 32);
  object(player, 63309, 'Inspect');
  assert.equal(stage(), 34);
  // Shayzien
  player.location = new api.core.Location(1485, 3636, 0);
  handlers.areas.find((area) => area.constructor.name === 'WarTentArea').process({ isPlayer: () => true, getAsPlayer: () => player });
  runAction(player);
  assert.equal(stage(), 36);
  npc(player, 16875); runAction(player); choose(player, 2); runAction(player);
  object(player, 63316, 'Inspect'); choose(player, 1); runAction(player); choose(player, 2); runAction(player);
  object(player, 63322, 'Search');
  object(player, 63320, 'Inspect');
  assert.equal(stage(), 40);
  // The island
  object(player, 63325, 'Inspect'); choose(player, 1);
  assert.equal(player.location.getY(), 9936, 'in the hideout');
  object(player, 63327, 'Inspect');
  assert.equal(stage(), 44);
  assert.deepEqual(player.opened.slice(-1), [989]);
  assert.equal(lines(player)[0], 'Get up.');
  npc(player, HUDSON);
  assert.equal(lines(player)[0], 'Well... This one is going to have some paperwork to deal with...');
  runAction(player);
  assert.equal(stage(), 48, 'the quest is complete');
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 48);
  assert.equal(player.getAttribute(runtime.QUEST_POINTS_ATTRIBUTE), 1);
  assert.deepEqual(player.xp.slice(-2), [['Agility', 2500], ['Thieving', 2500]]);
  assert.equal(carries(player, ItemIdentifiers.AMULET_OF_SIGHT), true);
  assert.equal(owned(player, HUDSON).filter((entry) => entry.getLocation().getY() === 3567).length, 1, 'Hudson is at the Administration');
  // After the quest: Hudson sells another amulet for 1,500 coins.
  player.getInventory().adds(ItemIdentifiers.COINS, 1500);
  npc(player, HUDSON);
  assert.equal(lines(player)[0], 'Adventurer.');
  runAction(player);
  choose(player, 2); // Could I have another amulet?
  choose(player, 1); // Yes.
  assert.equal(carries(player, ItemIdentifiers.AMULET_OF_SIGHT), true);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.AMULET_OF_SIGHT), 2);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 0);
});

test('every tile the plugin moves a player to is walkable and has a free neighbour on the real map collision', () => {
  const { RegionManager } = api.core;
  RegionManager.init();
  const { Location } = api.core;
  const tiles = require('../plugins/quests/quests/TheWritingsOnTheWall.Quest').MOVE_TO_TILES;
  const bad = [];
  for (const [name, [x, y]] of Object.entries(tiles)) {
    RegionManager.loadMapFiles(x, y, false);
    const free = (px, py) => !RegionManager.blocked(new Location(px, py, 0), null);
    const here = free(x, y);
    const neighbours = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => free(x + dx, y + dy) && RegionManager.canMove(x, y, x + dx, y + dy, 0, 1, 1, null));
    if (!here || neighbours.length === 0) bad.push(`${name} ${x},${y} walkable=${here} exits=${neighbours.length}`);
  }
  assert.deepEqual(bad, [], 'blocked or enclosed destinations');
});
