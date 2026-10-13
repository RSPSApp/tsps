"use strict";

/**
 * The generals' chambers: the doors, the private instances and the altars.
 *
 * - Open: into the shared chamber for 40 of the god's essence, or an ecumenical key when the
 *   essence is short ("Your ecumenical key melts into the door.", captured). From inside, the
 *   door lets the player out. An Ironman finds the shared chamber closed while someone fights
 *   there (captured message).
 * - The instance option: a private copy of the chamber for 150,000 coins on top of the essence.
 *   tsps has no Combat Achievements, so the Hard tier's price applies to everyone. As captured,
 *   godwars_fader_init fades the overlay, the chamber is rebuilt a tick later around the same
 *   inside tile, and varbit godwars_instance is 1 while in it.
 * - Peek: how many adventurers are in the shared chamber.
 * - Altars: Pray restores Prayer, plus one point per item of the god worn, once every 10 minutes
 *   and not in combat; Teleport leaves the chamber, in combat too (Wiki).
 */
const fs = require("fs");
const path = require("path");
const Combat = require("./Combat.GodWars");
const Common = require("./Common.GodWars");
const Dungeon = require("./Dungeon.GodWars");
const Rules = require("./Rules.GodWars");

const CHUNK = 8;
const PLANES = 4;
const COINS = 995;

/** Faction key -> the chamber's general and bodyguard spawns, from npc-spawns.json. */
let chamberSpawns = null;

function loadChamberSpawns() {
  const file = path.join(__dirname, "..", "..", "..", "data", "definitions", "npc-spawns.json");
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  chamberSpawns = new Map();
  for (const faction of Common.factions) {
    const ids = new Set([faction.general, ...faction.bodyguards]);
    chamberSpawns.set(faction.key, rows.filter((row) =>
      ids.has(row.id) && Common.inBox(faction.room, row.x, row.y, row.level ?? 0)));
  }
}

/** Player -> their private chamber while they are in it. */
const instances = new Map();

let InstanceClass = null;

function instanceClass() {
  if (InstanceClass) return InstanceClass;
  const { TemplatedInstanceArea } = Common.core;
  InstanceClass = class GodWarsChamber extends TemplatedInstanceArea {
    constructor(faction, player) {
      super(faction.instance.width, faction.instance.height);
      this.faction = faction;
      this.player = player;
      this.isGodWarsInstance = true;
      const { chunkX, chunkY, width, height } = faction.instance;
      for (let plane = 0; plane < PLANES; plane++) {
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < height; y++) {
            this.setChunk(plane, x, y, { sourceChunkX: chunkX + x, sourceChunkY: chunkY + y, sourcePlane: plane, rotation: 0 });
          }
        }
      }
    }

    getName() {
      return `God Wars Dungeon (${this.faction.name}, private)`;
    }

    isMulti() {
      return true;
    }

    allowSummonPet() {
      return false;
    }

    canAttack(attacker, target, method) {
      return Combat.deniesMelee(attacker, target, method);
    }

    /** The instance's copy of a real tile. */
    copyOf([x, y, z]) {
      const { chunkX, chunkY } = this.faction.instance;
      return this.tile(x - chunkX * CHUNK, y - chunkY * CHUNK, z ?? 0);
    }

    spawnChamber() {
      for (const row of chamberSpawns.get(this.faction.key) ?? []) this.spawn(row);
    }

    spawn(row) {
      if (this.isDestroyed()) return;
      const at = this.copyOf([row.x, row.y, row.level ?? 0]);
      const npc = Common.api.spawnNpc({ id: row.id, x: at.getX(), y: at.getY(), z: at.getZ(), wanderRadius: 4 });
      if (!npc) return;
      npc.__skipDefaultRespawn = true;
      npc.__godwarsChamber = { area: this, row };
      this.add(npc);
    }

    process(mobile) {
      if (!mobile.isPlayer() || mobile.getHitpoints() <= 0) return;
      Combat.engage(mobile.getAsPlayer(), this.faction, this.entities.filter((entity) => entity.isNpc?.()));
    }

    postEnter(mobile) {
      super.postEnter(mobile);
      if (!mobile.isPlayer()) return;
      const player = mobile.getAsPlayer();
      player.setAttribute(Common.CHAMBER_ATTRIBUTE, this.faction.key);
      Dungeon.openOverlay(player);
      player.getPacketSender().sendVarbit(Common.data.instanceVarbit, 1);
    }

    /** Leaving ends the chamber; logging out puts the player outside its door first. */
    postLeave(mobile, logout) {
      super.postLeave(mobile, logout);
      if (!mobile.isPlayer() || mobile.getAsPlayer() !== this.player) return;
      const player = this.player;
      player.setAttribute(Common.CHAMBER_ATTRIBUTE, null);
      if (logout) player.setLocation(Common.toLocation(this.faction.door.outside));
      player.getPacketSender().sendVarbit(Common.data.instanceVarbit, 0);
      if (!logout) Common.later(1, () => player.isRegistered() && !Dungeon.inGodWars(player) && Dungeon.closeOverlay(player));
      end(player);
    }

    destroy() {
      if (this.isDestroyed()) return;
      for (const entity of [...this.entities]) {
        if (!entity.isNpc?.()) continue;
        this.detach(entity);
        Common.api.removeNpc(entity);
      }
      super.destroy();
    }
  };
  return InstanceClass;
}

