// Throne of Whispers — screens for playing on one device or online.
// The rules live in rules.js, the computer players in bots.js and the
// connections in online.js; this file draws the game and reacts to clicks.
//
// Modes:
//   local  — everyone shares this device
//   host   — this browser runs the real game and sends each player their view
//   client — this browser shows the view the host sends and sends back moves
//   screen — a display-only tab for a 📺 Remote player in a local game
//
// 📺 Remote players can only watch (for example over a video call). They see
// their cards and actions numbered 1, 2, 3… and say a number; whoever runs
// the game clicks that number on face-down cards, so nobody else sees the
// hand. Players have seat numbers too. (Numbers, not letters: B/D/E/P sound
// alike over a call.)

(function () {
  'use strict';

  const app = document.getElementById('app');
  const overlay = document.getElementById('overlay');
  const rulesLayer = document.getElementById('rules-layer');
  const BOT_DELAY = 1500; // long enough to read what the computer did
  const slotNumber = (k) => String(k + 1);
  const seatNumber = (i) => String(i + 1);
  // Finished card pictures (name and ability are part of the picture), made
  // small from the full-size art in art/. A character left out of this list
  // falls back to its emoji design.
  const CARD_ART = {
    guildmaster: 'art/cards/guildmaster.webp',
    rogue: 'art/cards/rogue.webp',
    bard: 'art/cards/bard.webp',
    wizard: 'art/cards/wizard.webp',
    paladin: 'art/cards/paladin.webp',
  };
  const BACK_ART = 'art/cards/back.webp';
  // Load them all up front so a card never appears blank mid-game.
  [...Object.values(CARD_ART), BACK_ART].forEach((src) => { new Image().src = src; });

  const BOT_NAMES = ['Grimbold', 'Elowen', 'Thrak', 'Seraphine', 'Pip', 'Morwen', 'Bramble'];

  let mode = 'local';
  let game = null;    // local/host: the real game state; client/screen: this player's view of it
  let ui = {};        // what this screen is showing
  let botTimer = null;
  let teaching = true;
  let variant = false;   // two-player variant (choose your first card)
  let numberKeys = null; // number keys while entering a remote player's choice: { '2': fn, … }

  // Online only
  let net = null;     // connection from online.js
  let me = null;      // this device's seat number (also the seat a screen tab shows)
  let roomCode = '';
  let lobby = [];     // host: seats with connections; client: public seat list from the host
  let lastJoin = null;

  // Same-computer tabs talk to each other over this channel.
  const screenChannel = 'BroadcastChannel' in window ? new BroadcastChannel('throneofwhispers-screens') : null;

  // ---------- Small helpers ----------

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = (i) => esc(game.players[i].name);
  const isHost = () => mode === 'host';
  const stopTimers = () => clearTimeout(botTimer);
  const charLabel = (type) => esc(TW.charLabel(type));
  const actionLabel = (kind) => `${TW.ACTIONS[kind].icon} ${esc(TW.ACTIONS[kind].name)}`;
  const waiting = () => (game ? TW.waitingFor(game) : []);

  // Is seat i a 📺 Remote player whose choices are entered on this device?
  function isRelay(i) {
    if (mode === 'local') return !!(ui.relay && ui.relay[i]);
    if (mode === 'host') return !!(lobby[i] && lobby[i].relay);
    return false;
  }
  const relaySeats = () => (game ? game.players.map((p) => p.id).filter(isRelay) : []);
  // People physically using this device (local mode).
  const humans = () => game.players.filter((p) => !p.isBot && !isRelay(p.id)).map((p) => p.id);
  const multiHuman = () => humans().length > 1;
  // Is this device only showing a remote player's cards?
  const isDisplay = () => mode === 'screen' || (mode === 'client' && ui.relayed);

  // Can this device answer a challenge/block question for seat i?
  function canAnswer(i) {
    if (game.players[i].isBot) return false;
    if (mode === 'local') return true; // people at the table, or a remote player who tells us
    if (mode === 'host') return i === me || isRelay(i);
    return mode === 'client' && i === me && !ui.relayed;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* storage unavailable */ }
  }

  // Lets the host recognize this browser when it reconnects to a room.
  function deviceId() {
    let id = storageGet('throne.deviceId');
    if (!id) {
      id = Math.random().toString(36).slice(2, 12);
      storageSet('throne.deviceId', id);
    }
    return id;
  }

  // Typing a number on the keyboard picks that button (all choices are one digit).
  document.addEventListener('keydown', (e) => {
    if (!numberKeys || e.target.tagName === 'INPUT' || !/^[0-9]$/.test(e.key)) return;
    const fn = numberKeys[e.key];
    if (!fn) return;
    e.preventDefault();
    fn();
  });

  function cardHtml(card, { extraClass = '', attrs = '', badge = '', tag = '' } = {}) {
    const c = TW.CHARACTERS[card.type];
    const about = `${esc(c.name)}. Action: ${esc(c.action)} Block: ${esc(c.block)}`;
    if (CARD_ART[card.type]) {
      return `<div class="card has-art t-${card.type} ${extraClass}" title="${about}" ${attrs}>
        <img class="art-img" src="${CARD_ART[card.type]}" alt="${about}">
        ${tag ? `<div class="card-tag">${tag}</div>` : ''}
        ${badge ? `<div class="badge">${badge}</div>` : ''}
      </div>`;
    }
    return `<div class="card t-${card.type} ${extraClass}" title="${esc(c.name)}: ${esc(c.action)} ${esc(c.block)}" ${attrs}>
      <div class="icon">${c.icon}</div>
      <div class="title">${esc(c.name)}</div>
      <div class="text"><b>Action:</b> ${esc(c.action)}</div>
      <div class="text"><b>Block:</b> ${esc(c.block)}</div>
      ${tag ? `<div class="card-tag">${tag}</div>` : ''}
      ${badge ? `<div class="badge">${badge}</div>` : ''}
    </div>`;
  }

  // Face-down card, optionally with a number for a remote player's choice.
  function backHtml({ number = '', attrs = '', extraClass = '' } = {}) {
    return `<div class="card has-art back ${extraClass}" ${attrs}>
      <img class="art-img" src="${BACK_ART}" alt="Face-down card">
      ${number ? `<div class="badge">${number}</div>` : ''}
    </div>`;
  }

  // A small face-up card next to a player's name.
  function miniHtml(card) {
    const c = TW.CHARACTERS[card.type];
    return `<span class="mini t-${card.type}" title="Revealed: ${esc(c.name)}">${c.icon} ${esc(c.name)}</span>`;
  }

  function showOverlay(html) {
    overlay.innerHTML = `<div class="panel">${html}</div>`;
    overlay.classList.remove('hidden');
  }
  function hideOverlay() {
    numberKeys = null;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  // Redraw the current screen for whichever mode we're in.
  function rerender() {
    if (mode === 'local') update();
    else if (isHost()) hostTick();
    else renderOnline();
  }

  // A player's move. Local and host apply it here; a client sends it to the host.
  function act(action) {
    ui.message = '';
    ui.choosing = null;
    ui.keepSel = null;
    if (mode === 'client') return net.send({ t: 'action', action });
    try {
      TW.applyAction(game, action.player, action);
    } catch (e) {
      ui.message = e.message;
    }
    if (isHost()) return hostTick();
    // Sharing one device: hide this person's cards unless they're the only one
    // the game is waiting on next (challenges are answered on a shared screen).
    if (multiHuman()) {
      const w = waiting();
      const stillThem = game.phase !== 'respond' && w.length === 1 && w[0] === ui.viewer;
      if (!stillThem) ui.viewer = null;
    }
    update();
  }

  // ---------- Title screen ----------

  function endScreens() {
    if (screenChannel && mode === 'local' && game) screenChannel.postMessage({ t: 'screen-ended', seat: 'all' });
  }

  function renderTitle(note = '') {
    endScreens();
    leaveOnline();
    hideOverlay();
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo">👑 Throne of Whispers</h1>
        <p class="tagline">A game of deception, influence and betrayal. Claim any character you like,
          true or not. Call out the liars, and be the last adventurer with influence in the Royal Court.</p>
        ${note ? `<p class="error">${esc(note)}</p>` : ''}
        <div class="menu">
          <button class="primary big" id="m-local">🎲 Play on this device</button>
          <button class="secondary big" id="m-host">🏰 Host an online game</button>
          <button class="secondary big" id="m-join">🚪 Join an online game</button>
        </div>
        <button class="link" data-rules>How to play</button>
        <a class="home-link" href="https://brodiegames.netlify.app/">🌙 Back to Game Night</a>
      </div>`;
    document.getElementById('m-local').addEventListener('click', () => renderSetup());
    document.getElementById('m-host').addEventListener('click', () => renderHostStart());
    document.getElementById('m-join').addEventListener('click', () => renderJoin());
    app.querySelector('[data-rules]').addEventListener('click', showRules);
  }

  // ---------- Local setup ----------

  function loadSeats() {
    try {
      const saved = JSON.parse(storageGet('throne.seats'));
      if (Array.isArray(saved) && saved.length >= 2 && saved.length <= 6) return saved;
    } catch (e) { /* ignore */ }
    return [{ name: 'Player 1', isBot: false }, { name: 'Grimbold', isBot: true }, { name: 'Elowen', isBot: true }];
  }

  let seats = loadSeats();

  const SEAT_KINDS = { human: '🙂 Person', bot: '🤖 Computer', remote: '📺 Remote' };
  const seatKind = (s) => (s.isBot ? 'bot' : s.isRemote ? 'remote' : 'human');

  function variantHtml(count) {
    if (count !== 2) return '';
    return `<label class="check"><input type="checkbox" id="variant" ${variant ? 'checked' : ''}>
      Two-player variant: each player secretly picks their first character from a full set of five</label>`;
  }

  function renderSetup(error = '') {
    endScreens();
    stopTimers();
    hideOverlay();
    mode = 'local';
    game = null;
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">👑 Throne of Whispers</h1>
        <h2>Play on this device</h2>
        <div class="seats">
          ${seats.map((s, i) => `
            <div class="seat">
              <input data-name="${i}" value="${esc(s.name)}" maxlength="16" aria-label="Player ${i + 1} name">
              <button class="toggle ${seatKind(s)}" data-toggle="${i}" title="Click to change">${SEAT_KINDS[seatKind(s)]}</button>
              <button class="icon-btn" data-remove="${i}" ${seats.length <= 2 ? 'disabled' : ''} aria-label="Remove">✕</button>
            </div>`).join('')}
        </div>
        <div class="row">
          <button class="secondary" data-add="human" ${seats.length >= 6 ? 'disabled' : ''}>+ Person</button>
          <button class="secondary" data-add="bot" ${seats.length >= 6 ? 'disabled' : ''}>+ Computer</button>
        </div>
        <p class="small">2 to 6 adventurers. Click a player's type to switch it. <b>📺 Remote</b> players watch their own tab
          over a video call (like Google Meet) and tell you a number; you click it without seeing their cards.</p>
        ${variantHtml(seats.length)}
        <label class="check"><input type="checkbox" id="teaching" ${teaching ? 'checked' : ''}> Teaching mode (hints and explanations)</label>
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="start">Enter the Royal Court</button>
        <button class="link" id="back">← Back</button>
      </div>`;

    app.querySelectorAll('[data-name]').forEach((el) => el.addEventListener('input', () => { seats[+el.dataset.name].name = el.value; }));
    app.querySelectorAll('[data-toggle]').forEach((el) => el.addEventListener('click', () => {
      const s = seats[+el.dataset.toggle];
      const next = { human: 'bot', bot: 'remote', remote: 'human' }[seatKind(s)];
      s.isBot = next === 'bot';
      s.isRemote = next === 'remote';
      renderSetup();
    }));
    app.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => { seats.splice(+el.dataset.remove, 1); renderSetup(); }));
    app.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', () => {
      const bot = el.dataset.add === 'bot';
      seats.push({ name: bot ? freeBotName(seats) : `Player ${seats.length + 1}`, isBot: bot });
      renderSetup();
    }));
    const v = document.getElementById('variant');
    if (v) v.addEventListener('change', (e) => { variant = e.target.checked; });
    document.getElementById('teaching').addEventListener('change', (e) => { teaching = e.target.checked; });
    document.getElementById('start').addEventListener('click', startLocalGame);
    document.getElementById('back').addEventListener('click', () => renderTitle());
  }

  function freeBotName(list) {
    const used = new Set(list.map((s) => s.name));
    return BOT_NAMES.find((n) => !used.has(n)) || 'Bot';
  }

  function startLocalGame() {
    seats.forEach((s, i) => { s.name = s.name.trim() || (s.isBot ? 'Bot' : `Player ${i + 1}`); });
    if (!seats.some((s) => !s.isBot)) return renderSetup('At least one person needs to play.');
    if (seats.some((s) => s.isRemote) && !screenChannel) return renderSetup('This browser cannot open remote player screens. Try Chrome.');
    storageSet('throne.seats', JSON.stringify(seats));
    mode = 'local';
    game = TW.createGame({ players: seats, teaching, variant });
    ui = { viewer: null, message: '', relay: seats.map((s) => !!s.isRemote), noticeSeq: game.seq };
    ui.introPending = relaySeats().length > 0;
    if (humans().length === 1) ui.viewer = humans()[0];
    // Sharing one device: everyone looks at their cards before the first turn.
    // The player who goes first looks last, so they keep the device.
    if (multiHuman()) {
      const n = game.players.length;
      ui.peekQueue = humans().sort((a, b) => ((a - game.turn - 1 + n) % n) - ((b - game.turn - 1 + n) % n));
    }
    update();
  }

  // ---------- Local game loop: decide what to show next ----------

  function update() {
    stopTimers();
    hideOverlay();
    queueNotices();
    showLocal();
    sendScreens();
  }

  function showLocal() {
    if (ui.introPending) return renderScreenIntro();
    if (ui.notices && ui.notices.length) return renderNotice();
    if (ui.peekQueue && ui.peekQueue.length && game.phase !== 'draft' && game.phase !== 'gameOver') return renderPeek();
    if (game.phase === 'gameOver') return renderGameOver();

    const w = waiting();
    if (w.some((i) => game.players[i].isBot)) {
      botTimer = setTimeout(() => { botMove(); update(); }, BOT_DELAY);
    }
    // Challenges and blocks are answered together on one shared screen.
    if (game.phase === 'respond') return renderTable(multiHuman());
    const p = w.find((i) => !game.players[i].isBot);
    if (p === undefined || isRelay(p)) return renderTable(multiHuman());
    return needViewer(p, renderTable, passNote(p));
  }

  // One person looks at their secret cards (pass the device first).
  function renderPeek() {
    const p = ui.peekQueue[0];
    const starting = !game.log.some((e) => e.kind === 'declare');
    const note = starting ? '👀 Look at your two secret characters before the game begins.' : '👀 Look at your secret characters.';
    needViewer(p, () => {
      renderTable(true);
      const hand = game.hands[p];
      showOverlay(`
        <div class="pass">
          <h2>👀 ${nameOf(p)}'s secret characters</h2>
          ${hand.length ? `<div class="hand">${hand.map((card) => cardHtml(card)).join('')}</div>`
            : '<p>You have been banished: no cards left.</p>'}
          <p class="small">Remember them! You can look again anytime with <b>👀 Look at my cards</b> at the top.</p>
          <button class="primary big" id="peek-done">Got it, hide my cards</button>
        </div>`);
      document.getElementById('peek-done').addEventListener('click', () => {
        ui.peekQueue.shift();
        // If the game is waiting on this person next, they already have the device.
        const w = waiting();
        const theirMove = !ui.peekQueue.length && game.phase !== 'respond' && w.length === 1 && w[0] === p;
        if (!theirMove) ui.viewer = null;
        update();
      });
    }, note);
  }

  // Mid-game: someone wants to check their cards again.
  function chooseWhoPeeks() {
    stopTimers(); // computers wait while someone looks
    showOverlay(`
      <h2>👀 Look at my cards</h2>
      <p>Who wants to look?</p>
      <div class="choices">
        ${humans().filter((i) => !game.out[i]).map((i) => `<button class="choice" data-peek="${i}"><span class="seatno">${seatNumber(i)}</span> ${nameOf(i)}</button>`).join('')}
      </div>
      <button class="link" id="cancel">Cancel</button>`);
    overlay.querySelectorAll('[data-peek]').forEach((el) => el.addEventListener('click', () => {
      ui.peekQueue = [+el.dataset.peek];
      ui.choosing = null;
      update();
    }));
    document.getElementById('cancel').addEventListener('click', () => update());
  }

  // Why the device is being passed (shown on the "Pass the device" screen).
  function passNote(p) {
    if (game.phase === 'lose') return `💔 ${nameOf(p)} must reveal one of their cards.`;
    if (game.phase === 'exchange') return '🧙 Choose which cards to keep from your Arcane Study.';
    if (game.phase === 'draft') return '👑 Choose your first character.';
    return '';
  }

  function botMove() {
    const bots = waiting().filter((i) => game.players[i].isBot);
    if (!bots.length) return;
    try {
      switch (game.phase) {
        case 'draft':
          bots.forEach((i) => TW.draftPick(game, i, Bots.chooseDraft(game, i)));
          break;
        case 'action':
          TW.declare(game, game.turn, Bots.chooseAction(game, game.turn));
          break;
        case 'respond': {
          // Computers answer in seat order. One that challenges or blocks ends the window.
          const stage = game.pending.stage;
          for (const i of bots) {
            const r = Bots.chooseResponse(game, i);
            TW.respond(game, i, r);
            if (r.choice !== 'allow' || game.phase !== 'respond' || game.pending.stage !== stage) break;
          }
          break;
        }
        case 'lose':
          TW.loseCard(game, bots[0], Bots.chooseLoss(game, bots[0]));
          break;
        case 'exchange':
          TW.exchangeKeep(game, bots[0], Bots.chooseExchange(game, bots[0]));
          break;
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Makes sure the right person is holding the device before showing their cards.
  function needViewer(player, show, note = '') {
    if (ui.viewer === player) return show();
    renderTable(true);
    showOverlay(`
      <div class="pass">
        <div class="pass-icon">🔒</div>
        <h2>Pass the device to</h2>
        <div class="pass-name">${nameOf(player)}</div>
        ${note ? `<p>${note}</p>` : ''}
        <p>Everyone else, look away!</p>
        <button class="primary big" id="ready">I'm ${nameOf(player)}: show my cards</button>
      </div>`);
    document.getElementById('ready').addEventListener('click', () => {
      ui.viewer = player;
      update();
    });
  }

  // ---------- Pop-ups for challenges and lost influence ----------

  // Big moments (challenges, revealed cards, assassinations) pop up so nobody
  // misses them. A card you chose to reveal yourself doesn't pop up for you.
  function bigEvents(since, viewer) {
    return game.log.filter((e) => e.seq > since && e.big && e.kind !== 'win' && !(viewer !== null && e.chosenBy === viewer));
  }

  function queueNotices() {
    if (mode !== 'local' || !game) return;
    if (ui.noticeSeq === undefined) ui.noticeSeq = game.seq;
    if (game.seq === ui.noticeSeq) return;
    const solo = multiHuman() || !humans().length ? null : humans()[0];
    const fresh = bigEvents(ui.noticeSeq, solo);
    ui.noticeSeq = game.seq;
    if (fresh.length) (ui.notices = ui.notices || []).push({ events: fresh, viewer: solo });
  }

  function renderNotice() {
    const n = ui.notices[0];
    renderTable(multiHuman());
    showNoticePanel(n.events, n.viewer, () => {
      ui.notices.shift();
      update();
    });
  }

  function noticeHtml(ev, viewer) {
    const icon = ev.kind === 'challenge' ? '⚖️' : ev.kind === 'reveal' ? (ev.banished ? '💀' : '💔') : '🗡️';
    const secret = viewer !== null && ev.private[viewer];
    let tag = '';
    if (ev.kind === 'challenge') tag = ev.proven ? '✔ Proven' : '';
    if (ev.kind === 'reveal') tag = 'Revealed';
    return `
      <div class="notice-item">
        <div class="notice-icon">${icon}</div>
        ${ev.shown ? `<div class="showdown">${cardHtml(ev.shown, { tag })}</div>` : ''}
        <p class="secret-text">${esc(ev.text)}</p>
        ${secret ? `<p class="event-secret">🤫 Only you: ${esc(secret)}</p>` : ''}
      </div>`;
  }

  function showNoticePanel(events, viewer, done) {
    numberKeys = null;
    showOverlay(`
      <div class="notice">
        ${events.map((ev) => noticeHtml(ev, viewer)).join('')}
        <button class="primary big" id="got-it">Got it</button>
      </div>`);
    const button = document.getElementById('got-it');
    button.addEventListener('click', done);
    button.focus();
  }

  // ---------- Remote player screens in other tabs (local mode) ----------

  function screenUrl(seat) {
    return `${location.pathname}?screen=${seat}`;
  }
  function openScreen(seat) {
    window.open(screenUrl(seat), `throneofwhispers-screen-${seat}`);
    setTimeout(sendScreens, 1500);
  }

  function sendScreens() {
    if (!screenChannel || mode !== 'local' || !game) return;
    relaySeats().forEach((i) => {
      screenChannel.postMessage({ t: 'screen', seat: i, view: TW.viewFor(game, i) });
    });
  }

  function renderScreenIntro() {
    renderTable(true);
    const remotes = relaySeats();
    showOverlay(`
      <h2>📺 Set up the remote player screen${remotes.length > 1 ? 's' : ''}</h2>
      <ol class="steps">
        <li>Click the button below. The screen opens in a <b>new tab</b>.</li>
        <li>Come back to <b>this</b> tab. This is where you play.</li>
        <li>In Google Meet, choose <b>Present → A tab</b> and pick the tab called
          <b>“Throne of Whispers — ${remotes.map(nameOf).join('” / “')}'s screen”</b>.</li>
        <li><b>Don't look</b> at that tab or Meet's preview of it, because it shows their cards!</li>
      </ol>
      <div class="row">
        ${remotes.map((i) => `<button class="secondary big" data-open-screen="${i}">📺 Open ${nameOf(i)}'s screen</button>`).join('')}
      </div>
      <button class="primary big" id="intro-done">Everyone's ready, begin!</button>
      <p class="small">You can reopen a screen anytime from the top of the table.</p>`);
    overlay.querySelectorAll('[data-open-screen]').forEach((el) => el.addEventListener('click', () => openScreen(+el.dataset.openScreen)));
    document.getElementById('intro-done').addEventListener('click', () => {
      ui.introPending = false;
      update();
    });
  }

  // A screen tab shows one remote player's cards and follows the main tab.
  function startScreen(seat) {
    mode = 'screen';
    me = seat;
    game = null;
    ui = { viewer: seat, message: '' };
    document.body.classList.add('display-mode');
    renderScreenWaiting('Waiting for the game… Keep the main Throne of Whispers tab open.');
    if (!screenChannel) return renderScreenWaiting('This browser cannot show remote player screens. Try Chrome.');
    screenChannel.postMessage({ t: 'hello' });
  }

  function renderScreenWaiting(text) {
    hideOverlay();
    app.innerHTML = `<div class="setup"><h1 class="logo small">👑 Throne of Whispers</h1><p>${esc(text)}</p></div>`;
  }

  if (screenChannel) {
    screenChannel.onmessage = (e) => {
      const msg = e.data || {};
      if (mode === 'local' && msg.t === 'hello') return sendScreens();
      if (mode !== 'screen' || (msg.seat !== me && msg.seat !== 'all')) return;
      if (msg.t === 'screen') {
        game = msg.view;
        document.title = `Throne of Whispers — ${game.players[me].name}'s screen`;
        renderOnline();
      } else if (msg.t === 'screen-ended') {
        game = null;
        renderScreenWaiting('The game has ended. Waiting for a new one…');
      }
    };
  }

  // ---------- Hosting online ----------

  function renderHostStart(error = '') {
    leaveOnline();
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">👑 Throne of Whispers</h1>
        <h2>Host an online game</h2>
        <p class="small">You'll get a room code to share. Keep this page open while you play: your device runs the game.</p>
        <input id="name" class="wide" maxlength="16" placeholder="Your name" value="${esc(storageGet('throne.name') || '')}">
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="create">Create room</button>
        <button class="link" id="back">← Back</button>
      </div>`;
    document.getElementById('back').addEventListener('click', () => renderTitle());
    document.getElementById('create').addEventListener('click', () => {
      const name = document.getElementById('name').value.trim();
      if (!name) return renderHostStart('Enter your name first.');
      if (!Net.available()) return renderHostStart('Online play could not load. Check your internet connection and reload the page.');
      storageSet('throne.name', name);
      startHosting(name);
    });
  }

  function startHosting(name) {
    mode = 'host';
    me = 0;
    game = null;
    roomCode = '';
    lobby = [{ name, isHost: true }];
    ui = { viewer: 0, message: '' };
    app.innerHTML = '<div class="setup"><h2>Opening a room…</h2></div>';
    net = Net.host({
      onReady: (code) => {
        roomCode = code;
        window.onbeforeunload = () => 'Leaving will end the online game for everyone.';
        hostTick();
      },
      onData: hostReceive,
      onDisconnect: (conn) => {
        const seat = lobby.find((s) => s.conn === conn);
        if (seat) { seat.conn = null; hostTick(); }
      },
      onError: (message) => {
        if (!roomCode) renderHostStart(message);
        else console.warn(message); // players already connected keep playing
      },
    });
  }

  function refuse(conn, message) {
    conn.send({ t: 'refused', message });
    setTimeout(() => conn.close(), 500);
  }

  // Give a seat to a new connection, shutting the old one if it's still hanging on.
  function takeSeat(seat, conn, clientId) {
    const old = seat.conn;
    seat.conn = conn;
    if (clientId) seat.clientId = clientId;
    if (old && old !== conn) {
      try { old.close(); } catch (e) { /* already gone */ }
    }
  }

  function hostReceive(conn, msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'join') {
      const name = String(msg.name || '').trim().slice(0, 16) || 'Adventurer';
      const clientId = String(msg.clientId || '');
      const same = lobby.find((s) => s.name.toLowerCase() === name.toLowerCase());
      // A phone that drops out (screen lock, app switch, Wi-Fi blip) often
      // leaves its old connection looking open on the host for a long time,
      // so "still connected" can't be what blocks someone from coming back.
      const guestSeat = same && !same.isHost && !(same.isBot && !same.replaced);
      if (!game) {
        const sameDevice = guestSeat && clientId && same.clientId === clientId;
        const droppedOut = guestSeat && !(same.conn && same.conn.open);
        if (sameDevice || droppedOut) takeSeat(same, conn, clientId);
        else if (same) return refuse(conn, 'Someone in this room already has that name. Try another.');
        else if (lobby.length >= 6) return refuse(conn, 'This room is full (6 players).');
        else lobby.push({ name, conn, clientId });
      } else {
        // Mid-game, anyone who was playing can come back using the same name.
        if (!guestSeat) {
          return refuse(conn, 'This game has already started. Players who dropped out can rejoin with the same name.');
        }
        takeSeat(same, conn, clientId);
        if (same.replaced) {
          same.replaced = false;
          game.players[lobby.indexOf(same)].isBot = false;
        }
      }
      return hostTick();
    }

    if (msg.t === 'action' && game) {
      const seat = lobby.findIndex((s) => s.conn === conn);
      // Screen-only players' moves are entered by the host, not their device.
      if (seat < 0 || game.players[seat].isBot || lobby[seat].relay) return;
      try {
        TW.applyAction(game, seat, msg.action);
      } catch (e) {
        conn.send({ t: 'error', message: e.message });
      }
      hostTick();
    }
  }

  function publicLobby() {
    return lobby.map((s) => ({
      name: s.name,
      isHost: !!s.isHost,
      isBot: !!s.isBot,
      relay: !!s.relay,
      connected: !!s.isHost || !!s.isBot || !!s.replaced || !!(s.conn && s.conn.open),
    }));
  }

  function broadcast() {
    const pub = publicLobby();
    lobby.forEach((s, i) => {
      if (!s.conn || !s.conn.open) return;
      s.conn.send({ t: 'sync', code: roomCode, you: i, lobby: pub, teaching, variant, relayed: !!s.relay, view: game ? TW.viewFor(game, i) : null });
    });
  }

  // After anything changes on the host: let computers move, send everyone their view, redraw.
  function hostTick() {
    stopTimers();
    if (game && waiting().some((i) => game.players[i].isBot)) {
      botTimer = setTimeout(() => { botMove(); hostTick(); }, BOT_DELAY);
    }
    broadcast();
    renderOnline();
  }

  function startOnlineGame() {
    // Drop anyone who left the lobby before starting.
    lobby = lobby.filter((s) => s.isHost || s.isBot || (s.conn && s.conn.open));
    if (lobby.length < 2) return hostTick();
    game = TW.createGame({ players: lobby.map((s) => ({ name: s.name, isBot: !!s.isBot })), teaching, variant });
    ui = { viewer: 0, message: '' };
    hostTick();
  }

  // ---------- Joining online ----------

  function renderJoin(error = '', code) {
    leaveOnline();
    const params = new URLSearchParams(location.search);
    const prefill = code || params.get('join') || '';
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">👑 Throne of Whispers</h1>
        <h2>Join an online game</h2>
        <input id="name" class="wide" maxlength="16" placeholder="Your name" value="${esc(storageGet('throne.name') || '')}">
        <input id="code" class="wide code-input" maxlength="4" placeholder="Room code" value="${esc(prefill.toUpperCase())}" autocapitalize="characters">
        ${error ? `<p class="error">${esc(error)}</p>` : ''}
        <button class="primary big" id="join">Join</button>
        <button class="link" id="back">← Back</button>
      </div>`;
    document.getElementById('back').addEventListener('click', () => renderTitle());
    document.getElementById('join').addEventListener('click', () => {
      const name = document.getElementById('name').value.trim();
      const roomInput = document.getElementById('code').value.trim().toUpperCase();
      if (!name) return renderJoin('Enter your name first.', roomInput);
      if (!/^[A-Z]{4}$/.test(roomInput)) return renderJoin('Room codes are 4 letters.', roomInput);
      if (!Net.available()) return renderJoin('Online play could not load. Check your internet connection and reload the page.', roomInput);
      storageSet('throne.name', name);
      connectToRoom(name, roomInput);
    });
  }

  function connectToRoom(name, code) {
    leaveOnline();
    mode = 'client';
    lastJoin = { name, code };
    roomCode = code;
    if (!ui || ui.room !== code) ui = { viewer: null, message: '', room: code };
    app.innerHTML = `<div class="setup"><h2>Joining room ${esc(code)}…</h2></div>`;
    const conn = Net.join(code, {
      onOpen: () => conn.send({ t: 'join', name, clientId: deviceId() }),
      onData: clientReceive,
      onClose: () => { if (net === conn) renderLost(); },
      onError: (message) => {
        if (net !== conn) return;
        if (!game) renderJoin(message, code);
        else renderLost(message);
      },
    });
    net = conn;
  }

  function clientReceive(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'sync') {
      roomCode = msg.code;
      me = msg.you;
      lobby = msg.lobby;
      teaching = msg.teaching;
      variant = !!msg.variant;
      game = msg.view;
      ui.viewer = me;
      ui.relayed = !!msg.relayed;
      document.body.classList.toggle('display-mode', ui.relayed);
      return renderOnline();
    }
    if (msg.t === 'error') {
      ui.message = msg.message;
      return renderOnline();
    }
    if (msg.t === 'refused') return renderJoin(msg.message, roomCode);
    if (msg.t === 'kicked') return renderTitle('The host removed you from the room.');
    if (msg.t === 'ended') return renderTitle('The host ended the game.');
  }

  function renderLost(message = '') {
    stopTimers();
    showOverlay(`
      <h2>📡 Lost connection to the host</h2>
      <p>${esc(message || 'The connection dropped. You can try to rejoin; your seat is saved.')}</p>
      <div class="row">
        <button class="primary big" id="rejoin">Rejoin</button>
        <button class="secondary big" id="menu">Main menu</button>
      </div>`);
    document.getElementById('rejoin').addEventListener('click', () => connectToRoom(lastJoin.name, lastJoin.code));
    document.getElementById('menu').addEventListener('click', () => renderTitle());
  }

  // Close any online connection. The host tells everyone the game is over first.
  function leaveOnline() {
    stopTimers();
    window.onbeforeunload = null;
    document.body.classList.remove('display-mode');
    if (net) {
      const old = net;
      net = null;
      if (mode === 'host') {
        lobby.forEach((s) => { if (s.conn && s.conn.open) s.conn.send({ t: 'ended' }); });
        setTimeout(() => old.close(), 300);
      } else {
        old.close();
      }
    }
    mode = 'local';
    game = null;
    lobby = [];
    me = null;
  }

  // ---------- Online (and remote screen) views ----------

  function renderOnline() {
    hideOverlay();
    if (!game) return renderLobby();
    ui.viewer = me;
    if (game.phase === 'gameOver') {
      ui.seenSeq = game.seq;
      return renderGameOver();
    }
    renderTable();
    if (!isDisplay()) showNoticesOnline();
  }

  // Online, each device steps through the big moments at its own pace.
  // The game doesn't wait, so nobody holds up the other players.
  function showNoticesOnline() {
    if (ui.seenSeq === undefined || ui.seenSeq > game.seq) ui.seenSeq = game.seq; // just arrived, or a new game
    const fresh = bigEvents(ui.seenSeq, me);
    if (!fresh.length) {
      ui.seenSeq = game.seq;
      return;
    }
    showNoticePanel(fresh, me, () => {
      ui.seenSeq = Math.max(...fresh.map((e) => e.seq));
      renderOnline();
    });
  }

  function renderLobby() {
    const host = isHost();
    const list = host ? publicLobby() : lobby;
    const link = `${location.origin}${location.pathname}?join=${roomCode}`;
    const icon = (s) => (s.isHost ? '👑' : s.isBot ? '🤖' : !s.connected ? '📴' : s.relay ? '📺' : '🟢');
    app.innerHTML = `
      <div class="setup">
        <h1 class="logo small">👑 Throne of Whispers</h1>
        <div class="room-code">Room code <b>${esc(roomCode)}</b></div>
        <p class="small">Others open the game, choose <b>Join an online game</b> and enter this code, or use this link:</p>
        <div class="seat">
          <input class="link-box" readonly value="${esc(link)}" aria-label="Invite link">
          <button class="secondary" id="copy">Copy</button>
        </div>
        <h3>Adventurers (${list.length}/6)</h3>
        <div class="seats">
          ${list.map((s, i) => `
            <div class="seat lobby-seat">
              <span>${icon(s)} ${esc(s.name)}${i === me ? ' <i>(you)</i>' : ''}${!host && s.relay ? ' <i>(screen only)</i>' : ''}</span>
              ${host && i > 0 ? `
                <span>
                  ${s.isBot ? '' : `<button class="tiny inline" data-relay="${i}" title="Switch how this player plays">${s.relay ? '📺 Screen only' : '🙂 Own device'}</button>`}
                  <button class="icon-btn" data-remove="${i}" aria-label="Remove">✕</button>
                </span>` : ''}
            </div>`).join('')}
        </div>
        ${host ? `
          <p class="small"><b>📺 Screen only</b>: that device just shows the player's cards with numbers
            (for example, shared on a video call). They say a number and you click it here, without seeing their cards.</p>
          <div class="row"><button class="secondary" id="add-bot" ${list.length >= 6 ? 'disabled' : ''}>+ Computer</button></div>
          ${variantHtml(list.length)}
          <label class="check"><input type="checkbox" id="teaching" ${teaching ? 'checked' : ''}> Teaching mode (hints and explanations)</label>
          <button class="primary big" id="start" ${list.length < 2 ? 'disabled' : ''}>Enter the Royal Court</button>
          ${list.length < 2 ? '<p class="small">Waiting for at least one more adventurer…</p>' : ''}`
        : `<p>Waiting for the host to begin…</p>`}
        ${ui.message ? `<p class="error">${esc(ui.message)}</p>` : ''}
        <button class="link" id="leave">Leave room</button>
      </div>`;

    document.getElementById('copy').addEventListener('click', (e) => {
      const selectIt = () => app.querySelector('.link-box').select();
      if (!navigator.clipboard) return selectIt();
      navigator.clipboard.writeText(link).then(() => { e.target.textContent = 'Copied!'; }, selectIt);
    });
    document.getElementById('leave').addEventListener('click', () => renderTitle());
    if (!host) return;
    app.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => {
      const seat = lobby[+el.dataset.remove];
      if (seat.conn && seat.conn.open) {
        seat.conn.send({ t: 'kicked' });
        const c = seat.conn;
        setTimeout(() => c.close(), 300);
      }
      lobby.splice(+el.dataset.remove, 1);
      hostTick();
    }));
    app.querySelectorAll('[data-relay]').forEach((el) => el.addEventListener('click', () => {
      const seat = lobby[+el.dataset.relay];
      seat.relay = !seat.relay;
      hostTick();
    }));
    document.getElementById('add-bot').addEventListener('click', () => {
      lobby.push({ name: freeBotName(lobby), isBot: true });
      hostTick();
    });
    const v = document.getElementById('variant');
    if (v) v.addEventListener('change', (e) => { variant = e.target.checked; broadcast(); });
    document.getElementById('teaching').addEventListener('change', (e) => { teaching = e.target.checked; broadcast(); });
    document.getElementById('start').addEventListener('click', startOnlineGame);
  }

  // ---------- Teaching hints ----------

  function actionHint(player) {
    if (!game.teaching) return '';
    const move = Bots.chooseAction(game, player);
    const a = TW.ACTIONS[move.kind];
    let text = `<b>${actionLabel(move.kind)}</b>`;
    if (move.target !== undefined && move.target !== null) text += ` on <b>${nameOf(move.target)}</b>`;
    let why = '';
    if (a.claim) {
      why = game.hands[player].some((c) => c.type === a.claim)
        ? ` You really have the ${charLabel(a.claim)}, so a challenge would backfire on the challenger.`
        : ` That would be a bluff: you don't have the ${charLabel(a.claim)}. If someone challenges, you lose an influence.`;
    }
    return `<p class="hint">💡 Hint: a computer adventurer might choose ${text}.${why}</p>`;
  }

  // Counting cards: how many copies of the claimed character could they have?
  function respondHint(player) {
    if (!game.teaching) return '';
    const p = game.pending;
    const claim = p.stage === 'block' ? p.block.as : TW.ACTIONS[p.kind].claim;
    const claimant = p.stage === 'block' ? p.block.blocker : p.actor;
    const parts = [];
    if (claim && TW.responseOptions(game, player).challenge) {
      const left = TW.possibleCopies(game, player, claim);
      const seen = TW.COPIES - left;
      parts.push(left === 0
        ? `All ${TW.COPIES} ${charLabel(claim)} cards are face up or in your hand, so ${nameOf(claimant)} <b>must be bluffing</b>. Challenge!`
        : `There are ${TW.COPIES} ${charLabel(claim)} cards. You can see ${seen} (face up or in your hand), so ${nameOf(claimant)} might have one of the other ${left}.`);
    }
    const real = TW.responseOptions(game, player).blocks.filter((t) => game.hands[player].some((c) => c.type === t));
    if (real.length) parts.push(`You really have the ${charLabel(real[0])}, so you can block safely.`);
    if (p.kind === 'assassinate' && p.target === player && p.stage !== 'block') {
      parts.push('Careful: if you challenge and lose, or block with a bluff and get caught, you can lose <b>both</b> influences this turn.');
    }
    return parts.length ? `<p class="hint">💡 ${parts.join(' ')}</p>` : '';
  }

  // ---------- The table ----------

  function guideHtml() {
    const faceUp = (type) => game.revealed.reduce((n, list) => n + list.filter((c) => c.type === type).length, 0);
    return `
      <details class="guide" ${storageGet('throne.guideClosed') ? '' : 'open'}>
        <summary>📜 Character reference</summary>
        <table>
          <thead><tr><th>Character</th><th>Ability</th><th>Counteraction</th><th title="Face-up copies (3 of each in the game)">Face up</th></tr></thead>
          <tbody>
            ${TW.TYPES.map((t) => {
              const c = TW.CHARACTERS[t];
              return `<tr class="${faceUp(t) >= TW.COPIES ? 'gone' : ''}"><td class="nowrap">${c.icon} ${esc(c.name)}</td>
                <td>${esc(c.action)}</td><td>${esc(c.block)}</td><td>${faceUp(t)} / ${TW.COPIES}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
        <p class="small">Anyone may also <b>Scavenge</b> (take 1 gold), <b>Call in a Favor</b> (take 2 gold, a Guild Master can block it)
          or launch a <b>Coup</b> (pay 7 gold, a player loses an influence). With 10 or more gold at the start of your turn, you must launch a Coup.</p>
      </details>`;
  }

  function eventHtml(ev, viewer) {
    if (!ev) return '';
    const secret = viewer !== null && ev.private[viewer];
    return `<div class="event-text">${esc(ev.text)}</div>
      ${secret ? `<div class="event-secret">🤫 Only you: ${esc(secret)}</div>` : ''}`;
  }

  function statusText(viewer) {
    const w = waiting();
    switch (game.phase) {
      case 'draft':
        return 'Everyone is choosing their first character…';
      case 'action':
        if (game.turn === viewer) return '';
        return isRelay(game.turn) ? `📺 ${nameOf(game.turn)}'s turn: ask them for the number of their action.` : `${nameOf(game.turn)} is choosing an action…`;
      case 'respond':
        return w.length ? `Waiting for ${w.map(nameOf).join(', ')}…` : '';
      case 'lose': {
        const L = game.losses[0];
        const why = { challenge: 'lost a challenge', coup: 'was hit by a Coup', assassinated: 'was assassinated' }[L.why] || 'lost an influence';
        return L.player === viewer ? '' : `💔 ${nameOf(L.player)} ${why} and is choosing a card to reveal…`;
      }
      case 'exchange':
        return game.pending.actor === viewer ? '' : `🧙 ${nameOf(game.pending.actor)} is choosing which cards to keep…`;
      default:
        return '';
    }
  }

  function renderTable(hideHand = false) {
    numberKeys = null;
    const display = isDisplay();
    const viewer = hideHand ? null : ui.viewer;
    const online = mode === 'host' || mode === 'client';
    const seatInfo = online ? (isHost() ? publicLobby() : lobby) : null;
    const controls = controlsFor(viewer, display);

    const chip = (p, i) => {
      const away = seatInfo && seatInfo[i] && !seatInfo[i].connected;
      // The host can hand any guest's seat to a computer at any time (a drop-out
      // doesn't always show), and give it back.
      const guest = isHost() && lobby[i] && !lobby[i].isHost && !lobby[i].isBot && !isRelay(i) && game.phase !== 'gameOver';
      let replaceBtn = '';
      if (guest && lobby[i].replaced) {
        replaceBtn = `<button class="tiny" data-unreplace="${i}" title="${nameOf(i)} plays again">↩ Back to ${nameOf(i)}</button>`;
      } else if (guest) {
        replaceBtn = `<button class="tiny" data-replace="${i}">🤖 Let a computer play</button>`;
      }
      const claims = game.claims[i].slice(-4).map((t) => TW.CHARACTERS[t].icon).join(' ');
      const p2 = game.pending;
      const targeted = p2 && p2.target === i;
      return `
        <div class="pchip ${game.turn === i && !game.out[i] ? 'active' : ''} ${game.out[i] ? 'out' : ''} ${away ? 'away' : ''}">
          <div class="pname"><span class="seatno" title="Seat number">${seatNumber(i)}</span>
            ${p.isBot ? '🤖 ' : ''}${isRelay(i) ? '📺 ' : ''}${nameOf(i)}${mode !== 'local' && i === me ? ' (you)' : ''}${away ? ' 📴' : ''}</div>
          <div class="wealth">
            <span class="gold" title="Gold">🪙 ${game.coins[i]}</span>
            <span class="influence" title="Influence (face-down cards)">${game.hands[i].map(() => '<span class="inf"></span>').join('')}</span>
          </div>
          <div class="tags">
            ${game.out[i] ? '<span class="tag out-tag">💀 Banished</span>' : ''}
            ${!game.out[i] && game.coins[i] >= TW.MUST_COUP ? '<span class="tag must-tag">⚔️ Must Coup</span>' : ''}
            ${targeted && !game.out[i] ? '<span class="tag target-tag">🎯 Target</span>' : ''}
            ${claims ? `<span class="tag" title="Characters they have claimed (latest last)">claimed ${claims}</span>` : ''}
          </div>
          <div class="playarea">${game.revealed[i].map(miniHtml).join('')}</div>
          ${replaceBtn}
        </div>`;
    };

    const screenButtons = mode === 'local'
      ? relaySeats().map((i) => `<button class="link" data-open-screen="${i}">📺 ${nameOf(i)}'s screen</button>`).join('')
      : '';
    const log = game.log.slice().reverse();
    const status = statusText(viewer);

    app.innerHTML = `
      <div class="table">
        <header class="topbar">
          <div><b>👑 Throne of Whispers</b>${roomCode && online ? ` · Room ${esc(roomCode)}` : ''}</div>
          <div class="top-actions">
            ${mode === 'local' && multiHuman() && game.phase !== 'gameOver' ? '<button class="link" id="peek">👀 Look at my cards</button>' : ''}
            ${screenButtons}
            <button class="link" data-rules>Rules</button>
            ${mode === 'local' || isHost() ? `<button class="link" id="teach-toggle">${game.teaching ? 'Teaching: on' : 'Teaching: off'}</button>` : ''}
            ${mode !== 'screen' ? `<button class="link" id="quit">${online ? 'Leave' : 'Quit'}</button>` : ''}
          </div>
        </header>
        <div class="players">${game.players.map(chip).join('')}</div>
        <div class="court">
          <div class="pile">
            ${game.court.length ? backHtml() : '<div class="card empty-pile">empty</div>'}
            <div class="pile-label"><b>${game.court.length}</b> card${game.court.length === 1 ? '' : 's'} in<br>the Royal Court</div>
          </div>
        </div>
        ${status ? `<div class="status">${status}</div>` : ''}
        <div class="event">${eventHtml(game.lastEvent, viewer)}</div>
        ${ui.message ? `<div class="message">${esc(ui.message)}</div>` : ''}
        ${controls.html}
        ${controls.showsHand ? '' : handHtml(viewer, display)}
        ${log.length > 1 ? `
          <details class="log" ${storageGet('throne.logOpen') ? 'open' : ''}>
            <summary>📖 What happened (${log.length})</summary>
            <ol reversed>${log.map((ev) => `<li>${eventHtml(ev, viewer)}</li>`).join('')}</ol>
          </details>` : ''}
        ${guideHtml()}
      </div>`;

    app.querySelector('[data-rules]').addEventListener('click', showRules);
    app.querySelector('.guide').addEventListener('toggle', (e) => storageSet('throne.guideClosed', e.target.open ? '' : '1'));
    // The "What happened" list stays open (or closed) the way you left it.
    const logBox = app.querySelector('.log');
    if (logBox) logBox.addEventListener('toggle', (e) => storageSet('throne.logOpen', e.target.open ? '1' : ''));
    app.querySelectorAll('[data-open-screen]').forEach((el) => el.addEventListener('click', () => openScreen(+el.dataset.openScreen)));
    const peek = document.getElementById('peek');
    if (peek) peek.addEventListener('click', chooseWhoPeeks);
    const toggle = document.getElementById('teach-toggle');
    if (toggle) toggle.addEventListener('click', () => {
      game.teaching = !game.teaching;
      teaching = game.teaching;
      rerender();
    });
    const quit = document.getElementById('quit');
    if (quit) quit.addEventListener('click', () => {
      const question = isHost() ? 'Leave? This ends the game for everyone.' : online ? 'Leave this game?' : 'Quit this game?';
      if (confirm(question)) renderTitle();
    });
    app.querySelectorAll('[data-replace]').forEach((el) => el.addEventListener('click', () => {
      const i = +el.dataset.replace;
      if (lobby[i].conn && lobby[i].conn.open && !confirm(`Let a computer play for ${game.players[i].name}? They can rejoin to take their seat back.`)) return;
      lobby[i].replaced = true;
      game.players[i].isBot = true;
      hostTick();
    }));
    app.querySelectorAll('[data-unreplace]').forEach((el) => el.addEventListener('click', () => {
      const i = +el.dataset.unreplace;
      lobby[i].replaced = false;
      game.players[i].isBot = false;
      hostTick();
    }));

    controls.bind();
    // Finish choosing a target, if one was in progress.
    const c = ui.choosing;
    if (c && controls.canChoose && game.phase === 'action' && game.turn === c.player) showChooser();
    else ui.choosing = null;
  }

  // The viewer's own cards.
  function handHtml(viewer, display) {
    if (viewer === null) return '<div class="hand-hidden">Cards are hidden 🔒</div>';
    if (game.out[viewer]) return '<div class="hand-hidden">💀 You have been banished from the Royal Court. Watch the others…</div>';
    return `
      <div class="hand-label">${mode !== 'local' ? 'Your influence' : `${nameOf(viewer)}'s influence`} (secret)</div>
      <div class="hand">${game.hands[viewer].map((card, k) => cardHtml(card, { badge: display ? slotNumber(k) : '' })).join('')}</div>`;
  }

  // ---------- Controls for whatever the game is waiting on ----------

  // Returns { html, bind, showsHand, canChoose }. `seeing` means the player can
  // see their own cards on this screen; `blind` means this device enters a
  // remote player's choice without seeing their cards.
  function controlsFor(viewer, display) {
    const empty = { html: '', bind: () => {}, showsHand: false, canChoose: false };
    switch (game.phase) {
      case 'action': return actionControls(viewer, display) || empty;
      case 'respond': return respondControls(viewer, display);
      case 'lose': return loseControls(viewer, display) || empty;
      case 'exchange': return exchangeControls(viewer, display) || empty;
      case 'draft': return draftControls(viewer, display) || empty;
      default: return empty;
    }
  }

  function actionControls(viewer, display) {
    const actor = game.turn;
    const seeing = viewer === actor;
    const blind = !seeing && !display && isRelay(actor);
    if (!seeing && !blind) return null;
    const options = TW.availableActions(game, actor);
    const mine = seeing ? game.hands[actor].map((c) => c.type) : null;
    const forced = game.coins[actor] >= TW.MUST_COUP;
    const heading = seeing && display ? '🎯 Your turn! Say the <b>number</b> of your action.'
      : seeing ? '🎯 Your turn: choose an action'
      : `📺 ${nameOf(actor)}'s turn: click the action number they say`;
    const html = `
      <div class="box">
        <h3>${heading}</h3>
        ${seeing && display ? '<p class="say-more">If it targets a player, say their seat number too.</p>' : ''}
        ${forced ? `<p class="must">⚔️ ${seeing ? 'You have' : `${nameOf(actor)} has`} ${game.coins[actor]} gold, so a Coup is the only choice.</p>` : ''}
        <div class="actions">
          ${options.map((o, k) => {
            const a = TW.ACTIONS[o.kind];
            let claim = '<span class="claim general">Anyone</span>';
            if (a.claim) {
              const truth = mine ? (mine.includes(a.claim) ? '<span class="truth">✔ you have it</span>' : '<span class="bluff">🎭 bluff</span>') : '';
              claim = `<span class="claim t-${a.claim}">Claim ${charLabel(a.claim)}</span>${truth}`;
            }
            return `<button class="action-btn ${display ? 'static' : ''}" data-action="${o.kind}" ${o.legal ? '' : 'disabled'} title="${esc(o.reason || a.text)}">
              <span class="num">${k + 1}</span>
              <span class="a-main"><b>${a.icon} ${esc(a.name)}</b>${a.alt ? ` <span class="small">(${esc(a.alt)})</span>` : ''}
                <span class="a-text">${esc(a.text)}</span></span>
              <span class="a-claim">${claim}</span>
            </button>`;
          }).join('')}
        </div>
        ${seeing && !display ? actionHint(actor) : ''}
      </div>`;
    const bind = () => {
      if (display) return;
      app.querySelectorAll('[data-action]').forEach((el) => el.addEventListener('click', () => chooseAction(actor, el.dataset.action)));
      if (blind) {
        numberKeys = Object.fromEntries(options.filter((o) => o.legal).map((o) => [slotNumber(TW.ACTION_ORDER.indexOf(o.kind)), () => chooseAction(actor, o.kind)]));
      }
    };
    return { html, bind, showsHand: false, canChoose: !display };
  }

  function chooseAction(player, kind) {
    if (TW.ACTIONS[kind].target) {
      ui.choosing = { player, kind };
      return rerender();
    }
    act({ type: 'declare', player, kind });
  }

  // Pick who the Coup, assassination or pickpocketing is aimed at.
  function showChooser() {
    const c = ui.choosing;
    const a = TW.ACTIONS[c.kind];
    const relay = isRelay(c.player);
    const targets = TW.validTargets(game, c.player);
    showOverlay(`
      <h2>${a.icon} ${relay ? `📺 ${nameOf(c.player)}:` : ''} ${esc(a.name)}</h2>
      <p class="small">${esc(a.text)}</p>
      <p>${relay ? `Ask ${nameOf(c.player)}: which player? (seat number)` : 'Which player?'}</p>
      <div class="choices">
        ${targets.map((t) => `<button class="choice" data-target="${t}">
          <span class="seatno">${seatNumber(t)}</span> ${nameOf(t)}
          <span class="small">🪙 ${game.coins[t]} · ${game.hands[t].length} influence</span></button>`).join('')}
      </div>
      <button class="link" id="cancel">Cancel</button>`);
    const finish = (t) => act({ type: 'declare', player: c.player, kind: c.kind, target: t });
    overlay.querySelectorAll('[data-target]').forEach((el) => el.addEventListener('click', () => finish(+el.dataset.target)));
    document.getElementById('cancel').addEventListener('click', () => { ui.choosing = null; rerender(); });
    if (relay) numberKeys = Object.fromEntries(targets.map((t) => [seatNumber(t), () => finish(t)]));
  }

  // The shared "challenge or block?" panel.
  function respondControls(viewer, display) {
    const p = game.pending;
    const a = TW.ACTIONS[p.kind];
    const w = TW.waitingOn(game);
    let heading;
    let sub;
    if (p.stage === 'block') {
      heading = `✋ ${nameOf(p.block.blocker)} claims the ${charLabel(p.block.as)} to block ${nameOf(p.actor)}'s ${esc(a.name)}`;
      sub = 'Anyone else may challenge the block. If nobody does, the action fails.';
    } else {
      const aim = p.target !== null ? ` on ${nameOf(p.target)}` : '';
      heading = a.claim
        ? `${a.icon} ${nameOf(p.actor)} claims the ${charLabel(a.claim)}: ${esc(a.name)}${aim}`
        : `${a.icon} ${nameOf(p.actor)}: ${esc(a.name)}${aim}`;
      const blockers = a.blockers ? a.blockers.map(charLabel).join(' or ') : '';
      if (p.stage === 'blockOnly') sub = `The claim was proven. ${nameOf(p.target)} may still block with the ${blockers}.`;
      else if (a.claim && a.blockers) sub = `Anyone may challenge the claim. ${nameOf(p.target)} may block with the ${blockers}.`;
      else if (a.claim) sub = 'Anyone may challenge the claim.';
      else sub = `Anyone may block by claiming the ${blockers}.`;
    }
    const rows = TW.responders(game).map((i) => {
      const done = !w.includes(i);
      const opts = TW.responseOptions(game, i);
      const who = `<span class="who"><span class="seatno">${seatNumber(i)}</span> ${nameOf(i)}${mode !== 'local' && i === me ? ' (you)' : ''}</span>`;
      if (done) return `<div class="resp-row">${who}<span class="small">✔ allows it</span></div>`;
      if (display && i === me) {
        const say = ['Allow', opts.challenge ? 'Challenge' : '', ...opts.blocks.map((t) => `Block as ${TW.CHARACTERS[t].name}`)].filter(Boolean);
        return `<div class="resp-row mine">${who}<span class="say">👉 Say: <b>${esc(say.join(' / '))}</b></span></div>`;
      }
      if (display || !canAnswer(i)) {
        return `<div class="resp-row">${who}<span class="small">${game.players[i].isBot ? '🤔 thinking…' : 'deciding…'}</span></div>`;
      }
      return `
        <div class="resp-row mine">
          ${who}
          <span class="resp-btns">
            <button class="secondary" data-resp="${i}" data-choice="allow">✔ Allow</button>
            ${opts.challenge ? `<button class="danger" data-resp="${i}" data-choice="challenge">⚖️ Challenge</button>` : ''}
            ${opts.blocks.map((t) => `<button class="block-btn" data-resp="${i}" data-choice="block" data-as="${t}">✋ Block as ${charLabel(t)}</button>`).join('')}
            ${mode === 'local' && multiHuman() && humans().includes(i) && i !== viewer
              ? `<button class="peek-btn" data-peek-row="${i}" title="Pass the device to ${nameOf(i)} to check their cards first">👀 My cards</button>` : ''}
          </span>
          ${i === viewer ? respondHint(i) : ''}
        </div>`;
    }).join('');
    const watching = p.stage === 'block' ? viewer === p.block.blocker : viewer === p.actor;
    const html = `
      <div class="box respond">
        <h3>${heading}</h3>
        <p class="small">${sub}</p>
        <div class="resp-rows">${rows}</div>
        ${watching ? '<p class="small">Waiting for the others to answer…</p>' : ''}
      </div>`;
    const bind = () => {
      app.querySelectorAll('[data-resp]').forEach((el) => el.addEventListener('click', () => {
        act({ type: 'respond', player: +el.dataset.resp, choice: el.dataset.choice, as: el.dataset.as });
      }));
      // Check your cards before deciding: pass the device, look, then come back here.
      app.querySelectorAll('[data-peek-row]').forEach((el) => el.addEventListener('click', () => {
        ui.peekQueue = [+el.dataset.peekRow];
        update();
      }));
    };
    return { html, bind, showsHand: false, canChoose: false };
  }

  function loseControls(viewer, display) {
    const L = game.losses[0];
    const i = L.player;
    const seeing = viewer === i;
    const blind = !seeing && !display && isRelay(i);
    if (!seeing && !blind) return null;
    const why = { challenge: 'You lost the challenge', coup: 'A Coup hits you', assassinated: 'You were assassinated' }[L.why] || 'You lose an influence';
    const hand = game.hands[i];
    let heading;
    if (seeing && display) heading = `💔 ${why}. Say the <b>number</b> of the card to reveal.`;
    else if (seeing) heading = `💔 ${why}. Choose a card to reveal (you lose its influence):`;
    else heading = `📺 ${nameOf(i)} must reveal a card: click the number they say`;
    const cards = hand.map((card, k) => {
      if (blind) return backHtml({ number: slotNumber(k), extraClass: 'playable', attrs: `data-lose="${card.id}" role="button" tabindex="0"` });
      return cardHtml(card, {
        extraClass: display ? '' : 'playable',
        attrs: display ? '' : `data-lose="${card.id}" role="button" tabindex="0"`,
        badge: display ? slotNumber(k) : '',
      });
    }).join('');
    const html = `
      <div class="box">
        <h3>${heading}</h3>
        <div class="hand">${cards}</div>
        ${seeing && !display && game.teaching ? '<p class="hint">💡 Keep the character you most want to use (or bluff) next.</p>' : ''}
      </div>`;
    const bind = () => {
      if (display) return;
      app.querySelectorAll('[data-lose]').forEach((el) => {
        const go = () => act({ type: 'lose', player: i, cardId: el.dataset.lose });
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(); });
      });
      if (blind) numberKeys = Object.fromEntries(hand.map((card, k) => [slotNumber(k), () => act({ type: 'lose', player: i, cardId: card.id })]));
    };
    return { html, bind, showsHand: seeing, canChoose: false };
  }

  function exchangeControls(viewer, display) {
    const i = game.pending.actor;
    const seeing = viewer === i;
    const blind = !seeing && !display && isRelay(i);
    if (!seeing && !blind) return null;
    const hand = game.hands[i];
    const drawn = game.pending.drawn;
    const pool = [...hand, ...drawn];
    const need = hand.length;
    const sel = ui.keepSel && ui.keepSel.player === i ? ui.keepSel.ids.filter((id) => pool.some((c) => c.id === id)) : [];
    const many = need > 1 ? `${need} cards` : '1 card';
    let heading;
    if (seeing && display) heading = `🧙 Arcane Study: say the <b>numbers</b> of the ${many} to keep.`;
    else if (seeing) heading = `🧙 Arcane Study: choose ${many} to keep. The rest go back to the Royal Court.`;
    else heading = `📺 ${nameOf(i)}'s Arcane Study: click the ${need > 1 ? 'numbers' : 'number'} of the ${many} they keep`;
    const cards = pool.map((card, k) => {
      const picked = sel.includes(card.id) ? ' selected' : '';
      const attrs = `data-keep="${k}" role="button" tabindex="0"`;
      if (blind) return backHtml({ number: slotNumber(k), extraClass: `playable${picked}`, attrs });
      return cardHtml(card, {
        extraClass: display ? '' : `playable${picked}`,
        attrs: display ? '' : attrs,
        badge: display ? slotNumber(k) : '',
        tag: k >= need ? 'New' : 'Yours',
      });
    }).join('');
    let hint = '';
    if (seeing && !display && game.teaching) {
      const pickIds = Bots.chooseExchange(game, i).keepIds;
      const names = pool.filter((c) => pickIds.includes(c.id)).map((c) => `<b>${charLabel(c.type)}</b>`).join(' and ');
      hint = `<p class="hint">💡 Hint: a computer adventurer would keep ${names}. Two different characters give you more options.</p>`;
    }
    const html = `
      <div class="box">
        <h3>${heading}</h3>
        <div class="hand">${cards}</div>
        ${display ? '' : `<button class="primary big" id="keep-done" ${sel.length === need ? '' : 'disabled'}>Keep ${sel.length}/${need} chosen</button>`}
        ${hint}
      </div>`;
    const toggle = (k) => {
      const id = pool[k].id;
      let ids = sel.slice();
      if (ids.includes(id)) ids = ids.filter((x) => x !== id);
      else if (ids.length < need) ids.push(id);
      else if (need === 1) ids = [id];
      else return;
      ui.keepSel = { player: i, ids };
      rerender();
    };
    const bind = () => {
      if (display) return;
      app.querySelectorAll('[data-keep]').forEach((el) => {
        el.addEventListener('click', () => toggle(+el.dataset.keep));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(+el.dataset.keep); });
      });
      document.getElementById('keep-done').addEventListener('click', () => act({ type: 'exchange', player: i, keepIds: sel }));
      if (blind) numberKeys = Object.fromEntries(pool.map((_, k) => [slotNumber(k), () => toggle(k)]));
    };
    return { html, bind, showsHand: seeing, canChoose: false };
  }

  function draftControls(viewer, display) {
    const seeing = viewer !== null && !game.draft.chosen[viewer];
    const relayPick = !display ? waiting().find((i) => isRelay(i) && i !== viewer) : undefined;
    if (!seeing && relayPick === undefined) {
      if (viewer !== null && game.draft.chosen[viewer]) {
        return { html: `<div class="box"><h3>You kept the ${charLabel(game.draft.chosen[viewer].type)}.</h3><p>Waiting for the other player to choose…</p></div>`, bind: () => {}, showsHand: true, canChoose: false };
      }
      return null;
    }
    const i = seeing ? viewer : relayPick;
    const options = game.draft.options[i];
    let heading;
    if (seeing && display) heading = '👑 Say the <b>number</b> of the character you want to keep.';
    else if (seeing) heading = '👑 Choose one character to keep. The other four are removed from the game.';
    else heading = `📺 ${nameOf(i)} is choosing a character: click the number they say`;
    const cards = options.map((card, k) => {
      const attrs = `data-draft="${card.id}" role="button" tabindex="0"`;
      if (!seeing) return backHtml({ number: slotNumber(k), extraClass: 'playable', attrs });
      return cardHtml(card, { extraClass: display ? '' : 'playable', attrs: display ? '' : attrs, badge: display ? slotNumber(k) : '' });
    }).join('');
    const html = `
      <div class="box">
        <h3>${heading}</h3>
        <div class="hand">${cards}</div>
        ${seeing && !display ? '<p class="small">Your second card is dealt at random once both players have chosen.</p>' : ''}
      </div>`;
    const bind = () => {
      if (display) return;
      app.querySelectorAll('[data-draft]').forEach((el) => {
        const go = () => act({ type: 'draft', player: i, cardId: el.dataset.draft });
        el.addEventListener('click', go);
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') go(); });
      });
      if (!seeing) numberKeys = Object.fromEntries(options.map((card, k) => [slotNumber(k), () => act({ type: 'draft', player: i, cardId: card.id })]));
    };
    return { html, bind, showsHand: true, canChoose: false };
  }

  // ---------- End of the game ----------

  function renderGameOver() {
    if (mode === 'local' && multiHuman()) ui.viewer = null;
    renderTable(true);
    const w = game.winner;
    const ranked = [w, ...game.outOrder.slice().reverse()].filter((i) => i !== null && i !== undefined);
    let buttons = '';
    if (mode === 'local') {
      buttons = '<button class="primary big" id="again">Play again</button><button class="secondary big" id="new">New setup</button>';
    } else if (isHost()) {
      buttons = '<button class="primary big" id="again">Play again</button><button class="secondary big" id="lobby">Back to the room</button>';
    } else if (mode === 'client') {
      buttons = '<p>Waiting for the host…</p><button class="secondary big" id="new">Leave</button>';
    }
    showOverlay(`
      <h2 class="crown big-crown">👑 ${w !== null ? `${nameOf(w)} claims the throne!` : 'The Royal Court is empty!'}</h2>
      ${game.lastEvent ? `<div class="event ending">${esc(game.log.filter((e) => e.kind !== 'win').slice(-1)[0].text)}</div>` : ''}
      <div class="showdown">
        ${ranked.map((i, place) => `
          <div class="played ${i === w ? 'won' : 'knocked'}">
            <div class="mini-row">${[...game.hands[i], ...game.revealed[i]].filter(Boolean).map(miniHtml).join('')}</div>
            <div class="by">${place === 0 ? '👑' : `#${place + 1}`} ${nameOf(i)}</div>
          </div>`).join('')}
      </div>
      <div class="row">${buttons}</div>`);
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('again', mode === 'local' ? startLocalGame : startOnlineGame);
    on('new', () => (mode === 'local' ? renderSetup() : renderTitle()));
    on('lobby', () => { game = null; hostTick(); });
  }

  // ---------- Rules (its own layer, so the game keeps running underneath) ----------

  function showRules() {
    rulesLayer.innerHTML = `
      <div class="panel">
        <h2>How to play Throne of Whispers</h2>
        <div class="rules">
          <p><b>Goal:</b> make everyone else lose their influence and be the last adventurer standing.</p>
          <p><b>Setup:</b> the 15 character cards (3 each of Guild Master, Rogue, Bard, Wizard and Paladin) are shuffled.
            Everyone gets 2 face-down cards (your <b>influence</b>) and 2 gold. The rest form the <b>Royal Court</b> deck.
            A random player goes first. With 2 players, the first player starts with only 1 gold.</p>
          <p><b>Your turn:</b> take exactly one action. Some actions need you to <b>claim</b> a character. You may be telling the
            truth or bluffing!</p>
          <ul>
            ${TW.ACTION_ORDER.map((k) => {
              const a = TW.ACTIONS[k];
              return `<li><b>${a.icon} ${esc(a.name)}</b>${a.alt ? ` (${esc(a.alt)})` : ''}${a.claim ? `, claim the ${charLabel(a.claim)}` : ''}: ${esc(a.text)}</li>`;
            }).join('')}
          </ul>
          <p>If you start your turn with 10 or more gold, you must launch a Coup.</p>
          <p><b>Blocking:</b> a Guild Master blocks Call in a Favor (anyone may block it). The target of an assassination
            may block with the Paladin. The target of a Pickpocket may block with the Bard or the Wizard. Blocking is a claim too.</p>
          <p><b>Challenges:</b> anyone may challenge any claim, whether it's an action or a block.</p>
          <ul>
            <li>If the claimer <b>has</b> the character, they show it, shuffle it into the Royal Court and draw a new card.
              The challenger loses an influence, and the action (or block) goes ahead.</li>
            <li>If the claimer <b>doesn't</b> have it, they lose an influence and their action (or block) is canceled.
              Gold paid for a canceled action is returned.</li>
          </ul>
          <p><b>Losing influence:</b> you choose which of your cards to reveal. Revealed cards stay face up and no longer count.
            Lose both and you're banished from the Royal Court, and your gold returns to the treasury.</p>
          <p><b>Double danger:</b> if a Rogue assassinates you and you challenge and lose, or you bluff a Paladin and get caught,
            you lose one influence for the challenge and another for the assassination.</p>
          <p><b>Gold spent stays spent</b> when an action is blocked (for example the Rogue's 3 gold).</p>
          <p><b>Two-player variant</b> (option when setting up 2 players): the cards are split into 3 sets of five, one of each
            character. Each player secretly keeps one card from their set and removes the other four from the game. The third set
            is shuffled, each player gets one card from it, and the last three form the Royal Court.</p>
          <p><b>📺 Remote players</b> see their cards and actions numbered 1, 2… and every adventurer has a seat number.
            They say the action number and the seat number of who they pick, and say Allow, Challenge or Block when asked.</p>
        </div>
        <button class="primary" id="close-rules">Close</button>
      </div>`;
    rulesLayer.classList.remove('hidden');
    document.getElementById('close-rules').addEventListener('click', () => {
      rulesLayer.classList.add('hidden');
      rulesLayer.innerHTML = '';
    });
  }

  // Start: a remote screen tab, an invite link, or the title screen.
  const params = new URLSearchParams(location.search);
  if (params.has('screen')) startScreen(+params.get('screen'));
  else if (params.get('join')) renderJoin();
  else renderTitle();
})();
