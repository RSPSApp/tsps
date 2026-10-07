/**
 * The two chatbox shapes the Stronghold uses that have no dialogue entry yet, as captured:
 * - a door speaking: chat_left (231) with its floor's door NPC as the head, playing
 *   door_chathead (4281), under the door's name ("Rickety Door|...");
 * - objectbox_double (11): two items beside the text, for the Cradle of Life's boots.
 */
const { Dialogue } = require("../../../src/main/typescript/elvarg/game/model/dialogues/entries/Dialogue");

const PAUSE_BUTTON = 1;
const uid = (group, child) => (group << 16) | child;

const DOOR_CHATHEAD = 4281;

class DoorChatDialogue extends Dialogue {
  constructor(index, head, name, text) {
    super(index);
    this.head = head;
    this.name = name;
    this.text = text;
  }

  send(player) {
    player.getPacketSender()
      .sendChatboxInterface(231)
      .sendNpcHeadOnInterface(this.head, uid(231, 2))
      .sendInterfaceAnimation(uid(231, 2), DOOR_CHATHEAD)
      .sendString(this.name, uid(231, 4));
    Dialogue.sendChatText(player, this.text, uid(231, 6), uid(231, 5));
  }
}

class DoubleItemDialogue extends Dialogue {
  constructor(index, firstItem, secondItem, text) {
    super(index);
    this.firstItem = firstItem;
    this.secondItem = secondItem;
    this.text = text;
  }

  send(player) {
    player.getPacketSender()
      .sendChatboxInterface(11)
      .sendString("Click here to continue", uid(11, 4))
      .sendInterfaceFlagsRange(uid(11, 4), -1, -1, PAUSE_BUTTON)
      .sendItemOnInterfaces(uid(11, 1), this.firstItem, 400)
      .sendItemOnInterfaces(uid(11, 3), this.secondItem, 400)
      .sendString(this.text, uid(11, 2));
  }
}

module.exports = { DoorChatDialogue, DoubleItemDialogue };
