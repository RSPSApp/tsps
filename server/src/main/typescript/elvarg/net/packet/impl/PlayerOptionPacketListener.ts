import { World } from "../../../game/World";
import type { Player } from "../../../game/entity/impl/player/Player";
import { FollowPlayerPacketListener } from "./FollowPlayerPacketListener";
import { TradeRequestPacketListener } from "./TradeRequestPacketListener";
import { PluginManager } from "../../../plugins/PluginManager";

export class PlayerOptionPacketListener {
  public static executeClientOption(player: any, index: number, option: number): void {
    if (!player || player.getHitpoints() <= 0 || player.busy()) return;
    const target = World.getPlayers().get(index) as Player;
    if (!target || target === player || target.getHitpoints() <= 0) return;
    if (option === 1) {
      if (player.getCombat?.().getAutocastSpell?.() != null) player.getCombat().setCastSpell(null);
      player.getCombat().attack(target);
      PluginManager.emitPlayerAttack({ player, target });
      return;
    }
    if (option === 2) return TradeRequestPacketListener.request(player, index);
    if (option === 3) return FollowPlayerPacketListener.request(player, index);
    const route = { player, target, option, handled: false };
    PluginManager.emitCustomEvent("player:option-route", route);
    if (route.handled) return;
    player.getMovementQueue().walkToEntity(target, () => {
      PluginManager.emitPlayerOption({ player, target, option, handled: false });
    });
  }
}
