// Throne of Whispers — game rules.
// This file knows nothing about screens or buttons. It only holds the game
// state and the rules for changing it, so the host's browser can run the
// real game for online play.
//
// A turn goes like this:
//   'action'   the player whose turn it is declares an action
//   'respond'  other players may allow it, challenge the claim, or block it
//              (and a block can itself be challenged)
//   'lose'     someone who lost a challenge (or was hit) picks a card to reveal
//   'exchange' the Wizard's Arcane Study: pick which cards to keep
// The two-player variant starts with a 'draft' where each player picks a card.

(function (root) {
  'use strict';

  const COPIES = 3; // of each character
  const MUST_COUP = 10;

  const CHARACTERS = {
    guildmaster: { name: 'Guild Master', icon: '🏛️', action: 'Collect 3 gold (Guild Revenue).', block: 'Blocks Call in a Favor.' },
    rogue: { name: 'Rogue', icon: '🗡️', action: 'Pay 3 gold to assassinate.', block: 'None.' },
    bard: { name: 'Bard', icon: '🎻', action: 'Steal up to 2 gold (Pickpocket).', block: 'Blocks stealing.' },
    wizard: { name: 'Wizard', icon: '🧙', action: 'Exchange cards with the Court (Arcane Study).', block: 'Blocks stealing.' },
    paladin: { name: 'Paladin', icon: '🛡️', action: 'None.', block: 'Blocks assassination.' },
  };
  const TYPES = Object.keys(CHARACTERS);

  // claim: the character you must claim. blockers: who can block it.
  // anyoneBlocks: every other player may block (otherwise only the target).
  const ACTIONS = {
    income: { name: 'Scavenge', alt: 'Income', icon: '🪙', text: 'Take 1 gold. Cannot be challenged or blocked.' },
    aid: { name: 'Call in a Favor', alt: 'Foreign Aid', icon: '🤝', blockers: ['guildmaster'], anyoneBlocks: true,
      text: 'Take 2 gold. Anyone claiming the Guild Master can block it.' },
    coup: { name: 'Coup', alt: 'Overthrow', icon: '⚔️', cost: 7, target: true,
      text: 'Pay 7 gold. A player loses an influence. Cannot be stopped.' },
    tax: { name: 'Guild Revenue', icon: '🏛️', claim: 'guildmaster', text: 'Take 3 gold.' },
    assassinate: { name: 'Assassinate', icon: '🗡️', claim: 'rogue', cost: 3, target: true, blockers: ['paladin'],
      text: 'Pay 3 gold. A player loses an influence. Their Paladin can block it.' },
    steal: { name: 'Pickpocket', icon: '🎻', claim: 'bard', target: true, blockers: ['bard', 'wizard'],
      text: 'Take 2 gold from a player. Their Bard or Wizard can block it.' },
    exchange: { name: 'Arcane Study', icon: '🧙', claim: 'wizard',
      text: 'Draw 2 cards from the Royal Court, keep any of them, and put 2 back.' },
  };
  const ACTION_ORDER = ['income', 'aid', 'coup', 'tax', 'assassinate', 'steal', 'exchange'];

  // ---------- Deck ----------

  function buildDeck() {
    const deck = [];
    for (const type of TYPES) {
      for (let k = 1; k <= COPIES; k++) deck.push({ id: `${type}-${k}`, type });
    }
    return deck;
  }

  function shuffle(cards, random = Math.random) {
    const a = cards.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // ---------- Helpers ----------

  const charLabel = (type) => `${CHARACTERS[type].icon} ${CHARACTERS[type].name}`;
  const nameOf = (state, i) => state.players[i].name;
  const alivePlayers = (state) => state.players.map((p) => p.id).filter((i) => !state.out[i]);
  const validTargets = (state, player) => alivePlayers(state).filter((i) => i !== player);

  // How many copies of a character could still be hidden somewhere, as far as
  // `viewer` can tell: 3, minus the face-up ones, minus the viewer's own.
  function possibleCopies(state, viewer, type) {
    let n = COPIES;
    const count = (list) => list.forEach((c) => { if (c && c.type === type) n--; });
    state.revealed.forEach(count);
    if (viewer !== null && viewer !== undefined) {
      count(state.hands[viewer]);
      count(state.removed[viewer]);
    }
    return Math.max(0, n);
  }

  function addEvent(state, text, extra = {}) {
    const ev = { seq: ++state.seq, text, private: {}, ...extra };
    state.log.push(ev);
    state.lastEvent = ev;
    return ev;
  }

  // ---------- Setup ----------

  function createGame({ players, teaching = false, variant = false, random = Math.random, first }) {
    const n = players.length;
    if (n < 2 || n > 6) throw new Error('Throne of Whispers needs 2 to 6 players.');
    const starter = first === undefined ? Math.floor(random() * n) : first;
    const state = {
      players: players.map((p, i) => ({ id: i, name: p.name, isBot: !!p.isBot })),
      teaching,
      variant: !!variant && n === 2,
      // With only two players, the starting player gets 1 gold instead of 2.
      coins: players.map((_, i) => (n === 2 && i === starter ? 1 : 2)),
      hands: players.map(() => []),     // face-down cards (influence)
      revealed: players.map(() => []),  // face-up cards (lost influence)
      removed: players.map(() => []),   // two-player variant: the 4 cards each player discarded
      claims: players.map(() => []),    // characters each player has claimed, oldest first
      court: [],                         // the Royal Court deck (top = end of the array)
      out: players.map(() => false),
      outOrder: [],
      turn: starter,
      starter,
      phase: 'action',
      pending: null,
      losses: [],
      then: null,
      draft: null,
      winner: null,
      log: [],
      seq: 0,
      lastEvent: null,
      random,
    };
    const goesFirst = `${nameOf(state, starter)} goes first${n === 2 ? ' and starts with 1 gold (two-player rule)' : ''}.`;
    if (state.variant) {
      const set = (k) => TYPES.map((type) => ({ id: `${type}-${k}`, type }));
      state.draft = { options: [set(1), set(2)], chosen: [null, null], third: shuffle(set(3), random) };
      state.phase = 'draft';
      addEvent(state, `Two-player variant: each player secretly chooses one character from a full set of five. ${goesFirst}`);
    } else {
      const deck = shuffle(buildDeck(), random);
      state.hands = players.map(() => [deck.pop(), deck.pop()]);
      state.court = deck;
      addEvent(state, `Everyone has 2 secret characters and 2 gold. ${goesFirst}`);
    }
    return state;
  }

  // Two-player variant: keep one card from your set of five.
  function draftPick(state, player, { cardId } = {}) {
    if (state.phase !== 'draft') throw new Error('Not time to choose a character.');
    if (state.draft.chosen[player]) throw new Error('You already chose.');
    const card = state.draft.options[player].find((c) => c.id === cardId);
    if (!card) throw new Error('Choose one of your five cards.');
    state.draft.chosen[player] = card;
    if (state.draft.chosen.some((c) => !c)) return;
    const third = state.draft.third;
    state.players.forEach((_, i) => {
      const keep = state.draft.chosen[i];
      state.removed[i] = state.draft.options[i].filter((c) => c !== keep);
      state.hands[i] = [keep, third.pop()];
    });
    state.court = shuffle(third, state.random);
    state.draft = null;
    state.phase = 'action';
    addEvent(state, 'Both players chose a character and were dealt a second card. The other three form the Royal Court.');
  }

  // ---------- Actions ----------

  // Every action, with whether this player may take it right now.
  function availableActions(state, player) {
    const coins = state.coins[player];
    const forced = coins >= MUST_COUP;
    return ACTION_ORDER.map((kind) => {
      const a = ACTIONS[kind];
      if (forced && kind !== 'coup') return { kind, legal: false, reason: `You have ${MUST_COUP} or more gold, so you must launch a Coup.` };
      if (a.cost && coins < a.cost) return { kind, legal: false, reason: `You need ${a.cost} gold.` };
      return { kind, legal: true };
    });
  }

  function declare(state, player, { kind, target = null } = {}) {
    if (state.phase !== 'action') throw new Error('Not time to choose an action.');
    if (player !== state.turn) throw new Error('Not your turn.');
    const option = availableActions(state, player).find((o) => o.kind === kind);
    if (!option) throw new Error('Unknown action.');
    if (!option.legal) throw new Error(option.reason);
    const a = ACTIONS[kind];
    if (a.target) {
      if (!validTargets(state, player).includes(target)) throw new Error('Choose another player who is still in the game.');
    } else {
      target = null;
    }
    const cost = a.cost || 0;
    state.coins[player] -= cost;
    if (a.claim) state.claims[player].push(a.claim);

    const A = nameOf(state, player);
    const T = target !== null ? nameOf(state, target) : '';
    const text = {
      income: `${A} scavenges 1 gold.`,
      aid: `${A} calls in a favor to take 2 gold.`,
      coup: `${A} pays 7 gold and launches a ⚔️ Coup against ${T}!`,
      tax: `${A} claims the ${charLabel('guildmaster')} to collect 3 gold in Guild Revenue.`,
      assassinate: `${A} claims the ${charLabel('rogue')} and pays 3 gold to assassinate ${T}!`,
      steal: `${A} claims the ${charLabel('bard')} to pickpocket ${T}.`,
      exchange: `${A} claims the ${charLabel('wizard')} to exchange cards with the Royal Court.`,
    }[kind];
    addEvent(state, text, { kind: 'declare', actor: player, action: kind, target });

    if (kind === 'income') {
      state.coins[player] += 1;
      return endTurn(state);
    }
    state.pending = { actor: player, kind, target, stage: 'action', passed: [], block: null, paid: cost, drawn: null };
    if (kind === 'coup') {
      state.losses.push({ player: target, why: 'coup' });
      state.then = 'endTurn';
      return proceed(state);
    }
    state.phase = 'respond';
  }

  // ---------- Challenges and blocks ----------

  // What one player may do in the current response window.
  // stage 'action': the action was just declared (challenge and/or block)
  // stage 'blockOnly': a challenge failed; the action can still be blocked
  // stage 'block': someone blocked; anyone else may challenge the block
  function responseOptions(state, player) {
    const p = state.pending;
    const none = { challenge: false, blocks: [] };
    if (!p || state.phase !== 'respond' || state.out[player]) return none;
    if (p.stage === 'block') return { challenge: player !== p.block.blocker, blocks: [] };
    if (player === p.actor) return none;
    const a = ACTIONS[p.kind];
    const canBlock = !!a.blockers && (a.anyoneBlocks || player === p.target);
    return { challenge: p.stage === 'action' && !!a.claim, blocks: canBlock ? a.blockers.slice() : [] };
  }

  // Everyone who gets a say in the current response window.
  function responders(state) {
    if (state.phase !== 'respond') return [];
    return alivePlayers(state).filter((i) => {
      const o = responseOptions(state, i);
      return o.challenge || o.blocks.length > 0;
    });
  }

  // Those who still have to answer.
  function waitingOn(state) {
    if (state.phase !== 'respond') return [];
    return responders(state).filter((i) => !state.pending.passed.includes(i));
  }

  function respond(state, player, { choice, as } = {}) {
    if (state.phase !== 'respond') throw new Error('Nothing to respond to right now.');
    if (!waitingOn(state).includes(player)) throw new Error('You have already answered.');
    const p = state.pending;
    const options = responseOptions(state, player);
    if (choice === 'allow') {
      p.passed.push(player);
      if (!waitingOn(state).length) closeWindow(state);
      return;
    }
    if (choice === 'challenge') {
      if (!options.challenge) throw new Error('You cannot challenge this.');
      return challenge(state, player);
    }
    if (choice === 'block') {
      if (!options.blocks.includes(as)) throw new Error('You cannot block with that character.');
      p.block = { blocker: player, as };
      p.stage = 'block';
      p.passed = [];
      state.claims[player].push(as);
      addEvent(state, `${nameOf(state, player)} claims the ${charLabel(as)} to block ${nameOf(state, p.actor)}'s ${ACTIONS[p.kind].name}!`,
        { kind: 'block', actor: player });
      if (!waitingOn(state).length) closeWindow(state);
      return;
    }
    throw new Error('Choose Allow, Challenge or Block.');
  }

  // Everyone allowed it.
  function closeWindow(state) {
    if (state.pending.stage === 'block') return blockStands(state);
    return perform(state);
  }

  function challenge(state, challenger) {
    const p = state.pending;
    const onBlock = p.stage === 'block';
    const claimant = onBlock ? p.block.blocker : p.actor;
    const type = onBlock ? p.block.as : ACTIONS[p.kind].claim;
    const card = state.hands[claimant].find((c) => c.type === type);
    const C = nameOf(state, challenger);
    const X = nameOf(state, claimant);
    let text = `${C} challenges ${X}'s claim to have the ${charLabel(type)}! `;
    const ev = { kind: 'challenge', big: true, actor: challenger, claimant, claim: type, proven: !!card };
    if (card) {
      // Proven: show it, shuffle it into the Court and draw a replacement.
      text += `${X} reveals the ${charLabel(type)}, so ${C} loses the challenge and an influence. `
        + `${X} shuffles the card into the Royal Court and draws a new one.`;
      state.hands[claimant] = state.hands[claimant].filter((c) => c !== card);
      state.court.push(card);
      state.court = shuffle(state.court, state.random);
      const fresh = state.court.pop();
      state.hands[claimant].push(fresh);
      ev.shown = card;
      const e = addEvent(state, text, ev);
      e.private[claimant] = `Your new card from the Royal Court: ${charLabel(fresh.type)}.`;
      state.losses.push({ player: challenger, why: 'challenge' });
      state.then = onBlock ? 'blockStands' : 'actionProven';
    } else {
      text += `${X} does not have the ${charLabel(type)}, so ${X} loses the challenge and an influence.`;
      addEvent(state, text, ev);
      state.losses.push({ player: claimant, why: 'challenge' });
      state.then = onBlock ? 'perform' : 'actionFails';
    }
    proceed(state);
  }

  // ---------- Losing influence ----------

  // Work through anyone who has to lose an influence, then carry on.
  function proceed(state) {
    while (state.losses.length) {
      if (checkWinner(state)) return;
      const { player } = state.losses[0];
      if (state.out[player]) { state.losses.shift(); continue; }
      if (state.hands[player].length === 1) {
        state.losses.shift();
        revealCard(state, player, state.hands[player][0].id);
        continue;
      }
      state.phase = 'lose'; // they choose which card to reveal
      return;
    }
    if (checkWinner(state)) return;
    const step = state.then;
    state.then = null;
    if (step === 'actionProven') return actionProven(state);
    if (step === 'actionFails') return actionFails(state);
    if (step === 'blockStands') return blockStands(state);
    if (step === 'perform') return perform(state);
    return endTurn(state);
  }

  function revealCard(state, player, cardId, chosenBy) {
    const card = state.hands[player].find((c) => c.id === cardId);
    if (!card) throw new Error('That card is not in your hand.');
    state.hands[player] = state.hands[player].filter((c) => c !== card);
    state.revealed[player].push(card);
    const P = nameOf(state, player);
    let text = `${P} loses an influence and reveals the ${charLabel(card.type)}.`;
    const banished = !state.hands[player].length;
    if (banished) {
      const gold = state.coins[player];
      state.out[player] = true;
      state.outOrder.push(player);
      state.coins[player] = 0;
      text += ` ${P} has lost all influence and is banished from the Royal Court!`;
      if (gold) text += ` Their ${gold} gold returns to the treasury.`;
    }
    const ev = { kind: 'reveal', big: true, actor: player, shown: card, banished };
    if (chosenBy !== undefined) ev.chosenBy = chosenBy;
    addEvent(state, text, ev);
  }

  // A player picks which of their cards to reveal.
  function loseCard(state, player, { cardId } = {}) {
    if (state.phase !== 'lose' || !state.losses.length || state.losses[0].player !== player) {
      throw new Error('Not time to reveal a card.');
    }
    revealCard(state, player, cardId, player);
    state.losses.shift();
    proceed(state);
  }

  // ---------- Finishing an action ----------

  // The actor proved their character. The action goes ahead, but if it can be
  // blocked and nobody has blocked yet, the blockers still get their chance.
  function actionProven(state) {
    const p = state.pending;
    if (ACTIONS[p.kind].blockers && !p.block) {
      p.stage = 'blockOnly';
      p.passed = [];
      state.phase = 'respond';
      if (waitingOn(state).length) return;
    }
    perform(state);
  }

  function actionFails(state) {
    const p = state.pending;
    let text = `${nameOf(state, p.actor)}'s ${ACTIONS[p.kind].name} fails.`;
    if (p.paid && !state.out[p.actor]) {
      state.coins[p.actor] += p.paid;
      text += ` Their ${p.paid} gold is returned.`;
    }
    addEvent(state, text, { kind: 'fail' });
    endTurn(state);
  }

  function blockStands(state) {
    const p = state.pending;
    let text = `${nameOf(state, p.block.blocker)}'s block stands: ${nameOf(state, p.actor)}'s ${ACTIONS[p.kind].name} fails.`;
    if (p.paid) text += ` The ${p.paid} gold paid stays spent.`;
    addEvent(state, text, { kind: 'fail' });
    endTurn(state);
  }

  function perform(state) {
    const p = state.pending;
    const A = nameOf(state, p.actor);
    const t = p.target;
    switch (p.kind) {
      case 'aid':
        state.coins[p.actor] += 2;
        addEvent(state, `${A} takes 2 gold.`, { kind: 'result' });
        break;
      case 'tax':
        state.coins[p.actor] += 3;
        addEvent(state, `${A} collects 3 gold in Guild Revenue.`, { kind: 'result' });
        break;
      case 'steal': {
        if (state.out[t]) break;
        const amount = Math.min(2, state.coins[t]);
        state.coins[t] -= amount;
        state.coins[p.actor] += amount;
        addEvent(state, amount
          ? `${A} pickpockets ${amount} gold from ${nameOf(state, t)}.`
          : `${nameOf(state, t)} has no gold, so ${A} gets nothing.`, { kind: 'result' });
        break;
      }
      case 'assassinate':
        if (state.out[t]) break;
        addEvent(state, `The assassination succeeds! ${nameOf(state, t)} loses an influence.`, { kind: 'result', big: true });
        state.losses.push({ player: t, why: 'assassinated' });
        state.then = 'endTurn';
        return proceed(state);
      case 'exchange': {
        const drawn = [];
        while (drawn.length < 2 && state.court.length) drawn.push(state.court.pop());
        p.drawn = drawn;
        state.phase = 'exchange';
        const ev = addEvent(state, `${A} draws ${drawn.length} cards from the Royal Court.`, { kind: 'result' });
        ev.private[p.actor] = `You drew: ${drawn.map((c) => charLabel(c.type)).join(' and ')}.`;
        return;
      }
    }
    endTurn(state);
  }

  // Arcane Study: keep as many cards as you had, return the rest.
  function exchangeKeep(state, player, { keepIds } = {}) {
    if (state.phase !== 'exchange' || state.pending.actor !== player) throw new Error('Not time to exchange cards.');
    const hand = state.hands[player];
    const pool = [...hand, ...state.pending.drawn];
    const ids = Array.isArray(keepIds) ? [...new Set(keepIds)] : [];
    if (ids.length !== hand.length) throw new Error(`Choose ${hand.length} card${hand.length > 1 ? 's' : ''} to keep.`);
    const keep = pool.filter((c) => ids.includes(c.id));
    if (keep.length !== ids.length) throw new Error('Choose from your cards and the cards you drew.');
    const back = pool.filter((c) => !ids.includes(c.id));
    state.hands[player] = keep;
    state.court = shuffle([...state.court, ...back], state.random);
    const swapped = keep.filter((c) => state.pending.drawn.includes(c)).length;
    const ev = addEvent(state, `${nameOf(state, player)} returns ${back.length} cards to the Royal Court and shuffles it.`, { kind: 'result' });
    ev.private[player] = swapped
      ? `You swapped ${swapped} card${swapped > 1 ? 's' : ''}. You now hold: ${keep.map((c) => charLabel(c.type)).join(' and ')}.`
      : 'You kept your original cards.';
    endTurn(state);
  }

  function endTurn(state) {
    state.pending = null;
    state.losses = [];
    state.then = null;
    if (checkWinner(state)) return;
    const n = state.players.length;
    let next = state.turn;
    do { next = (next + 1) % n; } while (state.out[next]);
    state.turn = next;
    state.phase = 'action';
  }

  function checkWinner(state) {
    if (state.phase === 'gameOver') return true;
    const alive = alivePlayers(state);
    if (alive.length > 1) return false;
    state.winner = alive.length ? alive[0] : null;
    state.phase = 'gameOver';
    state.pending = null;
    state.losses = [];
    state.then = null;
    if (state.winner !== null) {
      addEvent(state, `👑 ${nameOf(state, state.winner)} is the last adventurer standing and claims the throne!`, { kind: 'win' });
    }
    return true;
  }

  // Seats the game is waiting on right now.
  function waitingFor(state) {
    switch (state.phase) {
      case 'draft': return state.draft.chosen.map((c, i) => (c ? null : i)).filter((i) => i !== null);
      case 'action': return [state.turn];
      case 'respond': return waitingOn(state);
      case 'lose': return [state.losses[0].player];
      case 'exchange': return [state.pending.actor];
      default: return [];
    }
  }

  // ---------- Online play ----------

  // A copy of the game for one player: other hands, the Court and other
  // players' secrets are hidden until the game is over.
  function viewFor(state, player) {
    const { random, ...rest } = state;
    const view = JSON.parse(JSON.stringify(rest));
    const over = state.phase === 'gameOver';
    const hide = (list) => list.map(() => null);
    view.hands = view.hands.map((h, i) => (i === player || over ? h : hide(h)));
    view.removed = view.removed.map((r, i) => (i === player || over ? r : hide(r)));
    view.court = hide(view.court);
    if (view.pending && view.pending.drawn && view.pending.actor !== player) view.pending.drawn = hide(view.pending.drawn);
    if (view.draft) {
      view.draft.options = view.draft.options.map((o, i) => (i === player ? o : hide(o)));
      view.draft.chosen = view.draft.chosen.map((c, i) => (i === player || !c ? c : { hidden: true }));
      view.draft.third = hide(view.draft.third);
    }
    const strip = (ev) => { ev.private = ev.private[player] ? { [player]: ev.private[player] } : {}; };
    view.log.forEach(strip);
    if (view.lastEvent) strip(view.lastEvent);
    return view;
  }

  // A move sent by a player:
  //   { type: 'declare', kind, target }      choose an action
  //   { type: 'respond', choice, as }        'allow', 'challenge' or 'block' (as a character)
  //   { type: 'lose', cardId }               reveal a card
  //   { type: 'exchange', keepIds }          Arcane Study: cards to keep
  //   { type: 'draft', cardId }              two-player variant: card to keep
  function applyAction(state, player, action) {
    if (!action) throw new Error('Missing action.');
    switch (action.type) {
      case 'declare': return declare(state, player, action);
      case 'respond': return respond(state, player, action);
      case 'lose': return loseCard(state, player, action);
      case 'exchange': return exchangeKeep(state, player, action);
      case 'draft': return draftPick(state, player, action);
      default: throw new Error('Unknown action.');
    }
  }

  const TW = {
    COPIES, MUST_COUP, CHARACTERS, TYPES, ACTIONS, ACTION_ORDER,
    buildDeck, shuffle, charLabel, alivePlayers, validTargets, possibleCopies,
    createGame, draftPick, availableActions, declare, responseOptions, responders, waitingOn,
    respond, loseCard, exchangeKeep, waitingFor, viewFor, applyAction,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = TW;
  else root.TW = TW;
})(typeof window !== 'undefined' ? window : globalThis);
