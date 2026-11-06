let core;
let pluginApi;
const methods = new Map();
const uncappedDamage = new WeakMap();

const TOXIC_BLOWPIPE_MAX_SCALES = 16383;
const TOXIC_BLOWPIPE_MAX_DARTS = 16383;
const TOXIC_BLOWPIPE_META_KEY = "toxic-blowpipe";

// The native confirmdestroy chatbox: setup script 814 installs the mouse and 1/Y, 2/N listeners.
const CONFIRM_GROUP_ID = 584;
const CONFIRM_SETUP_SCRIPT = 814;
const CONFIRM_BUTTON = CONFIRM_GROUP_ID << 16;
// rsprox 1862/550 (a drygore blowpipe's Unload): "Are you sure you want to uncharge it?" /
// "If you uncharge the blowpipe, all darts will fall out."
const UNLOAD_QUESTION = "Are you sure you want to uncharge it?";
const UNLOAD_WARNING = "If you uncharge the blowpipe, all darts will fall out.";
// Wiki (Toxic blowpipe): uncharging returns the remaining darts and scales, and empties the pipe.
const UNCHARGE_WARNING = "If you uncharge the blowpipe, all scales and darts will fall out.";
const NO_SPACE = "You don't have enough free inventory space to do that.";

const DART_RANGED_STRENGTHS = new Map([
  ["BRONZE_DART", 1],
  ["IRON_DART", 2],
  ["STEEL_DART", 3],
  ["BLACK_DART", 6],
  ["MITHRIL_DART", 9],
  ["ADAMANT_DART", 17],
  ["RUNE_DART", 26],
  ["AMETHYST_DART", 28],
  ["DRAGON_DART", 35],
]);

// Venom starts at 6 damage and escalates (Wiki: Venom); poisonEntity stores it as the damage.
const VENOM_START_DAMAGE = 6;
const EMPTY_STATE = Object.freeze({ scales: 0, dartId: -1, dartAmount: 0 });

function normalizeInt(value, fallback) {
  return Number.isFinite(value) ? Math.floor(Number(value)) : fallback;
}

function isToxicBlowpipeItemId(itemId) {
  const I = core.ItemIdentifiers;
  return itemId === I.TOXIC_BLOWPIPE_EMPTY_ || itemId === I.TOXIC_BLOWPIPE ||
    itemId === I.BLAZING_BLOWPIPE_EMPTY_ || itemId === I.BLAZING_BLOWPIPE;
}

function isBlazingBlowpipeItemId(itemId) {
  const I = core.ItemIdentifiers;
  return itemId === I.BLAZING_BLOWPIPE_EMPTY_ || itemId === I.BLAZING_BLOWPIPE;
}

function isChargedBlowpipeItemId(itemId) {
  const I = core.ItemIdentifiers;
  return itemId === I.TOXIC_BLOWPIPE || itemId === I.BLAZING_BLOWPIPE;
}

function isToxicBlowpipeDartId(itemId) {
  return [...DART_RANGED_STRENGTHS.keys()].some((name) => core.ItemIdentifiers[name] === Number(itemId));
}

/** The ordinary attack's dart: the blowpipe's own profile, ending by the distance to the target's nearest tile. */
function dartShot(player, target, projectileId) {
  const shot = core.WeaponProfiles.ranged(player).projectiles?.[0]
    ?? { delay: 32, lengthAdjustment: 0, stepMultiplier: 5, startHeight: 35.5, endHeight: 36.5 };
  return {
    id: projectileId,
    delay: shot.delay,
    end: core.RangedCombatMethod.projectileEnd(shot, core.CombatPosition.edgeDistance(player, target)),
    startHeight: shot.startHeight,
    endHeight: shot.endHeight,
  };
}

