// Attach from Ratcatchers with the actual quest, Felkrash ID and catspeak query.
// Component names and arrow order: pinned revision-241 cat_naming.if at
// https://github.com/Joshua-F/osrs-dumps/blob/6e5033af6215963581a51b348f452320ff18f0f6/interface/cat_naming.if
const CAT_NAME_ATTRIBUTE = 'ratcatchers:cat-name';
const GROUP = 61;
const NAME_TEXT = [10, 11, 12, 13, 14, 15];
// Cache 241 names the last pair in reverse numeric order.
const ARROWS = new Map([[17,[0,-1]],[18,[0,1]],[19,[1,-1]],[20,[1,1]],
  [21,[2,-1]],[22,[2,1]],[23,[3,-1]],[24,[3,1]],[25,[4,-1]],[26,[4,1]],
  [27,[5,1]],[28,[5,-1]]]);
const ENTER = 32;
// PacketSender.sendInterface mounts main modals at 161:16 on this source pin.
const MAIN_MODAL_TARGET = (161 << 16) | 16;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ ';
const ACTIONS = new Set(['NWmYMN', '8JxRbr']);
const HAS_CAT = 'ekmcUN', NO_CAT = 'IZ8YJ3';
const SPEAK = new Set(['C9zc6-', 'IiK5N-']);
const MEOW = new Set(['2MM0pm', 'SsSxEV']);
const uid = child => (GROUP << 16) | child;
let api, quest, felkrashId, understandsCats;
const pending = new WeakMap();
const continuations = new WeakMap();

function candidate(player) {
  const request = {player, candidate:null};
  api.emitCustomEvent('pets:naming-candidate', request);
  return request.candidate;
}

function sameCandidate(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  return a.kind === 'follower' ? a.npc === b.npc : a.slot === b.slot && a.item === b.item;
}

function inConversationRange(player, npc) {
  if (!player?.isRegistered?.() || !npc?.isRegistered?.() || !npc.isVisible?.()
      || npc.getId?.() !== felkrashId) return false;
  if ((player.getPrivateArea?.() ?? null) !== (npc.getPrivateArea?.() ?? null)
      || (npc.isOwnerOnly?.() && npc.getOwner?.() !== player)
      || !(player.getLocalNpcs?.() ?? []).includes(npc)) return false;
  const a = player.getLocation(), b = npc.getLocation();
  return a && b && a.getZ() === b.getZ() && a.isWithinDistance(b, 1);
}

function active(player, state) {
  return !!state && pending.get(player) === state && player.getInterfaceId() === GROUP
    && player.getPacketSender().getSubInterfaceAt(MAIN_MODAL_TARGET) === state.mount
    && player.getLocation().getX() === state.x && player.getLocation().getY() === state.y
    && player.getLocation().getZ() === state.z
    && (player.getPrivateArea?.() ?? null) === state.area
    && quest.isComplete(player) && inConversationRange(player, state.npc)
    && sameCandidate(state.cat, candidate(player));
}

function showLetters(player, letters) {
  const sender = player.getPacketSender();
  for (let i=0; i<NAME_TEXT.length; i++) sender.sendString(letters[i], uid(NAME_TEXT[i]));
}

function eligibility({player, npcId, stepId}) {
  if (npcId !== felkrashId || !player) return null;
  if (stepId === HAS_CAT) return !!candidate(player);
  if (stepId === NO_CAT) return !candidate(player);
  if (!SPEAK.has(stepId) && !MEOW.has(stepId)) return null;
  const state = continuations.get(player);
  const grounded = !!state && state.cat.kind === 'follower'
    && sameCandidate(state.cat, candidate(player));
  return grounded && (SPEAK.has(stepId) ? understandsCats(player) : !understandsCats(player));
}

