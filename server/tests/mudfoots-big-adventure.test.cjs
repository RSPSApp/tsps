// Run after `yarn build`: node --test tests/mudfoots-big-adventure.test.cjs
//
// Focused regression for Mudfoot's Big Adventure (rev 242 quest 218). It dispatches the plugin's
// real hooks (Captain Harlan and Mudfoot Talk-to, Outlaw Confront, outlaw death, lamp Rub) and
// asserts the stage varbit, spawned NPCs, rewards and the Harlan equipment claim.
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

const STAGE_VARBIT = 16779;
const HARLAN = 16821;
const MUDFOOT = 16829;
const MUDFOOT_SPEAR = 16830;
const RANGER_VIS = 16835;
const RANGER_NOOP = 16836;
const RANGER_COMBAT = 16837;
const MAGE_VIS = 16839;
const MAGE_COMBAT = 16840;
const WARRIOR_VIS = 16842;
const WARRIOR_COMBAT = 16843;
const ANTIQUE_LAMP = 34751;
const COMPLETE = 32;

let api;
let quest;
let handlers;
let spawned;
let ground;

function createPlayer() {
  const attributes = new Map();
  const messages = [];
  const varbits = new Map();
  const xp = [];
  const sender = new Proxy(
    {
      getVarbit: (id) => varbits.get(id) ?? 0,
      sendVarbit: (id, value) => { varbits.set(id, value); return sender; },
      sendConfig: () => sender,
      sendJingle: () => sender,
    },
    { get(target, property) { return property in target ? target[property] : () => sender; } },
  );
  const player = {
    attributes,
    messages,
    varbits,
    xp,
    lastDialogues: null,
    location: new api.core.Location(3220, 3238, 0),
    getAttribute: (key) => attributes.get(key),
    setAttribute: (key, value) => attributes.set(key, value),
    getUsername: () => 'mudfoot-test',
    getPacketSender: () => sender,
    sendMessage: (message) => messages.push(message),
    isRegistered: () => true,
    getInventory: () => player.inventory,
    getSkillManager: () => ({ addExperiences: (skill, amount) => xp.push({ skill, amount }), addExperience: () => {}, getExperience: () => 0 }),
    getDialogueManager: () => ({ startDialogues: (builder) => { player.lastDialogues = builder; }, reset: () => {} }),
    getLocation: () => player.location,
    getPrivateArea: () => null,
  };
  player.inventory = new Inventory(player);
  player.inventory.resetItems();
  return player;
}

const entries = (player) => [...player.lastDialogues.getDialogues().values()];
const lines = (player) => entries(player).filter((entry) => typeof entry.getText === 'function').map((entry) => entry.getText());
const menu = (player) => entries(player).find((entry) => entry instanceof api.core.OptionDialogue);
function choose(player, option) { menu(player).execute(option); }
function runAction(player) {
  const action = entries(player).find((entry) => entry instanceof api.core.ActionDialogue);
  assert.ok(action, 'dialogue ends in an action');
  action.send(player);
}
const harlan = (player, option = 'Talk-to') => handlers.npc.get('Captain Harlan')[option]({ player, npcId: HARLAN });
const mudfootTalk = (player) => handlers.npc.get('Mudfoot')['Talk-to']({ player, npcId: MUDFOOT });
const confront = (player, npcId) => handlers.npc.get('Outlaw').Confront({ player, npcId });
const owned = (player, id) => spawned.filter((npc) => npc.owner === player && npc.id === id && !npc.removed);
const give = (player, id, amount = 1) => player.getInventory().adds(id, amount);

function die(player, npcId) {
  const npc = spawned.find((entry) => entry.owner === player && entry.id === npcId && !entry.removed);
  assert.ok(npc, `outlaw ${npcId} is spawned`);
  handlers.death({ npc, npcId, killer: player });
}

function startQuest(player) {
  harlan(player);
  choose(player, 1); // Do you need help with anything?
  choose(player, 1); // Start the quest? Yes.
  runAction(player);
}

