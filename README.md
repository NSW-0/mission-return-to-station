# Mission: Return to Station

A two-player buzz wire race for the Astronomy, Electrical and Computer clubs. Each loop
is a ship racing back to the space station before a growing black hole swallows it; the
wire is its flight path. One laptop runs everything and shows the race on the projector.
Two referee phones control each side. No internet is needed on the day.

```
 Buzz wire boards ──► Arduino Pro Micro (USB keyboard) ──► Laptop: display page ──► projector
                                                               ▲
 Referee phone 1 ──── Wi-Fi ───────────────────────────────────┤  game server (Node.js)
 Referee phone 2 ──── Wi-Fi ───────────────────────────────────┘
```

## 1. Install (once, needs internet)

1. Install **Node.js LTS** from <https://nodejs.org>.
2. Open a terminal in this folder and run:

   ```
   npm install
   ```

After this, the game runs with no internet. The font, QR codes and sounds are all local.

## 2. Start

```
npm start
```

On Windows you can also double-click **start.bat**, or the **Mission Return to
Station** shortcut with the black hole icon.

**The shortcut.** It does exactly what `start.bat` does. Shortcuts store the full path of
the folder, so make it once on each laptop (and again if you move the folder):

```
powershell -ExecutionPolicy Bypass -File launcher\make_shortcut.ps1
```

This puts one shortcut in this folder and one on the Desktop. The icon is
`launcher/mission.ico`, made from `art/blackhole_icon.png` by `python tools/make_icon.py`.

The terminal prints the links, and **two tabs** open in the browser:

* the **Connect tab** with the two referee QR codes. Keep it open so you can reconnect a
  phone later.
* the **game display tab**. Click it and press **F** for fullscreen.

If you close the display tab, open it again from the Connect tab (**Open the game
display tab**). The Connect tab shows whether a display tab is already open, because two
displays would play every sound twice.

**Updates.** If the game files are updated while it runs, every open page (display and
phones) reloads itself within a few seconds. A race in progress is not lost. Changes to
the game rules in `server/` need a restart: press Ctrl+C and run `npm start` again; the
phones reconnect and reload by themselves.

```
1. Connect the referee phones (QR codes):         http://localhost:3000/connect
2. Display (this laptop, press F for fullscreen): http://localhost:3000/
Referee phone, Player 1:                          http://192.168.1.23:3000/ref/1?k=ab3cd
Referee phone, Player 2:                          http://192.168.1.23:3000/ref/2?k=ab3cd
Admin (this laptop only):                         http://localhost:3000/admin
```

Keep the black server window open for the whole event.

The first time it starts, Windows may ask whether Node.js may use the network. Tick
**Private networks** and click **Allow**. If you clicked Cancel by mistake, open
*Windows Security > Firewall > Allow an app through firewall* and tick Node.js.

## 3. Connect the referee phones

You do this **once, at the start of the event**, not before every race.

1. Connect both phones to **the same Wi-Fi as the laptop**.
2. The Connect page (`http://localhost:3000/connect`) shows one QR code per referee.
   Scan each with that referee's phone camera and open the link.
3. The phone shows a green dot and "Connected", and the Connect page shows "Phone
   connected" under its code.
4. Switch to the display tab, click it, and press **F** for fullscreen.

The phones stay on their referee page for the whole event and reconnect by themselves
if the Wi-Fi drops or the screen locks. The display shows "Referee phone connected"
under each side on the idle screen; if one says "not connected", reopen the page on that
phone (it is in the browser history) or scan again in the Connect tab.

The `?k=…` at the end of the link is a short key that stops people in the audience from
controlling the game. It stays the same across restarts. To change it, delete
`data/referee-key.json` and restart.

**If the phones cannot open the link.** University and venue Wi-Fi often blocks devices
from reaching each other. Use a hotspot instead:

* **Laptop hotspot (easiest).** On Windows, go to *Settings > Network & internet > Mobile
  hotspot* and turn it on. Connect both phones to that hotspot. Then open
  `http://localhost:3000/admin` and, under *Address for phones*, pick the address that
  starts with `192.168.137.` Save, and the QR codes update.
* **Phone hotspot.** Turn on a hotspot on a spare phone, connect the laptop and both
  referee phones to it, and restart the game (or pick the new address on `/admin`).

If the address on the QR code looks wrong (for example a VirtualBox or VPN adapter),
choose the right one on `/admin`.

## 4. Run a race

| Step | What happens |
| --- | --- |
| Idle | Top scores, a space fact, "Waiting for players", and whether each referee phone is connected. The QR codes are on the Connect tab. |
| Referees | Type the player's name and press **Ready**. No race of any kind starts until the player is Ready. |
| Countdown | When both are ready: 3, 2, 1, GO with beeps. Both fuel timers start exactly at GO. |
| False start | Lifting a loop off its start pad during the countdown cancels it and shows "False start: name". Referees press Ready again. |
| Racing | 60 s of fuel and 3 shields. A touch on the wire costs a shield, then hits are ignored for 1 s. |
| Done | A player is done when they dock, lose all shields ("Shields down") or run out of fuel ("Out of fuel"). |
| Result | The higher score wins (see below). Docking always beats not docking. If nobody docked, the one who lasted longer wins, then the one with more shields left, otherwise "Tie: rematch". The result shows for 3 s, then the scores. |

