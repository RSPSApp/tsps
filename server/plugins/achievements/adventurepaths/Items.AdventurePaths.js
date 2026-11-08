const Common = require("./Common.AdventurePaths");
const Rewards = require("./Rewards.AdventurePaths");
const Progress = require("./Progress.AdventurePaths");
const Data = require("./Data.AdventurePaths");
const pending = new WeakMap();
function id(name) {
    return Common.core.CacheDefinitions.getObjId(name);
}
function owns(player, itemId) {
    return (
        player.getInventory().contains(itemId) ||
        player.getEquipment().contains(itemId) ||
        player
            .getBanks()
            .some((b, i) => i !== Common.core.Bank.BANK_SEARCH_TAB_INDEX && b?.contains(itemId))
    );
}
function canKit(player) {
    const s = Common.state(player);
    return !s.kitOpened && !owns(player, id("adventurepath_combat_kit"));
}
function kit(player) {
    if (!Common.current(player) || !Progress.active(player) || !canKit(player)) return false;
    if (!Rewards.grant(player, [{ id: id("adventurepath_combat_kit"), amount: 1 }])) {
        player.getInventory().full();
        return false;
    }
    const s = Common.state(player);
    if (!s.kits.includes(0)) s.kits.push(0);
    Common.save(player);
    Progress.sync(player);
    return true;
}
function kitContents() {
    const I = Common.core.ItemIdentifiers;
    return [
        [I.IRON_MED_HELM, 1],
        [I.IRON_CHAINBODY, 1],
        [I.IRON_PLATELEGS, 1],
        [I.IRON_LONGSWORD, 1],
        [I.WIZARD_HAT, 1],
        [I.BLACK_ROBE, 1],
        [I.BLACK_SKIRT, 1],
        [I.STAFF, 1],
        [I.AIR_RUNE, 40],
        [I.MIND_RUNE, 40],
        [I.BRONZE_ARROW, 75],
        [I.LEATHER_VAMBRACES, 1],
    ].map(([id, amount]) => ({ id, amount }));
}
function itemAction(event) {
    const { player, item, itemId, slot, option } = event;
    if (
        ![
            id("adventurepath_combat_kit"),
            id("adventurepath_gatherer_lamp"),
            id("adventurepath_combat_voucher"),
        ].includes(itemId)
    )
        return false;
    if (!["Search", "Rub", "Read"].includes(option)) return false;
    event.handled = true;
    if (
        !Common.eligible(player) ||
        !item ||
        item.getId() !== itemId ||
        player.isNeedsPlacement() ||
        player.isTeleportingReturn() ||
        player.getForceMovement() ||
        player.getInventory().forSlot(slot) !== item ||
        item.getMeta() ||
        player.busy() ||
        player.getHitpoints() <= 0
    )
        return true;
    const s = Common.state(player);
    if (itemId === id("adventurepath_combat_voucher") && option === "Read") {
        if (!s.paths.includes(0)) return true;
        syncVoucher(player);
        player
            .getPacketSender()
            .sendInterface(Common.core.CacheDefinitions.getInterfaceId("adventurepath_reward"));
        player
            .getPacketSender()
            .sendClientScript(3509, 0, Common.core.CacheDefinitions.getItem(itemId).name);
        return true;
    }
    if (itemId === id("adventurepath_combat_kit") && option === "Search") {
        if (s.kitOpened || !s.kits.includes(0)) return true;
        const source = player
            .getInventory()
            .getItems()
            .map((i) => i.clone());
        source[slot] = new Common.core.Item(-1, 0);
        const copy = Rewards.plan(player, kitContents(), source);
        if (!copy) {
            player.getInventory().full();
            return true;
        }
        player
            .getInventory()
            .getItems()
            .splice(0, copy.length, ...copy);
        s.kitOpened = true;
        player.getInventory().refreshItems();
        Common.save(player);
        return true;
    }
    if (itemId === id("adventurepath_gatherer_lamp") && option === "Rub") {
        if (!s.paths.includes(1) || s.lampUsed) return true;
        const request = { item, slot, state: s };
        pending.set(player, request);
        Common.api.emitCustomEvent("xpreward:open", {
            player,
            skills: [
                Common.core.Skill.FISHING,
                Common.core.Skill.WOODCUTTING,
                Common.core.Skill.MINING,
            ],
            onConfirm: (skill) => lamp(player, request, skill),
        });
        return true;
    }
    return true;
}
function lamp(player, request, skill) {
    const s = Common.state(player);
    if (
        pending.get(player) !== request ||
        s !== request.state ||
        !Common.eligible(player) ||
        s.lampUsed ||
        player.getInventory().forSlot(request.slot) !== request.item ||
        request.item.getId() !== id("adventurepath_gatherer_lamp") ||
        request.item.getMeta() ||
        player.getHitpoints() <= 0 ||
        player.getStatus() !== Common.core.PlayerStatus.NONE ||
        player.isNeedsPlacement() ||
        player.isTeleportingReturn() ||
        player.getForceMovement() ||
        ![
            Common.core.Skill.FISHING,
            Common.core.Skill.WOODCUTTING,
            Common.core.Skill.MINING,
        ].includes(skill)
    )
        return null;
    pending.delete(player);
    const manager = player.getSkillManager(),
        before = manager.getExperience(skill);
    manager.addExperience(skill, 150, false);
    if (manager.getExperience(skill) === before) return null;
    player.getInventory().deleteAtSlot(request.slot, 1);
    s.lampUsed = true;
    Common.save(player);
    return "You have been awarded 150 " + skill.getName() + " XP!";
}
function syncVoucher(player) {
    const s = Common.state(player);
    player.getPacketSender().sendConfig(
        Common.core.CacheDefinitions.getVarpId("adventurepath_reward_bit_1"),
        s.vouchers.reduce((n, id) => n | (1 << id), 0),
    );
}
function redeem(event, talk = false) {
    const player = event.player,
        npc = event.target ?? event.npc;
    if (
        !player ||
        !npc ||
        !Common.eligible(player) ||
        !Common.near(player, npc) ||
        player.getStatus() !== Common.core.PlayerStatus.NONE
    )
        return;
    const s = Common.state(player);
    if (!s.paths.includes(0)) return;
    const entry = Data.vouchers().find(
        (row) => row.ids.has(npc.getId()) || row.ids.has(npc.getContentId(player)),
    );
    if (!entry) return;
    const voucherId = id("adventurepath_combat_voucher"),
        inventory = player.getInventory(),
        voucher = event.item ?? inventory.getValidItems().find((i) => i.getId() === voucherId);
    if (!voucher || voucher.getId() !== voucherId || voucher.getMeta()) return;
    const originalSlot = event.slot ?? inventory.getItems().indexOf(voucher);
    if (inventory.forSlot(originalSlot) !== voucher) return;
    const members = Common.core.WorldDefinition.isMembersWorld();
    // Nothing left to claim from this NPC on this world: a Talk-to is the NPC's own conversation again.
    const unclaimed = [entry.free, members ? entry.members : null]
        .filter(Boolean)
        .filter((offer) => !s.vouchers.includes(offer.key));
    if (talk && unclaimed.length === 0) return;
    event.handled = true;
    const required = Data.vouchers()
            .flatMap((row) => [row.free, members ? row.members : null])
            .filter(Boolean)
            .map((o) => o.key);
    let moved = false;
    for (const offer of [entry.free, members ? entry.members : null].filter(Boolean)) {
        if (s.vouchers.includes(offer.key)) continue;
        const source = inventory.getItems().map((i) => i.clone()),
            last = required.every((k) => k === offer.key || s.vouchers.includes(k));
        if (last) source[originalSlot] = new Common.core.Item(-1, 0);
        const copy = Rewards.plan(player, offer.items, source);
        if (!copy) continue;
        inventory.getItems().splice(0, copy.length, ...copy);
        s.vouchers.push(offer.key);
        moved = true;
    }
    if (moved) {
        inventory.refreshItems();
        syncVoucher(player);
        Common.save(player);
        player.sendMessage("You have received your Adventure Path voucher rewards.");
    } else
        player.sendMessage("No voucher rewards can be claimed here with your current inventory.");
}
function talkRedeem(event) {
    if (event.definition?.getActions()?.[(event.clickType ?? 1) - 1]?.toLowerCase() === "talk-to")
        redeem(event, true);
}
function recoverable(player) {
    const s = Common.state(player);
    const items = [];
    if (s.kits.includes(0) && canKit(player)) items.push(id("adventurepath_combat_kit"));
    if (s.paths.includes(1) && !s.lampUsed && !owns(player, id("adventurepath_gatherer_lamp")))
        items.push(id("adventurepath_gatherer_lamp"));
    const members = Common.core.WorldDefinition.isMembersWorld();
    if (
        s.paths.includes(0) &&
        Data.vouchers().some((r) =>
            [r.free, members ? r.members : null]
                .filter(Boolean)
                .some((o) => !s.vouchers.includes(o.key)),
        ) &&
        !owns(player, id("adventurepath_combat_voucher"))
    )
        items.push(id("adventurepath_combat_voucher"));
    return items;
}
function recover(player) {
    if (!Common.current(player) || !Progress.active(player)) return false;
    let moved = false;
    for (const itemId of recoverable(player))
        if (Rewards.grant(player, [{ id: itemId, amount: 1 }])) moved = true;
    if (moved) Common.save(player);
    return moved;
}
function logout({ player }) {
    pending.delete(player);
}
function attach(api) {
    api.onItemAction(itemAction);
    api.onItemOnNpc(redeem);
    api.onBeforeNpcInteraction(talkRedeem);
    api.onPlayerLogout(logout);
}
module.exports = { attach, recoverable, recover, syncVoucher, kit, canKit, owns, id };
