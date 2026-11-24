"use strict";

// Extends the existing player selection and detail pane. No second player list or login.
window.LocalPlayerTools = {
  render(detail, running, el, api, flash, refresh) {
    const tools = detail.tools;
    if (!tools?.enabled) return null;
    const player = detail.player;
    const available = running && player.online;
    let busy = false;
    const root = el("section", { className: "local-player-tools", "aria-label": `Tools for ${player.username}` });
    const controls = el("fieldset", { disabled: !available });
    root.append(el("h3", { text: `Manage ${player.username}` }), el("p", {
      text: available ? "Changes apply now and save immediately." : "Log this player into the running world to use these tools.",
    }), controls);

    const label = (text, input) => el("label", null, [el("span", { text }), input]);
    const input = (value, min, max) => el("input", { type: "number", value, min, max, step: 1, required: true });
    function section(title, children) {
      const box = el("details", { open: title === "Teleport" }, [el("summary", { text: title }), ...children]);
      controls.append(box);
      return box;
    }
    function form(children, submit) {
      return el("form", { onsubmit(event) {
        event.preventDefault();
        if (available && !busy && event.currentTarget.reportValidity()) void submit();
      } }, children);
    }
    async function change(action, options) {
      if (busy || !available || !root.isConnected) return;
      busy = true;
      controls.disabled = true;
      try {
        const result = await api("/api/players/action?name=" + encodeURIComponent(player.id), { action, ...options });
        if (!result.ok) throw new Error(result.body?.error || "The change failed.");
        flash("info", result.body.message);
        await refresh(player.id);
      } catch (error) {
        flash("error", error.message);
      } finally {
        busy = false;
        controls.disabled = !available;
      }
    }

    const named = el("select", { "aria-label": "Named destination" }, tools.destinations.map(place =>
      el("option", { value: place.name, text: `${place.name} (${place.x}, ${place.y}, ${place.z})` })));
    const point = tools.position ?? { x: 0, y: 0, z: 0 };
    const x = input(point.x, 0, 16383), y = input(point.y, 0, 16383), z = input(point.z, 0, 3);
    section("Teleport", [
      el("p", { text: "Owner teleport bypasses travel requirements. Coordinate tiles may be blocked; players in instances must leave in game first." }),
      form([label("Destination", named), el("button", { type: "submit", text: "Teleport to destination" })],
        () => change("teleport", { destination: named.value })),
      form([el("div", { className: "local-player-coordinates" }, [label("X", x), label("Y", y), label("Plane", z)]),
        el("button", { type: "submit", text: "Teleport to coordinates" })],
        () => change("teleport", { x: Number(x.value), y: Number(y.value), z: Number(z.value) })),
    ]);

    let picked;
    let searchVersion = 0;
    const itemName = el("input", { type: "search", placeholder: "e.g. Dragon scimitar", "aria-label": "Search items", maxlength: 80 });
    const matches = el("select", { size: 6, "aria-label": "Matching items", required: true });
    const itemStatus = el("p", { role: "status", text: "Enter at least two letters, then search and select an item." });
    const quantity = input(1, 1, 2147483647);
    const give = el("button", { type: "submit", text: "Give selected item", disabled: true });
    itemName.addEventListener("input", () => {
      searchVersion++;
      picked = undefined;
      matches.replaceChildren();
      give.disabled = true;
      itemStatus.textContent = "Search again to select an item.";
    });
    matches.addEventListener("change", () => {
      picked = matches.value ? Number(matches.value) : undefined;
      give.disabled = picked === undefined;
    });
    section("Give items", [
      form([label("Item name or ID", itemName), el("button", { type: "submit", text: "Search items" })], async () => {
        const version = ++searchVersion;
        picked = undefined;
        give.disabled = true;
        itemStatus.textContent = "Searching...";
        try {
          const result = await api("/api/players/items?q=" + encodeURIComponent(itemName.value));
          if (!root.isConnected || version !== searchVersion) return;
          if (!result.ok) throw new Error(result.body?.error || "Item search failed.");
          matches.replaceChildren(...result.body.items.map(item => el("option", {
            value: item.id, text: `${item.name}${item.noted ? " (noted)" : ""} · ${item.id}${item.stackable ? " · stackable" : ""}`,
          })));
          matches.selectedIndex = -1;
          itemStatus.textContent = result.body.items.length ? `${result.body.items.length} results. Select an item.` : "No items found. Try another name.";
        } catch (error) {
          if (version === searchVersion && root.isConnected) itemStatus.textContent = error.message;
        }
      }),
      itemStatus,
      form([matches, label("Quantity", quantity), give], () => picked === undefined ? undefined : change("give", { itemId: picked, quantity: Number(quantity.value) })),
      el("p", { text: "Items go into this player's inventory. If only part fits, the result reports the actual quantity." }),
    ]);

    const skillSelect = el("select", { "aria-label": "Skill" }, tools.skills.map(skill => el("option", { value: skill.name, text: skill.name })));
    const level = input(tools.skills[0]?.level ?? 1, 1, tools.skills[0]?.maximum ?? 99);
    const skillStatus = el("p", { role: "status" });
    function showSkill() {
      const skill = tools.skills.find(skill => skill.name === skillSelect.value);
      level.min = skill.minimum;
      level.max = skill.maximum;
      level.value = skill.level ?? skill.minimum;
      skillStatus.textContent = `Current ${skill.current ?? "unknown"}, base ${skill.level ?? "unknown"}, XP ${skill.experience ?? "unknown"}. Set base level ${skill.minimum}-${skill.maximum}; XP and current level change too.`;
    }
    skillSelect.addEventListener("change", showSkill);
    showSkill();
    section("Edit stats", [
      form([label("Skill", skillSelect), skillStatus, label("New base level", level),
        el("button", { type: "submit", text: "Set skill level" })], () => change("skill", { skill: skillSelect.value, level: Number(level.value) })),
      el("button", { type: "button", text: "Restore current levels and run energy", onclick: () => change("restore") }),
      el("p", { text: "Restore removes boosts and drains without changing base levels or XP." }),
    ]);

    if (tools.quests?.length) {
      const quests = tools.quests.slice().sort((a, b) => a.name.localeCompare(b.name));
      const questSelect = el("select", { "aria-label": "Quest" }, quests.map(quest => el("option", {
        value: quest.key, text: `${quest.name} (${quest.complete ? "complete" : `stage ${quest.stage}`})`,
      })));
      const mode = el("select", { "aria-label": "Quest action" }, [
        el("option", { value: "complete", text: "Complete with rewards" }),
        el("option", { value: "reset", text: "Reset to not started" }),
      ]);
      const confirmed = el("input", { type: "checkbox", required: true });
      section("Edit quests", [
        el("p", { text: "Complete uses the quest's normal rewards and quest points. Reset adjusts quest points but does not remove items, XP, or quest-specific saved progress. Completing after reset may grant rewards again." }),
        form([label("Quest", questSelect), label("Action", mode), label("I understand the reward and reset effects", confirmed),
          el("button", { type: "submit", text: "Apply quest change" })], () => change("quest", { quest: questSelect.value, mode: mode.value })),
      ]);
    }
    return root;
  },
};
