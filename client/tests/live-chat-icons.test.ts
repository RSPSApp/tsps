import assert from "node:assert/strict";
import test from "node:test";
import {
    CHAT_ICONS_CHANNEL,
    handleChatIconsPluginMessage,
    type LiveChatIconsHost,
} from "../game/chat/liveChatIcons";
import { CHAT_LINE_REDRAW_SCRIPT } from "../game/input/WasdCamera";

function createHost({ hasChatbox = true }: { hasChatbox?: boolean } = {}) {
    let icons: number[] = [];
    let chatTransmits = 0;
    const scripts: Array<{ widget: unknown; listener: number[] }> = [];
    const chatboxWidget = { uid: 162 << 16 };

    const host: LiveChatIconsHost = {
        getLocalChatIcons: () => icons,
        setLocalChatIcons: (next) => {
            icons = next;
        },
        markChatTransmit: () => {
            chatTransmits++;
        },
        widgetManager: {
            findWidget: (group, child) => (hasChatbox && group === 162 && child === 0 ? chatboxWidget : null),
        },
        executeScriptListener: (widget, listener) => {
            scripts.push({ widget, listener });
        },
    };

    return {
        host,
        chatboxWidget,
        getIcons: () => icons,
        getChatTransmits: () => chatTransmits,
        scripts,
    };
}

test("account:chat-icons updates icons and runs script 223 on 162:0 once; duplicate is a no-op", () => {
    const h = createHost();

    assert.equal(
        handleChatIconsPluginMessage({ channel: CHAT_ICONS_CHANNEL, data: { chatIcons: [1] } }, h.host),
        true,
    );
    assert.deepEqual(h.getIcons(), [1]);
    assert.equal(h.getChatTransmits(), 1);
    assert.equal(h.scripts.length, 1);
    assert.equal(h.scripts[0].widget, h.chatboxWidget);
    assert.deepEqual(h.scripts[0].listener, [CHAT_LINE_REDRAW_SCRIPT]);

    // Duplicate identical icons should not re-trigger chat transmit or script 223.
    assert.equal(
        handleChatIconsPluginMessage({ channel: CHAT_ICONS_CHANNEL, data: { chatIcons: [1] } }, h.host),
        true,
    );
    assert.equal(h.getChatTransmits(), 1);
    assert.equal(h.scripts.length, 1);
});

test("account:chat-icons clears icons on empty array and drops invalid/out-of-range values", () => {
    const h = createHost();

    handleChatIconsPluginMessage(
        { channel: CHAT_ICONS_CHANNEL, data: { chatIcons: [1, -1, 256, "bad", 24.9, NaN] } },
        h.host,
    );
    assert.deepEqual(h.getIcons(), [1, 24]);
    assert.equal(h.scripts.length, 1);

    handleChatIconsPluginMessage({ channel: CHAT_ICONS_CHANNEL, data: { chatIcons: [] } }, h.host);
    assert.deepEqual(h.getIcons(), []);
    assert.equal(h.scripts.length, 2);
});

test("account:chat-icons ignores unrelated channels and tolerates missing chatbox 162:0", () => {
    const h = createHost({ hasChatbox: false });

    assert.equal(
        handleChatIconsPluginMessage({ channel: "actor-visuals", data: { chatIcons: [1] } }, h.host),
        false,
    );
    assert.deepEqual(h.getIcons(), []);

    assert.equal(
        handleChatIconsPluginMessage({ channel: CHAT_ICONS_CHANNEL, data: { chatIcons: [0] } }, h.host),
        true,
    );
    assert.deepEqual(h.getIcons(), [0]);
    assert.equal(h.getChatTransmits(), 1);
    assert.equal(h.scripts.length, 0);
});
