import { ConfigGroup, ConfigItem, ConfigSection } from "@runelite/client/config/ConfigItem";

export enum ChatFilterType {
    CENSOR_WORDS = "CENSOR_WORDS",
    CENSOR_MESSAGE = "CENSOR_MESSAGE",
    REMOVE_MESSAGE = "REMOVE_MESSAGE",
}

/** RuneLite 1.13.5 ChatFilterConfig: group, keys, names, sections and defaults as in RuneLite. */
export const ChatFilterConfig = ConfigGroup(
    "chatfilter",
    {
        filteredWords: ConfigItem({
            name: "Filtered words",
            description: "List of filtered words, separated by commas.",
            position: 1,
            section: "filterLists",
            default: "",
        }),
        filteredRegex: ConfigItem({
            name: "Filtered regex",
            description: "List of regular expressions to filter, one per line.",
            position: 2,
            section: "filterLists",
            textArea: true,
            default: "",
        }),
        filteredNames: ConfigItem({
            name: "Filtered names",
            description: "List of filtered names, one per line. Accepts regular expressions.",
            position: 3,
            section: "filterLists",
            textArea: true,
            default: "",
        }),
        filterType: ConfigItem<ChatFilterType>({
            name: "Filter type",
            description: "Configures how the messages are filtered.",
            position: 4,
            enum: ChatFilterType,
            default: ChatFilterType.CENSOR_WORDS,
        }),
        filterFriends: ConfigItem({
            name: "Filter friends",
            description: "Filter your friends' messages.",
            position: 5,
            default: false,
        }),
        filterFriendsChat: ConfigItem({
            keyName: "filterClan",
            name: "Filter friends chat members",
            description: "Filter your friends chat members' messages.",
            position: 6,
            default: false,
        }),
        filterClanChat: ConfigItem({
            name: "Filter clan chat members",
            description: "Filter your clan chat members' messages.",
            position: 7,
            default: false,
        }),
        filterGameChat: ConfigItem({
            name: "Filter game chat",
            description: "Filter your game chat messages.",
            position: 9,
            default: false,
        }),
        collapseGameChat: ConfigItem({
            name: "Collapse game chat",
            description: "Collapse duplicate game chat messages into a single line.",
            position: 10,
            default: false,
        }),
        collapsePlayerChat: ConfigItem({
            name: "Collapse player chat",
            description: "Collapse duplicate player chat messages into a single line.",
            position: 11,
            default: false,
        }),
        maxRepeatedPublicChats: ConfigItem({
            name: "Repeat filter",
            description: "Block player chat message if repeated this many times. 0 is off.",
            position: 12,
            default: 0,
        }),
        stripAccents: ConfigItem({
            name: "Strip accents",
            description: "Remove accents before applying filters.",
            position: 13,
            default: false,
        }),
    },
    {
        sections: {
            filterLists: ConfigSection({
                name: "Filter lists",
                position: 0,
                closedByDefault: true,
            }),
        },
    },
);