function end(player) {
  const area = instances.get(player);
  if (!area) return;
  instances.delete(player);
  if (!area.isDestroyed()) area.destroy();
}

const instanceOf = (player) => instances.get(player) ?? null;

/** The chamber the player stands in: [faction, their instance or null], or null outside. */
function chamberOf(player) {
  const area = instanceOf(player);
  if (area && area.hasMember(player)) return [area.faction, area];
  const faction = Common.factionForRoom(player.getLocation());
  return faction ? [faction, null] : null;
}

function isIronman(player) {
  const query = { player, mode: "none" };
  Common.api.emitCustomEvent("ironman:mode", query);
  return query.mode !== "none";
}

/** Spends the door's price: 40 essence, else the key. False (with the captured message) if short. */
function payEntry(player, faction) {
  const result = Rules.canOpenBossDoor({
    killCount: Common.getEssence(player, faction),
    hasKey: player.getInventory().contains(Common.core.ItemIdentifiers.ECUMENICAL_KEY),
    required: Common.data.essence.required,
  });
  if (!result.ok) {
    player.sendMessage(`This door is locked by the power of ${faction.name}! You will need to collect the essence of at least ${result.required} of his followers before the door will open.`);
    return false;
  }
  if (result.consumesKey) {
    player.getInventory().delete(Common.core.ItemIdentifiers.ECUMENICAL_KEY, 1);
    player.sendMessage("Your ecumenical key melts into the door.");
  } else {
    Common.setEssence(player, faction, Common.getEssence(player, faction) - result.spendsEssence);
    player.sendMessage(`The door devours the life-force of ${result.spendsEssence} followers of ${faction.name} that you have slain.`);
  }
  return true;
}

/** Out through the door: the instance ends, or the shared door swings open behind the player. */
function leaveChamber(player, faction, area) {
  player.getMovementQueue().reset();
  if (area) {
    player.moveTo(Common.toLocation(faction.door.outside));
    return;
  }
  Common.swingDoor(faction);
  Common.later(1, () => player.isRegistered() && player.moveTo(Common.toLocation(faction.door.outside)));
}

function openDoor({ player, objectId }) {
  const faction = Common.factionForDoor(objectId);
  if (!faction) return false;
  const inside = chamberOf(player);
  if (inside) {
    leaveChamber(player, inside[0], inside[1]);
    return true;
  }
  if (isIronman(player) && Dungeon.chamberOccupants(faction) > 0) {
    player.sendMessage("There appears to be someone fighting in there already. As an Ironman, you'd do better with your own room.");
    return true;
  }
  if (!payEntry(player, faction)) return true;
  player.getMovementQueue().reset();
  Common.swingDoor(faction);
  Common.later(1, () => player.isRegistered() && player.moveTo(Common.toLocation(faction.door.inside)));
  return true;
}

