import { BoatManager } from "../../../game/content/sailing/BoatManager";
import { World } from "../../../game/World";
import type { Player } from "../../../game/entity/impl/player/Player";
import { FollowPlayerPacketListener } from "./FollowPlayerPacketListener";
import { TradeRequestPacketListener } from "./TradeRequestPacketListener";
import { PluginManager } from "../../../plugins/PluginManager";

export class PlayerOptionPacketListener {
  /** "player:option-route": a plugin that owns the slot sets `handled` and walks itself. */
  private static routed(player: any, target: Player, option: number): boolean {
    const route = { player, target, option, handled: false };
    PluginManager.emitCustomEvent("player:option-route", route);
    if (route.handled) player.setFollowing(null);
    return route.handled;
  }

  public static executeClientOption(player: any, index: number, option: number): void {
    if (!Number.isInteger(option) || option < 1 || option > 8) return;
    if (!player || player.getHitpoints() <= 0 || player.busy()) return;
    const target = World.getPlayers().get(index) as Player;
    if (!target || target === player || target.getHitpoints() <= 0) return;
    if (option === 1) {
      // A plugin that gave slot 1 its own label ("Challenge" in the Emir's Arena) handles it.
      if (PlayerOptionPacketListener.routed(player, target, option)) return;
      if (player.getCombat?.().getAutocastSpell?.() != null) player.getCombat().setCastSpell(null);
      player.getCombat().attack(target);
      PluginManager.emitPlayerAttack({ player, target });
      return;
    }
    if (BoatManager.rootLocation(player).getZ() !== BoatManager.rootLocation(target).getZ()) return;
    if (option === 2) {
      player.setFollowing(null);
      return TradeRequestPacketListener.request(player, index);
    }
    if (option === 3) return FollowPlayerPacketListener.request(player, index);
    if (PlayerOptionPacketListener.routed(player, target, option)) return;
    player.getMovementQueue().walkToEntity(target, () => {
      PluginManager.emitPlayerOption({ player, target, option, handled: false });
    });
  }
}
