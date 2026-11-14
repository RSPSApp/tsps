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
const LAN = 7479;

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
    attributes, messages, varbits, lastDialogues: null, opened: [], moved: [],
    location: new api.core.Location(1519, 3438, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'wotw-test',
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getSkillManager: () => ({
      getMaxLevel: (skill) => (skill === Skill.AGILITY ? levels.agility : skill === Skill.THIEVING ? levels.thieving : 1),
      addExperiences() {}, addExperience() {}, getExperience: () => 0,
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
  spawned = [];
  handlers = { npc: new Map(), obj: new Map(), items: new Map(), login: [] };
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
    onNpcInteraction: (name, actions) => handlers.npc.set(name, actions),
    onObjectInteraction: (name, actions) => handlers.obj.set(name, actions),
    onItemAction: (name, actions) => handlers.items.set(name, actions),
    onPlayerLogin: (handler) => handlers.login.push(handler),
    onCustomEvent() {},
    emitCustomEvent() {},
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
    'wotw_betty_child', 'wotw_hudson_child', 'wotw_soldier_child_1', 'wotw_soldier_child_2', 'wotw_monk', 'wotw_farmer', 'kw_hugor', 'kw_butcher_lan']);
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

test('Betty after all Hosidius clues offers the trip to Port Piscarilius', () => {
  const player = createPlayer();
  quest.setStage(player, 20);
  login(player);
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[1], "Yes, I've found a few things that might be of note, but the main one is that I found some symbols, just like the ones back at your home.");
  choose(player, 2); // I need to do something else first.
  assert.deepEqual(lines(player), ['I need to do something else first.', "Okay... Just, please don't take too long."]);
  talk(player, 'Betty', BETTY);
  choose(player, 1); // Let's get going.
  runAction(player);
  assert.equal(quest.getStage(player), 22, 'the cell and the way out are flight 2');
});

const object = (player, name, option, objectId) => handlers.obj.get(name)[option]({ player, objectId, option });
const carries = (player, itemId) => player.getInventory().getAmount(itemId) > 0;

test('Land\'s End: the body menu, the letter, the blood wall, the shelves and Lan\'s bed, until the report is due', () => {
  const player = createPlayer();
  quest.setStage(player, 4);
  assert.equal(object(player, 'Dead Body', 'Search', 50791), true);
  assert.equal(player.messages.at(-1), 'You search the body, but find nothing of note.');
  assert.equal(object(player, 'Dead Body', 'Inspect', 50792), true);
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
  assert.equal(handlers.items.get('Letter').Read({ player, itemId: ItemIdentifiers.LETTER_18 }), true);
  assert.equal(handlers.items.get('Letter').Read({ player, itemId: 1 }), false, 'other letters are left alone');
  assert.deepEqual(player.opened, [987]);
  object(player, 'Blood', 'Inspect', 50795);
  assert.deepEqual(player.opened.slice(-1), [990]);
  assert.equal(player.getAttribute('writings-on-the-wall:flags').wall, 1);
  object(player, 'Shelves', 'Search', 50798);
  assert.equal(carries(player, ItemIdentifiers.NEWSPAPER_CUTTING), true);
  assert.equal(handlers.items.get('Newspaper cutting').Read({ player, itemId: ItemIdentifiers.NEWSPAPER_CUTTING }), true);
  assert.deepEqual(player.opened.slice(-1), [988]);
  object(player, 'Bed', 'Search', 50799);
  assert.equal(lines(player)[0], 'You search the bed and find a bloody knife under it.');
  assert.equal(carries(player, ItemIdentifiers.BLOODY_KNIFE_2), true);
  object(player, 'Bed', 'Search', 50799);
  assert.equal(player.messages.at(-1), 'You search the bed, but find nothing of note.');
  assert.equal(quest.getStage(player), 4, 'the talk evidence is still missing');
  seed(player, { butcherQuestioned: 1, history: 1 });
  talk(player, 'Hugor', HUGOR);
  runAction(player);
  choose(player, 2);
  runAction(player);
  assert.equal(quest.getStage(player), 8, 'all Land\'s End evidence found through the world and conversations');
  assert.equal(object(player, 'Dead Body', 'Inspect', 50792), true, 'other objects are untouched when the ids differ');
  assert.equal(object(player, 'Shelves', 'Search', 1), false);
});

test('Hosidius: locked doors, the window, the door sequence into the basement, then the body, bookcase, compost bin and head', () => {
  const player = createPlayer();
  quest.setStage(player, 12);
  login(player);
  player.location = new api.core.Location(1785, 3518, 0);
  object(player, 'Door', 'Open', 50800);
  assert.equal(lines(player)[0], 'The door is securely locked.');
  object(player, 'Window', 'Climb-through', 50803);
  assert.equal(player.messages.at(-1), 'You climb through the window.');
  assert.equal(player.getPacketSender().getVarbit(16811), 1);
  assert.equal(player.location.getX(), 1785, 'now inside the house');
  object(player, 'Door', 'Open', 50801);
  assert.equal(lines(player)[0], "That's the door open. No sign of your uncle though...");
  runAction(player);
  assert.equal(quest.getStage(player), 16);
  assert.equal(player.moved.at(-1).getY(), 9936, 'in the basement');
  assert.equal(owned(player, BETTY).filter((npc) => npc.getLocation().getY() === 9936).length, 1, 'Betty is in the basement');
  object(player, 'Dead Body', 'Inspect', 50805);
  choose(player, 1);
  assert.equal(lines(player)[0], "You can't inspect the victim's head as it has been completely removed.");
  object(player, 'Bookcase', 'Search', 50810);
  assert.equal(carries(player, ItemIdentifiers.CERTIFICATE_11), true);
  assert.equal(player.getPacketSender().getVarbit(16813), 2);
  handlers.items.get('Certificate').Read({ player, itemId: ItemIdentifiers.CERTIFICATE_11 });
  assert.deepEqual(player.opened.slice(-1), [984]);
  object(player, 'Compost Bin', 'Search', 50808);
  assert.equal(lines(player)[0], 'You search the compost bin and find a decapitated head hidden in it.');
  seed(player, { uncleJob: 1, strangerInfo: 1, drinkingHabits: 1 });
  handlers.items.get('Human head').Inspect({ player, itemId: ItemIdentifiers.HUMAN_HEAD });
  assert.equal(carries(player, ItemIdentifiers.LETTER_19), true);
  assert.equal(player.getAttribute('writings-on-the-wall:flags').hosidiusHead, 2);
  handlers.items.get('Letter').Read({ player, itemId: ItemIdentifiers.LETTER_19 });
  assert.deepEqual(player.opened.slice(-1), [986]);
  assert.equal(quest.getStage(player), 16, 'Betty\'s Keystone Lodge answer is still missing');
  talk(player, 'Betty', BETTY);
  runAction(player);
  choose(player, 3);
  runAction(player);
  assert.equal(quest.getStage(player), 20, 'every Hosidius clue found');
});
