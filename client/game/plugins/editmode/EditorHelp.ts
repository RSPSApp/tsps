const topics = [
    { title: "Move around the world", keys: "WASD camera pan zoom world map navigate jump",
      text: "Use WASD to move, hold Shift to move faster, and drag with the right mouse button to turn. Use World map to browse the overworld or caves. Go to takes coordinates or a map square ID." },
    { title: "Edit a floor and show or hide roofs", keys: "plane level visibility upper height building roof",
      text: "Edit floor chooses where your tools work. Show floors controls what you can see. Show through the editing floor to look inside a building, or show all floors to inspect its roof." },
    { title: "Select and move scenery", keys: "object furniture npc duplicate rotate remove delete",
      text: "In Build & Place, choose Select objects and NPCs. Click something in the scene to move, duplicate, rotate, or delete it. For an area or a whole building, choose the matching selection tool first." },
    { title: "Shape and paint terrain", keys: "height lower raise flatten sculpt smoothing brush texture overlay underlay strength path",
      text: "Use Terrain to raise, lower, or smooth hills. Flatten makes a level space for a building. Paint base ground for a broad material, paint an overlay for a surface such as paving, or draw a path between points." },
    { title: "Brush size, strength, and timing", keys: "live drag release radius stroke keyboard",
      text: "Adjust Size and Strength in the brush panel. Live brushing applies as you drag. On release lets you see the affected area before applying. Use [ and ] to change the brush size." },
    { title: "Check where players can walk", keys: "collision block unblock clipping red",
      text: "Use Block walking to stop players crossing a tile and Unblock walking to open it again. Show blocked tiles while you work to check paths and building entrances." },
    { title: "Place objects, NPCs, and items", keys: "search asset preview rotate object npc spawn loot",
      text: "Open Build & Place, choose what you want, and search the cache. Pick a result to arm placement, then click a tile. Press R to rotate. NPC and ground item tools can set how the spawn behaves." },
    { title: "Paint trees and decoration with scatter", keys: "scatter sets biome foliage density plants rock",
      text: "Choose a biome or make a scatter set from your own objects. Set a low density for occasional trees or flowers and a higher density for thick growth. Drag over the ground to paint." },
    { title: "Build structures and reuse areas", keys: "house wall presets stamp copy paste furniture foundation blueprint",
      text: "Draw a straight or diagonal wall, or choose a structure preset to preview a whole building. Copy an area as a stamp to reuse its layout. Use a level foundation when placing a building on hills." },
    { title: "Create a map or extend a coast", keys: "generator terrain landform island river cave chunks squares reroll footprint",
      text: "In Maps, choose Create new map or Expand map portion. Select empty squares and use Add or remove squares for an L shape. Adjust the terrain and inspect it in the world. Reroll to try another layout, then choose Keep this terrain." },
    { title: "Connect places with travel links", keys: "warp teleport doors ladders portals destination return two way",
      text: "In Travel & Warps, pick the source object, name its action, and choose a destination tile or arrival object. Add a return link when players should be able to travel both ways." },
    { title: "Draw gameplay zones", keys: "pvp safe duel multi combat f2p overlay boundary",
      text: "In Maps, choose Edit gameplay zones to draw, resize, or remove an area. Use Zone overlays in the bottom bar to choose which zone boundaries you see while editing." },
    { title: "Save and play your map", keys: "server publish layer export zip install load restart cache",
      text: "Open Review changes to check and save your draft. Choose your server’s data folder when prompted, or export a ZIP for that server. Follow the Load in game or restart instruction after saving." },
    { title: "Undo an edit or restore a save", keys: "undo redo backup rollback delete cancel ctrl z y",
      text: "Use Undo and Redo for edits in the current draft. To put saved files back, open Maps, then Manage map files, and choose a backup. Restart the server to apply the restored layer." },
];

export function attachEditorHelp(panel: HTMLElement): void {
    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search map editor help";
    search.setAttribute("aria-label", search.placeholder);
    const results = document.createElement("div");
    results.className = "ghost-help-topics";
    const render = () => {
        const words = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
        const matches = topics.filter(({ title, keys, text }) =>
            words.every((word) => `${title} ${keys} ${text}`.toLowerCase().includes(word)));
        results.replaceChildren(...matches.map(({ title, text }) => {
            const article = document.createElement("details");
            article.open = matches.length === 1;
            const heading = document.createElement("summary");
            heading.textContent = title;
            const body = document.createElement("p");
            body.textContent = text;
            article.append(heading, body);
            return article;
        }));
        if (!matches.length) {
            const empty = document.createElement("p");
            empty.textContent = "No matching topics. Try a tool name, such as scatter or warp.";
            results.append(empty);
        }
    };
    search.addEventListener("input", render);
    panel.append(search, results);
    render();
    search.focus();
}
