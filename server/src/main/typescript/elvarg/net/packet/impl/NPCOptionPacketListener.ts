import { World } from "../../../game/World";
import { CombatSpells } from "../../../game/content/combat/magic/CombatSpells";
import { NpcInteractionManager } from "../../../game/entity/impl/npc/NpcInteractionManager";
import { PluginManager } from "../../../plugins/PluginManager";
import { Combat } from "../../../game/content/combat/Combat";

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
    if (!player.getLocation().isWithinDistance(npc.getLocation(), 24)) { trace("DROPPED: >24 tiles", npc); return; }

    const definition = npc.getCurrentDefinition(player);
    const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
    if (option === "attack") {
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
      player, npc, definition, npcId: npc.getId(), npcIndex: index, clickType,
      location: { x: npc.getLocation().getX(), y: npc.getLocation().getY(), z: npc.getLocation().getZ() },
      handled: false, range: 1,
    };
    PluginManager.emitNpcRoute(routeEvent);
    player.getMovementQueue().walkToEntity(npc, () => {
      player.setPositionToFace(npc.getLocation());

      const definition = npc.getCurrentDefinition(player);
      const option = definition?.getActions()?.[clickType - 1]?.toLowerCase();
      if (option === "attack") return;

      NPCOptionPacketListener.operate(player, npc, index, clickType, definition, option);

      // OSRS NPCs only turn to a player they are talking to (chatnpc sets playerface) or
      // fighting (retaliation, see combat:no-retaliate). An op on its own - Trade, Pickpocket,
      // burning a barricade - leaves them facing the way they were.
      if (player.getDialogueManager().isActive()) {
        npc.setMobileInteraction?.(player);
        npc.setPositionToFace?.(player.getLocation());
      }
    }, routeEvent.range);
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
      npcId: npc.getId(),
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
    if (!npc || !spell || !player.getLocation().isWithinDistance(npc.getLocation(), 24) ||
        !npc.getCurrentDefinition?.(player)?.isAttackable?.() || npc.getHitpoints?.() <= 0) {
      player.getMovementQueue().reset();
      return false;
    }
    if (!spell.canCastOnTarget(player, npc)) {
      player.getMovementQueue().reset();
      return false;
    }
    player.getCombat().castSpellOn(npc, spell);
    return true;
  }
}