function sanitizeMeta(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const rawDartId = normalizeInt(value.dartId, -1);
  const dartAmount = Math.max(0, normalizeInt(value.dartAmount, 0));
  const scales = Math.max(0, normalizeInt(value.scales, 0));
  const dartId = dartAmount > 0 && isToxicBlowpipeDartId(rawDartId) ? rawDartId : -1;
  return {
    scales: Math.min(TOXIC_BLOWPIPE_MAX_SCALES, scales),
    dartId,
    dartAmount: dartId > 0 ? Math.min(TOXIC_BLOWPIPE_MAX_DARTS, dartAmount) : 0,
  };
}

const BlowpipeState = {
  read(item) {
    if (!item || !isToxicBlowpipeItemId(item.getId())) {
      return EMPTY_STATE;
    }
    return sanitizeMeta(item.getMetaValue?.(TOXIC_BLOWPIPE_META_KEY));
  },
  write(item, next) {
    const state = sanitizeMeta(next);
    if (state.scales <= 0 && state.dartAmount <= 0) {
      item.setMetaValue(TOXIC_BLOWPIPE_META_KEY, undefined);
    } else {
      item.setMetaValue(TOXIC_BLOWPIPE_META_KEY, state);
    }
    if (item && isToxicBlowpipeItemId(item.getId())) {
      const charged = state.scales > 0 || state.dartAmount > 0;
      const blazing = isBlazingBlowpipeItemId(item.getId());
      item.setId(blazing
        ? (charged ? core.ItemIdentifiers.BLAZING_BLOWPIPE : core.ItemIdentifiers.BLAZING_BLOWPIPE_EMPTY_)
        : (charged ? core.ItemIdentifiers.TOXIC_BLOWPIPE : core.ItemIdentifiers.TOXIC_BLOWPIPE_EMPTY_));
    }
    return item;
  },
  update(item, updater) {
    return this.write(item, updater(this.read(item)));
  },
  equipped(player) {
    const item = player?.getEquipment?.()?.get?.(core.Equipment.WEAPON_SLOT) ?? null;
    return item && isToxicBlowpipeItemId(item.getId()) ? item : null;
  },
  hasDarts(item) {
    const state = this.read(item);
    return isToxicBlowpipeDartId(state.dartId) && state.dartAmount > 0;
  },
  ammo(item) {
    const { dartId } = this.read(item);
    return dartId > 0 ? core.Ammunition.getForItem(dartId) : null;
  },
  addScales(item, amount) {
    return this.update(item, (state) => ({ ...state, scales: state.scales + amount }));
  },
  clear(item) {
    return this.write(item, EMPTY_STATE);
  },
  swapDarts(item, dartId, amount) {
    return this.update(item, (state) => ({ ...state, dartId, dartAmount: amount }));
  },
  addDarts(item, dartId, amount) {
    return this.update(item, (state) => ({ ...state, dartId, dartAmount: state.dartAmount + amount }));
  },
  consumeScale(item) {
    let remaining = 0;
    this.update(item, (state) => {
      remaining = Math.max(0, state.scales - 1);
      return { ...state, scales: remaining };
    });
    return remaining;
  },
  consumeDart(item) {
    let remaining = 0;
    this.update(item, (state) => {
      remaining = Math.max(0, state.dartAmount - 1);
      return { ...state, dartId: remaining > 0 ? state.dartId : -1, dartAmount: remaining };
    });
    return remaining;
  },
};

function getToxicBlowpipeDartStrength(itemId) {
  return [...DART_RANGED_STRENGTHS].find(([name]) => core.ItemIdentifiers[name] === Number(itemId))?.[1] ?? 0;
}

function getDefinitionBonus(item, index) {
  const bonuses = item?.getDefinition?.()?.getBonuses?.() ?? [];
  return Number(bonuses[index] ?? 0);
}

function getAmmo(player) {
  return BlowpipeState.ammo(BlowpipeState.equipped(player));
}

function getAmmoName(dartId) {
  if (!isToxicBlowpipeDartId(dartId)) {
    return "darts";
  }
  return new core.Item(dartId).getDefinition()?.getName?.()?.toLowerCase?.() ?? "darts";
}

function canReturnDarts(inventory, itemId, amount) {
  return inventory.getAddableAmount(new core.Item(itemId, amount)) >= amount;
}

