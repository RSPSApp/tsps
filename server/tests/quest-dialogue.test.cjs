// Run after `yarn build`: node --test tests/quest-dialogue.test.cjs
//
// Walks every quest plugin's dialogue resolvers against the transcript data:
//  - for every NPC id in the index and every stage, a variant the selector returns
//    must exist on the page it names (catches wrong/missing variant ids), and
//  - every prose condition on a page the quest drives must be answerable without
//    throwing (catches typo'd condition text / broken inventory reads).
//
// This is the "all dialogue branches work" check: a quest whose start/report/hand-in
// variant names drifted from npc-dialogues.json fails here.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PluginManager } = require('../dist/plugins/PluginManager');

const serverRoot = path.join(__dirname, '..');
const data = JSON.parse(
  fs.readFileSync(path.join(serverRoot, 'data/definitions/npc-dialogues.json'), 'utf8')
);
const index = JSON.parse(
  fs.readFileSync(path.join(serverRoot, 'data/definitions/npc-dialogue-index.json'), 'utf8')
);

const STAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100];

function pageVariants(page) {
  const record = data[page];
  if (!record) return null;
  return record.variants ? Object.keys(record.variants) : null;
}

// Pages each npc id can reach, from the index.
const npcPages = new Map();
for (const [npcId, entries] of Object.entries(index)) {
  const pages = (entries || [])
    .map((entry) => String(entry.page || '').replace(/^Transcript:/, ''))
    .filter((page) => data[page]);
  if (pages.length) npcPages.set(Number(npcId), pages);
}

function fakePlayer(stage) {
  const amount = () => 0;
  const equipmentItem = { getId: () => -1, getName: () => '' };
  const target = {
    // Cross-quest probes (a quest reading another quest's stage to defer a shared
    // NPC) read as "not started"; the quest under test reads the injected stage.
    getAttribute: (key) =>
      String(key) === 'quest.shield_of_arrav.stage' ? 0 : String(key).endsWith('.stage') ? stage : undefined,
    setAttribute: () => {},
    getInventory: () => ({
      getAmount: amount,
      isFull: () => false,
      contains: () => false,
      adds: () => true,
      deleteNumber: () => true,
      addItem: () => true,
    }),
    getEquipment: () => ({ get: () => equipmentItem, hasItem: () => false }),
    getSkillManager: () => ({ getCurrentLevel: () => 99, getMaxLevel: () => 99 }),
    getLocation: () => ({ getX: () => 0, getY: () => 0, getZ: () => 0 }),
    getPacketSender: () => new Proxy({}, { get: () => () => {} }),
    getDialogueManager: () => ({ reset: () => {}, startDialogues: () => {} }),
    sendMessage: () => {},
    getRunEnergy: () => 100,
    isPlayer: () => true,
  };
  return new Proxy(target, {
    get(obj, prop) {
      if (prop in obj) return obj[prop];
      return () => undefined;
    },
  });
}

function questFiles() {
  const all = fs
    .readdirSync(path.join(serverRoot, 'plugins/quests/quests'))
    .filter((f) => f.endsWith('.Quest.js'))
    .map((f) => f.replace(/\.Quest\.js$/, ''))
    .sort();
  const filter = (process.env.QUEST_FILTER || '').split(',').map((s) => s.trim()).filter(Boolean);
  return filter.length ? all.filter((name) => filter.includes(name)) : all;
}

function loadQuest(name) {
  const handlers = { variant: [], condition: [] };
  const noop = () => {};
  const base = {
    core: PluginManager.getCoreApi(),
    onNpcDialogueVariant: (h) => handlers.variant.push(h),
    onNpcDialogueCondition: (h) => handlers.condition.push(h),
    onCustomEvent: noop,
    persistAttribute: noop,
  };
  const api = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return noop;
    },
  });
  require(path.join(serverRoot, 'plugins/quests/quests', `${name}.Quest`))(api);
  return {
    name,
    selectVariant: handlers.variant.at(-1),
    answerCondition: handlers.condition.at(-1),
  };
}

function collectConditionTexts(pages) {
  const texts = new Set();
  const walk = (steps) => {
    for (const step of steps || []) {
      if (step.type === 'condition' && typeof step.text === 'string') texts.add(step.text);
      walk(step.steps);
      for (const option of step.options || []) walk(option.steps);
    }
  };
  for (const page of pages) {
    const record = data[page];
    if (!record) continue;
    if (record.steps) walk(record.steps);
    for (const variant of Object.values(record.variants || {})) walk(variant);
  }
  return texts;
}

for (const name of questFiles()) {
  test(`${name}: every selected dialogue variant exists`, () => {
    const quest = loadQuest(name);
    if (!quest.selectVariant) return; // transcript-only quests use NpcDialogues defaults
    const pagesUsed = new Set();
    const player = fakePlayer(0);
    let selections = 0;

    for (const [npcId, pages] of npcPages) {
      for (const stage of STAGES) {
        player.__stage = stage;
        const stagePlayer = new Proxy(player, {
          get(obj, prop) {
            if (prop === 'getAttribute') {
              return (key) =>
                String(key) === 'quest.shield_of_arrav.stage'
                  ? 0
                  : String(key).endsWith('.stage')
                    ? stage
                    : undefined;
            }
            return obj[prop];
          },
        });
        const choice = quest.selectVariant({ npcId, player: stagePlayer, npc: null, definition: null, pages: [] });
        if (choice === null || choice === undefined) continue;
        const variant = typeof choice === 'string' ? choice : choice.variant;
        const page = typeof choice === 'string' ? null : choice.page;
        selections++;
        // `{ page }` with no variant means "play that page's default variant".
        if (page && variant === undefined) {
          assert.ok(data[page], `${name}: npc ${npcId} stage ${stage} named missing page "${page}"`);
          pagesUsed.add(page);
          continue;
        }
        const candidates = page ? [page] : pages;
        let found = false;
        for (const candidate of candidates) {
          const variants = pageVariants(candidate);
          if (variants && variants.includes(variant)) {
            found = true;
            pagesUsed.add(candidate);
            break;
          }
        }
        assert.ok(
          found,
          `${name}: npc ${npcId} stage ${stage} selected variant "${variant}" that is not on ${page || pages.join(', ')}`
        );
      }
    }
    assert.ok(selections > 0, `${name}: selector never returned a variant (stale npc ids?)`);

    if (quest.answerCondition) {
      for (const text of collectConditionTexts(pagesUsed)) {
        assert.doesNotThrow(
          () => quest.answerCondition({ npcId: 0, player, text, stepId: null }),
          `${name}: answering condition "${text}" threw`
        );
      }
    }
  });
}
