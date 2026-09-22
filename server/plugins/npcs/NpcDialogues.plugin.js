/**
 * Talk-to dialogues from data/definitions/npc-dialogues.json.
 * Copy fresh exports from osrsreboxed-db. The cache NPC name selects the record -
 * falling back to a "Name (disambiguation)" key - and pickVariant selects the variant.
 * Speech, choices, random alternatives and named shops run through existing systems.
 * Prose conditions pick their first branch; prose effects still stop safely.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue");
const { ActionDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { ShopDefinition } = require("../../src/main/typescript/elvarg/game/definition/ShopDefinition");
const { ShopManager } = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

// These NPCs have executable plugin conversations, not an imported prose transcript.
const SPECIAL_NPC_DIALOGUES = new Set(["Skully"]);

/**
 * Most records list several variants and name no default, which used to leave the
 * NPC silent. Prefer the standard talk transcript over overhead shouts.
 */
function pickVariant(npc) {
  if (Array.isArray(npc?.steps)) return npc.steps;
  const variants = npc?.variants;
  if (!variants) return undefined;
  const keys = Object.keys(variants);
  const key = (npc.default != null && keys.includes(npc.default) ? npc.default : undefined)
    ?? keys.find((name) => name.startsWith("standard"))
    ?? keys.find((name) => !name.startsWith("overhead"));
  return Array.isArray(variants[key]) ? variants[key] : undefined;
}

/**
 * Transcripts are keyed by wiki page title while NPC names come from the cache,
 * so "Hops" has to reach "Hops (Biohazard)". First usable disambiguated key wins.
 * ponytail: the cache name cannot tell two "Bartender"s apart. Needs id-keyed
 * overrides in the data to pick the right pub.
 */
function aliasKeys(data) {
  const aliases = new Map();
  for (const key of Object.keys(data)) {
    const base = key.replace(/ \(.+\)$/, "");
    if (base !== key && !aliases.has(base) && pickVariant(data[key])) aliases.set(base, key);
  }
  return aliases;
}

/**
 * Conditions carry prose, not a testable expression, and every jump id in the dump
 * points at nothing. Take the first branch of a run of sibling conditions - they are
 * written as alternatives - and let jumps fall through to whatever follows.
 * ponytail: first branch, not the true one. Structured conditions would fix it.
 */
function flatten(steps) {
  const out = [];
  for (let position = 0; position < steps.length; position++) {
    const step = steps[position];
    if (step.type === "jump") continue;
    if (step.type !== "condition") {
      out.push(step);
      continue;
    }
    while (steps[position + 1]?.type === "condition") position++;
    out.push(...flatten(step.steps || []));
  }
  return out;
}