function getItemContainer(player, item, preferredSlot = -1) {
  const inventory = player.getInventory();
  if (preferredSlot >= 0 && inventory.getItems()[preferredSlot] === item) {
    return inventory;
  }
  if (inventory.getItems().includes(item)) {
    return inventory;
  }
  const equipment = player.getEquipment();
  if (equipment.getItems().includes(item)) {
    return equipment;
  }
  return null;
}

function refreshBlowpipeState(player, item, preferredSlot = -1) {
  const container = getItemContainer(player, item, preferredSlot);
  if (container) {
    container.refreshItems();
    if (container === player.getEquipment()) {
      player.getUpdateFlag()?.flag?.(core.Flag.APPEARANCE);
    }
  }
  if (
    player.getWeapon?.() === core.WeaponInterfaces.BLOWPIPE ||
    player.getEquipment().get(core.Equipment.WEAPON_SLOT) === item
  ) {
    core.WeaponInterfaceManager.assign(player);
  }
  core.BonusManager.update(player);
}

function isReady(player, item, amountRequired = 1, silent = false) {
  const { scales, dartAmount } = BlowpipeState.read(item);
  if (scales <= 0) {
    if (!silent) {
      player.sendMessage("You must recharge your Toxic blowpipe using some Zulrah scales.");
      player.getCombat().reset();
    }
    return false;
  }
  if (dartAmount < amountRequired) {
    if (!silent) {
      player.sendMessage("You must load darts into the Toxic blowpipe.");
      player.getCombat().reset();
    }
    return false;
  }
  return true;
}

function isCharged(item, amountRequired = 1) {
  const { scales, dartAmount } = BlowpipeState.read(item);
  return scales > 0 && dartAmount >= amountRequired;
}

function chargeScales(player, blowpipeItem, blowpipeSlot, scaleItem) {
  const { scales: current } = BlowpipeState.read(blowpipeItem);
  if (current >= TOXIC_BLOWPIPE_MAX_SCALES) {
    player.sendMessage("Your blowpipe cannot hold any more scales.");
    return;
  }
  const add = Math.min(scaleItem.getAmount(), TOXIC_BLOWPIPE_MAX_SCALES - current);
  if (add <= 0) {
    return;
  }
  player.getInventory().deleteNumber(core.ItemIdentifiers.ZULRAHS_SCALES, add);
  BlowpipeState.addScales(blowpipeItem, add);
  refreshBlowpipeState(player, blowpipeItem, blowpipeSlot);
  player.sendMessage(`You add ${add} Zulrah scales to the blowpipe.`);
}

function chargeDarts(player, blowpipeItem, blowpipeSlot, dartItem) {
  const dartId = dartItem.getId();
  const { dartId: currentId, dartAmount: currentAmount } = BlowpipeState.read(blowpipeItem);

  if (currentAmount >= TOXIC_BLOWPIPE_MAX_DARTS && currentId === dartId) {
    player.sendMessage("Your blowpipe cannot hold any more darts.");
    return;
  }

  if (currentAmount > 0 && currentId !== dartId && !canReturnDarts(player.getInventory(), currentId, currentAmount)) {
    player.sendMessage("You need more inventory space to swap the loaded darts.");
    return;
  }

  if (currentAmount > 0 && currentId !== dartId) {
    player.getInventory().add(new core.Item(currentId, currentAmount), true);
    BlowpipeState.clear(blowpipeItem);
  }

  const add = Math.min(dartItem.getAmount(), TOXIC_BLOWPIPE_MAX_DARTS - BlowpipeState.read(blowpipeItem).dartAmount);
  if (add <= 0) {
    return;
  }

  player.getInventory().deleteNumber(dartId, add);
  BlowpipeState.addDarts(blowpipeItem, dartId, add);
  refreshBlowpipeState(player, blowpipeItem, blowpipeSlot);
  player.sendMessage(`You load ${add} ${getAmmoName(dartId)} into the blowpipe.`);
  // "toxic-blowpipe:darts-loaded" { player, itemId, amount }: those darts loaded into it.
  pluginApi.emitCustomEvent("toxic-blowpipe:darts-loaded", { player, itemId: dartId, amount: add });
}