function open(event) {
  const {player, npc, npcId, stepId} = event;
  if (!player || npcId !== felkrashId || !ACTIONS.has(stepId)) return;
  const cat = candidate(player);
  const allowed = quest.isComplete(player) && inConversationRange(player, npc) && !!cat;
  // Reset the original action chain before opening: otherwise NpcDialogues runs
  // its post-enter suffix immediately and can clobber the newly opened modal.
  event.handled = true;
  player.getPacketSender().sendInterfaceRemoval();
  clearContinuation(player, true);
  if (!allowed) return;
  const old = player.getAttribute(CAT_NAME_ATTRIBUTE);
  // Deliberate TSPS policy: first open starts AAAAAA and arrows cycle A-Z, space;
  // the cache and Wiki do not establish retail initial state or wrap timing.
  const initial = typeof old === 'string' && /^[A-Z ]{6}$/.test(old) ? old : 'AAAAAA';
  player.getPacketSender().sendInterface(GROUP);
  const mount = player.getPacketSender().getSubInterfaceAt(MAIN_MODAL_TARGET);
  // Another synchronous interface:opened listener may replace the mount.
  if (player.getInterfaceId() !== GROUP || !mount || mount.groupId !== GROUP) return;
  const location = player.getLocation();
  const state = {npc, cat, stepId, letters:[...initial], x:location.getX(), y:location.getY(), z:location.getZ(),
    area:player.getPrivateArea?.() ?? null, mount};
  pending.set(player, state);
  showLetters(player, state.letters);
}

function suffix(steps, actionId) {
  const menu = steps.find(step => step.type === 'choice');
  const option = menu?.options?.find(row => row.text === (actionId === 'NWmYMN'
    ? 'Can you train my cat for me?' : 'Can you rename my cat?'));
  const guard = option?.steps?.find(step => step.id === (actionId === 'NWmYMN' ? 'zwP5KS' : HAS_CAT));
  const at = guard?.steps?.findIndex(step => step.id === actionId) ?? -1;
  return at < 0 ? [] : guard.steps.slice(at + 1);
}

function press(event) {
  const {player, buttonId, action} = event;
  if (!player || (buttonId >>> 16) !== GROUP) return false;
  const child = buttonId & 0xffff, arrow = ARROWS.get(child);
  if (!arrow && child !== ENTER) return false;
  // Consume even stale/wrong-op 61 packets: returning false would allow
  // NetworkBuilder to send them to a different active dialogue's option handler.
  event.handled = true;
  if (action !== 1) return;
  const state = pending.get(player);
  if (!active(player, state)) {
    pending.delete(player);
    // Only close the exact mount we opened, never a replacement UI.
    if (state && player.getInterfaceId() === GROUP
        && player.getPacketSender().getSubInterfaceAt(MAIN_MODAL_TARGET) === state.mount) {
      player.getPacketSender().sendInterfaceRemoval();
    }
    return;
  }
  if (arrow) {
    const [column, direction] = arrow;
    const index = ALPHABET.indexOf(state.letters[column]);
    state.letters[column] = ALPHABET[(index + direction + ALPHABET.length) % ALPHABET.length];
    player.getPacketSender().sendString(state.letters[column], uid(NAME_TEXT[column]));
    return;
  }
  const value = state.letters.join('');
  if (!value.trim()) return;
  pending.delete(player); // close emits synchronously; never save or replay twice.
  player.setAttribute(CAT_NAME_ATTRIBUTE, value);
  player.getPacketSender().sendInterfaceRemoval();
  continuations.set(player, state);
  const start = {player, npc:state.npc, npcId:felkrashId,
    variant:{page:'Felkrash',variant:'standard-dialogue-after-ratcatchers'}, exact:true,
    select:steps => suffix(steps, state.stepId), handled:false};
  api.emitCustomEvent('npc-dialogue:start', start);
  if (!start.handled) continuations.delete(player);
  else { state.cancel = start.cancel; state.owner = player.getDialogueManager().getOwner(); }
}

function clearContinuation(player, cancel) {
  const state = continuations.get(player);
  if (!state) return;
  continuations.delete(player);
  if (cancel && typeof state.cancel === 'function') state.cancel();
}

