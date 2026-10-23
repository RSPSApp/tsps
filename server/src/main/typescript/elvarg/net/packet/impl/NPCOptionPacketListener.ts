import { World } from "../../../game/World";
import { CombatSpells } from "../../../game/content/combat/magic/CombatSpells";
import { NpcInteractionManager } from "../../../game/entity/impl/npc/NpcInteractionManager";
import { PluginManager } from "../../../plugins/PluginManager";
import { Combat } from "../../../game/content/combat/Combat";
import { NpcDefinition } from "../../../game/definition/NpcDefinition";
import { BoatManager } from "../../../game/content/sailing/BoatManager";
import { RegionManager } from "../../../game/collision/RegionManager";
import { Skill } from "../../../game/model/Skill";
import { Sounds } from "../../../game/Sounds";

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
    const playerBoat = BoatManager.getBoatAboard(player);
    const npcBoat = BoatManager.getBoatAboard(npc);
    if (npcBoat && npcBoat !== playerBoat) { trace("DROPPED: other boat", npc); return; }
    const npcArea = npc.getPrivateArea?.() ?? null;
    if (npcArea && npcArea !== player.getPrivateArea?.()) { trace("DROPPED: private area", npc); return; }
    const npcOwner = npc.getOwner?.();
    if (npcOwner && npcOwner !== player) { trace("DROPPED: foreign owner", npc); return; }
    // Aboard, the client sees main-world NPCs at their root position while the player stands
    // in a deck scene; range must be measured root-to-root.
    const playerRoot = BoatManager.rootLocation(player);
    const npcRoot = BoatManager.rootLocation(npc);
    if (!playerRoot.isWithinDistance(npcRoot, 24)) { trace("DROPPED: >24 tiles", npc); return; }

    const definition = npc.getCurrentDefinition(player);
    const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
    if (NpcDefinition.isCombatOption(option)) {
      if (!definition?.isAttackable() || npc.getHitpoints?.() <= 0) {
        trace("DROPPED: not attackable / hp<=0", npc);
        return;
      }
      trace("ACCEPTED attack", npc);
      if (player.getCombat?.().getAutocastSpell?.() != null) player.getCombat().setCastSpell(null);
      player.getCombat().attack(npc);
      return;
    }

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

  private static operate(player: any, npc: any, index: number, clickType: number, definition: any, option: string | undefined): void {
    if (
      NpcInteractionManager.handle(
        player,
        npc,
        index,
        clickType
      )
    ) {
      return;
    }

    if (option === "bank") {
      player.getBank(player.getCurrentBankTab()).open();
      return;
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
  }

  public static castSpell(player: any, index: number, spellId: number): boolean {
    if (!player || player.getHitpoints?.() <= 0 || player.busy?.()) return false;
    if (index < 0 || index >= World.getNpcs().capacityReturn()) return false;
    const npc = World.getNpcs().get(index);
    const spell = CombatSpells.getCombatSpell(spellId);
    if (!npc || !spell || !player.getLocation().isWithinDistance(npc.getLocation(), 24) || npc.getHitpoints?.() <= 0) {
      player.getMovementQueue().reset();
      return false;
    }
    const areaPermission = (npc.getPrivateArea?.() ?? npc.getArea?.())?.canCastOnNpc?.(player, npc, spell);
    const allowed = areaPermission ?? !!npc.getCurrentDefinition?.(player)?.isAttackable?.();
    if (!allowed) {
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
    if (playerLocation.getZ() !== targetLocation.getZ() ||
        !playerLocation.isWithinDistance(targetLocation, 10) ||
        (privateArea && privateArea !== player.getPrivateArea()) ||
        (npc.getOwner() && npc.getOwner() !== player) ||
        (npcBoat && npcBoat !== playerBoat) ||
        !RegionManager.canProjectileAttackTarget(player, npc) ||
        !spell.canCastOnTarget(player, npc) || !spell.canCast(player, false)) return false;

    let consumed = false;
    const event = {
      player,
      npc,
      npcId: npc.getContentId(player),
      npcIndex: index,
      spell,
      spellId: spell.spellId(),
      location: { x: targetLocation.getX(), y: targetLocation.getY(), z: targetLocation.getZ() },
      consumeRunes: () => {
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
    return PluginManager.emitSpellOnNpc(event) && consumed;
  }
}
