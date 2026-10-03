/**
 * Warriors' Guild: what the rooms share - the token ledger the staff pay out from, the ids every
 * room names, and small helpers for timing, speech and walking through the guild's doors.
 */
let core;

/** Filled from the generated identifiers once the plugin hands over `api`. */
const ITEMS = {};
const NPCS = {};

/** Set once by the plugin before any room attaches. */
function init(api) {
  core = api.core;
  const Items = core.ItemIdentifiers;
  const Npcs = core.NpcIdentifiers;
  Object.assign(ITEMS, {
    TOKEN: Items.WARRIOR_GUILD_TOKEN,
    DEFENSIVE_SHIELD: Items.DEFENSIVE_SHIELD,
    SHOT_18LB: Items._18LB_SHOT,
    SHOT_22LB: Items._22LB_SHOT,
    ONE_BARREL: Items.ONE_BARREL,
    GROUND_ASHES: Items.GROUND_ASHES,
    ATTACK_CAPES: [Items.ATTACK_CAPE, Items.ATTACK_CAPE_T_, Items.MAX_CAPE],
  });
  Object.assign(NPCS, {
    GHOMMAL: Npcs.GHOMMAL_3,
    HARRALLAK: Npcs.HARRALLAK_MENAROUS_5,
    SLOANE: Npcs.SLOANE_3,
    GAMFRED: Npcs.GAMFRED,
    AJJAT: Npcs.AJJAT,
    KAMFREENA: Npcs.KAMFREENA,
    SHANOMI: Npcs.SHANOMI,
    JIMMY: Npcs.JIMMY,
    REF_NORTH: Npcs.REF,
    REF_SOUTH: Npcs.REF_2,
    LORELAI: Npcs.LORELAI,
  });
}

/**
 * Tokens earned in the dummy, catapult and shot put rooms are written in the guild ledger and
 * collected from the training staff ("May I claim my tokens please?").
 */
const LEDGER_ATTRIBUTE = "warriors-guild:tokens";

function ledger(player) {
  return Number(player.getAttribute(LEDGER_ATTRIBUTE)) || 0;
}

function credit(player, amount) {
  player.setAttribute(LEDGER_ATTRIBUTE, ledger(player) + amount);
}

/** Pays the ledger out as tokens; false when there is nowhere to put them. */
function payOut(player) {
  const amount = ledger(player);
  const inventory = player.getInventory();
  if (amount <= 0 || (!inventory.contains(ITEMS.TOKEN) && inventory.getFreeSlots() === 0)) return false;
  inventory.adds(ITEMS.TOKEN, amount);
  player.setAttribute(LEDGER_ATTRIBUTE, 0);
  return true;
}

function baseLevel(player, skill) {
  return player.getSkillManager().getMaxLevel(skill);
}

/** Runs `action` after `ticks` game ticks (bound to `owner` so it stops on logout). */
function later(owner, ticks, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(ticks, owner ?? undefined, false); }
    execute() { this.stop(); action(); }
  })());
}

/** Calls `action` every tick until it returns true. */
function every(owner, action) {
  core.TaskManager.submit(new (class extends core.Task {
    constructor() { super(1, owner ?? undefined, false); }
    execute() { if (action() === true) this.stop(); }
  })());
}

function tile(x, y, z = 0) {
  return new core.Location(x, y, z);
}

function at(player, x, y, z) {
  const location = player.getLocation();
  return location.getX() === x && location.getY() === y && location.getZ() === z;
}

/** The nearest NPC with this id within `range` of the player, if any. */
function npcNear(player, npcId, range = 16) {
  const from = player.getLocation();
  let found = null;
  for (const npc of core.World.getNpcs()) {
    if (!npc || npc.getId() !== npcId || npc.getLocation().getZ() !== from.getZ()) continue;
    if (npc.getLocation().getDistance(from) <= range) found = npc;
  }
  return found;
}

/**
 * A short conversation outside the transcripts. Steps are `{ npc: id, text }`, `{ player: text }`,
 * `{ statement: text }` or a function, which runs when reached before the rest carries on.
 */