const pendingPrompts = new WeakMap();

function formatAmount(value) {
  return Math.max(0, normalizeInt(value, 0)).toLocaleString("en-US");
}

function getAmmoDisplayName(dartId) {
  return new core.Item(dartId).getDefinition()?.getName?.() ?? "darts";
}

/**
 * The pipe's Check line, as live prints it (rsprox 1637/4121): "Darts:
 * <col=007f00>Iron dart x 1,687</col>. Scales: <col=007f00>794 (4.8%)</col>." Only the parts
 * the pipe holds are printed (rsprox 1858: a drygore's darts alone).
 */
function checkBlowpipe({ player, item }) {
  const { scales, dartId, dartAmount } = BlowpipeState.read(item);
  const parts = [];
  if (dartAmount > 0 && isToxicBlowpipeDartId(dartId)) {
    parts.push(`Darts: <col=007f00>${getAmmoDisplayName(dartId)} x ${formatAmount(dartAmount)}</col>.`);
  }
  if (scales > 0) {
    const percent = ((scales / TOXIC_BLOWPIPE_MAX_SCALES) * 100).toFixed(1);
    parts.push(`Scales: <col=007f00>${formatAmount(scales)} (${percent}%)</col>.`);
  }
  if (parts.length) {
    player.sendMessage(parts.join(" "));
  }
  return true;
}

/** Inventory.add merges only when both the item id and the metadata match. */
function sameStack(held, item) {
  return held.getId() === item.getId() &&
    JSON.stringify(held.getMeta() ?? null) === JSON.stringify(item.getMeta() ?? null);
}

/**
 * One slot per returned stack that has no matching stack to merge into. The id alone is not
 * enough: a preset dart stack shares the id but not the metadata, so returned ordinary darts
 * still need a slot of their own.
 */
function slotsNeeded(inventory, stacks) {
  let needed = 0;
  for (const [itemId, amount] of stacks) {
    if (amount <= 0) {
      continue;
    }
    const item = new core.Item(itemId, amount);
    if (!inventory.getItems().some((held) => held && sameStack(held, item))) {
      needed++;
    }
  }
  return needed;
}

/** Whether the inventory can take every returned stack now: free slots and stack headroom. */
function canReturnAll(inventory, stacks) {
  if (inventory.getFreeSlots() < slotsNeeded(inventory, stacks)) {
    return false;
  }
  return stacks.every(([itemId, amount]) =>
    amount <= 0 || inventory.getAddableAmount(new core.Item(itemId, amount)) >= amount);
}

/** The stack Unload returns: the loaded darts. */
function dartsToReturn(blowpipeItem) {
  const { dartId, dartAmount } = BlowpipeState.read(blowpipeItem);
  return dartAmount > 0 && isToxicBlowpipeDartId(dartId) ? [[dartId, dartAmount]] : [];
}

/** The stacks Uncharge returns: the scales and the loaded darts. */
function everythingToReturn(blowpipeItem) {
  const { scales, dartId, dartAmount } = BlowpipeState.read(blowpipeItem);
  const stacks = [];
  if (scales > 0) {
    stacks.push([core.ItemIdentifiers.ZULRAHS_SCALES, scales]);
  }
  if (dartAmount > 0 && isToxicBlowpipeDartId(dartId)) {
    stacks.push([dartId, dartAmount]);
  }
  return stacks;
}

/** Unload: the loaded darts go back, the scales stay and the pipe keeps its charged id. */
function removeDarts(player, blowpipeItem, slot) {
  const { dartId, dartAmount } = BlowpipeState.read(blowpipeItem);
  if (dartAmount > 0 && isToxicBlowpipeDartId(dartId)) {
    player.getInventory().add(new core.Item(dartId, dartAmount), true);
  }
  BlowpipeState.update(blowpipeItem, (state) => ({ ...state, dartId: -1, dartAmount: 0 }));
  refreshBlowpipeState(player, blowpipeItem, slot);
}

