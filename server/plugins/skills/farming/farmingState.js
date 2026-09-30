/**
 * Per-player farming state: persistence, varbit rendering and patch state helpers.
 *
 * State lives in one JSON attribute (registered by Farming.plugin.js) so it saves
 * with the player through every persistence backend. Patch entries keep the crop's
 * logical state; farmingValues turns that into the varbit value the client renders.
 */
const { displayValue } = require("./farmingValues");

const STATE_ATTRIBUTE = "farming.patches";
const SAPLING_ATTRIBUTE = "farming.saplings";

const REFRESH_RADIUS = 16;

// player -> patchKey -> last value sent, so per-tick refreshes stay quiet.
const sentValues = new WeakMap();

module.exports = function buildState(core) {
    const { GameObject, Location } = core;

    // patchKey -> GameObjects for every loc tile the patch occupies.
    const patchObjects = new Map();

    function objectsFor(patch) {
        let objects = patchObjects.get(patch.key);
        if (!objects) {
            objects = patch.placements.map(
                ([x, y, z, type, face]) => new GameObject(patch.id, new Location(x, y, z), type, face, null),
            );
            patchObjects.set(patch.key, objects);
        }
        return objects;
    }

    function entryFor(player, patch) {
        const all = player.getAttribute(STATE_ATTRIBUTE) ?? {};
        return all[patch.key] ?? { w: 0, crop: null };
    }

    function save(player, patch, entry) {
        const all = player.getAttribute(STATE_ATTRIBUTE) ?? {};
        all[patch.key] = entry;
        player.setAttribute(STATE_ATTRIBUTE, all);
    }

    function binValue(bin) {
        if (!bin || bin.fill <= 0) {
            return 0;
        }
        const superKind = bin.kind === "SUPERCOMPOST";
        if (bin.state === "rot") {
            return superKind ? 126 : 94;
        }
        if (bin.state === "ready") {
            return (superKind ? 48 : 16) + Math.min(bin.taken ?? 0, 14);
        }
        return (superKind ? 33 : 1) + Math.min(bin.fill, 15) - 1;
    }

    function valueFor(patch, entry) {
        if (patch.type === "COMPOST") {
            return binValue(entry.bin);
        }
        return displayValue(patch.type, entry);
    }

    function refresh(player, patch, entry) {
        const state = entry ?? entryFor(player, patch);
        const value = valueFor(patch, state);
        let cache = sentValues.get(player);
        if (!cache) {
            cache = new Map();
            sentValues.set(player, cache);
        }
        const previous = cache.get(patch.key);
        if (previous === value) {
            return;
        }
        cache.set(patch.key, value);
        if (previous === undefined && value === 0) {
            // The client's cache default is already the untouched model.
            return;
        }
        const sender = player.getPacketSender();
        // The client only re-reads a loc's transform when its geometry is
        // rebuilt, so bounce the patch: set the varbit, remove and re-add.
        sender.sendVarbit(patch.varbit, value);
        for (const object of objectsFor(patch)) {
            sender.sendObjectRemoval(object);
            sender.sendObject(object);
        }
    }

    /**
     * Send every patch near the player, furthest first so the closest one wins for
     * shared transmit varbits. Called each process tick; unchanged patches are skipped.
     */
    function refreshNearby(player, patches) {
        const location = player.getLocation();
        const near = patches.PATCHES.filter(
            (patch) =>
                patch.z === location.getZ() &&
                Math.abs(patch.x - location.getX()) <= REFRESH_RADIUS &&
                Math.abs(patch.y - location.getY()) <= REFRESH_RADIUS,
        );
        near.sort((a, b) => distance(b, location) - distance(a, location));
        for (const patch of near) {
            refresh(player, patch);
        }
    }

    function distance(patch, location) {
        return Math.max(Math.abs(patch.x - location.getX()), Math.abs(patch.y - location.getY()));
    }

    return {
        STATE_ATTRIBUTE,
        SAPLING_ATTRIBUTE,
        entryFor,
        save,
        refresh,
        refreshNearby,
        valueFor,
    };
};
