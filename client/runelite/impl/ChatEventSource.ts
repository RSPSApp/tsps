import { ChatMessage } from "@runelite/api/events";
import { subscribeChatMessages } from "../../network/serverConnection/subscriptions/ui";

/** Network chat is authoritative, including dialogue114; widget mounts must not post it again. */
export function bindChatEvents(post: (event: ChatMessage) => void): () => void {
    return subscribeChatMessages((msg) => post(
        new ChatMessage(msg.chatType ?? 0, msg.from ?? "", msg.text ?? "", msg.prefix ?? null),
    ));
}