before(async () => {
  await CachePipeline.initialize(path.resolve(__dirname, '..'));
  spawned = [];
  ground = [];
  handlers = { npc: new Map(), items: new Map(), login: [], death: null };
  const customEvents = new Map();
  api = {
    core: {
      ...PluginManager.getCoreApi(),
      ItemOnGroundManager: { registerLocation: (player, item) => ground.push({ player, id: item.getId(), amount: item.getAmount() }) },
    },
    persistAttribute() {},
    spawnNpc(definition) {
      const npc = {
        id: definition.id, owner: definition.owner, tile: { x: definition.x, y: definition.y }, removed: false, following: null,
        getId: () => definition.id,
        getOwner: () => definition.owner,
        getLocation: () => ({ getX: () => definition.x, getY: () => definition.y, getZ: () => 0 }),
        setFollowing(target) { npc.following = target; },
        setMobileInteraction() {},
        forceChat() {},
        getCombat: () => ({ attack: (target) => { npc.attacked = target; } }),
      };
      spawned.push(npc);
      return npc;
    },
    removeNpc(npc) { npc.removed = true; },
    onNpcInteraction: (name, actions) => handlers.npc.set(name, actions),
    onNpcDeath: (handler) => { handlers.death = handler; },
    onItemAction: (name, actions) => handlers.items.set(name, actions),
    onPlayerLogin: (handler) => handlers.login.push(handler),
    onCustomEvent: (name, handler) => { customEvents.set(name, [...(customEvents.get(name) ?? []), handler]); },
    emitCustomEvent: (name, event) => { for (const handler of customEvents.get(name) ?? []) handler(event); handlers.lastEmitted = { name, event }; },
    onInterfaceActionButton() {},
    onPlayerLevelUp() {},
    onPlayerLogout() {},
  };
  require('../plugins/quests/quests/MudfootsBigAdventure.Quest')(api);
  quest = runtime.getRegisteredQuests().find((entry) => entry.name === "Mudfoot's Big Adventure");
  assert.ok(quest, "Mudfoot's Big Adventure registers");
});

test('the quest is keyed on the cache: row 218, varbit mba, completion 32', () => {
  const row = questRowById(218, CacheDefinitions);
  assert.equal(row.displayname[0], "Mudfoot's Big Adventure");
  assert.equal(row.endstate[0], COMPLETE);
  assert.equal(row.startnpc[0], HARLAN);
  assert.equal(new Gamevals().namesOf(GamevalKind.VARBIT).get(STAGE_VARBIT), 'mba');
  assert.equal(quest.varbitId, STAGE_VARBIT);
  assert.equal(quest.completionValue, COMPLETE);
  assert.equal(quest.questPoints, 1);
});

test('Captain Harlan offers the bounty and the quest starts on Yes, with Mudfoot waiting at the goblin house', () => {
  const player = createPlayer();
  harlan(player);
  assert.equal(lines(player)[0], 'Greetings, adventurer. Captain Harlan, leader of the Lumbridge Guard, at your service. Is there anything I can do for you?');
  assert.equal(quest.getStage(player), 0);
  choose(player, 1);
  assert.deepEqual(lines(player).slice(0, 2), ['Do you need help with anything?',
    'Well, I do actually have a bounty available at the moment that you might be interested in. 1,000 coins to whoever can bring justice to some thieves that robbed the General Store.']);
  choose(player, 2); // No.
  assert.equal(quest.getStage(player), 0, 'declining does not start it');
  harlan(player);
  assert.equal(lines(player)[0], 'Hello again, adventurer, Is there anything I can do for you?');
  choose(player, 1);
  choose(player, 1);
  runAction(player);
  assert.equal(quest.getStage(player), 1);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 1);
  assert.ok(player.messages.includes("You've started a new quest: <col=081190>Mudfoot's Big Adventure</col>"));
  assert.equal(owned(player, MUDFOOT).length, 1);
});

test('Mudfoot will not follow while a pet is out, then recruits the player and the outlaw appears at the store', () => {
  const player = createPlayer();
  startQuest(player);
  player.setAttribute('pets:current', { isRegistered: () => true });
  mudfootTalk(player);
  assert.equal(lines(player).at(-1), 'You pick up follower first. Me no follow you otherwise.');
  assert.equal(entries(player).some((entry) => entry instanceof api.core.ActionDialogue), false, 'no progress with a pet out');
  assert.equal(quest.getStage(player), 1);
  player.setAttribute('pets:current', null);
  mudfootTalk(player);
  runAction(player);
  assert.equal(quest.getStage(player), 6);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), 6);
  assert.equal(owned(player, RANGER_VIS).length, 1, 'ranger outlaw outside the store');
  assert.equal(owned(player, MUDFOOT).slice(-1)[0].following, player, 'Mudfoot follows');
});

test('the store cutscene advances to the windmill and unlocks the first Harlan claim; the fights follow the cache stages', () => {
  const player = createPlayer();
  startQuest(player);
  mudfootTalk(player); runAction(player);
  confront(player, RANGER_VIS);
  runAction(player);
  assert.equal(quest.getStage(player), 10);
  assert.equal(owned(player, RANGER_NOOP).length, 1, 'the cache shows the windmill ranger at 10-12');
  assert.equal(owned(player, MUDFOOT_SPEAR).length, 1, 'Mudfoot has his spear');
  assert.equal(player.getPacketSender().getVarbit(16784), 1, 'melee giveaway flag');
  // Mudfoot waits at the windmill until spoken to, then the ranger fights.
  assert.equal(owned(player, MUDFOOT_SPEAR).slice(-1)[0].following, null, 'he waits outside the windmill');
  mudfootTalk(player);
  assert.equal(lines(player)[0], 'Look. Nasty human over there. Kill time now.');
  runAction(player);
  assert.equal(quest.getStage(player), 11);
  const ranger = owned(player, RANGER_COMBAT)[0];
  assert.ok(ranger && ranger.attacked === player, 'the ranger attacks the player');
  die(player, RANGER_COMBAT);
  assert.deepEqual(ground.map((drop) => [drop.id, drop.amount]), [[ItemIdentifiers.SHORTBOW, 1], [ItemIdentifiers.BRONZE_ARROW, 80]]);
  runAction(player);
  assert.equal(quest.getStage(player), 14);
  assert.equal(owned(player, MAGE_VIS).length, 1);
  assert.equal(player.getPacketSender().getVarbit(16786), 1, 'ranged giveaway flag');
});

