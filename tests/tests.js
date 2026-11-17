// Rules checks. Open tests/tests.html in a browser to run them.

(function (root) {
  'use strict';
  const TW = root.TW;
  const Bots = root.Bots;
  const results = [];
  function test(name, fn) {
    try { fn(); results.push({ name, ok: true }); }
    catch (e) { results.push({ name, ok: false, error: e.message }); }
  }
  function eq(actual, expected, msg) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${msg || 'Expected'} ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }
  function throws(fn, msg) {
    try { fn(); } catch (e) { return; }
    throw new Error(msg || 'Expected an error');
  }

  // Short ways to make cards and rig a game for a test.
  let nextId = 0;
  const c = (type) => ({ id: `${type}-t${nextId++}`, type });
  function rig(hands, { coins, turn = 0, court } = {}) {
    const game = TW.createGame({ players: hands.map((_, i) => ({ name: `P${i}` })), first: turn });
    game.hands = hands.map((h) => h.slice());
    game.coins = coins ? coins.slice() : hands.map(() => 2);
    game.court = court ? court.slice() : [c('wizard'), c('bard'), c('paladin'), c('guildmaster'), c('rogue')];
    game.turn = turn;
    game.phase = 'action';
    return game;
  }
  const declare = (g, kind, target = null) => TW.declare(g, g.turn, { kind, target });
  const allow = (g, i) => TW.respond(g, i, { choice: 'allow' });
  const challenge = (g, i) => TW.respond(g, i, { choice: 'challenge' });
  const block = (g, i, as) => TW.respond(g, i, { choice: 'block', as });
  const types = (list) => list.map((x) => x.type).sort();

  test('Deck has 15 cards, 3 of each character', () => {
    const deck = TW.buildDeck();
    eq(deck.length, 15);
    eq(new Set(deck.map((x) => x.id)).size, 15);
    TW.TYPES.forEach((t) => eq(deck.filter((x) => x.type === t).length, 3));
  });

  test('Setup: 2 cards and 2 gold each, the rest in the Royal Court', () => {
    const g = TW.createGame({ players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }], first: 1 });
    eq(g.hands.map((h) => h.length), [2, 2, 2]);
    eq(g.coins, [2, 2, 2]);
    eq(g.court.length, 9);
    eq(g.turn, 1);
    eq(g.phase, 'action');
  });

  test('Two players: the starting player gets only 1 gold', () => {
    const g = TW.createGame({ players: [{ name: 'A' }, { name: 'B' }], first: 1 });
    eq(g.coins, [2, 1]);
  });

  test('Scavenge: +1 gold, next player', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')]]);
    declare(g, 'income');
    eq(g.coins, [3, 2]);
    eq(g.turn, 1);
    eq(g.phase, 'action');
  });

  test('With 10 gold you must launch a Coup', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')]], { coins: [10, 2] });
    throws(() => declare(g, 'income'));
    throws(() => declare(g, 'tax'));
    declare(g, 'coup', 1);
    eq(g.coins[0], 3);
    eq(g.phase, 'lose');
  });

  test('Coup needs 7 gold and makes the target lose an influence', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')]], { coins: [6, 2] });
    throws(() => declare(g, 'coup', 1));
    g.coins[0] = 7;
    declare(g, 'coup', 1);
    eq(g.phase, 'lose');
    TW.loseCard(g, 1, { cardId: g.hands[1][0].id });
    eq(types(g.revealed[1]), ['wizard']);
    eq(g.turn, 1);
  });

  test('Guild Revenue: nobody challenges, +3 gold', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')], [c('wizard'), c('paladin')]]);
    declare(g, 'tax');
    eq(g.phase, 'respond');
    eq(TW.waitingOn(g), [1, 2]);
    allow(g, 1);
    allow(g, 2);
    eq(g.coins[0], 5);
    eq(g.turn, 1);
  });

  test('Challenge a true claim: challenger loses, claimer swaps the card', () => {
    const gm = c('guildmaster');
    const g = rig([[gm, c('bard')], [c('wizard'), c('paladin')]], { court: [c('rogue')] });
    declare(g, 'tax');
    challenge(g, 1);
    eq(g.phase, 'lose');
    eq(g.losses[0].player, 1);
    // The shown card was shuffled into the Court and one card drawn (it may be the same one).
    eq(g.hands[0].length, 2);
    eq(g.court.length, 1);
    eq(types([...g.hands[0].filter((x) => x.type !== 'bard'), ...g.court]), ['guildmaster', 'rogue']);
    TW.loseCard(g, 1, { cardId: g.hands[1][1].id });
    eq(g.coins[0], 5, 'the action still happens');
    eq(g.turn, 1);
  });

  test('Challenge a bluff: claimer loses and the action fails', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')]]);
    declare(g, 'tax');
    challenge(g, 1);
    eq(g.losses[0].player, 0);
    TW.loseCard(g, 0, { cardId: g.hands[0][0].id });
    eq(g.coins[0], 2);
    eq(g.turn, 1);
  });

  test('A bluffed assassination that is caught gets its 3 gold back', () => {
    const g = rig([[c('guildmaster'), c('bard')], [c('wizard'), c('paladin')]], { coins: [3, 2] });
    declare(g, 'assassinate', 1);
    eq(g.coins[0], 0);
    challenge(g, 1);
    TW.loseCard(g, 0, { cardId: g.hands[0][0].id });
    eq(g.coins[0], 3);
    eq(g.revealed[1].length, 0);
  });

  test('Blocked assassination: the 3 gold stays spent', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')]], { coins: [3, 2] });
    declare(g, 'assassinate', 1);
    block(g, 1, 'paladin');
    eq(g.pending.stage, 'block');
    allow(g, 0);
    eq(g.coins[0], 0);
    eq(g.revealed[1].length, 0);
    eq(g.turn, 1);
  });

  test('Only the target may block an assassination', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')], [c('paladin'), c('bard')]], { coins: [3, 2, 2] });
    declare(g, 'assassinate', 1);
    throws(() => block(g, 2, 'paladin'));
    eq(TW.responseOptions(g, 2), { challenge: true, blocks: [] });
  });

  test('Double danger: lose the challenge, then the assassination', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('guildmaster')]], { coins: [3, 2] });
    declare(g, 'assassinate', 1);
    challenge(g, 1);
    TW.loseCard(g, 1, { cardId: g.hands[1][0].id }); // the challenge
    // The target may still block after the failed challenge, but doesn't.
    eq(g.pending.stage, 'blockOnly');
    allow(g, 1);
    eq(g.out[1], true);
    eq(g.phase, 'gameOver');
    eq(g.winner, 0);
  });

  test('Double danger: a caught Paladin bluff costs both influences', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('guildmaster')], [c('bard'), c('bard')]], { coins: [3, 2, 2] });
    declare(g, 'assassinate', 1);
    block(g, 1, 'paladin');
    challenge(g, 0);
    TW.loseCard(g, 1, { cardId: g.hands[1][0].id });
    eq(g.out[1], true);
    eq(g.revealed[1].length, 2);
    eq(g.turn, 2);
  });

  test('Pickpocket takes 2 gold, or 1 if that is all they have', () => {
    const g = rig([[c('bard'), c('rogue')], [c('wizard'), c('paladin')]], { coins: [2, 5] });
    declare(g, 'steal', 1);
    allow(g, 1);
    eq(g.coins, [4, 3]);
    const h = rig([[c('bard'), c('rogue')], [c('wizard'), c('paladin')]], { coins: [2, 1] });
    declare(h, 'steal', 1);
    allow(h, 1);
    eq(h.coins, [3, 0]);
  });

  test('Pickpocket blocked by a bluffed Wizard that is challenged: the theft goes ahead', () => {
    const g = rig([[c('bard'), c('rogue')], [c('guildmaster'), c('paladin')], [c('rogue'), c('rogue')]], { coins: [2, 4, 2] });
    declare(g, 'steal', 1);
    block(g, 1, 'wizard');
    eq(TW.waitingOn(g), [0, 2]);
    challenge(g, 2);
    TW.loseCard(g, 1, { cardId: g.hands[1][0].id });
    eq(g.coins, [4, 2, 2]);
  });

  test('Call in a Favor: anyone may block with the Guild Master; it cannot be challenged', () => {
    const g = rig([[c('bard'), c('rogue')], [c('wizard'), c('paladin')], [c('rogue'), c('rogue')]]);
    declare(g, 'aid');
    eq(TW.responseOptions(g, 2), { challenge: false, blocks: ['guildmaster'] });
    block(g, 2, 'guildmaster');
    allow(g, 0);
    allow(g, 1);
    eq(g.coins[0], 2);
    eq(g.turn, 1);
  });

  test('Arcane Study: draw 2, keep 2, return 2', () => {
    const g = rig([[c('wizard'), c('rogue')], [c('bard'), c('paladin')]], { court: [c('bard'), c('guildmaster'), c('paladin')] });
    declare(g, 'exchange');
    allow(g, 1);
    eq(g.phase, 'exchange');
    eq(types(g.pending.drawn), ['guildmaster', 'paladin']);
    const keep = [g.hands[0][1].id, g.pending.drawn.find((x) => x.type === 'guildmaster').id];
    throws(() => TW.exchangeKeep(g, 0, { keepIds: [keep[0]] }));
    TW.exchangeKeep(g, 0, { keepIds: keep });
    eq(types(g.hands[0]), ['guildmaster', 'rogue']);
    eq(g.court.length, 3);
    eq(g.turn, 1);
  });

  test('Banished players return their gold to the treasury', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard'), c('paladin')], [c('wizard'), c('paladin')]], { coins: [7, 5, 2] });
    g.revealed[1] = [c('bard')];
    g.hands[1] = [c('wizard')];
    declare(g, 'coup', 1);
    eq(g.out[1], true);
    eq(g.coins[1], 0);
    eq(g.turn, 2);
  });

  test('Banished players are skipped and can\'t respond', () => {
    const g = rig([[c('rogue'), c('bard')], [c('wizard')], [c('wizard'), c('paladin')]], { coins: [7, 2, 2] });
    declare(g, 'coup', 1);
    eq(g.turn, 2);
    declare(g, 'tax');
    eq(TW.waitingOn(g), [0]);
  });

  test('Players see only their own cards online', () => {
    const g = TW.createGame({ players: [{ name: 'A' }, { name: 'B' }], first: 0 });
    const v = TW.viewFor(g, 1);
    eq(v.hands[0], [null, null]);
    eq(v.hands[1].length, 2);
    eq(v.court.every((x) => x === null), true);
    eq(v.random, undefined);
  });

  test('A drawn replacement card stays secret from the others', () => {
    const g = rig([[c('guildmaster'), c('bard')], [c('wizard'), c('paladin')]]);
    declare(g, 'tax');
    challenge(g, 1);
    const ev = g.log.find((e) => e.kind === 'challenge');
    eq(Object.keys(TW.viewFor(g, 1).log.find((e) => e.kind === 'challenge').private), []);
    eq(Object.keys(TW.viewFor(g, 0).log.find((e) => e.seq === ev.seq).private), ['0']);
  });

  test('Two-player variant: pick one of five, get a second card, Court of 3', () => {
    const g = TW.createGame({ players: [{ name: 'A' }, { name: 'B' }], variant: true, first: 0 });
    eq(g.phase, 'draft');
    eq(types(g.draft.options[0]), TW.TYPES.slice().sort());
    const v = TW.viewFor(g, 1);
    eq(v.draft.options[0].every((x) => x === null), true);
    TW.draftPick(g, 0, { cardId: g.draft.options[0].find((x) => x.type === 'rogue').id });
    eq(g.phase, 'draft');
    TW.draftPick(g, 1, { cardId: g.draft.options[1].find((x) => x.type === 'paladin').id });
    eq(g.phase, 'action');
    eq(g.hands.map((h) => h.length), [2, 2]);
    eq(g.hands[0][0].type, 'rogue');
    eq(g.court.length, 3);
    eq(g.removed[0].length, 4);
    eq(g.coins, [1, 2]);
  });

  test('Card counting: all 3 copies seen means a sure bluff', () => {
    const g = rig([[c('guildmaster'), c('bard')], [c('guildmaster'), c('guildmaster')]]);
    eq(TW.possibleCopies(g, 1, 'guildmaster'), 1);
    g.revealed[0] = [c('guildmaster')];
    eq(TW.possibleCopies(g, 1, 'guildmaster'), 0);
  });

  test('Computer players finish 400 games without breaking a rule', () => {
    let finished = 0;
    for (let n = 0; n < 400; n++) {
      const count = 2 + (n % 5);
      const g = TW.createGame({
        players: Array.from({ length: count }, (_, i) => ({ name: `B${i}`, isBot: true })),
        variant: count === 2 && n % 2 === 0,
      });
      let steps = 0;
      while (g.phase !== 'gameOver' && steps++ < 3000) {
        const who = TW.waitingFor(g)[0];
        // Bots decide from their own view, like an online player would.
        const view = TW.viewFor(g, who);
        if (g.phase === 'draft') TW.draftPick(g, who, Bots.chooseDraft(view, who));
        else if (g.phase === 'action') TW.declare(g, who, Bots.chooseAction(view, who));
        else if (g.phase === 'respond') TW.respond(g, who, Bots.chooseResponse(view, who));
        else if (g.phase === 'lose') TW.loseCard(g, who, Bots.chooseLoss(view, who));
        else if (g.phase === 'exchange') TW.exchangeKeep(g, who, Bots.chooseExchange(view, who));
        const total = g.hands.flat().length + g.revealed.flat().length + g.court.length
          + (g.pending && g.pending.drawn ? g.pending.drawn.length : 0) + g.removed.flat().length;
        if (!g.draft && total !== 15) throw new Error(`Cards went missing: ${total}`);
        if (g.coins.some((x) => x < 0)) throw new Error('Negative gold');
      }
      if (g.phase !== 'gameOver') throw new Error(`Game ${n} did not finish`);
      if (TW.alivePlayers(g).length !== 1) throw new Error('Should be exactly one winner');
      finished++;
    }
    eq(finished, 400);
  });

  const box = document.getElementById('results');
  const bad = results.filter((r) => !r.ok);
  box.innerHTML = `<h2 class="${bad.length ? 'bad' : 'ok'}">${results.length - bad.length} of ${results.length} checks passed</h2>`
    + results.map((r) => `<div class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✔' : '✘'} ${r.name}${r.ok ? '' : ` — ${r.error}`}</div>`).join('');
})(window);