/** The private chamber, as captured: the fade, then a tick later the rebuilt chamber. */
function startInstance({ player, objectId }) {
  const faction = Common.factionForDoor(objectId);
  if (!faction) return false;
  const inside = chamberOf(player);
  if (inside) {
    leaveChamber(player, inside[0], inside[1]);
    return true;
  }
  const cost = Common.data.instanceCost;
  if (player.getInventory().getAmount(COINS) < cost) {
    player.sendMessage(`You need ${cost.toLocaleString("en-US")} coins to start your own instance.`);
    return true;
  }
  if (!payEntry(player, faction)) return true;
  player.getInventory().delete(COINS, cost);
  player.getMovementQueue().reset();
  const { overlay } = Common.data;
  player.getPacketSender().sendClientScript(overlay.faderScript, 1, 0, 1, (overlay.group << 16) | overlay.fader);
  Common.later(1, () => {
    if (!player.isRegistered()) return;
    end(player);
    const area = new (instanceClass())(faction, player);
    instances.set(player, area);
    area.spawnChamber();
    area.enter(player);
    player.moveTo(area.copyOf(faction.door.inside));
  });
  return true;
}

function peek({ player, objectId }) {
  const faction = Common.factionForDoor(objectId);
  if (!faction) return false;
  const count = Dungeon.chamberOccupants(faction);
  player.sendMessage(count === 0
    ? "You peek inside the door and see no adventurers in the room."
    : `You peek inside the door and see ${count} adventurer${count === 1 ? "" : "s"} in the room.`);
  return true;
}

function minutesLeft(player) {
  const since = Date.now() - (Number(player.getAttribute(Common.ALTAR_ATTRIBUTE)) || 0);
  return Math.ceil((Common.data.altarCooldownMs - since) / 60000);
}

function pray({ player, objectId }) {
  const faction = Common.factionForAltar(objectId);
  if (!faction) return false;
  const { CombatFactory, Skill, Sound, Sounds, Animation } = Common.core;
  if (CombatFactory.inCombat(player)) {
    player.sendMessage("You need to be out of combat to use this altar.");
    return true;
  }
  const minutes = minutesLeft(player);
  if (minutes > 0) {
    player.sendMessage(`The gods blessed you recently. They will ignore your prayers for another ${minutes === 1 ? "minute" : `${minutes} minutes`}.`);
    return true;
  }
  const skills = player.getSkillManager();
  player.performAnimation(new Animation(Common.data.altarPrayAnim));
  Sounds.sendSound(player, Sound.PRAYER_RECHARGE);
  skills.setCurrentLevels(Skill.PRAYER, skills.getMaxLevel(Skill.PRAYER) + Common.godItemCount(player, faction));
  skills.updateSkill(Skill.PRAYER);
  player.setAttribute(Common.ALTAR_ATTRIBUTE, Date.now());
  player.sendMessage("You recharge your Prayer points.");
  return true;
}

function teleportOut({ player, objectId }) {
  const faction = Common.factionForAltar(objectId);
  if (!faction) return false;
  const inside = chamberOf(player);
  player.getMovementQueue().reset();
  player.getCombat().reset();
  player.moveTo(Common.toLocation(faction.door.outside));
  if (inside?.[1]) end(player);
  return true;
}

/** Saved inside a private chamber (the server stopped): back outside its door. */
function recoverOnLogin({ player }) {
  const faction = Common.factionByKey(player.getAttribute(Common.CHAMBER_ATTRIBUTE));
  if (!faction || instanceOf(player)) return;
  player.setAttribute(Common.CHAMBER_ATTRIBUTE, null);
  player.moveTo(Common.toLocation(faction.door.outside));
}

/** A chamber's NPC comes back in its instance 150 ticks after dying, while the instance lasts. */
function respawnInChamber(event) {
  const chamber = event.npc?.__godwarsChamber;
  if (!chamber) return;
  event.npc.__skipDefaultRespawn = true;
  Common.later(Common.data.respawnTicks, () => chamber.area.spawn(chamber.row));
}

function attachChambers(api) {
  loadChamberSpawns();
  api.persistAttribute(Common.ALTAR_ATTRIBUTE);
  api.persistAttribute(Common.CHAMBER_ATTRIBUTE);
  api.onPlayerLogin(recoverOnLogin);
  const doors = Common.factions.map((faction) => faction.door.id);
  const altars = Common.factions.map((faction) => faction.altar);
  api.onObjectFirstClick(doors, openDoor);
  api.onObjectSecondClick(doors, startInstance);
  api.onObjectThirdClick(doors, peek);
  api.onObjectFirstClick(altars, pray);
  api.onObjectSecondClick(altars, teleportOut);
  api.onNpcDeath(respawnInChamber);
}

module.exports = { attachChambers, instanceOf };
