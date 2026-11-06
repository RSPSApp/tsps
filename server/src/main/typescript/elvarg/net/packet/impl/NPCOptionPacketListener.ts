import { CrossFloor } from "../../../game/CrossFloor";
import { World } from "../../../game/World";
import { CombatSpells } from "../../../game/content/combat/magic/CombatSpells";
import { EffectSpells } from "../../../game/content/combat/magic/EffectSpells";
import { Spell } from "../../../game/content/combat/magic/Spell";
import { NpcInteractionManager } from "../../../game/entity/impl/npc/NpcInteractionManager";
import { PluginManager } from "../../../plugins/PluginManager";
import { Combat } from "../../../game/content/combat/Combat";
import { NpcDefinition } from "../../../game/definition/NpcDefinition";
import { BoatManager } from "../../../game/content/sailing/BoatManager";
import { RegionManager } from "../../../game/collision/RegionManager";
import { Skill } from "../../../game/model/Skill";
import { Sounds } from "../../../game/Sounds";

/** How far an NPC ship's crew can be spoken to from another boat or the shore. */
const OTHER_SHIP_REACH_TILES = 16;

export class NPCOptionPacketListener {
  public executeOption(player: any, index: number, clickType: number): void {
    const trace = (why: string, npc?: any) =>
      Combat.debugLog(
        `[npcclick] ${player?.getUsername?.()} idx=${index} click=${clickType} ${why}` +
        ` npcId=${npc?.getId?.() ?? "-"} npcHp=${npc?.getHitpoints?.() ?? "-"}` +
        ` busy=${player?.busy?.()} hp=${player?.getHitpoints?.()}`
      );
    if (!player || player.getHitpoints?.() <= 0 || player.busy?.() || clickType < 1 || clickType > 5) {
      trace("DROPPED: busy/hp/clickType");
      return;
    }
    if (index < 0 || index > World.getNpcs().capacityReturn()) { trace("DROPPED: index range"); return; }
    const npc = World.getNpcs().get(index);
    if (!npc) { trace("DROPPED: npc slot empty"); return; }
    const npcOwner = npc.getOwner?.();
    if (npcOwner && npcOwner !== player) { trace("DROPPED: foreign owner", npc); return; }
    const playerBoat = BoatManager.getBoatAboard(player);
    const npcBoat = BoatManager.getBoatAboard(npc);
    if (npcBoat && npcBoat !== playerBoat) {
      // An NPC ship's crew (a Barracuda Trial's master) is spoken to from your own boat or the
      // shore, without boarding: "I can't reach that!" further away (rsprox). A ship the player
      // can't see (another player's quest ship) can't be reached at all.
      if (!npcBoat.static || !BoatManager.canSeeBoat(player, npcBoat)) { trace("DROPPED: other boat", npc); return; }
      NPCOptionPacketListener.operateAcross(player, npc, index, clickType);
      return;
    }
    const npcArea = npc.getPrivateArea?.() ?? null;
    if (npcArea && npcArea !== player.getPrivateArea?.()) { trace("DROPPED: private area", npc); return; }
    // Aboard, the client sees main-world NPCs at their root position while the player stands
    // in a deck scene; range must be measured root-to-root.
    const playerRoot = BoatManager.rootLocation(player);
    const npcRoot = BoatManager.rootLocation(npc);
    if (!CrossFloor.visible(playerRoot, npcRoot, 24)) { trace("DROPPED: >24 tiles", npc); return; }

    const definition = npc.getCurrentDefinition(player);
    const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
    if (NpcDefinition.isCombatOption(option)) {
      if (!definition?.isAttackable() || npc.getHitpoints?.() <= 0) {
        trace("DROPPED: not attackable / hp<=0", npc);
        return;
      }
      trace("ACCEPTED attack", npc);
      if (PluginManager.emitNpcAttackOption({ player, npc, npcId: npc.getContentId(player), clickType, handled: false })) return;
      if (player.getCombat?.().getAutocastSpell?.() != null) player.getCombat().setCastSpell(null);
      player.getCombat().attack(npc);
      return;
    }

    if (playerRoot.getZ() !== npcRoot.getZ()) return;
    player.setPositionToFace(npc.getLocation());
    const routeEvent = {
      player, npc, definition, npcId: npc.getContentId(player), npcIndex: index, clickType,
      location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() },
      handled: false, range: 1, ignoreProjectileClip: false,
    };
    PluginManager.emitNpcRoute(routeEvent);
    player.getMovementQueue().walkToEntity(npc, () => {
      player.setPositionToFace(npc.getLocation());

      const definition = npc.getCurrentDefinition(player);
      const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
      if (NpcDefinition.isCombatOption(option)) return;

      NPCOptionPacketListener.operate(player, npc, index, clickType, definition, option);

      // OSRS NPCs only turn to a player they are talking to (chatnpc sets playerface) or
      // fighting (retaliation, see combat:no-retaliate). An op on its own - Trade, Pickpocket,
      // burning a barricade - leaves them facing the way they were.
      if (player.getDialogueManager().isActive()) {
        npc.setMobileInteraction?.(player);
        npc.setPositionToFace?.(player.getLocation());
      }
    }, routeEvent.range, routeEvent.ignoreProjectileClip === true);
  }

  private static operateAcross(player: any, npc: any, index: number, clickType: number): void {
    const definition = npc.getCurrentDefinition(player);
    const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
    if (!option || NpcDefinition.isCombatOption(option)) return;
    if (!BoatManager.rootLocation(player).isWithinDistance(BoatManager.rootLocation(npc), OTHER_SHIP_REACH_TILES)) {
      player.sendMessage("I can't reach that!");
      return;
    }
    player.getMovementQueue().reset();
    NPCOptionPacketListener.operate(player, npc, index, clickType, definition, option);
    if (player.getDialogueManager().isActive()) npc.setMobileInteraction?.(player);
  }

  /**
   * An NPC's menu option done (not Attack): its handler, else the bank, else a plugin. One that
   * something answered is `npc:operated` { player, npc, npcId, option } (the option lower-cased: a
   * Talk-to that started a dialogue, a Pet), for whatever counts the deed itself.
   */
  private static operate(player: any, npc: any, index: number, clickType: number, definition: any, option: string | undefined): void {
    if (NPCOptionPacketListener.dispatch(player, npc, index, clickType, definition, option)) {
      PluginManager.emitCustomEvent(NPCOptionPacketListener.OPERATED_EVENT, { player, npc, npcId: npc.getContentId(player), option });
    }
  }

  public static readonly OPERATED_EVENT = "npc:operated";

  private static dispatch(player: any, npc: any, index: number, clickType: number, definition: any, option: string | undefined): boolean {
    if (
      NpcInteractionManager.handle(
        player,
        npc,
        index,
        clickType
      )
    ) {
      return true;
    }

    if (option === "bank") {
      player.getBank(player.getCurrentBankTab()).open();
      return true;
    }

    const handled = PluginManager.emitNpcInteraction({
      player,
      npc,
      definition,
      npcId: npc.getContentId(player),
      npcIndex: index,
      clickType,
      location: {
        x: npc.getLocation().getX(),
        y: npc.getLocation().getY(),
        z: npc.getLocation().getZ(),
      },
      handled: false,
    });

    if (!handled) {
      player.sendMessage("Nothing interesting happens.");
    }
    return handled;
  }

  public static castSpell(player: any, index: number, spellId: number, selection?: { name: string; widgetId: number }): boolean {
    if (!player || player.getHitpoints?.() <= 0 || player.busy?.()) return false;
    if (index < 0 || index >= World.getNpcs().capacityReturn()) return false;
    const npc = World.getNpcs().get(index);
    // Utility spells (Telekinetic Grab in the Mage Training Arena) are scripted on NPCs just as
    // combat spells are: the fall-back keeps the same rune and XP handling.
    const combatSpell = CombatSpells.getCombatSpell(spellId);
    const resolution = {
      player, spellId, spellName: selection?.name, spellWidget: selection?.widgetId,
      spell: (combatSpell ?? EffectSpells.forSpellId(spellId)) as Spell | null,
    };
    // Plugins can supply scripted utility spells missing from the legacy spell tables.
    if (!resolution.spell && selection) PluginManager.emitCustomEvent("magic:resolve-spell", resolution);
    const spell = resolution.spell;
    if (!npc || !spell || !CrossFloor.visible(
      BoatManager.rootLocation(player), BoatManager.rootLocation(npc), 24,
    ) || npc.getHitpoints?.() <= 0) {
      player.getMovementQueue().reset();
      return false;
    }
    const areaPermission = (npc.getPrivateArea?.() ?? npc.getArea?.())?.canCastOnNpc?.(player, npc, spell);
    // Only a CombatSpell may enter Combat.castSpellOn: an effect spell has no hits/maximumHit, so
    // the combat method would throw on it. Utility spells stay on the scripted route, which also
    // rejects them when no plugin takes the cast.
    const allowed = !!combatSpell && (areaPermission ?? !!npc.getCurrentDefinition?.(player)?.isAttackable?.());
    if (!allowed) {
      if (BoatManager.rootLocation(player).getZ() !== BoatManager.rootLocation(npc).getZ()) return false;
      player.getMovementQueue().reset();
      if (areaPermission === false) return false;
      return NPCOptionPacketListener.castSpellOnScriptedNpc(player, index, npc, spell);
    }
    if (!spell.canCastOnTarget(player, npc)) {
      player.getMovementQueue().reset();
      return false;
    }
    player.getCombat().castSpellOn(npc, spell);
    return true;
  }

  private static castSpellOnScriptedNpc(player: any, index: number, npc: any, spell: any): boolean {
    const targetLocation = npc.getLocation();
    const playerLocation = player.getLocation();
    const privateArea = npc.getPrivateArea();
    const playerBoat = BoatManager.getBoatAboard(player);
    const npcBoat = BoatManager.getBoatAboard(npc);
    // Telekinetic Grab reaches across the Theatre's maze walls; utility spells are not checked
    // for a combat line of sight.
    const needsLineOfSight = !(spell instanceof EffectSpells);
    if (playerLocation.getZ() !== targetLocation.getZ() ||
        !playerLocation.isWithinDistance(targetLocation, 10) ||
        (privateArea && privateArea !== player.getPrivateArea()) ||
        (npc.getOwner() && npc.getOwner() !== player) ||
        (npcBoat && npcBoat !== playerBoat) ||
        (needsLineOfSight && !RegionManager.canProjectileAttackTarget(player, npc)) ||
        !spell.canCastOnTarget(player, npc) || !spell.canCast(player, false)) return false;

    let consumed = false;
    let consumptionAttempted = false;
    const event = {
      player,
      npc,
      npcId: npc.getContentId(player),
      npcIndex: index,
      spell,
      spellId: spell.spellId(),
      location: { x: targetLocation.getX(), y: targetLocation.getY(), z: targetLocation.getZ() },
      consumeRunes: () => {
        consumptionAttempted = true;
        if (consumed || !spell.canCast(player, true)) return false;
        consumed = true;
        player.setPositionToFace(targetLocation);
        const sound = spell.castSound();
        if (sound) Sounds.sendSound(player, sound);
        spell.startCast(player, npc);
        const experience = Number(spell.baseExperience()) || 0;
        if (experience > 0) player.getSkillManager().addExperiences(Skill.MAGIC, experience);
        return true;
      },
      handled: false,
    };
    const handled = PluginManager.emitSpellOnNpc(event);
    // A scripted cast may already have refused with its own resource/cooldown feedback.
    if (!handled && !consumptionAttempted && !npc.getCurrentDefinition?.(player)?.isAttackable?.()) {
      player.sendMessage("You can't attack this npc.");
    }
    return handled && consumed;
  }
}
