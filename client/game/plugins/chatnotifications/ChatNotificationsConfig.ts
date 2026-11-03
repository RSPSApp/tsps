import { ConfigGroup, ConfigItem, ConfigSection } from "@runelite/client/config/ConfigItem";

/**
 * RuneLite 1.13.5 ChatNotificationsConfig: group, keys, names and defaults as in RuneLite. Its
 * Notification items are on/off switches here.
 */
export const ChatNotificationsConfig = ConfigGroup(
    "chatnotification",
    {
        highlightWordsString: ConfigItem({
            name: "Highlight words",
            description: "Highlights the following words in chat, separated by commas.",
            position: 1,
            section: "highlightLists",
            default: "",
        }),
        highlightRegexString: ConfigItem({
            name: "Highlight regex",
            description: "Highlights the following regular expressions in chat, one per line.",
            position: 2,
            section: "highlightLists",
            textArea: true,
            default: "",
        }),
        highlightOwnName: ConfigItem({
            name: "Highlight own name",
            description: "Highlights any instance of your username in chat.",
            position: 1,
            default: true,
        }),
        notifyOnOwnName: ConfigItem({
            name: "Notify on own name",
            description: "Notifies you whenever someone mentions you by name.",
            position: 2,
            default: false,
        }),
        notifyOnHighlight: ConfigItem({
            name: "Notify on highlight",
            description: "Notifies you whenever a highlighted word is matched.",
            position: 3,
            default: false,
        }),
        notifyOnTrade: ConfigItem({
            name: "Notify on trade",
            description: "Notifies you whenever you are traded.",
            position: 4,
            default: false,
        }),
        notifyOnDuel: ConfigItem({
            name: "Notify on duel",
            description: "Notifies you whenever you are challenged to a duel.",
            position: 5,
            default: false,
        }),
        notifyOnBroadcast: ConfigItem({
            name: "Notify on broadcast",
            description: "Notifies you whenever you receive a broadcast message.",
            position: 6,
            default: false,
        }),
        notifyOnPM: ConfigItem({
            name: "Notify on private message",
            description: "Notifies you whenever you receive a private message.",
            position: 7,
            default: false,
        }),
    },
    {
        sections: {
            highlightLists: ConfigSection({ name: "Highlight lists", position: 0 }),
        },
    },
);