function startDialogue(api, event, steps, branches = {}) {
  const { player } = event;
  const manager = player.getDialogueManager();
  const close = () => player.getPacketSender().sendInterfaceRemoval();
  const unavailable = () => {
    close();
    player.sendMessage("That conversation isn't available right now.");
  };

  function choices(step, rest, offset = 0) {
    const options = step.options || [];
    const more = options.length - offset > 5;
    const visible = options.slice(offset, offset + (more ? 4 : 5));
    const pairs = visible.flatMap((option) => [option.text, () => {
      if (option.hook) return unavailable();
      run([...(option.steps || []), ...rest]);
    }]);
    if (more) pairs.push("More...", () => choices(step, rest, offset + 4));
    // The existing prompt requires at least two buttons; keep a single choice selectable.
    if (visible.length === 1) pairs.push("Goodbye.", close);
    if (!pairs.length) return close();
    manager.reset();
    if (!api.sendMultiChatboxPrompt(player, step.prompt || "Select an Option", ...pairs)) {
      unavailable();
    }
  }

  function run(steps) {
    const queue = flatten(steps);
    const chain = new DialogueChainBuilder();
    let index = 0;
    for (let position = 0; position < queue.length; position++) {
      const step = queue[position];
      const rest = [...(step.steps || []), ...queue.slice(position + 1)];
      const namedNpc = step.type === "line" && step.speaker === event.definition.getName();
      if (!step.hook && (typeof step.npc === "string" || typeof step.player === "string" || namedNpc)) {
        const isPlayer = typeof step.player === "string";
        // NPC chatboxes show four wrapped lines. Split long source lines instead of truncating.
        const lines = Misc.wrapText(isPlayer ? step.player : namedNpc ? step.text : step.npc, 53);
        for (let start = 0; start < lines.length; start += 4) {
          const text = lines.slice(start, start + 4).join(" ");
          chain.add(isPlayer
            ? new PlayerDialogue(index++, text)
            : new NpcDialogue(index++, event.definition.getId(), text));
        }
        if (step.steps?.length) {
          chain.add(new ActionDialogue(index++, { execute: () => run(rest) }));
          manager.startDialogues(chain);
          return;
        }
        continue;
      }
      chain.add(new ActionDialogue(index++, { execute: () => {
        if (step.hook) return unavailable();
        if (step.type === "end") return close();
        if (step.type === "call" && Object.hasOwn(branches, step.branch) && Array.isArray(branches[step.branch])) {
          return run([...branches[step.branch], ...rest]);
        }
        if (step.type === "choice") return choices(step, rest);
        if (step.type === "random" && step.options?.length) {
          const option = step.options[Math.floor(Math.random() * step.options.length)];
          if (option.hook) return unavailable();
          return run([...(option.steps || []), ...rest]);
        }
        if (step.type === "action" && step.action === "open_shop") {
          const target = step.target;
          const shops = ShopDefinition.all().filter((shop) => shop.getName() === target);
          if (shops.length === 1) {
            close();
            if (ShopManager.open(player, shops[0].getId(), true)) return;
          }
        }
        // The exporter slugs a Slayer master's assignment line so the task plugin
        // can start it; the plugin fills in the line to speak, then the chain resumes.
        if (step.type === "action" && step.action === "slayer_assignment") {
          const request = {
            player,
            npcId: event.npcId,
            definitionId: event.definition?.getId?.(),
            npcName: event.definition?.getName?.(),
            line: null,
          };
          api.emitCustomEvent("slayer:assignment", request);
          if (request.line) return run([{ npc: request.line }, ...rest]);
        }
        if (step.type === "action" && step.action === "slayer_task_tip") {
          const request = { player, line: null };
          api.emitCustomEvent("slayer:task-tip", request);
          if (request.line) return run([{ npc: request.line }, ...rest]);
        }
        // ponytail: prose conditions, effects and unresolved jumps have no executable contract.
        // Stop here; add structured conditions/actions to the data before implementing them.
        unavailable();
      } }));
      manager.startDialogues(chain);
      return;
    }
    chain.add(new ActionDialogue(index, { execute: close }));
    manager.startDialogues(chain);
  }
  run(steps);
}

module.exports = {
  name: "NpcDialogues",
  // Exported for tests/npc-dialogues.test.cjs; nothing else reads them.
  pickVariant,
  aliasKeys,
  flatten,
  register(api) {
    const file = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`${file}: expected dialogues keyed by transcript name`);
    }
    for (const [name, npc] of Object.entries(data)) {
      if (npc.steps !== undefined && !Array.isArray(npc.steps)) {
        throw new Error(`${file}: ${name} has non-array steps`);
      }
      if (npc.default != null && !Object.hasOwn(npc.variants ?? {}, npc.default)) {
        throw new Error(`${file}: ${name} names a missing default variant`);
      }
    }
    const aliases = aliasKeys(data);
    api.onAnyNpcInteraction({
      "Talk-to": (event) => {
        const name = event.definition.getName();
        if (SPECIAL_NPC_DIALOGUES.has(name)) return false;
        let npc = Object.hasOwn(data, name) ? data[name] : undefined;
        if (!pickVariant(npc) && aliases.has(name)) npc = data[aliases.get(name)];
        const variant = pickVariant(npc);
        startDialogue(api, event, variant?.length ? variant : [
          { npc: "Sorry, i've nothing interesting to talk about yet" },
        ], npc?.branches);
        return true;
      },
    });
  },
};