/** Uncharge: both stacks come back and an emptied pipe becomes the tradeable empty item. */
function removeEverything(player, blowpipeItem, slot) {
  const { scales, dartId, dartAmount } = BlowpipeState.read(blowpipeItem);
  if (scales > 0) {
    player.getInventory().add(new core.Item(core.ItemIdentifiers.ZULRAHS_SCALES, scales), true);
  }
  if (dartAmount > 0 && isToxicBlowpipeDartId(dartId)) {
    player.getInventory().add(new core.Item(dartId, dartAmount), true);
  }
  BlowpipeState.clear(blowpipeItem);
  refreshBlowpipeState(player, blowpipeItem, slot);
}

function openConfirm(player, blowpipeItem, slot, warning, getStacks, apply) {
  // The destroy confirmation shares group 584 and registers first: closing whatever prompt is
  // open clears its pending item (sendInterfaceRemoval resets "destroy-item:pending"), so the
  // player's Yes answers this prompt instead of destroying the item Destroy named.
  player.getPacketSender().sendInterfaceRemoval();
  pendingPrompts.set(player, { item: blowpipeItem, itemId: blowpipeItem.getId(), slot, getStacks, apply });
  player
    .getPacketSender()
    .sendChatboxInterface(CONFIRM_GROUP_ID)
    .sendClientScript(CONFIRM_SETUP_SCRIPT, blowpipeItem.getId(), blowpipeItem.getAmount(), UNLOAD_QUESTION, warning);
}

/** The chatbox resume's dynamic child is 1 for Yes and 0 for No. */
function confirmPrompt({ player, action }) {
  if (action !== 0 && action !== 1) return false;
  const pending = pendingPrompts.get(player);
  if (!pending || !player.getPacketSender().isChatboxInterface(CONFIRM_GROUP_ID)) return false;
  pendingPrompts.delete(player);
  player.getPacketSender().sendInterfaceRemoval();
  if (action !== 1) return true;
  const blowpipeItem = player.getInventory().getItems()[pending.slot];
  if (blowpipeItem === pending.item && blowpipeItem?.getId() === pending.itemId) {
    // The inventory can fill up while the prompt is open (unequipping into the last slot), and
    // add() would silently refuse: re-check the return as it stands now and keep the pipe loaded.
    if (!canReturnAll(player.getInventory(), pending.getStacks(blowpipeItem))) {
      player.sendMessage(NO_SPACE);
    } else {
      pending.apply(player, blowpipeItem);
    }
  }
  return true;
}

/** The destroy confirmation shares group 584, so its prompt replaces any pending blowpipe one. */
function forgetPrompt({ player }) {
  pendingPrompts.delete(player);
}

function unloadBlowpipe({ player, item, slot }) {
  const stacks = dartsToReturn(item);
  if (stacks.length === 0) {
    return true;
  }
  if (!canReturnAll(player.getInventory(), stacks)) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  openConfirm(player, item, slot, UNLOAD_WARNING, dartsToReturn, (owner, blowpipeItem) => removeDarts(owner, blowpipeItem, slot));
  return true;
}

function unchargeBlowpipe({ player, item, slot }) {
  const { scales, dartAmount } = BlowpipeState.read(item);
  if (scales <= 0 && dartAmount <= 0) {
    return true;
  }
  if (!canReturnAll(player.getInventory(), everythingToReturn(item))) {
    player.sendMessage(NO_SPACE);
    return true;
  }
  openConfirm(player, item, slot, UNCHARGE_WARNING, everythingToReturn, (owner, blowpipeItem) => removeEverything(owner, blowpipeItem, slot));
  return true;
}

function maybeConsumeLoadedDart(player, blowpipeItem) {
  // An Ava's device keeps its share of the darts out of the pipe's count (Wiki: 60/72/80%).
  if (core.Misc.getRandom(99) < core.CombatFactory.ammoRecovery(player)) {
    return false;
  }
  if (BlowpipeState.consumeDart(blowpipeItem) <= 0) {
    player.sendMessage("Your Toxic blowpipe has run out of darts!");
    player.getCombat().reset();
    return true;
  }
  return false;
}