test('mage and warrior fights, drops and unlocks, then Harlan pays out and the quest completes', () => {
  const player = createPlayer();
  quest.setStage(player, 14);
  player.setAttribute('mudfoots-big-adventure:mudfoot-waiting', false);
  for (const login of handlers.login) login({ player }); // the quest runtime's list refresh and this plugin's NPC sync
  confront(player, MAGE_VIS);
  assert.equal(quest.getStage(player), 16);
  assert.ok(owned(player, MAGE_COMBAT)[0].attacked === player);
  ground.length = 0;
  die(player, MAGE_COMBAT);
  assert.deepEqual(ground.map((drop) => [drop.id, drop.amount]), [[ItemIdentifiers.STAFF, 1], [ItemIdentifiers.MIND_RUNE, 80], [ItemIdentifiers.AIR_RUNE, 80]]);
  runAction(player);
  assert.equal(quest.getStage(player), 20);
  assert.equal(player.getPacketSender().getVarbit(16787), 1, 'magic giveaway flag');
  confront(player, WARRIOR_VIS);
  assert.equal(quest.getStage(player), 22);
  ground.length = 0;
  die(player, WARRIOR_COMBAT);
  assert.deepEqual(ground.map((drop) => [drop.id, drop.amount]), [[ItemIdentifiers.IRON_SCIMITAR, 1], [ItemIdentifiers.IRON_KITESHIELD, 1]]);
  runAction(player);
  assert.equal(quest.getStage(player), 26);

  // Harlan's report needs room for the coins and the four lamps.
  for (let slot = 0; slot < 28; slot++) give(player, ItemIdentifiers.SHORTBOW, 1);
  harlan(player);
  choose(player, 1);
  runAction(player);
  assert.equal(quest.getStage(player), 26, 'no room: the quest waits');
  player.getInventory().resetItems();
  harlan(player);
  choose(player, 1);
  runAction(player);
  assert.equal(quest.getStage(player), COMPLETE);
  assert.equal(player.getPacketSender().getVarbit(STAGE_VARBIT), COMPLETE);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.COINS), 500);
  assert.equal(player.getInventory().getAmount(ANTIQUE_LAMP), 4);
  assert.equal(player.getAttribute(runtime.QUEST_POINTS_ATTRIBUTE), 1);
  assert.deepEqual(spawned.filter((npc) => npc.owner === player && !npc.removed), [], 'Mudfoot and the outlaws are gone');
});

test('Captain Harlan hands out equipment once every 30 minutes, for the styles unlocked so far', () => {
  const player = createPlayer();
  quest.setStage(player, 32);
  player.setAttribute('mudfoots-big-adventure:giveaways', 7);
  harlan(player, 'Claim-weapons');
  choose(player, 2); // shortbow and arrows
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.SHORTBOW), 1);
  assert.equal(player.getInventory().getAmount(ItemIdentifiers.BRONZE_ARROW), 40);
  harlan(player, 'Claim-weapons');
  assert.match(lines(player)[0], /I'm afraid I've already given you some items recently\. I only have so many available, so I can't go overboard\. You'll have to come back in \d+ minutes\./);
  assert.equal(entries(player).some((entry) => entry instanceof api.core.OptionDialogue), false);
});

test('the quest lamp opens the experience reward restricted to combat skills and Prayer', () => {
  const player = createPlayer();
  player.getInventory().adds(ANTIQUE_LAMP, 1);
  const item = player.getInventory().get(0);
  assert.equal(handlers.items.get('Antique lamp').Rub({ player, itemId: 1, item, slot: 0 }), false, 'other lamps are left alone');
  assert.equal(handlers.items.get('Antique lamp').Rub({ player, itemId: ANTIQUE_LAMP, item, slot: 0 }), true);
  assert.equal(handlers.lastEmitted.name, 'xpreward:open');
  const names = handlers.lastEmitted.event.skills.map((skill) => skill.getName());
  assert.deepEqual(names.sort(), ['Attack', 'Defence', 'Hitpoints', 'Magic', 'Prayer', 'Ranged', 'Strength']);
});
