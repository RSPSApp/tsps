package local.questbridge;

import static org.junit.jupiter.api.Assertions.*;

import com.questhelper.requirements.item.ItemRequirement;
import com.questhelper.steps.*;
import net.runelite.api.coords.WorldPoint;
import org.junit.jupiter.api.Test;

class PresentationTest {
  @Test
  void targetsIncludeNpcWithoutWorldPointAndItemOnGround() {
    try (var engine = new BridgeEngine()) {
      engine.evaluate(BridgeTest.request("targets", 1, "CooksAssistant"));
      var s = engine.sessions.get("targets");
      var npc = new NpcStep(s.helper, 80, "Speak to this NPC.");
      var result = s.export(npc);
      assertEquals(
          80, result.getAsJsonArray("targets").get(0).getAsJsonObject().get("id").getAsInt());
      var item =
          new ItemStep(
              s.helper,
              new WorldPoint(3177, 3296, 0),
              "Get the egg",
              new ItemRequirement("Egg", 1944));
      result = s.export(item);
      assertEquals(
          "item",
          result.getAsJsonArray("targets").get(0).getAsJsonObject().get("kind").getAsString());
      assertEquals(
          1944,
          result
              .getAsJsonArray("targets")
              .get(0)
              .getAsJsonObject()
              .getAsJsonArray("ids")
              .get(0)
              .getAsInt());
    }
  }

  @Test
  void preservesAdditionalMarkedPuzzleTiles() {
    try (var engine = new BridgeEngine()) {
      engine.evaluate(BridgeTest.request("tiles", 1, "CooksAssistant"));
      var s = engine.sessions.get("tiles");
      var step = new DetailedQuestStep(s.helper, "Stand on these tiles.");
      step.addTileMarkers(new WorldPoint(3200, 3200, 0), new WorldPoint(3201, 3201, 0));
      assertEquals(2, s.export(step).getAsJsonArray("targets").size());
    }
  }

  @Test
  void inventoryHighlightsCarryOnlyTheStepsHighlightedRequirements() {
    try (var engine = new BridgeEngine()) {
      engine.evaluate(BridgeTest.request("highlights", 1, "CooksAssistant"));
      var s = engine.sessions.get("highlights");
      var knife = new ItemRequirement("Knife", 946);
      var step =
          new DetailedQuestStep(
              s.helper, "Use a knife on the marked painting.", knife.highlighted());
      var ids = s.export(step).getAsJsonArray("inventoryHighlights");
      assertEquals(1, ids.size(), "the highlighted requirement is exported");
      assertEquals(946, ids.get(0).getAsInt());

      // An unhighlighted requirement stays out: it is a checklist entry, not a hint.
      var plain = new DetailedQuestStep(s.helper, "Use a knife on the marked painting.", knife);
      assertEquals(0, s.export(plain).getAsJsonArray("inventoryHighlights").size());
    }
  }

  @Test
  void standardWidgetStepRetainsActualHighlightDrawing() {
    try (var engine = new BridgeEngine()) {
      var req = BridgeTest.request("widget", 1, "CooksAssistant");
      req.getAsJsonObject("snapshot")
          .add(
              "widgets",
              com.google.gson.JsonParser.parseString(
                  "[{\"id\":65538,\"bounds\":{\"x\":20,\"y\":30,\"width\":40,\"height\":50}}]"));
      engine.evaluate(req);
      var s = engine.sessions.get("widget");
      var step = new WidgetStep(s.helper, "Press this", 1, 2);
      s.services.inject(step);
      assertEquals(2, s.export(step).getAsJsonArray("overlays").size());
    }
  }
}