**Score: a race against time.** Only a docked run scores:

```
score = seconds of fuel left × 10  +  shields left × 100
```

Example: docking at 34.2 s with 2 shields leaves 25.8 s of fuel, so 258 + 200 = **458
points**. One shield is worth 10 seconds, so a careful run can beat a faster, messier
one. While racing, each half shows the score the player would get if they docked right
now, counting down with the fuel. Shields down or out of fuel scores 0. Both numbers can
be changed on `/admin`.

**Solo race.** One referee types a name, presses **Ready**, then **Start solo race**
(it stays off until the player is Ready). The other side sits out. A docked solo run goes
on the leaderboard. If the other referee presses Ready first, a normal two-player race
starts instead.

**Escape the black hole.** Behind each ship a black hole sits at the outer edge of the
screen. It grows faster and faster as the fuel runs down. Docking means escaping: the
black hole shrinks away and the station appears. Running out of fuel means being
swallowed: the ship spins and is pulled into it. Player 2's half is a mirror image of
Player 1's, so both players see exactly the same thing.

**The ship shows the player's state.** Full shield bubble at 3 shields, a cracked bubble
at 2, no bubble at 1, a smoking ship when shields are down, and the laurel ship when
docked.

**Referee buttons**

* **Test hit**: the same as the loop touching the wire, for trying the game without the
  boards. Turn it off on `/admin` (*Test hit button on referee phones*) before the event.
* **Undo hit**: gives one shield back (never above 3). Use it for a false hit, during the
  race or on the result screen. If a false hit caused "Shields down" and there is fuel
  left, the player is back in the race.
* **Finish** (a quick tap): use when the loop clearly docked but the docking pad did not
  register. The finish time is the moment of the tap, so tap as the loop docks.
* **Reset** (a quick tap): ends the round at once. Nothing from it is saved.

**Laptop keys** (on the display page, if the phones lose Wi-Fi)

| Key | Action |
| --- | --- |
| Enter | Both players ready (starts the countdown) |
| Backspace | Reset the round |
| F | Fullscreen on or off |
| F2 | Debug panel: test buttons, last keys received, connected phones, race state, frame rate |

**Test without the boards.** With the display tab in front, the laptop keyboard does
exactly what the Pro Micro does: **Q** = Player 1 hit, **W** = dock, **E** = loop on the
start pad, **R** = loop off the start pad; **U I O P** are the same for Player 2. Or press
**F2** and click the test buttons (Hit, Dock, On pad, Off pad) for each player.

**Leaderboard ("Top scores").** Only docked runs count. Highest score first, then the
faster time, then more shields. The top 10 are shown.

## 5. Settings and results

Open `http://localhost:3000/admin` on the laptop (it does not open on phones).

* Fuel, shields, hit cooldown, countdown, result screen time, score points, colours, key
  map, the phone address and the space facts. Changes apply from the next round.
* **Export all races to CSV** downloads every race with times, names, results and the
  time of every hit.
* **Reset scores** empties the top scores list. The race records stay in the CSV. The
  same button is on the Connect tab. Both only work on the laptop, never from a phone.

The same settings live in `config/settings.json`. Results are saved to
`data/results.json` after every race, so a restart loses nothing.

**Text.** Every visible text on the display and phones is in `public/js/strings.js`.
The space facts are in `config/settings.json` or on `/admin`.

**Art.** Put PNG files with transparent backgrounds in `public/assets/` with these exact
names: `background.png`, `satellite_p1.png`, `satellite_p2.png`, `debris_1.png`,
`debris_2.png`, `debris_3.png`, `meteoroid_1.png`, `meteoroid_2.png`, `shield_full.png`,
`shield_broken.png`, `spark.png`, `station.png`, `logo.png`. Any file that is missing is
drawn in code, so the game never breaks. Reload the display page after adding files.

The black hole is `public/assets/blackhole.png`, made from `art/blackhole_source.png` by
`python tools/prepare_blackhole.py`. If it is missing, a simple black hole is drawn in
code. `art/blackhole_source.png` is third-party artwork: fine for a club event, but check
you may use it before showing the game publicly or recording it, or replace it with your
own picture.

The spaceship state pictures are in `public/assets/ship/` and were made from the files in
`art/` by `python tools/prepare_ship_art.py` (needs Pillow and NumPy). Run it again
after replacing any of the source pictures.

## 6. The boards and the firmware

### Wiring (Arduino Pro Micro)

| Pin | Connects to |
| --- | --- |
| 2 | Player 1 track (the long wire) |
| 3 | Player 1 docking pad |
| 4 | Player 1 start pad |
| 5 | Player 2 track |
| 6 | Player 2 docking pad |
| 7 | Player 2 start pad |
| 8 | Player 1 buzzer + (buzzer − to GND) |
| 9 | Player 2 buzzer + (buzzer − to GND) |
| GND | Both hand-held loops |