function talk(player, steps) {
  const chain = new core.DialogueChainBuilder();
  let index = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (typeof step === "function") {
      const rest = steps.slice(i + 1);
      chain.add(new core.ActionDialogue(index++, { execute: () => {
        step();
        if (rest.length) talk(player, rest);
        else player.getPacketSender().sendInterfaceRemoval();
      } }));
      player.getDialogueManager().startDialogues(chain);
      return;
    }
    if (step.npc !== undefined) {
      npcNear(player, step.npc)?.setPositionToFace(player.getLocation());
      chain.add(new core.NpcDialogue(index++, step.npc, step.text));
    } else if (step.player !== undefined) {
      chain.add(new core.PlayerDialogue(index++, step.player));
    } else {
      chain.add(new core.StatementDialogue(index++, step.statement));
    }
  }
  chain.add(new core.EndDialogue(index));
  player.getDialogueManager().startDialogues(chain);
}

/** A guild NPC turns to the player and speaks lines outside its transcript. */
function npcSays(player, npcId, ...lines) {
  talk(player, lines.map((text) => ({ npc: npcId, text })));
}

/** Plays a variant of the NPC's wiki transcript; false when the transcript lacks it. */
function playTranscript(api, player, npcId, variant) {
  npcNear(player, npcId)?.setPositionToFace(player.getLocation());
  const request = { player, npcId, npc: npcNear(player, npcId), variant, handled: false };
  api.emitCustomEvent("npc-dialogue:start", request);
  return request.handled;
}

/**
 * Walks the player one tile through a closed guild door: the door leaf is lifted for them while
 * they cross (as the Barrows doors do), and put back once they are through.
 */
const WALK_ANIMATION = 819;

function crossDoor(player, door, to) {
  if (player.getForceMovement()) return;
  const from = player.getLocation().clone();
  const dx = to.getX() - from.getX();
  const dy = to.getY() - from.getY();
  if (Math.abs(dx) + Math.abs(dy) !== 1) {
    player.moveTo(to);
    return;
  }
  player.getPacketSender().sendObjectRemoval(door);
  const direction = dy > 0 ? 0 : dx > 0 ? 1 : dy < 0 ? 2 : 3;
  // 30 client cycles is one tick; the task moves the player once it has played out.
  core.TaskManager.submit(new core.ForceMovementTask(player, 2,
    new core.ForceMovement(from, tile(dx, dy), 0, 30, direction, WALK_ANIMATION)));
  later(player, 3, () => player.getPacketSender().sendObject(door));
}

/** An NPC only `player` may fight, which never respawns. */
function spawnFor(player, npcId, location) {
  const npc = new core.NPC(npcId, location);
  npc.setOwner(player);
  npc.__skipDefaultRespawn = true;
  core.World.getAddNPCQueue().push(npc);
  return npc;
}

function despawn(npc) {
  npc.getCombat().reset();
  npc.__skipDefaultRespawn = true;
  const pending = core.World.getAddNPCQueue();
  if (pending.includes(npc)) pending.splice(pending.indexOf(npc), 1);
  else if (npc.isRegistered() && !core.World.getRemoveNPCQueue().includes(npc)) core.World.getRemoveNPCQueue().push(npc);
}

function wearing(player, slot, ...itemIds) {
  return itemIds.includes(player.getEquipment().getItems()[slot]?.getId());
}

/** Kamfreena and Lorelai let the Attack (or max) cape in without tokens. */
function wearsAttackCape(player) {
  return wearing(player, core.Equipment.CAPE_SLOT, ...ITEMS.ATTACK_CAPES);
}

function random(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function damage(player, amount) {
  player.getCombat().getHitQueue().addPendingDamage([new core.HitDamage(amount, core.HitMask.RED)]);
}

module.exports = {
  init, ITEMS, NPCS, LEDGER_ATTRIBUTE, ledger, credit, payOut, baseLevel, later, every, tile, at,
  npcNear, talk, npcSays, playTranscript, crossDoor, spawnFor, despawn, wearing, wearsAttackCape, random, damage,
  get core() { return core; },
};
