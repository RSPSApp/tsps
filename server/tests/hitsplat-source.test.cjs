// Run after `yarn build`: node --test tests/hitsplat-source.test.cjs
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Server } = require('../dist/Server');
Server.installProductionPathResolver();

const { PlayerSession } = require('../dist/net/PlayerSession');
const { HitDamage } = require('../dist/game/content/combat/hit/HitDamage');
const { HitMask } = require('../dist/game/content/combat/hit/HitMask');

// RuneLite HitsplatID
const DAMAGE_ME = 16;
const DAMAGE_OTHER = 17;
const BLOCK_ME = 12;
const BLOCK_OTHER = 13;

const me = { name: 'me' };
const someoneElse = { name: 'someone else' };

/** How the session of `viewer` shows `hit` on an actor (`onViewer`: the actor is the viewer). */
function view(viewer, hit, onViewer = false) {
    const session = Object.create(PlayerSession.prototype);
    session.player = viewer;
    return PlayerSession.prototype.hitView.call(session, hit, onViewer);
}

test('my hit on an NPC is my own hitsplat; another player\'s is the darker one', () => {
    const mine = new HitDamage(12, HitMask.RED).setSource(me);
    assert.deepEqual(view(me, mine), { type: DAMAGE_ME, damage: 12 });
    assert.equal(view(someoneElse, mine).type, DAMAGE_OTHER, 'a bystander sees it as someone else\'s');

    const theirs = new HitDamage(0, HitMask.BLUE).setSource(someoneElse);
    assert.equal(view(me, theirs).type, BLOCK_OTHER);
    assert.equal(view(someoneElse, theirs).type, BLOCK_ME);
});

test('hits on me are mine whoever dealt them, and sourceless hits elsewhere are others\'', () => {
    assert.equal(view(me, new HitDamage(7, HitMask.RED).setSource(someoneElse), true).type, DAMAGE_ME);
    assert.equal(view(me, new HitDamage(7, HitMask.RED)).type, DAMAGE_OTHER, 'poison or a hazard on someone else');
});