function maybeConsumeScale(player, blowpipeItem) {
  if (core.Misc.getRandom(2) !== 0) {
    if (BlowpipeState.consumeScale(blowpipeItem) <= 0) {
      player.sendMessage("Your Toxic blowpipe has run out of scales!");
      player.getCombat().reset();
      return true;
    }
  }
  return false;
}

function combatMethod(special) {
  if (methods.has(special))
    return methods.get(special);
  class ToxicBlowpipeCombatMethod extends core.RangedCombatMethod {
    constructor(special) {
      super();
      this.special = special === true;
    }
    canAttack(character, target) {
      if (!character?.isPlayer?.()) {
        return false;
      }
      const player = character.getAsPlayer();
      const blowpipeItem = BlowpipeState.equipped(player);
      if (!blowpipeItem || !isChargedBlowpipeItemId(blowpipeItem.getId())) {
        return false;
      }
      return isReady(player, blowpipeItem);
    }
    attackSpeed(character) {
      const target = character?.getCombat?.()?.getTarget?.() ?? null;
      const baseSpeed = target?.isPlayer?.() ? 4 : 3;
      return character?.getFightType?.()?.isRapid?.() === true ? Math.max(1, baseSpeed - 1) : baseSpeed;
    }
    hits(character, target) {
      const delay = core.RangedCombatMethod.landingDelays(character, target)[0];
      return [new core.PendingHit(character, target, this, delay)];
    }
    start(character, target) {
      const player = character.getAsPlayer();
      const blowpipeItem = BlowpipeState.equipped(player);
      if (!blowpipeItem) {
        player.getCombat().reset();
        return;
      }
      const ammo = getAmmo(player);
      if (!ammo) {
        player.sendMessage("You must load darts into the Toxic blowpipe.");
        player.getCombat().reset();
        return;
      }
      if (this.special) {
        // TOXIC_BLOWPIPE_SPECIAL_UPDATED; the ordinary attack keeps the style's 5061.
        character.performAnimation(new core.Animation(876));
      } else {
        const animation = character.getAttackAnim();
        if (animation !== -1) {
          character.performAnimation(new core.Animation(animation));
        }
      }
      // The ordinary attack flies the profile's dart (rsprox 3279: starts at 32, ends 32 + 5 a tile of the distance
      // to the nearest tile, heights 142 to 146 sent), so it ends with its hit. The special's own projectile was
      // never captured and keeps its old fixed shape.
      if (this.special) {
        core.Projectile.createProjectile(character, target, ammo.getProjectileId(), 40, 60, 40, 35).sendProjectile();
      } else {
        const shot = dartShot(player, target, ammo.getProjectileId());
        core.Projectile.createProjectile(character, target, shot.id, shot.delay, shot.end, shot.startHeight, shot.endHeight)
          .sendProjectile();
      }
      core.Sounds.sendSound(character, core.Sound.THROW_DART);
      if (this.special) {
        core.Sounds.sendSound(character, core.Sound.TOXIC_BLOWPIPE_SPECIAL);
        const drainAmount = player.getCombatSpecial?.()?.getDrainAmount?.() ?? 50;
        core.CombatSpecial.drain(player, drainAmount);
      }
      const dartsDepleted = maybeConsumeLoadedDart(player, blowpipeItem);
      const scalesDepleted = maybeConsumeScale(player, blowpipeItem);
      if (dartsDepleted || scalesDepleted) {
        refreshBlowpipeState(player, blowpipeItem);
      }
    }
    handleAfterHitEffects(hit) {
      const attacker = hit?.getAttacker?.();
      const target = hit?.getTarget?.();
      if (!attacker?.isPlayer?.() || !target) {
        return;
      }
      const player = attacker.getAsPlayer();
      const totalDamage = Number(uncappedDamage.get(hit) ?? hit.getTotalDamage?.() ?? 0);
      if (totalDamage <= 0 || hit.isAccurate?.() !== true) {
        return;
      }
      if (core.Misc.getRandom(3) === 0) {
        core.CombatFactory.poisonEntity(target, VENOM_START_DAMAGE, 2);
      }
      if (!this.special) {
        return;
      }
      const heal = Math.floor(totalDamage * 0.5);
      if (heal <= 0) {
        return;
      }
      const skillManager = player.getSkillManager();
      const maxHp = skillManager.getMaxLevel(core.Skill.HITPOINTS);
      const nextHp = Math.min(maxHp, skillManager.getCurrentLevel(core.Skill.HITPOINTS) + heal);
      skillManager.setCurrentLevels(core.Skill.HITPOINTS, nextHp);
      skillManager.updateSkill(core.Skill.HITPOINTS);
    }
  }
  const method = new ToxicBlowpipeCombatMethod(special);
  methods.set(special, method);
  return method;
}

