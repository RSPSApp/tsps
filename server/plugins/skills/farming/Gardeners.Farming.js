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
/** The protection offer the Pay option makes (Services.gardenerProtection answers it). */
const PROTECT_ACTION = "farming:gardener-protect";
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

/**
 * The menu: `chop` swaps the protection question for the felling one. Each answer is the player's line, then what
 * it leads to.
 */
function menu(name, chop) {
    const ask = chop ? CHOP : LOOK_AFTER;
    return [{
        type: "choice",
        options: [
            { text: ask, steps: [{ player: ask }, { type: "action", action: PROTECT_ACTION }] },
            { text: ADVICE, steps: adviceSteps(name) },
            { text: SELL, steps: [{ player: SELL }, { npc: SELL_REPLY }, { type: "action", action: "open_shop", target: SHOP }] },
            { text: LEAVE, steps: [{ player: LEAVE }] },
        ],
    }];
}

/** Talk-to on a gardener: the menu through the dialogue runtime, so its hooks (Fairytale I, diaries) still see it. */
function talk(player, npc, definition, chop) {
    const name = definition?.getName?.() ?? npc.getDefinition()?.getName?.() ?? "";
    const npcId = npc.getId();
    const { startDialogue } = require("../../npcs/NpcDialogues.plugin.js");
    const record = QuestRuntime.loadTranscripts(api)?.[name];
    const context = { player, npc, npcId, definition, pages: [{ page: name, variants: ["standard-dialogue"] }] };
    startDialogue(api, { player, npcId, npc, definition }, menu(name, chop), record?.branches ?? {}, context);
}

function attach(pluginApi) {
    api = pluginApi;
}

module.exports = { attach, talk, menu, LOOK_AFTER, CHOP, ADVICE, SELL, LEAVE, SELL_REPLY, SHOP };
