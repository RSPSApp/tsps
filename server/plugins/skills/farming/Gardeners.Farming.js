/**
 * Farming: a gardener's Talk-to (docs/farming.md, Gardeners).
 *
 * rsprox captures: Talk-to on Elstan (local 1001683, 1002189), Dantaera and Lyra opens "Select an option" with
 * "Would you look after my crops for me?|Can you give me any farming advice?|Can you sell me something?|I'll come
 * back another time." (Elstan adds "Are you a member of the Group of Advanced Gardeners?" during Fairytale I, which
 * that quest plays). "Can you sell me something?" says the line, the gardener answers "That depends on whether I have
 * it to sell. What is it that you're looking for?" and the Continue opens the Farming Supplies shop (Fayeth 1000149
 * tick 1863, Garth 03030 tick 4108). Since 25 September 2024 every protecting farmer sells through that shop (Wiki,
 * Elstan's changes), so a page's older "Some plant cure." menu is not played.
 *
 * The advice is the gardener's own Wiki transcript (a random tip, then the menu again). The Wiki gives a tree
 * gardener whose sapling has matured "Would you chop my tree down for me?" in place of the protection question
 * (Transcript: Fayeth). Both questions continue into the same protection or felling offer as Pay.
 */
const QuestRuntime = require("../../quests/QuestRuntime");

const LOOK_AFTER = "Would you look after my crops for me?";
const CHOP = "Would you chop my tree down for me?";
const ADVICE = "Can you give me any farming advice?";
const SELL = "Can you sell me something?";
const LEAVE = "I'll come back another time.";
const SELL_REPLY = "That depends on whether I have it to sell. What is it that you're looking for?";
const SHOP = "Farming Supplies";
/** The two questions' answers, which Services.gardenerTalkAction plays from the patches' state. */
const LOOK_AFTER_ACTION = "farming:gardener-look-after";
const CHOP_ACTION = "farming:gardener-chop";
/**
 * Ours: Elstan, Frizzy Skernip and the other gardeners with no Wiki transcript give the tips Kragen's, Marisi's and
 * Taria's pages share; no recording has a gardener's advice.
 */
const ADVICE_FALLBACK_PAGE = "Kragen";

let api = null;

function findOption(steps, text) {
    for (const step of steps ?? []) {
        for (const option of step?.options ?? []) {
            if (option?.text === text) return option.steps ?? [];
            const nested = findOption(option?.steps, text);
            if (nested) return nested;
        }
        const nested = Array.isArray(step?.steps) ? findOption(step.steps, text) : null;
        if (nested) return nested;
    }
    return null;
}

function pageSteps(page) {
    const variants = QuestRuntime.loadTranscripts(api)?.[page]?.variants;
    return variants?.["standard-dialogue"] ?? null;
}

/** The gardener's own random tip, else the shared one; a tip that has no random draw is not a tip. */
function adviceSteps(name) {
    for (const page of [name, ADVICE_FALLBACK_PAGE]) {
        const body = findOption(pageSteps(page), ADVICE);
        if (body?.some(step => step?.type === "random")) return body;
    }
    return [{ player: ADVICE }];
}

/** Every option text a page's menus offer, at any depth. */
function pageOptions(steps, found = new Set()) {
    for (const step of steps ?? []) {
        for (const option of step?.options ?? []) {
            if (option?.text) found.add(option.text);
            pageOptions(option?.steps, found);
        }
        if (Array.isArray(step?.steps)) pageOptions(step.steps, found);
    }
    return found;
}

/**
 * The menu. `chop` (a tree of the gardener's has grown) asks "Would you chop my tree down for me?"; `lookAfter` (a
 * patch of theirs is not a grown tree) keeps the protection question, so a gardener with both offers both, as
 * Alexandra's Wiki menu does. Each answer is the player's line, then what it leads to. A gardener whose Wiki
 * transcript has no advice question (Guppa, Argo) does not offer it.
 */
function menu(name, { chop = false, lookAfter = true } = {}) {
    const page = pageSteps(name);
    const advises = !page || pageOptions(page).has(ADVICE);
    return [{
        type: "choice",
        options: [
            ...lookAfter || !chop ? [{ text: LOOK_AFTER, steps: [{ player: LOOK_AFTER }, { type: "action", action: LOOK_AFTER_ACTION }] }] : [],
            ...chop ? [{ text: CHOP, steps: [{ player: CHOP }, { type: "action", action: CHOP_ACTION }] }] : [],
            ...advises ? [{ text: ADVICE, steps: adviceSteps(name) }] : [],
            { text: SELL, steps: [{ player: SELL }, { npc: SELL_REPLY }, { type: "action", action: "open_shop", target: SHOP }] },
            { text: LEAVE, steps: [{ player: LEAVE }] },
        ],
    }];
}

/** Plays `steps` as the gardener's, through the dialogue runtime, so its hooks (Fairytale I, diaries) still see them. */
function play(player, npc, definition, steps) {
    definition ??= npc.getDefinition?.();
    const name = definition?.getName?.() ?? "";
    const npcId = npc.getId();
    const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const record = QuestRuntime.loadTranscripts(api)?.[name];
    const context = { player, npc, npcId, definition, pages: [{ page: name, variants: ["standard-dialogue"] }] };
    startDialogue(api, { player, npcId, npc, definition }, steps, record?.branches ?? {}, context);
}

/** Talk-to on a gardener: its menu. */
function talk(player, npc, definition, questions) {
    play(player, npc, definition, menu(definition?.getName?.() ?? npc.getDefinition()?.getName?.() ?? "", questions));
}

function attach(pluginApi) {
    api = pluginApi;
}

module.exports = { attach, talk, play, menu, LOOK_AFTER_ACTION, CHOP_ACTION, LOOK_AFTER, CHOP, ADVICE, SELL, LEAVE, SELL_REPLY, SHOP };