function rangedAmmoResolverResolve(player) {
  const blowpipeItem = BlowpipeState.equipped(player);
  if (!blowpipeItem || !isChargedBlowpipeItemId(blowpipeItem.getId())) {
    return null;
  }
  return BlowpipeState.ammo(blowpipeItem);
}

function rangedAmmoHandlerCheckAmmo(player, amountRequired, silent = false) {
  const rangedWeapon = player?.getCombat?.()?.getRangedWeapon?.();
  if (rangedWeapon !== core.RangedWeapon.TOXIC_BLOWPIPE) {
    return null;
  }
  return isReady(player, BlowpipeState.equipped(player), amountRequired, silent);
}

function rangedAmmoHandlerDecrementAmmo(player, pos, amount) {
  const rangedWeapon = player?.getCombat?.()?.getRangedWeapon?.();
  if (rangedWeapon !== core.RangedWeapon.TOXIC_BLOWPIPE) {
    return false;
  }
  const blowpipeItem = BlowpipeState.equipped(player);
  if (!blowpipeItem) {
    player.getCombat().reset();
    return true;
  }
  // Content may keep some shots from costing a scale (a league relic), as core asks for quiver ammunition.
  const saving = { player, itemId: blowpipeItem.getId(), amount, saved: 0 };
  pluginApi.emitCustomEvent("ranged:ammo-saving", saving);
  const scales = amount - Math.min(amount, Math.max(0, saving.saved | 0));
  let depleted = false;
  for (let i = 0; i < scales; i++) {
    if (BlowpipeState.consumeScale(blowpipeItem) <= 0) {
      depleted = true;
      break;
    }
  }
  if (depleted) {
    refreshBlowpipeState(player, blowpipeItem);
    player.sendMessage("Your Toxic blowpipe has run out of scales!");
    player.getCombat().reset();
  }
  return true;
}

function bonusProviderApply(event) {
  const { player, bonuses } = event;
  const blowpipeItem = BlowpipeState.equipped(player);
  if (!blowpipeItem || !isChargedBlowpipeItemId(blowpipeItem.getId())) {
    return;
  }
  if (!isCharged(blowpipeItem)) {
    return;
  }
  const { dartId } = BlowpipeState.read(blowpipeItem);
  if (!isToxicBlowpipeDartId(dartId)) {
    return;
  }
  bonuses[core.BonusManager.ATTACK_RANGE] += 30 - getDefinitionBonus(blowpipeItem, core.BonusManager.ATTACK_RANGE);
  bonuses[10 + core.BonusManager.RANGED_STRENGTH] +=
    20 + getToxicBlowpipeDartStrength(dartId) - getDefinitionBonus(blowpipeItem, 10 + core.BonusManager.RANGED_STRENGTH);
}

