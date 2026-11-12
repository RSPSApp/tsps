import { PluginManager } from "../../../plugins/PluginManager";

export class InterfaceActionClickOpcode {
  /** A refuseWhileBusy button's answer to a locked player. */
  public static readonly BUSY_MESSAGE = "Please finish what you are doing first.";

  public static handle(
    player: any,
    interfaceId: number,
    action: number,
    metadata: {
      groupId?: number;
      childId?: number;
      opId?: number;
      itemId?: number;
      slot?: number;
      option?: string;
      targetWidgetId?: number;
      targetSlot?: number;
      targetItemId?: number;
      sourceWidgetId?: number;
      sourceSlot?: number;
      sourceItemId?: number;
      argsData?: Buffer;
      scriptTrigger?: boolean;
    } = {}
  ): boolean {

    if (player == null || player.getHitpoints() <= 0) {
      return false;
    }

    if (PluginManager.refusesWhileBusy(interfaceId) && player.isLocked()) {
      player.sendMessage(InterfaceActionClickOpcode.BUSY_MESSAGE);
      return true;
    }

    if (player.isTeleportingReturn()) {
      return false;
    }

    return PluginManager.emitInterfaceActionClick({
      player,
      buttonId: interfaceId,
      action,
      ...metadata,
      handled: false,
    });
  }
}
