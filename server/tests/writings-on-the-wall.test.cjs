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
const { PluginManager } = require('../dist/plugins/PluginManager');
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
    },
    { get(target, property) { return property in target ? target[property] : () => sender; } },
  );
  const { Skill } = api.core;
  const player = {
    attributes, messages, varbits, lastDialogues: null,
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
  };
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
const flag = (player, name) => player.getAttribute('writings-on-the-wall:flags')?.[name] === true;

const seed = (player, names) => player.setAttribute('writings-on-the-wall:flags', { ...(player.getAttribute('writings-on-the-wall:flags') ?? {}), ...Object.fromEntries(names.map((name) => [name, true])) });

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  spawned = [];
  handlers = { npc: new Map(), login: [] };
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
  assert.equal(flag(player, 'butcherQuestioned'), true);
  // Betty's family question sets the history flag.
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[1], "I've found a few things, but I think there's still more to uncover.");
  runAction(player);
  choose(player, 2);
  runAction(player);
  assert.equal(flag(player, 'history'), true);
  assert.equal(quest.getStage(player), 4, 'not everything is found yet');
  seed(player, ['letter', 'news', 'wall', 'knife']);
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
  assert.equal(flag(player, 'strangerInfo'), true);
  talk(player, 'Joyce', JOYCE);
  runAction(player);
  choose(player, 1);
  assert.equal(flag(player, 'uncleJob'), true);
  talk(player, 'Betty', BETTY);
  assert.equal(lines(player)[0], 'Have you found anything yet?');
  seed(player, ['certificate']);
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
