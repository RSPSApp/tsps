/**
 * Talk-to dialogues from data/definitions/npc-dialogues.json (+ the osrsreboxed
 * id index, npc-dialogue-index.json).
 *
 * The cache NPC id selects the transcript page(s) and variant; quest plugins can
 * override the choice (onNpcDialogueVariant) and answer the wiki prose conditions
 * (onNpcDialogueCondition). Choice/condition steps emit custom events
 * ("npc-dialogue:choice" / "npc-dialogue:condition") so quests can run their own
 * game logic (set stage, hand in items) without re-authoring the words, and each
 * speech line emits "npc-dialogue:line" with a mutable `skip` so a quest can drop
 * lines that no longer apply (e.g. handing over an item the player does not have), a
 * mutable `text` to fill in blanks and an `after` callback run once the player continues
 * past it. A message step's "npc-dialogue:action" (`kind: "message"`) can set
 * `box: { items }` (one or two item ids) to show it as an item box, as OSRS shows
 * hand-outs, instead of a chat message. "npc-dialogue:start" plays a named variant on demand.
 * Speech, choices, random alternatives and named shops run through existing systems.
 */
const fs = require("fs");
const path = require("path");
const { GameConstants } = require("../../src/main/typescript/elvarg/game/GameConstants");
const { Misc } = require("../../src/main/typescript/elvarg/util/Misc");
const { PluginManager } = require("../../src/main/typescript/elvarg/plugins/PluginManager");
const { DialogueChainBuilder } = require("../../src/main/typescript/elvarg/game/model/dialogues/builders/DialogueChainBuilder");
const { NpcDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/NpcDialogue");
const { PlayerDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/PlayerDialogue");
const { ActionDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ActionDialogue");
const { ItemStatementDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/ItemStatementDialogue");
const { DoubleItemStatementDialogue } = require("../../src/main/typescript/elvarg/game/model/dialogues/entries/impl/DoubleItemStatementDialogue");
const { ShopDefinition } = require("../../src/main/typescript/elvarg/game/definition/ShopDefinition");
const { NpcDefinition } = require("../../src/main/typescript/elvarg/game/definition/NpcDefinition");
const { ShopManager } = require("../../src/main/typescript/elvarg/game/model/container/shop/ShopManager");

/** Jumps followed in one conversation before it is cut off (a transcript that loops on itself). */
const MAX_JUMPS = 100;

// These NPCs have executable plugin conversations, not an imported prose transcript.
const SPECIAL_NPC_DIALOGUES = new Set(["Skully", "Estate agent", "Estate Agent", "Alwyn"]);

/**
 * Wiki transcripts leave parts of a line to the reader's character: their name
 * ("[player name]", "<player name>") and gendered alternatives ("[sir/madam]",
 * "[Greetings, sir/Greetings, madam/Greetings]"). Resolve them from the player
 * seeing the dialogue; alternatives without a gendered form (numbers, item
 * picks, NPC choices) stay for quest plugins to fill.
 */
const PLAYER_NAME_PLACEHOLDER = /\[(?:player name|playername|player|player vampyre name)(\.?)\]|<player name>/gi;
const PLAYER_NAME_ALTERNATIVE = /^(?:player name|playername|player vampyre name)$/i;
const GENDERED_ALTERNATIVE = /\[([^\[\]]*\/[^\[\]]*)\]/g;

/** The address words the wiki templates use for each gender. */
const MALE_ADDRESS_WORDS = new Set([
  "sir", "sirrah", "mister", "master", "milord", "lord", "lad", "laddie", "man", "men", "boy", "boys",
  "brother", "fellow", "fella", "chap", "guy", "prince", "strongman", "craftsman", "monsieur",
]);
const FEMALE_ADDRESS_WORDS = new Set([
  "madam", "madame", "ma'am", "m'am", "miss", "lady", "milady", "m'lady", "mistress", "lass", "lassie",
  "woman", "women", "girl", "girls", "gal", "sister", "princess", "strongwoman", "craftswoman",
]);

/** The gender an alternative addresses, or null when it addresses neither or both. */
function genderedForm(text) {
  const words = String(text).toLowerCase().match(/[a-z']+/g) ?? [];
  const male = words.some((word) => MALE_ADDRESS_WORDS.has(word));
  const female = words.some((word) => FEMALE_ADDRESS_WORDS.has(word));
  return male === female ? null : male ? "male" : "female";
}

/** The alternative to show a player of this gender, or null to leave the group alone. */
function pickAlternative(parts, name, male) {
  if (parts.some((part) => PLAYER_NAME_ALTERNATIVE.test(part))) return name ?? null;
  const forms = parts.map((part) => ({ text: part, gender: genderedForm(part) }));
  if (!forms.some((form) => form.gender)) return null;
  const wanted = male ? "male" : "female";
  const match = forms.find((form) => form.gender === wanted) ?? forms.find((form) => !form.gender);
  return (match ?? forms[0]).text;
}

function formatPlayerText(text, player) {
  let out = String(text ?? "");
  const name = player?.getUsername?.();
  // "[player.]" keeps the sentence's closing period.
  if (name) out = out.replace(PLAYER_NAME_PLACEHOLDER, (_, period) => `${name}${period ?? ""}`);
  if (!out.includes("/")) return out;
  const male = player?.getAppearance?.()?.isMale?.() !== false;
  return out.replace(GENDERED_ALTERNATIVE, (whole, body) => {
    const parts = body.split("/").map((part) => part.trim());
    return parts.length < 2 ? whole : pickAlternative(parts, name, male) ?? whole;
  });
}

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

/** Transcript page name -> an NPC id that speaks it, so cutscene/paired speakers
 * get their own chathead instead of borrowing the NPC being talked to. */
function speakerIdIndex(index) {
  const byName = new Map();
  for (const [id, pages] of Object.entries(index ?? {})) {
    for (const entry of pages ?? []) {
      const name = String(entry.page ?? "").replace(/^Transcript:/, "");
      if (name && !byName.has(name)) byName.set(name, Number(id));
    }
  }
  return byName;
}

/**
 * Transcripts are keyed by wiki page title while NPC names come from the cache,
 * so "Hops" has to reach "Hops (Biohazard)". First usable disambiguated key wins.
 * The id index is preferred; this name fallback covers NPCs the index misses.
 */
function aliasKeys(data) {
  const aliases = new Map();
  for (const key of Object.keys(data)) {
    const base = key.replace(/ \(.+\)$/, "");
    if (base !== key && !aliases.has(base) && pickVariant(data[key])) aliases.set(base, key);
  }
  return aliases;
}

/** True when a branch ends in a wiki "continues" marker. */
function continues(steps) {
  for (const step of steps ?? []) {
    if (step.type === "jump") {
      if (/^continue/i.test(step.reference ?? "")) return true;
      continue;
    }
    if (continues(step.steps)) return true;
    for (const option of step.options ?? []) {
      if (continues(option.steps)) return true;
    }
  }
  return false;
}

/** True when a branch is only a navigation jump (no dialogue of its own). */
function jumpOnly(steps) {
  return !Array.isArray(steps) || steps.length === 0 || steps.every((step) => step.type === "jump");
}

/** A step body that actually says something (usable as a jump target). */
function realBody(steps) {
  return Array.isArray(steps) && steps.length > 0 && !jumpOnly(steps) ? steps : undefined;
}

/** Normalize option text so punctuation/prefix drift still matches ("Well," == "Well"). */
function normText(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Significant words of an option, for similarity matching. */
function words(value) {
  return new Set(
    String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2)
  );
}

/** Jaccard word overlap, 0..1. */
function similarity(a, b) {
  let inter = 0;
  for (const word of a) if (b.has(word)) inter++;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/** Option text -> steps across every variant of a transcript page; real bodies win. */
function collectPageOptions(record) {
  const byText = new Map();
  const list = [];
  const walk = (steps) => (steps || []).forEach((step) => {
    for (const option of step.options ?? []) {
      const key = normText(option.text);
      const body = Array.isArray(option.steps) ? option.steps : [];
      if (key) {
        list.push({ key, words: words(option.text), steps: body });
        if (!byText.has(key) || (jumpOnly(byText.get(key)) && !jumpOnly(body))) byText.set(key, body);
      }
      walk(option.steps);
    }
    walk(step.steps);
  });
  if (record) {
    if (record.steps) walk(record.steps);
    for (const variant of Object.values(record.variants ?? {})) walk(variant);
  }
  return { byText, list };
}

/** Normalized line text -> the steps that follow it, across a page's variants. */
function collectPageLines(record) {
  const lines = new Map();
  const walk = (steps) => {
    if (!Array.isArray(steps)) return;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const text = typeof step.player === "string" ? step.player
        : typeof step.npc === "string" ? step.npc
        : step.type === "line" && typeof step.text === "string" ? step.text
        : undefined;
      if (text) {
        const key = normText(text);
        if (key && !lines.has(key)) lines.set(key, steps.slice(i));
      }
      walk(step.steps);
      for (const option of step.options ?? []) walk(option.steps);
    }
  };
  if (record) {
    if (record.steps) walk(record.steps);
    for (const variant of Object.values(record.variants ?? {})) walk(variant);
  }
  return lines;
}

/** The first top-level menu of a variant, if it has one. */
function topLevelMenu(steps) {
  return (steps || []).find((step) => step.type === "choice" && step.options?.length);
}

/**
 * The menu "above" the given variant on its page: the nearest earlier variant with
 * a top-level menu. The wiki writes "same as above" tails ({{tact|above}}) that
 * continue into the previous variant's menu, which is not linked in the dump.
 */
function collectMenuBefore(record, variantName) {
  const variants = record?.variants ?? {};
  const keys = Object.keys(variants);
  const family = variantName ? String(variantName).split("-")[0] : "";
  const index = variantName ? keys.indexOf(variantName) : -1;
  const upto = index === -1 ? keys.length : index;
  let menu;
  for (let i = 0; i < upto; i++) {
    // Stay within the same variant family ("sir-prysin-*"), or a page shared by
    // several NPCs would continue into an unrelated NPC's menu.
    if (family && keys[i].split("-")[0] !== family) continue;
    const found = topLevelMenu(variants[keys[i]]);
    if (found) menu = { step: found, rest: [], record: undefined };
  }
  return menu;
}

/**
 * The wiki marks a conditional with `{{tcond|If X:}}` and puts the guarded text
 * after it. The parser sometimes emits that guard as an empty condition followed
 * by the text as a sibling, so attach the following run of non-condition steps to
 * the empty condition. Without this the text plays unconditionally.
 */
function nestOrphanConditions(steps) {
  if (!Array.isArray(steps)) return [];
  const flat = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step.type === "condition" && !(step.steps && step.steps.length)) {
      const branch = [];
      let j = i + 1;
      while (j < steps.length && steps[j].type !== "condition") branch.push(steps[j++]);
      if (branch.length) {
        flat.push({ ...step, steps: branch });
        i = j - 1;
        continue;
      }
    }
    flat.push(step);
  }
  return flat.map((step) => {
    if (step.options?.length) {
      return { ...step, options: step.options.map((option) => ({ ...option, steps: nestOrphanConditions(option.steps || []) })) };
    }
    if (step.steps?.length) return { ...step, steps: nestOrphanConditions(step.steps) };
    return step;
  });
}

/**
 * Flatten a transcript into a linear play queue.
 *
 * Conditions are resolved through `opts.resolveCondition` (true/false/null). For a
 * run of sibling conditions the first true one wins; if none is true the first the
 * resolver could not answer wins, so behaviour is unchanged when no plugin resolves
 * them. If every condition is explicitly false the guarded content is skipped.
 * Jumps resolve through `opts.resolveJump`; unresolved jumps fall through.
 * `opts.wrapBranch` can splice bookkeeping steps in front of a chosen branch.
 */
function flatten(steps, opts = {}) {
  steps = nestOrphanConditions(steps);
  const resolveCondition = typeof opts.resolveCondition === "function" ? opts.resolveCondition : () => null;
  const resolveJump = typeof opts.resolveJump === "function" ? opts.resolveJump : () => null;
  const wrapBranch = typeof opts.wrapBranch === "function" ? opts.wrapBranch : (_chosen, branch) => branch;

  const out = [];
  for (let position = 0; position < steps.length; position++) {
    if (opts.stopped) break;
    const step = steps[position];
    if (step.type === "jump") {
      const target = resolveJump(step, steps[position - 1]);
      // "end": a jump we cannot replay. Stop rather than leak into the next step.
      if (target === "end") {
        out.push({ type: "end" });
        opts.stopped = true;
        break;
      }
      // { menu }: "shows other/previous/initial options" - replay a menu already seen.
      if (target && typeof target === "object" && target.menu) {
        out.push({ type: "gomenu", menu: target.menu });
        continue;
      }
      // Expanded when the conversation reaches it (startDialogue's run), so its conditions see
      // what happened before it: Percy's unlock menu after a purchase. Expanding it here also
      // recursed forever when a jump led back into its own branch.
      if (Array.isArray(target)) out.push({ type: "jump_to", steps: target });
      continue;
    }
    if (step.type !== "condition") {
      out.push(step);
      continue;
    }
    const runStart = position;
    while (steps[position + 1]?.type === "condition") position++;
    const run = steps.slice(runStart, position + 1);
    const answers = run.map((condition) => resolveCondition(condition));
    let chosen = answers.findIndex((answer) => answer === true);
    if (chosen === -1) {
      const unknown = answers.findIndex((answer) => answer === null);
      // Every condition answered false: the guarded content does not apply.
      if (unknown === -1) continue;
      chosen = unknown;
    }
    const step_ = run[chosen];
    out.push(...wrapBranch(step_, flatten(step_.steps || [], opts)));
    if (opts.stopped) break;
    if (continues(step_.steps)) {
      out.push(...flatten(run.slice(chosen + 1), opts));
      if (opts.stopped) break;
    }
  }
  return out;
}

function startDialogue(api, event, steps, branches = {}, context = {}) {
  context.jumps = 0;
  const { player } = event;
  const manager = player.getDialogueManager();
  const npcId = event.npcId;
  const definition = event.definition;
  const close = () => player.getPacketSender().sendInterfaceRemoval();
  // Only warn when a conversation had nothing to show; a terminal wiki
  // "unavailable" marker after real dialogue is just the end of the branch.
  let playedAny = false;
  const unavailable = () => {
    close();
    if (!playedAny) player.sendMessage("That conversation isn't available right now.");
  };

  // Menus seen so far, for the wiki "shows other/previous/initial options" jumps.
  context.currentMenu = undefined;
  context.menuHistory = [];

  // Ordered option records power the wiki "jump above" shortcut (repeated menus).
  const records = [];
  const recordsByText = new Map();
  const optionRecords = new WeakMap();
  const recordOption = (option) => {
    let record = optionRecords.get(option);
    if (record) return record;
    record = { id: records.length, text: String(option.text ?? ""), steps: Array.isArray(option.steps) ? option.steps : [] };
    optionRecords.set(option, record);
    records.push(record);
    const key = normText(record.text);
    const list = recordsByText.get(key);
    if (list) list.push(record); else recordsByText.set(key, [record]);
    return record;
  };

  const resolveCondition = (step) =>
    PluginManager.emitNpcDialogueCondition({
      player, npc: event.npc, npcId, definition, pages: context.pages,
      text: step.text, stepId: step.id,
    });

  // "shows other/previous/initial options" ({{tact|other}} etc.) replays a menu
  // that has already been shown. "previous2/3" walk further back, "initial" is
  // the first menu of the conversation.
  const resolveMenuJump = (reference) => {
    const current = context.currentMenu;
    const history = context.menuHistory;
    if (/^other/i.test(reference)) return current ? { menu: current } : "end";
    if (/^initial/i.test(reference)) return history[0] ? { menu: history[0] } : "end";
    const match = /^previous(\d*)/i.exec(reference);
    const back = match && match[1] ? Number(match[1]) : 1;
    const index = current ? history.indexOf(current) : history.length - 1;
    // "previous" on the first menu means the menu the option came from; only walk
    // further back when the conversation actually has earlier menus.
    const target = index - back >= 0 ? history[index - back] : current ?? history[history.length - 1];
    return target ? { menu: target } : "end";
  };

  // "jump above" targets the same option's earlier occurrence, else the option
  // defined just before this one. Wiki jump ids lost their targets in the dump.
  const resolveJump = (step, previous) => {
    const reference = String(step.reference ?? "");
    if (/^(other|previous\d*|initial)/i.test(reference)) return resolveMenuJump(reference);
    // The player asks one of the page's questions again (Percy's "Is there anything else I can
    // unlock here?" after a purchase): carry on as that question does, without saying it twice.
    if (/^(above|below)/i.test(reference) && typeof previous?.player === "string") {
      const question = normText(previous.player);
      const asked = realBody(context.pageOptions?.get(question))
        ?? realBody((recordsByText.get(question) ?? [])[0]?.steps);
      if (asked) {
        const repeatsLine = typeof asked[0]?.player === "string" && normText(asked[0].player) === normText(previous.player);
        return realBody(repeatsLine ? asked.slice(1) : asked) ?? asked;
      }
    }
    // After an NPC line, "same as above" carries on as that line does where the page first has
    // it (Bryn's first-time "What is this place?" continues as his full explanation).
    if (/^(above|below)/i.test(reference) && typeof previous?.npc === "string") {
      const after = context.pageLines?.get(normText(previous.npc))?.slice(1);
      if (after?.length && after[0] !== step && !jumpOnly(after)) return after;
    }
    const current = context.currentRecord;
    /**
     * True when a candidate would replay the branch the jump is in. A wiki jump
     * whose target was lost falls back to "the most similar option", which can be
     * the very option containing the jump (Garden of Tranquillity's retake menu,
     * X Marks' "I'm looking for a quest."); resolving to "end" beats looping.
     */
    const sameBranch = (candidate) => {
      if (!candidate || !current?.steps) return true;
      if (candidate === current.steps) return true;
      const signature = (steps) => (steps ?? [])
        .map((entry) => typeof entry?.player === "string" ? `p:${entry.player}`
          : typeof entry?.npc === "string" ? `n:${entry.npc}`
          : entry?.type === "line" && typeof entry?.text === "string" ? `l:${entry.text}` : null)
        .filter(Boolean).join("|");
      const mine = signature(current.steps);
      return mine.length > 0 && signature(candidate) === mine;
    };
    // A random alternative ending "same as above" repeats the previous alternative's
    // continuation, not an unrelated menu elsewhere on the page.
    if (/^above/i.test(reference) && current?.randomOptions) {
      let continuation = realBody(current.randomOptions[current.randomIndex - 1]?.steps);
      while (
        continuation?.length &&
        (typeof continuation[0]?.player === "string" ||
          typeof continuation[0]?.npc === "string" ||
          continuation[0]?.type === "line")
      ) {
        continuation = continuation.slice(1);
      }
      continuation = realBody(continuation);
      if (continuation?.length) return continuation;
    }
    const key = current ? normText(current.text) : "";
    // A jump never leads back into the branch it is in: that replays the branch forever.
    const elsewhere = (steps) => (steps && steps !== current?.steps ? steps : undefined);
    // The same option text (normalized) shown earlier, anywhere on the page.
    const sameText = current ? (recordsByText.get(key) ?? []).find((record) => record.steps !== current.steps) : undefined;
    const fromPage = key ? elsewhere(context.pageOptions?.get(key)) : undefined;
    // Near text: a page option whose normalized text contains (or is contained by)
    // this one, e.g. "Aris said..." vs "Fortune-teller Aris said...".
    const near = key.length >= 8
      ? (context.pageOptionList ?? [])
          .filter((option) => option.key.length >= 8 && option.key !== key && (option.key.includes(key) || key.includes(option.key)))
          .sort((a, b) => Math.abs(a.key.length - key.length) - Math.abs(b.key.length - key.length))
          .map((option) => realBody(option.steps))
          .find(Boolean)
      : undefined;
    // Same question reworded ("...Count Draynor?" vs "...this vampyre?"): best
    // word overlap on the page, above a confidence floor.
    let similar;
    if (key.length >= 8) {
      const target = words(current ? current.text : "");
      const best = (context.pageOptionList ?? [])
        .map((option) => ({ steps: realBody(option.steps), score: option.words ? similarity(target, option.words) : 0 }))
        .filter((candidate) => candidate.steps)
        .sort((a, b) => b.score - a.score)[0];
      if (best && best.score >= 0.5) similar = best.steps;
    }
    // "Same as above" can point at an inline line rather than an option (e.g. a
    // repeat option for dialogue the player already spoke in this branch).
    const fromLine = key.length >= 8 ? realBody(context.pageLines?.get(key)) : undefined;
    if (/^below/i.test(reference)) {
      const next = current ? records[current.id + 1] : records[0];
      const pick = [realBody(sameText?.steps), realBody(fromPage), near, similar, fromLine, realBody(next?.steps)]
        .find((candidate) => candidate && !sameBranch(candidate));
      if (pick) return pick;
      if (!current && context.pageMenuBefore) return { menu: context.pageMenuBefore };
      const last = records[records.length - 1];
      return realBody(last?.steps) ?? "end";
    }
    if (!/^above/i.test(reference)) return null;
    if (!current) {
      // "same as above" outside a menu continues into the menu above on the page.
      if (context.pageMenuBefore) return { menu: context.pageMenuBefore };
      const last = records[records.length - 1];
      return realBody(last?.steps) ?? "end";
    }
    const prev = current.id > 0 ? records[current.id - 1] : undefined;
    return [realBody(sameText?.steps), realBody(fromPage), near, similar, fromLine, realBody(prev?.steps)]
      .find((candidate) => candidate && !sameBranch(candidate)) ?? "end";
  };

  const flattenOptions = () => ({ resolveCondition, resolveJump,
    wrapBranch: (chosen, branch) => [{ type: "condition_chosen", id: chosen.id, text: chosen.text }, ...branch] });

  function presentMenu(menu, offset = 0, tail = []) {
    const { step, rest, record } = menu;
    context.currentMenu = menu;
    if (!context.menuHistory.includes(menu)) context.menuHistory.push(menu);
    // An option the wiki guards ("If the player is wearing the Ring of Charos(a):") is hidden
    // only once a plugin answers its condition false; unanswered ones still show.
    const options = (step.options || []).filter((option) =>
      !option.condition || resolveCondition({ text: option.condition, id: option.id }) !== false);
    const more = options.length - offset > 5;
    const visible = options.slice(offset, offset + (more ? 4 : 5));
    // Record every option when the prompt is shown (not on selection) so that a
    // nested option's "jump above" can find its unselected sibling by text.
    visible.forEach(recordOption);
    const pairs = visible.flatMap((option) => {
      // A dump-gap option can carry blank text (the wording lives in its condition
      // or its first player line); fall back so the branch stays reachable.
      const formatted = formatPlayerText(option.text, player);
      const label = String(formatted ?? "").trim()
        || String(option.condition ?? "").replace(/^if\s+.*?:\s*/i, "").trim()
        || (option.steps ?? []).find((entry) => typeof entry?.player === "string")?.player
        || "Continue.";
      return [label, () => {
        // Quest-gated choices carry a slug like "quest:cook-s-assistant:start";
        // let the owning quest run its action, then play the branch.
        if (option.hook) {
          api.emitCustomEvent("npc-dialogue:hook", { player, npc: event.npc, npcId, definition, hook: option.hook, quest: option.quest, option: option.text });
        }
        api.emitCustomEvent("npc-dialogue:choice", { player, npc: event.npc, npcId, definition, option: option.text, stepId: option.id });
        context.currentMenu = menu;
        run([...(option.steps || []), ...rest, ...tail], recordOption(option));
      }];
    });
    if (more) pairs.push("More...", () => presentMenu(menu, offset + 4, tail));
    if (visible.length === 1) pairs.push("Goodbye.", close);
    // A parsed menu with no options is a wiki-export gap; continue the branch
    // instead of silently closing the chat.
    if (!pairs.length) return run(rest, record);
    playedAny = true;
    manager.reset();
    if (!api.sendMultiChatboxPrompt(player, formatPlayerText(step.prompt || "Select an Option", player), ...pairs)) {
      unavailable();
    }
  }

  function run(steps, currentRecord) {
    const previous = context.currentRecord;
    context.currentRecord = currentRecord;
    const queue = flatten(steps, flattenOptions());
    context.currentRecord = previous;
    const chain = new DialogueChainBuilder();
    let index = 0;
    for (let position = 0; position < queue.length; position++) {
      const step = queue[position];
      const rest = [...(step.steps || []), ...queue.slice(position + 1)];
      if (step.type === "jump_to") {
        const after = queue.slice(position + 1);
        chain.add(new ActionDialogue(index++, { execute: () => {
          // Jumps that only ever lead to more jumps would never show anything.
          if (++context.jumps > MAX_JUMPS) return close();
          run([...step.steps, ...after], currentRecord);
        } }));
        manager.startDialogues(chain);
        return;
      }
      if (step.type === "condition_chosen") {
        chain.add(new ActionDialogue(index++, { execute: () => {
          api.emitCustomEvent("npc-dialogue:condition", { player, npc: event.npc, npcId, definition, text: step.text, stepId: step.id });
          run(rest, currentRecord);
        } }));
        manager.startDialogues(chain);
        return;
      }
      // "shows other/previous options": replay a menu already shown, then carry
      // on with whatever followed the jump in this queue.
      if (step.type === "gomenu" && step.menu) {
        // A parser-split "shows other options" jump immediately before a choice
        // really means "show that choice" (Wanted!'s squireship offer); replaying
        // the current menu forever would never reach it.
        const next = queue[position + 1];
        if (next && next.type === "choice") {
          continue;
        }
        const after = queue.slice(position + 1);
        chain.add(new ActionDialogue(index++, { execute: () => presentMenu(step.menu, 0, after) }));
        manager.startDialogues(chain);
        return;
      }
      // Typed lines carry a speaker; render any of them (cutscene actors included)
      // rather than aborting when the speaker is not the NPC being talked to.
      const typedLine = step.type === "line" && typeof step.text === "string";
      if (!step.hook && (typeof step.npc === "string" || typeof step.player === "string" || typedLine)) {
        const isPlayer = typeof step.player === "string";
        const speech = isPlayer ? step.player : typedLine ? step.text : step.npc;
        // Let a plugin skip a line through the mutable payload (as slayer:assignment),
        // e.g. a hand-over line for an item the player is no longer carrying.
        const request = { player, npc: event.npc, npcId, definition, step, text: speech, skip: false };
        api.emitCustomEvent("npc-dialogue:line", request);
        if (request.skip) {
          if (step.steps?.length) {
            run(rest, currentRecord);
            return;
          }
          continue;
        }
        // `text` is mutable too, so a plugin can fill in the wiki's "[number]"-style blanks.
        const lines = Misc.wrapText(formatPlayerText(request.text, player), 53);
        playedAny = true;
        // A typed line spoken by someone other than the NPC being talked to (a
        // paired NPC talking to them, a cutscene actor) gets that speaker's head.
        const speakerId = !isPlayer && typedLine && step.speaker && step.speaker !== definition.getName()
          ? (context.speakerIdByName?.get(step.speaker) ?? definition.getId())
          : definition.getId();
        for (let start = 0; start < lines.length; start += 4) {
          const text = lines.slice(start, start + 4).join(" ");
          chain.add(isPlayer
            ? new PlayerDialogue(index++, text)
            : new NpcDialogue(index++, speakerId, text));
        }
        // `after` (set by a line handler) runs once the player continues past the line,
        // before the conversation carries on: a teleport the wiki only narrates, say.
        if (step.steps?.length || typeof request.after === "function") {
          chain.add(new ActionDialogue(index++, { execute: () => {
            request.after?.();
            run(rest, currentRecord);
          } }));
          manager.startDialogues(chain);
          return;
        }
        continue;
      }
      chain.add(new ActionDialogue(index++, { execute: () => {
        // Action steps can carry a quest slug; emit it, then continue the branch.
        if (step.hook) {
          api.emitCustomEvent("npc-dialogue:hook", { player, npc: event.npc, npcId, definition, hook: step.hook, quest: step.quest, action: step.action });
          return run(rest, currentRecord);
        }
        // Quest actions ("Quest complete!", "receive", ...) let a plugin drive
        // state through the mutable payload, then the branch continues.
        // Message steps are their own event (`kind: "message"`); emitting the
        // generic event first made handlers keyed on step ids act twice.
        if (step.type === "message") {
          // Item hand-outs are also `message` steps; let quests hook their id.
          const message = {
            player, npc: event.npc, npcId, definition, step,
            text: step.text, target: step.target, stepId: step.id, kind: "message", handled: false,
          };
          api.emitCustomEvent("npc-dialogue:action", message);
          if (message.end) return close();
          playedAny = true;
          const [first, second] = Array.isArray(message.box?.items) ? message.box.items : [];
          if (first !== undefined) {
            const text = formatPlayerText(String(message.text ?? ""), player);
            const box = new DialogueChainBuilder();
            box.add(second === undefined
              ? new ItemStatementDialogue(0, first, text)
              : new DoubleItemStatementDialogue(0, first, second, text));
            box.add(new ActionDialogue(1, { execute: () => run(rest, currentRecord) }));
            manager.startDialogues(box);
            return;
          }
          if (!message.handled) player.sendMessage(formatPlayerText(String(step.text ?? ""), player));
          return run(rest, currentRecord);
        }
        const action = {
          player, npc: event.npc, npcId, definition, step,
          text: step.text, action: step.action, target: step.target, stepId: step.id, handled: false,
        };
        api.emitCustomEvent("npc-dialogue:action", action);
        // A handler can also hand back `steps` to play first (a story picked from another page).
        if (action.handled) return action.end ? close() : run([...(action.steps ?? []), ...rest], currentRecord);
        if (step.type === "end") return close();
        // Wiki markers for content this server does not implement.
        if (step.type === "unavailable" || step.type === "reference") return unavailable();
        if (step.type === "call" && Object.hasOwn(branches, step.branch) && Array.isArray(branches[step.branch])) {
          return run([...branches[step.branch], ...rest], currentRecord);
        }
        if (step.type === "choice") return presentMenu({ step, rest, record: currentRecord });
        if (step.type === "random") {
          // A parsed-but-empty random (the export dropped its alternatives) is not
          // a dead end; continue with whatever follows. Alternatives the wiki guards
          // ("If Animal Magnetism is completed:") are left out once a plugin answers
          // their condition false, as menu options are.
          const options = (step.options ?? []).filter((option) =>
            !option.condition || resolveCondition({ text: option.condition, id: option.id }) !== false);
          if (!options.length) return run(rest, currentRecord);
          const index = Math.floor(Math.random() * options.length);
          const option = options[index];
          if (option.hook) return unavailable();
          // The record lets an "above" jump see the other random alternatives
          // ({{tact|above}} = "same as the alternative above").
          const record = {
            id: -1,
            text: String(option.text ?? ""),
            steps: Array.isArray(option.steps) ? option.steps : [],
            randomOptions: options,
            randomIndex: index,
          };
          return run([...(option.steps || []), ...rest], record);
        }
        if (step.type === "action" && step.action === "open_shop") {
          const target = step.target;
          const shops = ShopDefinition.all().filter((shop) => shop.getName() === target);
          if (shops.length === 1) {
            close();
            if (ShopManager.open(player, shops[0].getId(), true)) return;
          }
        }
        if (step.type === "action" && step.action === "slayer_assignment") {
          const request = { player, master: step.target, npcId, definitionId: definition?.getId?.(), npcName: definition?.getName?.(), line: null };
          api.emitCustomEvent("slayer:assignment", request);
          if (request.line) return run([{ npc: request.line }, ...rest], currentRecord);
        }
        if (step.type === "action" && step.action === "slayer_task_tip") {
          const request = { player, master: step.target, line: null };
          api.emitCustomEvent("slayer:task-tip", request);
          if (request.line) return run([{ npc: request.line }, ...rest], currentRecord);
        }
        if (step.type === "action") {
          // "npc-dialogue:action": a plugin that owns this stage direction (an interface to
          // open, say) sets handled and takes over the conversation from here.
          const request = { player, npcId, action: step.action, target: step.target, handled: false };
          api.emitCustomEvent("npc-dialogue:action", request);
          if (request.handled) return;
          // Unhandled prose stage directions ("The player lights a tinderbox.")
          // have no executable contract; continue the branch rather than abort.
          return run(rest, currentRecord);
        }
        // ponytail: unknown step type with no executable contract. Stop safely.
        unavailable();
      } }));
      manager.startDialogues(chain);
      return;
    }
    chain.add(new ActionDialogue(index, { execute: close }));
    manager.startDialogues(chain);
  }
  run(steps, undefined);
}

module.exports = {
  name: "NpcDialogues",
  // Exported for tests/npc-dialogues.test.cjs; nothing else reads them.
  pickVariant,
  aliasKeys,
  flatten,
  formatPlayerText,
  startDialogue,
  collectPageLines,
  collectPageOptions,
  register(api) {
    const dialogueFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogues.json");
    const indexFile = path.join(GameConstants.DEFINITIONS_DIRECTORY, "npc-dialogue-index.json");
    // Parsed on the first Talk-to rather than at boot: the 17 MiB transcript dump expands
    // to ~35 MiB of objects, and a world where nobody talks never needs it.
    let loaded;
    const load = () => {
      if (loaded) return loaded;
      const data = JSON.parse(fs.readFileSync(dialogueFile, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${dialogueFile}: expected dialogues keyed by transcript name`);
      }
      for (const [name, npc] of Object.entries(data)) {
        if (npc.steps !== undefined && !Array.isArray(npc.steps)) {
          throw new Error(`${dialogueFile}: ${name} has non-array steps`);
        }
        if (npc.default != null && !Object.hasOwn(npc.variants ?? {}, npc.default)) {
          throw new Error(`${dialogueFile}: ${name} names a missing default variant`);
        }
      }
      let index = {};
      try {
        index = JSON.parse(fs.readFileSync(indexFile, "utf8"));
      } catch {
        index = {};
      }
      loaded = { data, aliases: aliasKeys(data), index, speakerIdByName: speakerIdIndex(index) };
      return loaded;
    };

    /**
     * Resolve the transcript for an NPC: id index first (with the plugin variant
     * selector), cache name second.
     */
    const resolveTranscript = (event) => {
      const { data, aliases, index, speakerIdByName } = load();
      const npcId = event.npcId;
      const pages = (Array.isArray(index[String(npcId)]) ? index[String(npcId)] : [])
        .map((entry) => ({ page: String(entry.page ?? "").replace(/^Transcript:/, ""), variants: Array.isArray(entry.variants) ? entry.variants : [] }))
        .filter((entry) => Object.hasOwn(data, entry.page));
      const context = { player: event.player, npc: event.npc, npcId, definition: event.definition, pages, speakerIdByName };

      // "Same as above" option bodies ({{tact|above}}) reference an option defined
      // earlier on the page, which may live in another variant. Index this page's
      // option texts so resolveJump can reach a real answer without replaying it.
      const withOptions = (page, result) => {
        if (page && data[page]) {
          const pageOptions = collectPageOptions(data[page]);
          result.context.pageOptions = pageOptions.byText;
          result.context.pageOptionList = pageOptions.list;
          result.context.pageLines = collectPageLines(data[page]);
          // Only a known variant has a well-defined "menu above"; otherwise a
          // page shared by several NPCs could replay an unrelated menu.
          result.context.pageMenuBefore = result.variant ? collectMenuBefore(data[page], result.variant) : undefined;
        }
        return result;
      };

      if (pages.length) {
        const choice = event.variant ?? PluginManager.emitNpcDialogueVariant(context);
        const wanted = typeof choice === "string" ? choice : choice?.variant;
        const wantedPage = typeof choice === "object" ? choice?.page : undefined;
        if (wanted || wantedPage) {
          const page = wantedPage
            ? pages.find((entry) => entry.page === wantedPage)
            // The id index sometimes slugifies a variant differently from the dump
            // (drops words), so fall back to whichever page actually has it.
            : pages.find((entry) => entry.variants.includes(wanted)) ?? pages.find((entry) => Object.hasOwn(data[entry.page]?.variants ?? {}, wanted));
          if (page) {
            const record = data[page.page];
            // Flat pages hold `steps` directly (no variants); use their default.
            const steps = wanted && record?.variants ? record.variants[wanted] : pickVariant(record);
            if (Array.isArray(steps)) return withOptions(page.page, { steps, branches: record?.branches, context, variant: wanted });
          }
        }
        const first = pages.find((entry) => pickVariant(data[entry.page]));
        if (first) return withOptions(first.page, { steps: pickVariant(data[first.page]), branches: data[first.page]?.branches, context });
      }

      const name = event.definition.getName();
      let record = Object.hasOwn(data, name) ? data[name] : undefined;
      if (!pickVariant(record) && aliases.has(name)) record = data[aliases.get(name)];
      const forced = event.variant ? record?.variants?.[event.variant] : undefined;
      const steps = Array.isArray(forced) ? forced : pickVariant(record);
      return steps ? withOptions(record === data[name] ? name : undefined, { steps, branches: record?.branches, context }) : null;
    };

    /**
     * Plays one named variant of an NPC's transcript outside Talk-to (a door that has the
     * guard speak, an item used on an NPC): { player, npc?, npcId, variant, select?, handled }.
     * `select(steps)` can narrow the variant to the steps that apply (a right-click shortcut).
     */
    api.onCustomEvent("npc-dialogue:start", (request) => {
      const definition = NpcDefinition.forId(request.npcId);
      if (!request.player || !definition) return;
      const event = { player: request.player, npc: request.npc, npcId: request.npcId, definition, variant: request.variant };
      const resolved = resolveTranscript(event);
      const steps = typeof request.select === "function" && resolved?.steps ? request.select(resolved.steps) : resolved?.steps;
      if (!steps?.length) return;
      startDialogue(api, event, steps, resolved.branches, resolved.context);
      request.handled = true;
    });

    api.onAnyNpcInteraction({
      "Talk-to": (event) => {
        const name = event.definition.getName();
        if (SPECIAL_NPC_DIALOGUES.has(name)) return false;
        const resolved = resolveTranscript(event);
        startDialogue(api, event, resolved?.steps?.length ? resolved.steps : [
          { npc: "Sorry, i've nothing interesting to talk about yet" },
        ], resolved?.branches, resolved?.context);
        return true;
      },
    });
  },
};
