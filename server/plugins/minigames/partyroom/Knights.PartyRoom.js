"use strict";

// The Wiki gives the price and tabletop dance. The six positions and four-tick cadence are
// from the Near-Reality reference, not a live capture; the room map has blocked tiles there.
const PRICE = 500;
const FIRST_X = 3043;
const COUNT = 6;
const TABLE_Y = 3378;
const SONG_INTERVAL = 4;
let api;
let core;
let active = null;

function init(pluginApi) {
  api = pluginApi;
  core = api.core;
}

/** Read the existing generated transcript without opening a player dialogue or copying its data. */
function songFor(player) {
  let song = null;
  api.emitCustomEvent("npc-dialogue:start", {
    player, npcId: core.NpcIdentifiers.KNIGHT_2,
    variant: { page: "Knight (Falador Party Room)", variant: "overhead-dialogue-song" },
    exact: true,
    select(steps) {
      song = steps.filter((step) => step.type === "line" && step.presentation === "overhead")
        .map(({ speaker, text }) => ({ speaker, text }));
      return [];
    },
  });
  if (song?.length !== 9 || song.some((line, index) =>
    !line.text || line.speaker !== (index === 8 ? "Party Pete" : "Knights"))) return null;
  return song;
}

function remove(performance) {
  let unresolved = false;
  for (const npc of performance.knights) {
    try {
      if (npc.isRegistered() && core.World.getNpcs().get(npc.getIndex()) === npc) {
        core.World.getNpcs().remove(npc);
      }
    } catch (error) {
      console.error("[party-room] Could not remove a knight", error);
    }
    if (npc.isRegistered() && core.World.getNpcs().get(npc.getIndex()) === npc) unresolved = true;
  }
  if (!unresolved && active === performance) active = null;
  return !unresolved;
}

/** Keep the performance reserved until cleanup succeeds; never spawn over unresolved actors. */
function cleanup(performance) {
  performance.stopping = true;
  if (remove(performance) || performance.cleanupScheduled) return;
  performance.cleanupScheduled = true;
  try {
    let attempts = 0;
    core.TaskManager.submit(new (class extends core.Task {
      constructor() { super(1, false); }
      execute() {
        if (remove(performance) || ++attempts >= 5) {
          performance.cleanupScheduled = false;
          this.stop();
        }
      }
    })());
  } catch (error) {
    performance.cleanupScheduled = false;
    console.error("[party-room] Could not schedule knight cleanup", error);
  }
}

function pete() {
  for (const npc of core.World.getNpcs()) {
    const loc = npc.getLocation();
    if (npc.getId() === core.NpcIdentifiers.PARTY_PETE && loc.getZ() === 0 &&
        Math.abs(loc.getX() - FIRST_X) <= 16 && Math.abs(loc.getY() - TABLE_Y) <= 16) return npc;
  }
  return null;
}

function start(player) {
  if (active) {
    player.sendMessage("The party room knights are already here!");
    return false;
  }
  const inventory = player.getInventory();
  const coins = core.ItemIdentifiers.COINS;
  if (inventory.getAmount(coins) < PRICE) {
    player.sendMessage("You need 500 coins for the knights to dance.");
    return false;
  }
  const song = songFor(player);
  if (!song) {
    player.sendMessage("The knights are not available right now.");
    return false;
  }
  const performance = { knights: [], song };
  active = performance;
  let coinSlots = null;
  try {
    for (let i = 0; i < COUNT; i++) {
      const npc = new core.NPC(core.NpcIdentifiers.KNIGHT_2, new core.Location(FIRST_X + i, TABLE_Y, 0));
      npc.__skipDefaultRespawn = true;
      npc.setScriptedMovement(true);
      npc.getMovementCoordinator().setRadius(0);
      npc.setFace(core.Direction.SOUTH);
      performance.knights.push(npc);
      if (!core.World.getNpcs().add(npc)) throw new Error("NPC capacity exhausted");
    }
    let line = 0;
    core.TaskManager.submit(new (class extends core.Task {
      constructor() { super(SONG_INTERVAL, false); }
      execute() {
        if (active !== performance || performance.stopping) { this.stop(); return; }
        try {
          if (line >= song.length) {
            this.stop();
            cleanup(performance);
            return;
          }
          const next = song[line++];
          const speaker = next.speaker === "Party Pete" ? pete() : performance.knights[2];
          speaker?.forceChat(next.text);
        } catch (error) {
          this.stop();
          console.error("[party-room] Knight performance failed", error);
          cleanup(performance);
        }
      }
    })());
    // Different coin stacks can carry different metadata. Restore the exact slots if debit fails.
    coinSlots = inventory.getItems().flatMap((item, slot) =>
      item?.getId() === coins ? [{ slot, item: item.clone() }] : []);
    inventory.deleted(coins, PRICE, false);
    inventory.refreshItems();
    return true;
  } catch (error) {
    // Deletion may have mutated the inventory before throwing. This transaction is synchronous,
    // so no other action can change these slots between snapshot and restoration.
    if (coinSlots) {
      try {
        for (const { slot, item } of coinSlots) inventory.setItem(slot, item);
        inventory.refreshItems();
      } catch (refundError) {
        console.error("[party-room] Could not finish the coin refund", refundError);
      }
    }
    cleanup(performance);
    console.error("[party-room] Could not start the knights", error);
    player.sendMessage("The knights are not available right now.");
    return false;
  }
}

function reset() {
  if (active) cleanup(active);
}

module.exports = { init, start, reset, performance: () => active };
