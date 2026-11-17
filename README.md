# 👑 Throne of Whispers

A game of deception, influence and betrayal. Everyone holds two secret characters from the
Royal Court. On your turn, claim any character you like, true or not, to use its power.
Anyone can call your bluff. Lose both cards and you're banished. The last adventurer
standing claims the throne.

## How to play it

Double-click `index.html` to open it in your web browser. Nothing to install.

- **2–6 players**: any mix of people and computer adventurers.
- **Same device**: a "Pass the device" screen hides each person's cards until they tap
  *I'm ready*. Challenges and blocks are answered on one shared screen, so nobody has to
  pass the device just to say "Allow".
- **Teaching mode**: hints for your action, and card counting when someone makes a claim
  ("you can see 2 of the 3 Rogues…").
- **Two-player variant**: with 2 players, tick the box to pick your first character from a
  full set of five.
- **Online**: one person chooses *Host an online game* and shares the 4-letter room code
  (or invite link). Everyone else chooses *Join an online game*.

## The characters (3 of each, 15 cards)

| Character | Ability | Counteraction |
|---|---|---|
| 🏛️ Guild Master | Collect 3 gold (Guild Revenue) | Blocks Call in a Favor |
| 🗡️ Rogue | Pay 3 gold to assassinate | None |
| 🎻 Bard | Steal up to 2 gold (Pickpocket) | Blocks stealing |
| 🧙 Wizard | Exchange cards with the Court (Arcane Study) | Blocks stealing |
| 🛡️ Paladin | None | Blocks assassination |

Anyone may also **Scavenge** (take 1 gold), **Call in a Favor** (take 2 gold) or launch a
**Coup** (pay 7 gold; a player loses an influence; can't be stopped). Starting your turn
with 10 or more gold forces a Coup. The full rules are under *How to play* in the game.

## 📺 Remote players (playing over a video call)

For someone who can only watch, for example over Google Meet. They see their cards and the
seven actions numbered, and every adventurer has a **seat number**. They say the action
number and the seat number of who they pick ("6 on seat 3"), and say *Allow*, *Challenge*
or *Block* when asked. You click their choices without seeing their cards. You can also
type the numbers on your keyboard.

- **One computer:** in *Play on this device*, click a player's type until it says
  **📺 Remote**. When the game starts, open their screen in a new tab, then in Google
  Meet choose *Present → A tab* and share only that tab.
- **Two devices:** host an online game, have the second device join under the remote
  player's name, and in the room switch them to **📺 Screen only**.

## How online play works

The host's browser runs the game and sends each player only what they're allowed to see.
Devices connect directly using [PeerJS](https://peerjs.com/) (WebRTC). The host must keep
the page open. A player who drops out can rejoin with the same name, and the host can tap
*Let a computer play* on their seat meanwhile.

## Files

| File | What it does |
|---|---|
| `rules.js` | The game rules: actions, challenges, blocks, losing influence. No screen code. |
| `bots.js` | How computer adventurers act, bluff, challenge and block. |
| `game.js` | The screens and buttons, for both same-device and online games. |
| `online.js` | Connects devices for online play. |
| `style.css` | Colors, card designs and layout. |
| `tests/tests.html` | Open in a browser to run the rules checks (includes 400 computer-only games). |

The cards use emoji designs for now. Card pictures can be added later the same way as in
Dungeon's Treasure.
