import { PlayerPunishment } from "../../../util/PlayerPunishment";
import { Misc } from "../../../util/Misc";
import { World } from "../../../game/World";
import { PluginManager } from "../../../plugins/PluginManager";
import { CommandPacketListener } from "./CommandPacketListener";

export class ChatPacketListener {
  private static allowChat(player: any, text: string) {
    if (!text || text.length === 0) {
      return false;
    }
    if (
      PlayerPunishment.muted(player.getUsername()) ||
      PlayerPunishment.IPMuted(player.getHostAddress())
    ) {
      player.sendMessage("You are muted and cannot chat.");
      return false;
    }
    if (Misc.blockedWord(text)) {
      player.sendMessage("Your message did not make it past the filter.");
      return false;
    }
    return true;
  }

  public static handleText(player: any, value: string): void {
    const text = String(value ?? "").replace(/[<>]/g, "").trim().slice(0, 80);
    if (text.startsWith("::")) {
      CommandPacketListener.execute(player, text.slice(2));
      return;
    }
    if (!ChatPacketListener.allowChat(player, text)) return;
    // Let plugins observe or intercept public chat (e.g. NPC dialogue
    // systems). A plugin that marks the event handled suppresses the broadcast.
    const intercepted = PluginManager.emitSocialPacket({
      player,
      packet: { type: "public_chat", text },
      handled: false,
    });
    if (intercepted) return;
    const iconPrefix = (player.getChatIcons?.() ?? [])
      .map((icon: number) => `<img=${icon}>`)
      .join("");
    player.forceChat(`${iconPrefix}${text}`);

    // Local lists can be asymmetric at the 255-player cap. Include clients
    // that render the speaker even when the speaker cannot render them.
    const recipients = [
      player,
      ...player.getLocalPlayers(),
      ...World.getNearbyPlayersForUpdate(player).filter((recipient) =>
        recipient.getLocalPlayers().includes(player)
      ),
    ];
    const sent = new Set<number>();
    for (const recipient of recipients) {
      if (
        !recipient ||
        sent.has(recipient.getIndex()) ||
        (recipient !== player && !recipient.getRelations?.().canReceivePublicChatFrom?.(player))
      ) continue;
      sent.add(recipient.getIndex());
      recipient.getPacketSender().sendPublicChat(
        text,
        `${iconPrefix}${player.getUsername()}`,
        player.getIndex()
      );
    }
  }
}
