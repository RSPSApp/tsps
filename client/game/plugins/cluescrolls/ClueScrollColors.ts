/*
 * Copyright (c) 2016-2017, Seth <Sethtroll3@gmail.com>
 * Copyright (c) 2018, Lotto <https://github.com/devLotto>
 * All rights reserved.
 * Ported to TypeScript from RuneLite 1.13.6. BSD 2-Clause License, see ./LICENSE.
 */
import { Color } from "@runelite/awt/Color";

/** ClueScrollOverlay.TITLED_CONTENT_COLOR: the grey the clue panels use under their labels. */
export const TITLED_CONTENT_COLOR = new Color(190, 190, 190);

/** ClueScrollWorldOverlay.IMAGE_Z_OFFSET: how far above a tile the clue image floats, in local units. */
export const IMAGE_Z_OFFSET = 30;

/** ClueScrollWorldOverlay's clickbox colours for objects a clue points at. */
export const CLICKBOX_BORDER_COLOR = Color.ORANGE;
export const CLICKBOX_HOVER_BORDER_COLOR = CLICKBOX_BORDER_COLOR.darker();
export const CLICKBOX_FILL_COLOR = new Color(0, 255, 0, 20);

/** RuneLite's check mark and ballot x on requirement lines. */
export const UNICODE_CHECK_MARK = "✓";
export const UNICODE_BALLOT_X = "✗";
