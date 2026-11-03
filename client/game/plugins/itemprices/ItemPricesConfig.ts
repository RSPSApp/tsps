import { ConfigGroup, ConfigItem } from "../../../runelite/client/config/ConfigItem";

export const ItemPricesConfig = ConfigGroup("itemprices", {
    showGEPrice: ConfigItem({ name: "Show Grand Exchange prices", description: "Grand Exchange prices should be shown on tooltips.", default: true, position: 1 }),
    showHAValue: ConfigItem({ name: "Show high alchemy values", description: "High alchemy values should be shown on tooltips.", default: true, position: 2 }),
    showEA: ConfigItem({ name: "Show price each on stacks", description: "Show the value of each item in a stack.", default: true, position: 3 }),
    hideInventory: ConfigItem({ name: "Hide tooltips on inventory items", description: "Hide tooltips on items in the inventory.", default: true, position: 4 }),
    showAlchProfit: ConfigItem({ name: "Show high alchemy profit", description: "Show the profit from casting high alchemy on items.", default: false, position: 5 }),
    showWhileAlching: ConfigItem({ name: "Show prices while alching", description: "Show prices while using High Level Alchemy. Takes priority over hiding inventory tooltips.", default: true, position: 6 }),
});