function combatMethodResolverResolve(attacker) {
  if (!attacker?.isPlayer?.()) {
    return null;
  }
  const player = attacker.getAsPlayer();
  const blowpipeItem = BlowpipeState.equipped(player);
  if (!blowpipeItem || !isChargedBlowpipeItemId(blowpipeItem.getId())) {
    return null;
  }
  if (player.isSpecialActivated?.() === true && player.getCombatSpecial?.()?.getId?.() === "toxic_blowpipe") {
    return combatMethod(true);
  }
  return combatMethod(false);
}

function itemOnItem(event) {
  const { player, usedItemId, usedWithItemId, usedItemSlot, usedWithItemSlot, usedItem, usedWithItem } = event;
  const blowpipeOnLeft = isToxicBlowpipeItemId(usedItemId);
  const blowpipeOnRight = isToxicBlowpipeItemId(usedWithItemId);
  if (!blowpipeOnLeft && !blowpipeOnRight) {
    return;
  }
  const blowpipeSlot = blowpipeOnLeft ? usedItemSlot : usedWithItemSlot;
  const blowpipeItem = blowpipeOnLeft ? usedItem : usedWithItem;
  const otherItem = blowpipeOnLeft ? usedWithItem : usedItem;
  const otherItemId = blowpipeOnLeft ? usedWithItemId : usedItemId;
  if (otherItemId === core.ItemIdentifiers.ZULRAHS_SCALES) {
    event.handled = true;
    chargeScales(player, blowpipeItem, blowpipeSlot, otherItem);
    return;
  }
  if (isToxicBlowpipeDartId(otherItemId)) {
    event.handled = true;
    chargeDarts(player, blowpipeItem, blowpipeSlot, otherItem);
  }
}

function rememberDamage({ attacker, hit, damage }) {
  if (attacker?.isPlayer?.() && attacker.isSpecialActivated?.() && attacker.getCombatSpecial?.()?.getId() === "toxic_blowpipe") {
    uncappedDamage.set(hit, damage.getDamage());
  }
}

module.exports = {
  name: "ToxicBlowpipe",
  members: true,
  register(api) {
    core = api.core;
    pluginApi = api;
    // The ornament changes appearance only. Native ranged-weapon and profile lookups
    // should see the corresponding charged or empty Toxic Blowpipe definition.
    core.ItemAliases.register(core.ItemIdentifiers.BLAZING_BLOWPIPE, core.ItemIdentifiers.TOXIC_BLOWPIPE);
    core.ItemAliases.register(core.ItemIdentifiers.BLAZING_BLOWPIPE_EMPTY_, core.ItemIdentifiers.TOXIC_BLOWPIPE_EMPTY_);
    api.onCombatHitDamage(rememberDamage);
    api.registerRangedAmmoResolver({ resolve: rangedAmmoResolverResolve });
    api.registerRangedAmmoHandler({ checkAmmo: rangedAmmoHandlerCheckAmmo, decrementAmmo: rangedAmmoHandlerDecrementAmmo });
    api.registerBonusProvider({ apply: bonusProviderApply });
    api.registerCombatMethodResolver({ resolve: combatMethodResolverResolve });
    api.onItemOnItem(itemOnItem);
    api.onItemAction("Toxic blowpipe", {
      Check: checkBlowpipe,
      Unload: unloadBlowpipe,
      Uncharge: unchargeBlowpipe,
    });
    api.onItemAction("Toxic blowpipe (empty)", {
      Check: checkBlowpipe,
      Unload: unloadBlowpipe,
      Uncharge: unchargeBlowpipe,
    });
    api.onItemAction("Blazing blowpipe", {
      Check: checkBlowpipe,
      Unload: unloadBlowpipe,
      Uncharge: unchargeBlowpipe,
    });
    api.onItemAction("Blazing blowpipe (empty)", {
      Check: checkBlowpipe,
      Unload: unloadBlowpipe,
      Uncharge: unchargeBlowpipe,
    });
    api.onInterfaceActionButton(CONFIRM_BUTTON, confirmPrompt);
    api.onCustomEvent("destroy-item:prompt", forgetPrompt);
  },
  _test: { dartShot, BlowpipeState, checkBlowpipe, removeDarts, removeEverything, CONFIRM_GROUP_ID },
};