The inputs use the internal pull-up resistors, so no extra resistors are needed. A
touch pulls the pin to GND.

### Upload the firmware

1. Install the **Arduino IDE**.
2. Open `firmware/mission_control/mission_control.ino`.
3. *Tools > Board*: **Arduino Micro** (or *SparkFun Pro Micro 5V/16MHz* if you added
   SparkFun's boards). Pick the port under *Tools > Port*.
4. Click **Upload**. If the upload cannot find the board, press the reset button twice
   quickly (or briefly connect RST to GND twice) and click Upload again.

The sketch assumes **active** buzzers (they beep on 5 V). For passive buzzers, set
`PASSIVE_BUZZERS` to `1` at the top of the sketch.

### Test a board in a text editor

Before connecting the game, open **Notepad**, click inside it, and touch each part with
the loop:

| Touch | Player 1 types | Player 2 types |
| --- | --- | --- |
| Track (wire) | `q` and the buzzer beeps | `u` and the buzzer beeps |
| Docking pad | `w` | `i` |
| Put the loop on the start pad | `e` | `o` |
| Lift the loop off the start pad | `r` | `p` |

Each touch should type exactly one letter. Several letters for one touch means a loose
connection. Nothing at all means check the wire to that pin, and that the loop is
connected to GND.

The game reads the physical key, so an Arabic keyboard layout on the laptop does not
matter. Notepad will show Arabic letters instead, and that is fine.

## 7. Event-day checklist

**One week before:** run at least 5 full races with real players on the real projector.
Note any false or missed hits and adjust the fuel time and cooldown on `/admin`. Check
the text can be read from the back of the room.

**On the day**

- [ ] Laptop on mains power. Sleep, screen saver and notifications off (Windows: turn
      on *Do not disturb*).
- [ ] Double-click the **Mission Return to Station** shortcut (or run `npm start`). In the
      Connect tab, scan both QR codes with the referee phones (once for the whole event).
      Then switch to the display tab, click it and press **F**.
- [ ] **Click the game window so it is in front.** The Pro Micro types into whatever
      window is in front. If the display shows a red screen, click it.
- [ ] Do the Notepad test on both boards if anything was moved.
- [ ] On `/admin`, untick *Test hit button on referee phones* and save.
- [ ] Both referee phones charged, connected (green dot), referee pages open. Set the
      phones' screen timeout to 10 minutes or more.
- [ ] Spares: a loop, wire, tape, a **USB cable**, a flashed spare Pro Micro, and a phone
      hotspot ready to turn on.
- [ ] One test race before the doors open. Press Backspace before anyone docks (a reset
      round is not saved), or press **Reset scores** on the Connect tab afterwards.
- [ ] At the end, open `/admin` and **Export all races to CSV**.

**If something goes wrong**

| Problem | Fix |
| --- | --- |
| Hits do not count | The game window is not in front. Click it. Check F2: the key should appear under "Last keys received". |
| Phone says "Reconnecting…" | Wait a few seconds. It reconnects by itself. If not, check the Wi-Fi, or press Enter on the laptop to start the race. |
| A phone lost its page | Open it again from the browser history, or scan its code again in the Connect tab (`/connect`). |
| Start solo race is greyed out | Press **Ready** first. |
| A hit did not happen | The referee presses **Undo hit**. |
| Docking pad did not register | The referee taps **Finish**. |
| Clicked the shortcut but the game was already running | Nothing breaks: it opens the running game's Connect tab and closes. Only one copy of the game can run at a time. |
| "Port 3000 is used by another program" | Another program has taken port 3000. Close it, or start with `set PORT=3001 && npm start`. |
| Display shows "Lost contact with the game server" | The black server window was closed. Run `npm start` again. The race state and results are kept. |

## 8. For developers

```
server/          Node.js server: game rules (game.js), score (scoring.js), saving (store.js), settings
public/          display (index.html), referee (ref.html), connect (connect.html), admin (admin.html)
firmware/        Arduino Pro Micro sketch
config/          settings.json
data/            results.json and the referee key (created at run time, not in git)
launcher/        shortcut icon and make_shortcut.ps1
art/             source pictures (ships, black hole, icon)
test/            game.test.js (rules) and e2e/race_e2e.py (real browser)
tools/           prepare_ship_art.py, prepare_blackhole.py, make_icon.py
start.bat        Windows starter (installs packages on first run, then starts the game)
```

* Rules tests (fast, no browser): `npm test`
* Browser tests (Playwright): `pip install playwright`, then `python -m playwright install chromium`
  (or have Edge or Chrome installed), then `python test/e2e/race_e2e.py`. The test uses
  port 3199 and a throwaway results file, so it never touches the real leaderboard.

The server owns the state and the clock (a monotonic clock, not the wall clock), so
refreshing any page never loses a race.
