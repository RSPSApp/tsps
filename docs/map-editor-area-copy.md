# Copy and paste map areas

In `/host/mapeditor`, use Point to select a tile or drag over an area, then choose **Copy area** in the selection panel. Select the destination's southwest tile and choose **Paste area**. The destination is captured when you click Paste, even if you select something else while the browser asks for clipboard permission.

Paste replaces terrain and objects within the copied rectangle on all four levels, and adds the copied NPC spawns. **Undo** reverses the whole paste; **Redo** restores it. **Save changes** uses the editor's existing host save flow for the affected region packs and NPC spawn patch. Standalone editors use their existing download flow.

New copies include source terrain heights at every corner, including the north and east borders. Procedural terrain heights are made explicit when pasted so moving the area does not generate different ground. NPC spawn positions, facing and wandering settings are retained. Source and destination map data and NPC spawns must have finished loading. Areas use the editor's existing maximum span of 128 by 128 tiles.

The older version-1 clipboard format remains accepted. It contains no NPC spawns or far-edge vertex heights, so those copies retain the destination's north/east boundary heights and add no NPCs. Copy the area again to include both. Missing permissions, unavailable clipboard access, malformed or incomplete records, out-of-map destinations and unavailable destination regions report an error before changing edits or undo history.

`client/tests/edit-mode-area-copy.test.ts` checks narrow/wide terrain, explicit/procedural source heights through the production terrain decoder, all four levels, cross-region object/NPC relocation, boundary heights, invalid input, undo/redo, and mocked DOM clipboard and host-save messages. Rendered editor use and real browser clipboard permissions were not tested; no game clients, browsers or servers were launched.
