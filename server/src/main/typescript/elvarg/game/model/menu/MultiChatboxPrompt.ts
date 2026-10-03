import { PluginInterfaceActionClickEvent } from "../../../plugins/PluginTypes";

type MultiChatboxPromptCallback = (
  player: any,
  optionIndex: number,
  optionText: string
) => void;

type MultiChatboxPromptOption = {
  text: string;
  callback: MultiChatboxPromptCallback;
};

type PendingMultiChatboxPrompt = {
  pluginName: string;
  title: string;
  options: MultiChatboxPromptOption[];
  expiresAt: number;
};

export class MultiChatboxPrompt {
  private static pendingPrompts = new WeakMap<any, PendingMultiChatboxPrompt>();
  private static readonly INTERFACE_ID = 219;
  /** Option n is picked with a resume (dialogue_continue) on this widget, childIndex n. */
  public static readonly OPTIONS_WIDGET_ID = (219 << 16) | 1;
  private static readonly PROMPT_TTL_MS = 10 * 60_000;

  public static showPrompt(
    pluginName: string,
    player: any,
    title: string,
    optionCallbackPairs: Array<string | MultiChatboxPromptCallback>
  ): boolean {
    if (
      !player ||
      !player.getPacketSender ||
      typeof title !== "string" ||
      !title.trim().length
    ) {
      return false;
    }

    if (
      !Array.isArray(optionCallbackPairs) ||
      optionCallbackPairs.length < 2 ||
      optionCallbackPairs.length % 2 !== 0
    ) {
      console.warn(
        `[plugins] ${pluginName} attempted invalid sendMultiChatboxPrompt registration`
      );
      return false;
    }

    const options: MultiChatboxPromptOption[] = [];
    for (let i = 0; i < optionCallbackPairs.length; i += 2) {
      const optionText = optionCallbackPairs[i];
      const callback = optionCallbackPairs[i + 1];
      if (
        typeof optionText !== "string" ||
        !optionText.trim().length ||
        typeof callback !== "function"
      ) {
        console.warn(
          `[plugins] ${pluginName} attempted invalid sendMultiChatboxPrompt option pair at index ${i}`
        );
        return false;
      }
      options.push({ text: optionText, callback });
    }

    if (options.length > 5) {
      console.warn(
        `[plugins] ${pluginName} attempted unsupported sendMultiChatboxPrompt option count=${options.length}`
      );
      return false;
    }

    // Cache script 58 always renders at least two options.
    if (options.length === 1) {
      options.push({ text: "Cancel", callback: () => {} });
    }

    const sender = player.getPacketSender();
    sender.sendInterfaceScript(2379);
    sender.sendVarbit(10670, 1);
    sender.sendChatboxInterface(MultiChatboxPrompt.INTERFACE_ID);
    sender.sendClientScript(58, title, options.map((option) => option.text).join("|"));
    sender.sendInterfaceFlagsRange(
      MultiChatboxPrompt.OPTIONS_WIDGET_ID,
      1,
      options.length,
      1
    );

    MultiChatboxPrompt.pendingPrompts.set(player, {
      pluginName,
      title,
      options,
      expiresAt: Date.now() + MultiChatboxPrompt.PROMPT_TTL_MS,
    });

    return true;
  }

  /** The prompt the player has open, if any. */
  public static getPending(player: any): { title: string; options: string[] } | null {
    const pending = MultiChatboxPrompt.pendingPrompts.get(player);
    // Closing the chatbox another way (walking off, a new dialogue) leaves the entry behind.
    if (!pending || pending.expiresAt < Date.now()) return null;
    if (!player.getPacketSender?.()?.isChatboxInterface?.(MultiChatboxPrompt.INTERFACE_ID)) return null;
    return {
      title: pending.title,
      options: pending.options.map((option) => option.text),
    };
  }

  public static handleInterfaceActionClick(
    event: PluginInterfaceActionClickEvent
  ): boolean {
    const pending = MultiChatboxPrompt.pendingPrompts.get(event.player);
    if (!pending) {
      return false;
    }
    if (!Number.isInteger(pending.expiresAt) || pending.expiresAt < Date.now()) {
      MultiChatboxPrompt.pendingPrompts.delete(event.player);
      event.player?.getPacketSender?.()?.sendInterfaceRemoval?.();
      return false;
    }
    if (
      event.buttonId !== MultiChatboxPrompt.OPTIONS_WIDGET_ID &&
      event.groupId !== MultiChatboxPrompt.INTERFACE_ID
    ) {
      return false;
    }

    const optionNumber = typeof event.slot === "number" && Number.isInteger(event.slot)
      ? event.slot
      : event.action;
    return MultiChatboxPrompt.selectOption(event.player, optionNumber - 1);
  }

  private static selectOption(player: any, optionIndex: number): boolean {
    const pending = MultiChatboxPrompt.pendingPrompts.get(player);
    if (!pending) {
      return false;
    }
    if (!Number.isInteger(pending.expiresAt) || pending.expiresAt < Date.now()) {
      MultiChatboxPrompt.pendingPrompts.delete(player);
      player?.getPacketSender?.()?.sendInterfaceRemoval?.();
      return false;
    }
    if (
      !Number.isInteger(optionIndex) ||
      optionIndex < 0 ||
      optionIndex >= pending.options.length
    ) {
      return false;
    }

    MultiChatboxPrompt.pendingPrompts.delete(player);
    const selected = pending.options[optionIndex];
    try {
      player?.getPacketSender?.()?.sendInterfaceRemoval?.();
    } catch (err) {
      console.error(
        `[plugins] multi_chatbox_prompt close failed (${pending.pluginName})`,
        err
      );
    }
    try {
      selected.callback(player, optionIndex, selected.text);
    } catch (err) {
      console.error(
        `[plugins] multi_chatbox_prompt callback failed (${pending.pluginName})`,
        err
      );
    }
    return true;
  }
}
