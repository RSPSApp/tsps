import assert from 'node:assert/strict';
import { ChatMessage } from '@runelite/api/events';
import { bindChatEvents } from '../runelite/impl/ChatEventSource';
import { WidgetSourceBinder } from '../runelite/impl/ContainerEventSource';
import { encodeChatMessage } from '../../server/src/main/typescript/elvarg/net/protocol/ClientProtocol';
import { decodeServerPacket } from '../network/packet/ServerBinaryDecoder';
import { handleInboundUi } from '../network/serverConnection/handlers/inboundUi';
import { subscribeChatMessages } from '../network/serverConnection/subscriptions/ui';
import { state } from '../network/serverConnection/state';
import { ChatHistoryStore } from '../rs/cs2/ChatHistory';

const events: ChatMessage[] = [], history = new ChatHistoryStore();
const unbind = bindChatEvents(event => events.push(event));
// The same history insertion used by OsrsClient's network subscriber.
const stopHistory = subscribeChatMessages(msg => history.addMessage(msg.chatType ?? msg.messageType, msg.text, msg.from ?? '', msg.prefix ?? ''));
const groupLoadedListeners = new Set<(group: number) => void>();
const groupRemountedListeners = new Set<(group: number) => void>();
const widgets = new Map<number, { text: string }>();
const binder = new WidgetSourceBinder({ widgetManager: { groupLoadedListeners, groupRemountedListeners,
    getWidgetByUid: (id: number) => widgets.get(id) } } as any, event => {
    if (event instanceof ChatMessage) events.push(event);
});
assert.ok(binder.bind());
const receive = (name: string, text: string, group: number) => {
    const line = `${name}|${text}`;
    const packet = decodeServerPacket(encodeChatMessage('game', line, '', '', -1, 114));
    assert.ok(packet);
    assert.ok(handleInboundUi(packet));
    widgets.set((group << 16) | 4, { text: name });
    widgets.set((group << 16) | 6, { text });
    for (const listener of groupLoadedListeners) listener(group);
    for (const listener of groupRemountedListeners) listener(group);
    for (const listener of state.tickListeners) listener(1, 600);
    return line;
};
const npc = receive('Falo the Bard', '<col=ff0000>One<lt>two<gt></col>', 231);
assert.equal(events.length, 1, 'the packet plus widget load/remount is one plugin event');
assert.equal(events[0].getType(), 114);
assert.equal(events[0].getName(), '');
assert.equal(events[0].getMessage(), npc);
const player = receive('DialogueTester', 'Yes please.', 217);
assert.equal(events.length, 2);
receive('DialogueTester', 'Yes please.', 217);
assert.equal(events.length, 3, 'intentional repeated pages are not deduplicated');
assert.equal(history.getLength(114), 3);
assert.equal(history.getByTypeAndLine(114, 0), player);
handleInboundUi(decodeServerPacket(encodeChatMessage('game', 'Ordinary game line.')));
assert.equal(events.length, 4);
assert.equal(events[3].getType(), 0);
unbind(); stopHistory(); binder.release();
assert.equal(groupLoadedListeners.size, 0);
console.log('runelite-dialogue-chat: network history and exactly-once events passed');
