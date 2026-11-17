// Computer adventurers: simple, readable strategies.
// They only use what that player could know (their own cards, the face-up
// cards, gold and what everyone has claimed), so they also work on the view
// an online player receives. They bluff now and then, and sometimes call
// a bluff, which keeps them unpredictable but beatable.

(function (root) {
  'use strict';
  const TW = root.TW || (typeof require !== 'undefined' ? require('./rules.js') : null);

  const chance = (p) => Math.random() < p;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  // How much a computer likes keeping each character (higher = keep it).
  const KEEP = { rogue: 5, guildmaster: 5, bard: 3, wizard: 3, paladin: 2 };

  const has = (state, me, type) => state.hands[me].some((c) => c && c.type === type);
  const rivals = (state, me) => TW.alivePlayers(state).filter((i) => i !== me);
  const claimedLately = (state, i, type) => state.claims[i].slice(-3).includes(type);

  // The rival most worth attacking: the most influence, then the most gold.
  function biggestThreat(state, me, list = rivals(state, me)) {
    const score = (i) => state.hands[i].length * 100 + state.coins[i];
    const best = Math.max(...list.map(score));
    return pick(list.filter((i) => score(i) === best));
  }

  // Returns { kind, target } for the player whose turn it is.
  function chooseAction(state, me) {
    const coins = state.coins[me];
    const legal = (kind) => TW.availableActions(state, me).find((o) => o.kind === kind).legal;
    const threat = biggestThreat(state, me);

    if (legal('coup') && (coins >= TW.MUST_COUP || chance(0.85))) return { kind: 'coup', target: threat };

    // Avoid assassinating someone who keeps claiming the Paladin, if there's a choice.
    const unguarded = rivals(state, me).filter((i) => !claimedLately(state, i, 'paladin'));
    const victim = unguarded.length ? biggestThreat(state, me, unguarded) : threat;
    if (legal('assassinate') && has(state, me, 'rogue')) return { kind: 'assassinate', target: victim };
    if (has(state, me, 'guildmaster')) return { kind: 'tax' };

    const marks = rivals(state, me)
      .filter((i) => state.coins[i] >= 2 && !claimedLately(state, i, 'bard') && !claimedLately(state, i, 'wizard'))
      .sort((a, b) => state.coins[b] - state.coins[a]);
    if (has(state, me, 'bard') && marks.length) return { kind: 'steal', target: marks[0] };
    if (has(state, me, 'wizard') && chance(0.5)) return { kind: 'exchange' };

    // Bluffs.
    if (chance(0.25)) return { kind: 'tax' };
    if (legal('assassinate') && chance(0.12)) return { kind: 'assassinate', target: victim };
    if (marks.length && chance(0.15)) return { kind: 'steal', target: marks[0] };

    const guildWatching = rivals(state, me).some((i) => claimedLately(state, i, 'guildmaster'));
    return guildWatching ? { kind: 'income' } : { kind: 'aid' };
  }

  // Returns { choice: 'allow' | 'challenge' | 'block', as } during a response window.
  function chooseResponse(state, me) {
    const p = state.pending;
    const a = TW.ACTIONS[p.kind];
    const opts = TW.responseOptions(state, me);
    const lives = state.hands[me].length;
    const allow = { choice: 'allow' };
    const challenge = { choice: 'challenge' };
    const block = (as) => ({ choice: 'block', as });
    const copies = (type) => TW.possibleCopies(state, me, type);

    if (p.stage === 'block') {
      if (!opts.challenge) return allow;
      if (copies(p.block.as) === 0) return challenge; // every copy is accounted for: a sure bluff
      let odds = p.actor === me ? 0.15 : 0.04;
      if (copies(p.block.as) === 1) odds += 0.15;
      if (lives === 1) odds /= 2;
      return chance(odds) ? challenge : allow;
    }

    if (opts.challenge && copies(a.claim) === 0) return challenge;
    const real = opts.blocks.find((t) => has(state, me, t));
    if (real) return block(real);

    const targeted = p.target === me;
    if (p.kind === 'assassinate' && targeted && opts.blocks.length) {
      // With one influence left, doing nothing means certain banishment.
      if (lives === 1) return chance(0.5) || !opts.challenge ? block('paladin') : challenge;
      if (chance(0.3)) return block('paladin');
    }
    if (p.kind === 'steal' && targeted && opts.blocks.length && state.coins[me] >= 2 && chance(0.25)) return block(pick(opts.blocks));
    if (p.kind === 'aid' && opts.blocks.length && state.coins[p.actor] >= 5 && chance(0.15)) return block('guildmaster');

    if (opts.challenge) {
      let odds = targeted ? 0.15 : 0.05;
      if (copies(a.claim) === 1) odds += 0.2;
      if (lives === 1) odds /= 2;
      if (chance(odds)) return challenge;
    }
    return allow;
  }

  // Reveal the card we'd least like to keep.
  function chooseLoss(state, me) {
    const hand = state.hands[me].slice().sort((x, y) => KEEP[x.type] - KEEP[y.type]);
    return { cardId: hand[0].id };
  }

  // Arcane Study: keep the best cards, preferring two different characters.
  function chooseExchange(state, me) {
    const need = state.hands[me].length;
    const pool = [...state.hands[me], ...state.pending.drawn].sort((x, y) => KEEP[y.type] - KEEP[x.type]);
    const keep = [];
    pool.forEach((c) => { if (keep.length < need && !keep.some((k) => k.type === c.type)) keep.push(c); });
    pool.forEach((c) => { if (keep.length < need && !keep.includes(c)) keep.push(c); });
    return { keepIds: keep.map((c) => c.id) };
  }

  // Two-player variant: keep a strong character.
  function chooseDraft(state, me) {
    const options = state.draft.options[me];
    const type = pick(['guildmaster', 'rogue', 'guildmaster', 'rogue', 'bard']);
    return { cardId: options.find((c) => c.type === type).id };
  }

  const Bots = { chooseAction, chooseResponse, chooseLoss, chooseExchange, chooseDraft };
  if (typeof module !== 'undefined' && module.exports) module.exports = Bots;
  else root.Bots = Bots;
})(typeof window !== 'undefined' ? window : globalThis);
