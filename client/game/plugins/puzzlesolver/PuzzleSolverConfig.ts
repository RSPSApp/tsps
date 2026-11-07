/*
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite. BSD 2-Clause License, see ./LICENSE.
 */
import { ConfigGroup, ConfigItem } from "@runelite/client/config/ConfigItem";

/** RuneLite's PuzzleSolverConfig: group, keys, names and defaults as in RuneLite. */
export const PuzzleSolverConfig = ConfigGroup("puzzlesolver", {
    displaySolution: ConfigItem({
        keyName: "displaySolution",
        name: "Display solution",
        description: "Display a solution to the puzzle.",
        position: 0,
        default: true,
    }),
    displayRemainingMoves: ConfigItem({
        keyName: "displayRemainingMoves",
        name: "Display remaining moves",
        description: "Add a text line above puzzle boxes displaying the amount of remaining moves.",
        position: 1,
        default: true,
    }),
    drawDots: ConfigItem({
        keyName: "drawDots",
        name: "Draw dots instead of arrows",
        description: "Draw dots increasing in size instead of arrows for the solution.",
        position: 2,
        default: true,
    }),
    movesToShow: ConfigItem({
        keyName: "movesToShow",
        name: "Number of dots",
        description: "The number of moves as dots to show for the puzzle.",
        position: 3,
        range: { min: 4, max: 8 },
        default: 4,
    }),
    dotColor: ConfigItem({
        keyName: "dotColor",
        name: "Dot start color",
        description: "Dot color for the first solution dot.",
        position: 4,
        color: true,
        default: 0xffffff00, // Color.YELLOW
    }),
    dotEndColor: ConfigItem({
        keyName: "dotEndColor",
        name: "Dot end color",
        description: "Dot color of the last solution dot that dots blend towards.",
        position: 5,
        color: true,
        default: 0xffff0000, // Color.RED
    }),
});
