const core = require("./Core.Farming");
const Patches = require("./Patches.Farming");
const Data = require("./Data.Farming");

// Cache241: scripts2813/2820 read inventories93/626 and seed-category obj param709.
const CAPACITY = 104;
const CATEGORY_PARAM = 709;
const MAX_AMOUNT = 2147483647;
const SLOT_MASK = (1 << 28) - 1;
const SESSIONS = new WeakMap();
const uid = (name) => core.CacheDefinitions.getComponentId(name);
const group = (name) => core.CacheDefinitions.getInterfaceId(name);
const bit = (name) => core.CacheDefinitions.getVarbitId("seed_vault_" + name);
const varp = (name) => core.CacheDefinitions.getVarpId("seed_vault_" + name);

function eligible(id) {
    if (!Number.isInteger(id) || id <= 0 || id >= core.CacheDefinitions.getCounts().items)
        return false;
    const item = core.CacheDefinitions.getItem(id),
        category = item.params?.get(CATEGORY_PARAM);
    return (
        item.noteTemplate < 0 &&
        item.placeholderTemplate < 0 &&
        Number.isInteger(category) &&
        category >= 1 &&
        category <= 11
    );
}
function plain(id) {
    if (!Number.isInteger(id) || id <= 0 || id >= core.CacheDefinitions.getCounts().items)
        return -1;
    const definition = core.CacheDefinitions.getItem(id);
    return definition.noteTemplate >= 0 ? definition.note : id;
}
function held(farm, id) {
    const n = farm.vault?.[id];
    return Number.isSafeInteger(n) && n >= 0 && n <= MAX_AMOUNT ? n : 0;
}
function recoverLegacy(player, farm) {
    const inventory = player.getInventory();
    let moved = false, remaining = false;
    for (const key of Object.keys(farm.vault ?? {})) {
        const id = Number(key), balance = held(farm, id);
        // Only recover plain crop seeds/saplings accepted by the old deposit producer.
        // Category-less items cannot be displayed by the native cache scripts.
        if (!balance || eligible(id) || plain(id) !== id ||
            ![...Data.CROPS.values()].some(c => c.seed === id || c.sapling === id)) continue;
        const item = new core.Item(id, balance);
        const amount = Math.min(balance, inventory.getAddableAmount(item));
        if (amount > 0) {
            inventory.add(item.setAmount(amount), false);
            farm.vault[id] = balance - amount;
            moved = true;
            player.sendMessage(`${amount} ${core.CacheDefinitions.getItem(id).name} returned from your old Seed Vault storage.`);
        }
        remaining ||= held(farm, id) > 0;
    }
    if (moved) {
        inventory.refreshItems();
        core.PluginManager.emitCustomEvent("persistence:save", { player, reason: "seed-vault-legacy-recovery" });
    }
    if (remaining) player.sendMessage("Make room in your inventory and reopen the Seed Vault to recover the remaining old items.");
}
function prepare(farm) {
    farm.vault ??= {};
    farm.vaultSettings ??= { quantity: 1, custom: 0, favourites: [] };
    const settings = farm.vaultSettings;
    if (
        !Number.isSafeInteger(settings.quantity) ||
        settings.quantity <= 0 ||
        settings.quantity > MAX_AMOUNT
    )
        settings.quantity = 1;
    if (
        !Number.isSafeInteger(settings.custom) ||
        settings.custom < 0 ||
        settings.custom > MAX_AMOUNT
    )
        settings.custom = 0;
    if (!Number.isInteger(settings.locks) || settings.locks < 0 || settings.locks > SLOT_MASK)
        settings.locks = 0;
    settings.favourites = [...new Set((settings.favourites ?? []).filter(eligible))].slice(0, 8);
    const seen = new Set();
    farm.vaultOrder = Array.from({ length: CAPACITY }, (_, i) => {
        const id = farm.vaultOrder?.[i];
        if (!eligible(id) || seen.has(id)) return null;
        seen.add(id);
        return id;
    });
    for (const key of Object.keys(farm.vault)) {
        const id = Number(key);
        if (!eligible(id) || !held(farm, id) || seen.has(id)) continue;
        const free = farm.vaultOrder.indexOf(null);
        if (free < 0) break;
        farm.vaultOrder[free] = id;
        seen.add(id);
    }
}
function sync(player) {
    const farm = Patches.farmFor(player),
        sender = player.getPacketSender();
    prepare(farm);
    const contract = farm.contract,
        crop = contract && Data.CROPS.get(contract.crop);
    const contractType = crop ? core.CacheDefinitions.getItem(crop.seed).params?.get(895) : 0;
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("farmguild_contract_type"),
        Number.isInteger(contractType) ? contractType : 0,
    );
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("farmguild_contract_complete"),
        contract?.complete ? 1 : 0,
    );
    sender.sendInventory(
        core.CacheDefinitions.getInventoryId("seed_vault"),
        CAPACITY,
        farm.vaultOrder.map((id) => {
            if (!id) return null;
            const count = held(farm, id);
            return {
                id: count ? id : core.CacheDefinitions.getItem(id).placeholder,
                amount: count || 1,
            };
        }),
    );
    sender.sendConfig(varp("selected_qty"), farm.vaultSettings.quantity);
    sender.sendConfig(varp("requested_qty"), farm.vaultSettings.custom);
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("bank_side_slot_overview"),
        farm.vaultSettings.locks,
    );
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("bank_side_slot_ignoreinvlocks"),
        farm.vaultSettings.ignoreLocks ? 1 : 0,
    );
    sender.sendVarbit(
        core.CacheDefinitions.getVarbitId("bank_side_slot_showop"),
        farm.vaultSettings.showLockOps ? 1 : 0,
    );
    for (let i = 0; i < 8; i++) {
        const slot = farm.vaultOrder.indexOf(farm.vaultSettings.favourites[i]);
        sender.sendVarbit(bit("fave" + (i + 1)), slot < 0 ? 255 : slot);
    }
}
/** Able to use the vault: standing, and within 5 tiles of it (`anywhere`: content that carries it, a league relic's vault). */
function near(player, object, anywhere = false) {
    return (
        player.getHitpoints() > 0 &&
        player.getStatus() === core.PlayerStatus.NONE &&
        !player.isNeedsPlacement() &&
        !player.isTeleportingReturn() &&
        !player.getForceMovement() &&
        (anywhere || player.getLocation().isWithinDistance(object.getLocation(), 5))
    );
}
function ultimate(player) {
    const query = { player, mode: "none" };
    core.PluginManager.emitCustomEvent("ironman:mode", query);
    if (query.mode !== "ultimate") return false;
    // Use the existing bank restriction's refusal side effects for this mode.
    core.PluginManager.emitCanBank(player, "seed-vault");
    return true;
}
function current(player) {
    const session = SESSIONS.get(player);
    if (!session || ultimate(player)) return null;
    const sender = player.getPacketSender();
    return session.farm === Patches.farmFor(player) &&
        near(player, session.object, session.anywhere) &&
        player.getInterfaceId() === group("seed_vault") &&
        sender.isSubInterfaceOpen(group("seed_vault")) &&
        sender.isSubInterfaceOpen(group("seed_vault_deposit"))
        ? session
        : null;
}
/** Opens the vault at `object`, or anywhere with `event.anywhere`. */
function open(event) {
    const { player, object } = event;
    const anywhere = event.anywhere === true;
    if (!anywhere && !player.getLocation().isWithinDistance(object.getLocation(), 5)) return;
    if (ultimate(player)) return;
    // Do not create storage state or expose its contents until the shared PIN guard succeeds.
    const request = { player, feature: "seed-vault", resume: () => open(event) };
    core.PluginManager.emitCustomEvent("bank-pin:guard", request);
    if (request.locked || !near(player, object, anywhere) || (player.busy() && !current(player))) return;
    const farm = Patches.farmFor(player);
    recoverLegacy(player, farm);
    SESSIONS.set(player, { farm, object, event, anywhere });
    player.setEnteredAmountAction(null);
    sync(player);
    const sender = player.getPacketSender();
    // RSProx232/03150,238/04222: native inventory before modal, and both modal panels.
    sender.sendInterfaceScript(917, [-1, -2]);
    sender.sendInterface(group("seed_vault"));
    sender.sendSubInterface(uid("toplevel_osrs_stretch:sidemodal"), group("seed_vault_deposit"), 0);
    sender.sendVarbit(bit("category"), 12);
    for (const name of ["obj_list", "text_list"])
        sender.sendInterfaceFlagsRange(
            uid("seed_vault:" + name),
            0,
            CAPACITY - 1,
            2046 | (3 << 17) | (1 << 20),
        );
    sender.sendInterfaceFlagsRange(uid("seed_vault:category_list"), 0, 12, 1 << 1);
    sender.sendInterfaceFlagsRange(
        uid("seed_vault_deposit:inv"),
        0,
        27,
        254 | (1 << 9) | (1 << 10),
    );
    player.getInventory().refreshItems();
}
function guarded(player, session) {
    if (current(player) !== session) return false;
    const request = {
        player,
        feature: "seed-vault",
        resume: () => {
            if (
                SESSIONS.get(player) === session &&
                session.farm === Patches.farmFor(player) &&
                near(player, session.object, session.anywhere)
            )
                open(session.event);
        },
    };
    core.PluginManager.emitCustomEvent("bank-pin:guard", request);
    return !request.locked && current(player) === session;
}
/** Refresh only an existing visible vault; do not open it or prompt for a PIN. */
function refreshOpen(player) {
    if (current(player)) sync(player);
}
function changed(player) {
    player.getInventory().refreshItems();
    sync(player);
    core.PluginManager.emitCustomEvent("persistence:save", { player, reason: "seed-vault" });
}
function deposit(player, session, requested, slot, expected, expectedId) {
    if (!guarded(player, session)) return;
    const inventory = player.getInventory(),
        farm = session.farm;
    if (
        slot !== undefined &&
        (inventory.forSlot(slot) !== expected || expected.getId() !== expectedId)
    )
        return;
    const items = inventory.getItems().map((item) => item?.clone());
    const balances = { ...farm.vault },
        order = [...farm.vaultOrder];
    let moved = 0;
    for (let i = 0; i < items.length; i++) {
        if (slot !== undefined && i !== slot) continue;
        if (
            slot === undefined &&
            !farm.vaultSettings.ignoreLocks &&
            farm.vaultSettings.locks & (1 << i)
        )
            continue;
        const item = items[i];
        if (!item || item.getId() <= 0 || item.getAmount() <= 0 || item.getMeta()) continue;
        const id = plain(item.getId());
        if (!eligible(id)) continue;
        let index = order.indexOf(id);
        if (index < 0) index = order.indexOf(null);
        if (index < 0) continue;
        const balance =
            Number.isSafeInteger(balances[id]) && balances[id] >= 0 && balances[id] <= MAX_AMOUNT
                ? balances[id]
                : 0;
        const count = Math.min(item.getAmount(), requested, MAX_AMOUNT - balance);
        if (count <= 0) continue;
        order[index] = id;
        balances[id] = balance + count;
        item.setAmount(item.getAmount() - count);
        if (!item.getAmount()) items[i] = new core.Item(-1, 0);
        moved += count;
    }
    // A complete slot-by-slot plan: metadata/preset copies never disappear through delete-by-id.
    if (moved) {
        inventory.getItems().splice(0, items.length, ...items);
        farm.vault = balances;
        farm.vaultOrder = order;
        changed(player);
        if (slot === undefined)
            player.sendMessage("All of your seeds and saplings were deposited.");
    } else player.sendMessage("No eligible seeds or saplings could be deposited.");
}
function withdraw(player, session, id, requested, noted) {
    if (!guarded(player, session) || !eligible(id)) return;
    const inventory = player.getInventory(),
        farm = session.farm;
    const itemId = noted ? core.CacheDefinitions.getItem(id).note : id;
    if (itemId < 0) return;
    const item = new core.Item(itemId, Math.min(held(farm, id), requested));
    const count = Math.min(item.getAmount(), inventory.getAddableAmount(item));
    if (count <= 0) {
        inventory.full();
        return;
    }
    inventory.add(item.setAmount(count), false);
    farm.vault[id] -= count;
    changed(player);
}
function prompt(player, session, select, done) {
    const action = {
        acceptsZero: true,
        execute(amount) {
            if (player.getEnteredAmountAction() !== action) return;
            player.setEnteredAmountAction(null);
            if (!guarded(player, session) || !Number.isSafeInteger(amount) || amount <= 0) return;
            amount = Math.min(MAX_AMOUNT, amount);
            session.farm.vaultSettings.custom = amount;
            if (select) session.farm.vaultSettings.quantity = amount;
            done(amount);
            sync(player);
        },
    };
    player.setEnteredAmountAction(action);
    player.getPacketSender().sendEnterAmountPrompt("How many would you like to transfer?");
}
function forget(farm, slot) {
    const id = farm.vaultOrder[slot];
    farm.vaultOrder[slot] = null;
    farm.vaultSettings.favourites = farm.vaultSettings.favourites.filter((entry) => entry !== id);
}
function lockPopup(player, session) {
    session.popup = true;
    const sender = player.getPacketSender();
    sender.sendSubInterface(uid("seed_vault:popup"), group("bank_side_locks"), 0);
    // Cache241 script7784 builds the existing bank-side lock editor in the supplied popup host.
    sender.sendClientScript(7784, uid("seed_vault:popup"));
    sender.sendInterfaceFlagsRange(uid("bank_side_locks:slots"), 0, 27, 1 << 1);
    for (const name of ["ignorelocks", "extraoptions", "done"])
        sender.sendInterfaceFlagsRange(uid("bank_side_locks:" + name), -1, -1, 1 << 1);
}
function lockClick(player, session, buttonId, slot, action) {
    if (
        !session.popup ||
        !player.getPacketSender().isSubInterfaceOpen(group("bank_side_locks")) ||
        action !== 1
    )
        return;
    const settings = session.farm.vaultSettings;
    if (buttonId === uid("bank_side_locks:done")) {
        session.popup = false;
        player.getPacketSender().closeSubInterface(uid("seed_vault:popup"));
        return;
    }
    if (buttonId === uid("bank_side_locks:slots")) {
        if (settings.ignoreLocks || !Number.isInteger(slot) || slot < 0 || slot >= 28) return;
        settings.locks ^= 1 << slot;
    } else if (buttonId === uid("bank_side_locks:ignorelocks"))
        settings.ignoreLocks = !settings.ignoreLocks;
    else if (buttonId === uid("bank_side_locks:extraoptions"))
        settings.showLockOps = !settings.showLockOps;
    else return;
    changed(player);
}
function click(event) {
    const { player, buttonId, slot, itemId, action } = event;
    const main = buttonId >>> 16 === group("seed_vault"),
        side = buttonId >>> 16 === group("seed_vault_deposit");
    const popup = buttonId >>> 16 === group("bank_side_locks");
    if (!main && !side && !popup) return;
    event.handled = true;
    const session = current(player);
    if (
        !session ||
        !guarded(player, session) ||
        !Number.isInteger(action) ||
        action < 1 ||
        action > 10
    )
        return;
    player.setEnteredAmountAction(null);
    const farm = session.farm,
        settings = farm.vaultSettings;
    if (popup) {
        lockClick(player, session, buttonId, slot, action);
        return;
    }
    if (main) {
        if (buttonId === uid("seed_vault:lock_menu")) {
            if (action === 1) lockPopup(player, session);
            return;
        }
        const quantities = { x1: 1, x5: 5, x10: 10, xall: MAX_AMOUNT };
        for (const [name, quantity] of Object.entries(quantities))
            if (buttonId === uid("seed_vault:" + name)) {
                if (action === 1) {
                    settings.quantity = quantity;
                    changed(player);
                }
                return;
            }
        if (buttonId === uid("seed_vault:xx")) {
            if (action === 2 || (action === 1 && !settings.custom))
                prompt(player, session, true, () => changed(player));
            else if (action === 1) {
                settings.quantity = settings.custom;
                changed(player);
            }
            return;
        }
        if (buttonId === uid("seed_vault:search")) return; // Script2865 owns local text input and filtering.
        if (buttonId === uid("seed_vault:category_list")) {
            const offset =
                player
                    .getPacketSender()
                    .getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_type")) > 0 &&
                player
                    .getPacketSender()
                    .getVarbit(core.CacheDefinitions.getVarbitId("farmguild_contract_complete")) ===
                    0
                    ? 1
                    : 0;
            const category = slot === 0 && offset ? 12 : slot - offset;
            if (action === 1 && Number.isInteger(slot) && category >= 0 && category <= 12)
                player.getPacketSender().sendVarbit(bit("category"), category);
            return;
        }
        if (buttonId === uid("seed_vault:deposit_all")) {
            if (action === 1) deposit(player, session, MAX_AMOUNT);
            return;
        }
        if (![uid("seed_vault:obj_list"), uid("seed_vault:text_list")].includes(buttonId)) return;
        if (!Number.isInteger(slot) || slot < 0 || slot >= CAPACITY) return;
        const id = farm.vaultOrder[slot];
        if (!id) return;
        const count = held(farm, id),
            displayed = count ? id : core.CacheDefinitions.getItem(id).placeholder;
        if (itemId > 0 && itemId !== displayed) return;
        if (action === 10) {
            player.sendMessage(core.ItemDefinition.forId(id).getExamine());
            return;
        }
        if (!count) {
            if (action === 8) forget(farm, slot);
            else if (action === 9) {
                for (let i = 0; i < CAPACITY; i++)
                    if (farm.vaultOrder[i] && !held(farm, farm.vaultOrder[i])) forget(farm, i);
            } else return;
            changed(player);
            return;
        }
        if (action === 8) {
            const index = settings.favourites.indexOf(id);
            if (index >= 0) settings.favourites.splice(index, 1);
            else if (settings.favourites.length < 8) settings.favourites.push(id);
            changed(player);
            return;
        }
        if (action === 6) {
            prompt(player, session, false, (n) => withdraw(player, session, id, n, false));
            return;
        }
        const requested =
            action === 9
                ? settings.quantity
                : [settings.quantity, 1, 5, 10, settings.custom, 0, MAX_AMOUNT][action - 1];
        if (requested > 0) withdraw(player, session, id, requested, action === 9);
    } else if (buttonId === uid("seed_vault_deposit:inv")) {
        if (!Number.isInteger(slot) || slot < 0 || slot >= player.getInventory().capacity()) return;
        if (action === 9) {
            if (!settings.ignoreLocks && settings.showLockOps) {
                settings.locks ^= 1 << slot;
                changed(player);
            }
            return;
        }
        const item = player.getInventory().forSlot(slot);
        if (!item || item.getId() <= 0 || (itemId > 0 && itemId !== item.getId())) return;
        if (action === 10) {
            player.sendMessage(core.ItemDefinition.forId(item.getId()).getExamine());
            return;
        }
        const originalId = item.getId();
        if (action === 6) {
            prompt(player, session, false, (n) =>
                deposit(player, session, n, slot, item, originalId),
            );
            return;
        }
        const requested = [settings.quantity, 1, 5, 10, settings.custom, 0, MAX_AMOUNT][action - 1];
        if (requested > 0) deposit(player, session, requested, slot, item, originalId);
    }
}
function drag(event) {
    const { player, packet } = event;
    if (packet.type !== "widget_drag" || packet.sourceWidgetId >>> 16 !== group("seed_vault"))
        return;
    event.handled = true;
    const session = current(player),
        widgets = [uid("seed_vault:obj_list"), uid("seed_vault:text_list")];
    if (
        !session ||
        !guarded(player, session) ||
        !widgets.includes(packet.sourceWidgetId) ||
        !widgets.includes(packet.targetWidgetId)
    )
        return;
    const from = packet.sourceSlot,
        to = packet.targetSlot,
        order = session.farm.vaultOrder;
    if (![from, to].every((n) => Number.isInteger(n) && n >= 0 && n < CAPACITY) || !order[from])
        return;
    const display = (id) =>
        id ? (held(session.farm, id) ? id : core.CacheDefinitions.getItem(id).placeholder) : -1;
    if (
        (packet.sourceItemId > 0 && packet.sourceItemId !== display(order[from])) ||
        (packet.targetItemId > 0 && packet.targetItemId !== display(order[to]))
    )
        return;
    player.setEnteredAmountAction(null);
    [order[from], order[to]] = [order[to], order[from]];
    changed(player);
}
function logout({ player }) {
    SESSIONS.delete(player);
}
Object.assign(module.exports, { open, click, drag, logout, eligible, held, refreshOpen });