function line(event) {
  const {player, npcId, step} = event;
  const state = player && continuations.get(player);
  if (!state || npcId !== felkrashId) return;
  // NpcDialogues builds multiple lines ahead of display. Validate at each
  // actual presentation, including a same-group chatbox replacement between
  // the Cat line and the already-built player line. The first synchronous
  // presentation captures the named chain owner before its first mount.
  const before = event.before;
  event.before = () => {
    const owner = player.getDialogueManager().getOwner();
    if (continuations.get(player) !== state) { state.cancel?.(); return; }
    if (!state.owner) state.owner = owner;
    else if (!owner || owner !== state.owner || player.getPacketSender().getChatboxOwner() !== state.owner) {
      clearContinuation(player, true);
      return;
    }
    before?.();
  };
  const text = String(event.text ?? '');
  const isNameLine = /\[cat name\]/i.test(text);
  const isCatReply = /^(?:Cat|Kitty)$/i.test(String(step?.speaker ?? ''))
    && (/finally got around to naming/i.test(text) || /^Miaaow!$/i.test(text));
  if (isNameLine) event.text = text.replace(/\[cat name\]/gi, player.getAttribute(CAT_NAME_ATTRIBUTE));
  if (isCatReply && state.cat.kind === 'follower' && sameCandidate(state.cat, candidate(player))) {
    event.speakerId = state.cat.npc.getId();
    event.speakerName = String(step.speaker);
  }
  if (isNameLine || (isCatReply && /^Miaaow!$/i.test(text))) {
    const after = event.after;
    event.after = () => { after?.(); if (continuations.get(player) === state) clearContinuation(player, false); };
  }
}

function closed({player, interfaceId}) {
  if (interfaceId === GROUP) pending.delete(player);
  const state = continuations.get(player);
  if (state?.owner && player.getDialogueManager().getOwner() !== state.owner) clearContinuation(player, false);
}
function changed({player, previousId, interfaceId}) {
  if (previousId === GROUP && interfaceId !== GROUP) pending.delete(player);
}
function opened({player, targetUid}) {
  const state = pending.get(player);
  if (state && targetUid === MAIN_MODAL_TARGET
      && player.getPacketSender().getSubInterfaceAt(MAIN_MODAL_TARGET) !== state.mount) pending.delete(player);
  if (targetUid === MAIN_MODAL_TARGET) clearContinuation(player, true);
}
function movement({player}) {
  const state = pending.get(player);
  clearContinuation(player, true);
  if (!state) return;
  const ours = player.getInterfaceId() === GROUP
    && player.getPacketSender().getSubInterfaceAt(MAIN_MODAL_TARGET) === state.mount;
  pending.delete(player);
  if (ours) player.getPacketSender().sendInterfaceRemoval();
}
function movementInput(event) { if (event.packet?.active === true) movement(event); }
function closeInput({player}) {
  if (player?.getInterfaceId?.() === GROUP) pending.delete(player);
  if (player) clearContinuation(player, true);
}
function choice({player}) { if (player) clearContinuation(player, true); }
function logout({player}) { pending.delete(player); clearContinuation(player, true); }

module.exports = function attachCatNaming(pluginApi, options) {
  api = pluginApi; quest = options.quest; felkrashId = options.felkrashId;
  understandsCats = options.understandsCats;
  api.persistAttribute(CAT_NAME_ATTRIBUTE, '');
  api.onNpcDialogueCondition(eligibility);
  api.onCustomEvent('npc-dialogue:action', open);
  api.onCustomEvent('npc-dialogue:line', line);
  api.onInterfaceActionButton([...ARROWS.keys(), ENTER].map(uid), press);
  api.onCustomEvent('interface:closed', closed);
  api.onCustomEvent('interface:changed', changed);
  api.onCustomEvent('interface:opened', opened);
  api.onCustomEvent('interface:close', closeInput);
  api.onCustomEvent('player:movement-input', movementInput);
  api.onWalkRoute(movement);
  api.onCustomEvent('npc-dialogue:choice', choice);
  api.onPlayerLogout(logout);
  api.onPlayerDisconnect(logout);
};
