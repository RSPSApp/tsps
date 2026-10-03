import { PluginManager } from "../../../plugins/PluginManager";

export class InterfaceActionClickOpcode {
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

    if (
      player == null ||
      player.getHitpoints() <= 0 ||
      player.isTeleportingReturn()
    ) {
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
