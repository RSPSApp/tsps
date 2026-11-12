const Journal = require("./Journal.AdventurePaths");
const Common = require("./Common.AdventurePaths");
const Progress = require("./Progress.AdventurePaths");
const Rewards = require("./Rewards.AdventurePaths");
const Items = require("./Items.AdventurePaths");
const Interface = require("./Interface.AdventurePaths");
const Data = require("./Data.AdventurePaths");
const isJon = (request) => request.definition?.getName() === "Adventurer Jon";
// Talk-to pays a carried voucher's rewards before the conversation starts, so a recipient's
// "carrying a voucher and hasn't received their reward" branch never plays.
const VOUCHER_UNPAID = "if the player is carrying a combat path voucher and hasn't received their reward:";
function variant(request) {
    if (!isJon(request)) return null;
    if (!Common.eligible(request.player))
        return "standard-dialogue-if-the-player-is-not-eligible-for-adventure-paths";
    return Common.state(request.player).disabled
        ? "standard-dialogue-if-the-player-has-opted-out-of-adventure-paths"
        : "standard-dialogue";
}
function capacity(player) {
    const offers = [
        ...Rewards.offers(player),
        ...Items.recoverable(player).map((id) => ({ items: [{ id, amount: 1 }] })),
    ];
    let source = player.getInventory().getItems(),
        fitted = 0;
    for (const offer of offers) {
        const next = Rewards.plan(player, offer.items, source);
        if (next) {
            source = next;
            fitted++;
        }
    }
    return { total: offers.length, fitted };
}
function condition(request) {
    if (String(request.text ?? "").toLowerCase() === VOUCHER_UNPAID) return false;
    if (!isJon(request)) return null;
    const { player } = request,
        text = request.text.toLowerCase();
    if (!Common.eligible(player)) return false;
    if (text.includes("starter kit"))
        return text.includes("hasn't") ? Items.canKit(player) : !Items.canKit(player);
    const room = capacity(player),
        members = Common.core.WorldDefinition.isMembersWorld(),
        s = Common.state(player),
        extra = Data.tasks().some(
            (t) => s.completed.includes(t.id) && t.members.length && !s.members.includes(t.id),
        );
    if (text.includes("hasn't completed a task")) return room.total === 0 && !extra;
    if (text.includes("only has members rewards")) return !members && room.total === 0 && extra;
    if (text.includes("does not have enough inventory space"))
        return room.total > 0 && room.fitted === 0;
    if (text.includes("on a free-to-play world"))
        return !members && room.fitted === room.total && room.total > 0 && extra;
    if (text.includes("can claim all remaining rewards"))
        return room.total > 0 && room.fitted === room.total;
    if (text.includes("not enough inventory slots to claim all"))
        return room.fitted > 0 && room.fitted < room.total;
    return null;
}
function action(event) {
    if (
        !isJon(event) ||
        !Common.current(event.player) ||
        Common.current(event.player).npc !== event.npc
    )
        return;
    const { player } = event;
    if (event.stepId === "hPtBlS") {
        event.handled = true;
        return;
    } // Canonical explanatory marker, followed by the real confirmation choice.
    if (event.stepId === "9XrrAG") {
        Journal.setEnabled(player, true);
        player.sendMessage("You have opted back into Adventure Paths.");
        event.handled = true;
        return;
    }
    if (event.stepId === "h9kLyj") {
        Journal.setEnabled(player, false);
        return;
    }
    if (
        event.kind === "message" &&
        event.text === "Adventurer Jon gives you a Combat path starter kit"
    ) {
        event.handled = true;
        if (Items.kit(player)) event.box = { items: [Items.id("adventurepath_combat_kit")] };
        else event.end = true;
        return;
    }
    if (event.action === "receive" && /player receives available/.test(event.text ?? "")) {
        event.handled = true;
        Rewards.claim(player, Items.recover(player));
    }
}
function line(event) {
    if (!isJon(event) || event.text !== "Of course, here you go.") return;
    const { player } = event,
        session = Common.current(player);
    if (!session) return;
    event.after = () => {
        Common.core.TaskManager.submit(
            new (class extends Common.core.Task {
                constructor() {
                    super(1, player, false);
                }
                execute() {
                    this.stop();
                    if (
                        Common.current(player) === session &&
                        !player.getDialogueManager().isActive() &&
                        player.getInterfaceId() < 0
                    )
                        Interface.open(player);
                }
            })(),
        );
    };
}
function attach(api) {
    api.onNpcDialogueVariant(variant);
    api.onNpcDialogueCondition(condition);
    api.onCustomEvent("npc-dialogue:action", action);
    api.onCustomEvent("npc-dialogue:line", line);
}
module.exports = { attach };
