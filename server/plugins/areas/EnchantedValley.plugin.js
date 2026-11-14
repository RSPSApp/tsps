"use strict";

/**
 * Enchanted Valley (fairy ring B K Q): its trees are not choppable, and each attempt wakes the
 * tree spirit guarding them. https://oldschool.runescape.wiki/w/Enchanted_Valley
 *
 * The Wiki:
 * - Trying to chop a tree spawns a tree spirit that attacks the player and stops the tree being
 *   cut. While it is out, another attempt says "That tree spirit won't get any happier with you
 *   if you keep chopping trees!"
 * - It appears with "Leave these woods and never return!"
 * - Its level follows the player's combat level: 3-10 -> 14, 11-20 -> 29, 21-40 -> 49,
 *   41-60 -> 79, 61-90 -> 120, 91+ -> 159. These are cache NPCs 1861-1866.
 * - It despawns when the player is more than three tiles away.
 * - Each tree has one spirit: repeated attempts do not stack another.
 * Not built here: the guardians' reduced combat experience and fire-spell weakness, which belong
 * to the shared combat XP/weakness paths rather than this spawn.
 *
 * The Wiki does not say which tile it appears on. Ours takes a free tile beside the tree.
 */

const Woodcutting = require("../skills/Woodcutting.plugin");

/** More than this many tiles from the player who woke it and the spirit leaves. */
const DESPAWN_DISTANCE = 3;
const SPAWN_LINE = "Leave these woods and never return!";
const SPIRIT_ALREADY_OUT = "That tree spirit won't get any happier with you if you keep chopping trees!";

let api = null;
let core = null;
/** One live guardian per tree tile: "x,y,z" -> { npc, player }. */
const guardedTrees = new Map();
/** Its tree tile, for the death event. */
const spiritTrees = new Map();

/** The spirit for the player's combat level (the Wiki's level bands). */
function spiritId(combatLevel) {
    const { NpcIdentifiers: N } = core;
    if (combatLevel <= 10) return N.TREE_SPIRIT_2;
    if (combatLevel <= 20) return N.TREE_SPIRIT_3;
    if (combatLevel <= 40) return N.TREE_SPIRIT_4;
    if (combatLevel <= 60) return N.TREE_SPIRIT_5;
    if (combatLevel <= 90) return N.TREE_SPIRIT_6;
    return N.TREE_SPIRIT_7;
}

const treeKey = (location) => `${location.getX()},${location.getY()},${location.getZ()}`;

/** The tree's live spirit, dropping the entry if that NPC has gone. */
function spiritAt(key) {
    const entry = guardedTrees.get(key);
    if (!entry) return null;
    if (entry.npc.isRegistered?.() === true) return entry;
    guardedTrees.delete(key);
    spiritTrees.delete(entry.npc);
    return null;
}

function forget(key, entry) {
    if (guardedTrees.get(key) === entry) guardedTrees.delete(key);
    if (spiritTrees.get(entry.npc) === key) spiritTrees.delete(entry.npc);
}

/** A free tile beside the tree, not the chopper's own tile. */
function spawnTile(tree, player) {
    const region = api.getRegionManager();
    const area = player.getPrivateArea?.();
    const origin = player.getLocation();
    const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    const tiles = candidates
        .map(([dx, dy]) => new core.Location(tree.getX() + dx, tree.getY() + dy, tree.getZ()))
        .filter((tile) => !tile.equals(origin) && !region.blocked(tile, area));
    return tiles.length ? tiles[Math.floor(Math.random() * tiles.length)] : null;
}

/** Watches the spirit every tick: gone with its player, or when they walk more than 3 tiles off. */
function watch(key, entry) {
    core.TaskManager.submit(new (class extends core.Task {
        constructor() {
            super(1, entry.player, false);
        }

        execute() {
            this.stop();
            if (guardedTrees.get(key) !== entry) return;
            const { npc, player } = entry;
            if (!player.isRegistered?.() || player.getHitpoints() <= 0 || npc.isRegistered?.() !== true) {
                forget(key, entry);
                api.removeNpc(npc);
                return;
            }
            if (!npc.getLocation().isWithinDistance(player.getLocation(), DESPAWN_DISTANCE)) {
                forget(key, entry);
                api.removeNpc(npc);
                return;
            }
            watch(key, entry);
        }
    })());
}

/** Wakes the guardian for the tree the player tried to cut. */
function wakeSpirit(player, key, tree) {
    const tile = spawnTile(tree, player);
    if (!tile) return false;
    const npc = api.spawnNpc({
        id: spiritId(player.getSkillManager().getCombatLevel()),
        x: tile.getX(), y: tile.getY(), z: tile.getZ(),
        owner: player, wanderRadius: 0,
    });
    if (!npc) return false;
    const entry = { npc, player };
    guardedTrees.set(key, entry);
    spiritTrees.set(npc, key);
    npc.forceChat(SPAWN_LINE);
    npc.getCombat().attack(player);
    watch(key, entry);
    return true;
}

/** Chop-down: the tree is never felled; its first attempt wakes the guardian instead. */
function chopDown({ player, object }) {
    const request = { player, itemId: null, axe: null };
    api.emitCustomEvent("woodcutting:axe", request);
    if (!request.axe) {
        player.sendMessage(Woodcutting.NO_AXE_MESSAGE);
        return true;
    }
    const key = treeKey(object.getLocation());
    if (spiritAt(key)) {
        player.sendMessage(SPIRIT_ALREADY_OUT);
        return true;
    }
    wakeSpirit(player, key, object.getLocation());
    return true;
}

function spiritDied({ npc }) {
    const key = spiritTrees.get(npc);
    if (key === undefined) return;
    const entry = guardedTrees.get(key);
    if (entry) forget(key, entry);
}

function playerGone({ player }) {
    for (const [key, entry] of guardedTrees) {
        if (entry.player !== player) continue;
        forget(key, entry);
        api.removeNpc(entry.npc);
    }
}

function initialize(pluginApi) {
    api = pluginApi;
    core = pluginApi.core;
}

module.exports = {
    name: "EnchantedValley",
    description: "Enchanted Valley's trees: chopping wakes a level-scaled tree spirit instead of cutting the tree.",
    members: true,
    register(pluginApi) {
        initialize(pluginApi);
        pluginApi.onObjectFirstClick(core.ObjectIdentifiers.TREE_101, chopDown);
        pluginApi.onNpcDeath(spiritDied);
        pluginApi.onPlayerLogout(playerGone);
        pluginApi.onPlayerDisconnect(playerGone);
    },
    _test: { spiritId, spawnTile, treeKey, DESPAWN_DISTANCE, SPAWN_LINE, SPIRIT_ALREADY_OUT },
};
