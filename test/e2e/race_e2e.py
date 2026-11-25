"""End-to-end test in a real browser (Playwright).

Simulates the buzz wire boards with keyboard events on the display page and the
two referees with phone-sized pages. Starts its own server on port 3199 with a
throwaway settings and results file, so your real leaderboard is never touched.

    python test/e2e/race_e2e.py            (uses Playwright Chromium, or Edge/Chrome if that is missing)
    python test/e2e/race_e2e.py --shots out_dir

Prints PASS/FAIL per scenario and exits non-zero if anything failed.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import traceback
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")

ROOT = Path(__file__).resolve().parents[2]
PORT = 3199
BASE = f"http://localhost:{PORT}"

FAST = {"fuelSeconds": 8, "countdownSeconds": 3, "resultSeconds": 3, "hitCooldownMs": 1000, "falseStartSeconds": 2, "shields": 3}

results = []
console_errors = []


# ---------------------------------------------------------------- server and API helpers

class Server:
    def __init__(self, tmp):
        self.tmp = tmp
        self.proc = None

    def start(self):
        env = dict(os.environ, PORT=str(PORT), MRS_NO_OPEN="1",
                   MRS_CONFIG=str(Path(self.tmp) / "settings.json"), MRS_DATA=str(Path(self.tmp) / "results.json"))
        self.log = open(Path(self.tmp) / "server.log", "a")
        self.proc = subprocess.Popen(["node", str(ROOT / "server" / "index.js")], cwd=ROOT, env=env, stdout=self.log, stderr=self.log)
        for _ in range(100):
            try:
                urllib.request.urlopen(BASE + "/api/assets", timeout=1)
                return
            except Exception:
                time.sleep(0.1)
        raise RuntimeError("server did not start")

    def stop(self):
        if self.proc:
            self.proc.terminate()
            self.proc.wait(5)
            self.log.close()


def api(path, body=None):
    req = urllib.request.Request(BASE + path, method="POST" if body is not None else "GET")
    data = None
    if body is not None:
        req.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
    with urllib.request.urlopen(req, data=data, timeout=5) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if r.headers.get_content_type() == "application/json" else raw


def state():
    return api("/api/state")["state"]


def wait_for(cond, timeout=6.0, what="condition"):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = state()
        if cond(last):
            return last
        time.sleep(0.03)
    raise AssertionError(f"timed out waiting for {what}; phase={last['phase']} p1={last['players']['1']['status']} p2={last['players']['2']['status']}")


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)


def scenario(name):
    def deco(fn):
        def run(ctx):
            t0 = time.time()
            print(f"[{t0 - T0:6.1f}s] start: {name}")
            try:
                fn(ctx)
                results.append((name, "PASS", f"{time.time() - t0:.1f}s"))
            except Exception as e:  # noqa: BLE001
                results.append((name, "FAIL", f"{e}"))
                traceback.print_exc()
            finally:
                try:
                    ctx.display.keyboard.press("Backspace")  # leave every scenario in idle
                    wait_for(lambda s: s["phase"] == "idle", 3, "idle after scenario")
                except Exception:  # noqa: BLE001
                    pass
        run.__name__ = fn.__name__
        return run
    return deco


# ---------------------------------------------------------------- page helpers

class Ctx:
    pass


def ref_ready(page, name):
    page.fill("#name", name)
    page.click("#ready")


def hold(page, selector, ms=1150):
    page.locator(selector).scroll_into_view_if_needed()
    box = page.locator(selector).bounding_box()
    page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    page.mouse.down()
    page.wait_for_timeout(ms)
    page.mouse.up()


def start_duel(c, names=("Amal", "Badr")):
    ref_ready(c.ref1, names[0])
    ref_ready(c.ref2, names[1])
    wait_for(lambda s: s["phase"] == "countdown", what="countdown")
    return wait_for(lambda s: s["phase"] == "racing", 5, "racing")


def press(c, code):
    c.display.keyboard.press(code)


def shot(c, page, name):
    if c.shots:
        page.screenshot(path=str(Path(c.shots) / f"{name}.png"))


# ---------------------------------------------------------------- scenarios

@scenario("1 Normal race: both Ready, countdown, P1 docks first and wins, leaderboard updates")
def s_normal(c):
    before = len(api("/api/races")["races"])
    ref_ready(c.ref1, "Amal")
    c.display.wait_for_timeout(150)
    check(state()["phase"] == "arming", "one ready should be arming")
    ref_ready(c.ref2, "Badr")
    wait_for(lambda s: s["phase"] == "countdown", what="countdown")
    c.display.wait_for_selector("#countdown.show")
    shot(c, c.display, "countdown")
    s = wait_for(lambda s: s["phase"] == "racing", 5, "racing")
    check(s["players"]["1"]["status"] == "racing" and s["players"]["2"]["status"] == "racing", "both racing at GO")
    c.display.wait_for_timeout(1200)
    shot(c, c.display, "racing")
    # both fuel readouts must agree (same GO tick)
    f1, f2 = c.display.evaluate("() => [...document.querySelectorAll('.fuel-sec')].map((e) => e.textContent)")
    check(f1 == f2, f"fuel differs {f1} vs {f2}")
    press(c, "KeyW")
    wait_for(lambda s: s["players"]["1"]["status"] == "docked", what="P1 docked")
    c.display.wait_for_timeout(500)
    press(c, "KeyI")
    s = wait_for(lambda s: s["phase"] == "result", what="result")
    check(s["result"]["winner"] == 1 and s["result"]["outcome"] == "score", f"winner {s['result']}")
    p1 = s["players"]["1"]
    expected = round((s["fuelMs"] - p1["timeMs"]) / 1000 * 10) + p1["shields"] * 100
    check(p1["score"] == expected, f"score {p1['score']} vs formula {expected}")
    c.display.wait_for_timeout(400)
    verdict = c.display.inner_text("#half1 .verdict")
    check("Winner!" in verdict and f"{expected} points" in verdict, f"verdict text: {verdict!r}")
    check("winner" in c.display.get_attribute("#half1", "class"), "winner half lit")
    shot(c, c.display, "result")
    check("Docked" in c.ref1.inner_text(".status"), "ref1 shows docked")
    shot(c, c.ref1, "ref_result")
    data = api("/api/races")
    check(len(data["races"]) == before + 1, "race saved")
    names = [e["name"] for e in data["leaderboard"]]
    check("Amal" in names and "Badr" in names, f"leaderboard {names}")
    # result screen times out into the idle leaderboard
    wait_for(lambda s: s["phase"] == "idle", 12, "idle after result")
    c.display.wait_for_selector("#lobby", state="visible")
    rows = c.display.locator("#leaderboard tbody tr").count()
    check(rows >= 2, "leaderboard rows on idle screen")
    shot(c, c.display, "idle_leaderboard")


@scenario("2 False start: KeyR during countdown cancels, shows message, back to Ready")
def s_false_start(c):
    ref_ready(c.ref1, "Amal")
    ref_ready(c.ref2, "Badr")
    wait_for(lambda s: s["phase"] == "countdown", what="countdown")
    c.display.wait_for_timeout(800)
    press(c, "KeyR")
    s = wait_for(lambda s: s["phase"] == "arming", what="arming")
    check(s["notice"] and s["notice"]["name"] == "Amal", f"notice names Amal: {s['notice']}")
    c.display.wait_for_selector("#notice.show")
    text = c.display.inner_text("#notice .msg")
    check("False start: Amal" in text, f"notice text {text!r}")
    shot(c, c.display, "false_start")
    check(not s["players"]["1"]["ready"] and not s["players"]["2"]["ready"], "ready cleared")
    c.ref1.wait_for_function("document.querySelector('#ready').textContent.includes('Ready') && !document.querySelector('#ready').textContent.includes('Cancel')")


@scenario("3 Cooldown: three KeyQ within 500 ms remove one shield")
def s_cooldown(c):
    start_duel(c)
    press(c, "KeyQ")
    c.display.wait_for_timeout(200)
    press(c, "KeyQ")
    c.display.wait_for_timeout(200)
    press(c, "KeyQ")
    s = wait_for(lambda s: s["players"]["1"]["ignoredHits"] == 2, what="2 ignored hits")
    check(s["players"]["1"]["shields"] == 2 and s["players"]["1"]["hits"] == 1, f"shields {s['players']['1']['shields']}")
    c.display.wait_for_timeout(150)
    check(c.display.locator("#half1 .shield-row img.lost").count() == 1, "one broken shield icon on display")
    check(c.ref1.locator(".hex.lost").count() == 1, "one lost shield on phone")


@scenario("4 Shields down: three hits >1 s apart knock P1 out, P2 keeps racing")
def s_shields_down(c):
    start_duel(c)
    for i in range(3):
        press(c, "KeyQ")
        if i == 0:
            c.display.wait_for_timeout(130)
            shot(c, c.display, "hit_effect")  # debris striking, half flashing
            c.display.wait_for_timeout(920)
        else:
            c.display.wait_for_timeout(1050)
    s = state()
    check(s["players"]["1"]["status"] == "shieldsDown", f"P1 {s['players']['1']['status']}")
    check(s["players"]["2"]["status"] == "racing" and s["phase"] == "racing", "P2 still racing")
    check("Shields down" in c.display.inner_text("#half1 .status"), "display says Shields down")
    shot(c, c.display, "shields_down")
    # 8: a dock after shields down is ignored
    press(c, "KeyW")
    c.display.wait_for_timeout(150)
    check(state()["players"]["1"]["status"] == "shieldsDown", "dock after shields down ignored")


@scenario("5+6 Out of fuel; both fail: the one who lasted longer wins")
def s_out_of_fuel(c):
    start_duel(c)
    for _ in range(3):
        press(c, "KeyU")
        c.display.wait_for_timeout(1050)
    s = wait_for(lambda s: s["phase"] == "result", 10, "result after fuel")
    check(s["players"]["1"]["status"] == "outOfFuel", "P1 out of fuel")
    check(s["result"]["winner"] == 1 and s["result"]["outcome"] == "lasted", f"result {s['result']}")
    c.display.wait_for_timeout(300)
    check("Out of fuel" in c.display.inner_text("#half1 .verdict") or "Lasted longer" in c.display.inner_text("#half1 .verdict"), "verdict shown")
    shot(c, c.display, "out_of_fuel")


@scenario("6b Both run out of fuel with equal shields: Tie, rematch")
def s_tie(c):
    start_duel(c)
    s = wait_for(lambda s: s["phase"] == "result", 10, "result")
    check(s["result"]["outcome"] == "tie", f"outcome {s['result']}")
    c.display.wait_for_timeout(300)
    check("Tie: rematch" in c.display.inner_text("#half1 .verdict"), "tie verdict")


@scenario("7 A dock during a cooldown still counts")
def s_dock_cooldown(c):
    start_duel(c)
    press(c, "KeyU")
    c.display.wait_for_timeout(100)
    press(c, "KeyI")
    s = wait_for(lambda s: s["players"]["2"]["status"] == "docked", what="P2 docked in cooldown")
    check(s["players"]["2"]["shields"] == 2, "kept 2 shields")


@scenario("9 Undo hit gives a shield back, never above 3")
def s_undo(c):
    start_duel(c)
    press(c, "KeyQ")
    wait_for(lambda s: s["players"]["1"]["shields"] == 2, what="hit")
    c.ref1.wait_for_selector("#undo:not([disabled])")
    c.ref1.click("#undo")
    wait_for(lambda s: s["players"]["1"]["shields"] == 3, what="undo")
    c.ref1.wait_for_selector("#undo[disabled]")  # at 3 shields the button is off
    # force a press at full shields (the button is off, so enable and click in one go)
    c.ref1.evaluate("() => { const b = document.querySelector('#undo'); b.disabled = false; b.click(); }")
    c.display.wait_for_timeout(200)
    check(state()["players"]["1"]["shields"] == 3, "never above 3")


@scenario("Test hit button on the phone works like touching the wire, and can be turned off")
def s_phone_test_hit(c):
    start_duel(c)
    c.ref1.wait_for_selector("#testHit:not([hidden]):not([disabled])")
    c.ref1.click("#testHit")
    wait_for(lambda s: s["players"]["1"]["hits"] == 1 and s["players"]["1"]["shields"] == 2, 2, "hit from the phone")
    check(state()["players"]["2"]["hits"] == 0, "only this referee's player is hit")
    api("/api/settings", {**api("/api/settings"), "refTestButtons": False})
    c.ref1.wait_for_selector("#testHit", state="hidden")
    c.ref1.evaluate("() => { const b = document.querySelector('#testHit'); b.hidden = false; b.disabled = false; b.click(); }")
    c.display.wait_for_timeout(1200)
    check(state()["players"]["1"]["hits"] == 1, "server ignores test hits when turned off")
    api("/api/settings", {**api("/api/settings"), "refTestButtons": True})


@scenario("10 Finish (quick tap) records the moment of the tap")
def s_manual_finish(c):
    s0 = start_duel(c)
    c.display.wait_for_timeout(1500)
    c.ref2.locator("#finish").scroll_into_view_if_needed()
    t_tap = state()["now"]
    c.ref2.click("#finish")
    s = wait_for(lambda s: s["players"]["2"]["status"] == "docked", 1.5, "finish right after a tap")
    p = s["players"]["2"]
    expected = t_tap - s0["goAt"]
    check(p["manualFinish"], "flagged as manual")
    check(abs(p["timeMs"] - expected) < 250, f"finish {p['timeMs']} ms vs tap at {expected:.0f} ms")


@scenario("11 Reset (quick tap) mid-race clears the round and saves nothing")
def s_reset(c):
    before = api("/api/races")
    start_duel(c)
    press(c, "KeyW")
    wait_for(lambda s: s["players"]["1"]["status"] == "docked", what="P1 docked")
    c.ref2.click("#reset")
    wait_for(lambda s: s["phase"] == "idle", 1.5, "idle right after a tap on Reset")
    after = api("/api/races")
    check(len(after["races"]) == len(before["races"]), "no race saved")
    check(after["leaderboard"] == before["leaderboard"], "leaderboard unchanged")


@scenario("12 Solo mode with one referee (Ready first, then Start solo race)")
def s_solo(c):
    c.ref2.fill("#name", "Sara")
    check(c.ref2.is_disabled("#solo"), "solo is off until the player is Ready")
    c.ref2.click("#ready")
    c.ref2.wait_for_selector("#solo:not([disabled])")
    c.ref2.click("#solo")
    s = wait_for(lambda s: s["phase"] == "countdown", what="solo countdown")
    check(s["mode"] == "solo" and s["players"]["1"]["status"] == "sittingOut", "P1 sits out")
    press(c, "KeyR")  # the empty board must not false-start a solo race
    wait_for(lambda s: s["phase"] == "racing", 5, "solo racing")
    press(c, "KeyQ")
    c.display.wait_for_timeout(100)
    check(state()["players"]["1"]["hits"] == 0, "P1 keys ignored")
    c.display.wait_for_timeout(700)
    shot(c, c.display, "solo")
    press(c, "KeyI")
    s = wait_for(lambda s: s["phase"] == "result", what="solo result")
    check(s["result"]["outcome"] == "soloDocked", "solo docked")
    c.display.wait_for_timeout(300)
    check("Mission complete" in c.display.inner_text("#half2 .verdict"), "mission complete shown")
    check(any(e["name"] == "Sara" for e in api("/api/races")["leaderboard"]), "solo time on leaderboard")


@scenario("13 Refreshing the display mid-race keeps the race and timers")
def s_refresh(c):
    start_duel(c)
    press(c, "KeyQ")
    c.display.wait_for_timeout(1500)
    c.display.reload()
    c.display.wait_for_selector("#stage[data-phase='racing']")
    c.display.wait_for_timeout(400)
    s = state()
    expected = (s["fuelMs"] - (s["now"] - s["goAt"])) / 1000
    shown = float(c.display.inner_text("#half1 .fuel-sec").split()[0])
    check(abs(shown - expected) < 0.35, f"fuel after reload {shown} vs {expected:.2f}")
    check(c.display.locator("#half1 .shield-row img.lost").count() == 1, "hit still shown after reload")


@scenario("14 A phone dropping off Wi-Fi reconnects and gets its state back")
def s_phone_reconnect(c):
    start_duel(c)
    # Playwright's offline mode does not cut an open WebSocket, so cut it by hand
    # while offline: reconnect attempts then fail until the phone is back online.
    c.ref1_ctx.set_offline(True)
    c.ref1.evaluate("() => window.__sockets.forEach((s) => s.close())")
    c.ref1.wait_for_selector(".link[data-state='closed'], .link[data-state='connecting']", timeout=8000)
    check("Reconnecting" in c.ref1.inner_text(".link"), "phone shows Reconnecting")
    press(c, "KeyQ")  # happens while the phone is offline
    c.display.wait_for_timeout(300)
    c.ref1_ctx.set_offline(False)
    c.ref1.wait_for_selector(".link[data-state='open']", timeout=10000)
    c.ref1.wait_for_function("document.querySelectorAll('.hex.lost').length === 1", timeout=5000)


@scenario("15 Display losing focus shows the red overlay")
def s_focus(c):
    check(c.display.eval_on_selector("#focusOverlay", "e => e.hidden"), "overlay hidden while focused")
    # Headless browsers always report focus, so fake the window losing it.
    c.display.evaluate("() => { document.hasFocus = () => false; window.dispatchEvent(new Event('blur')); }")
    c.display.wait_for_function("!document.querySelector('#focusOverlay').hidden", timeout=3000)
    shot(c, c.display, "focus_lost")
    check("game window must be in front" in c.display.inner_text("#focusOverlay"), "overlay text")
    c.display.evaluate("() => { delete document.hasFocus; window.dispatchEvent(new Event('focus')); }")
    c.display.wait_for_function("document.querySelector('#focusOverlay').hidden", timeout=3000)


@scenario("17 Laptop fallback: Enter starts a race and Backspace resets")
def s_fallback(c):
    press(c, "Enter")
    wait_for(lambda s: s["phase"] == "countdown", what="countdown from Enter")
    wait_for(lambda s: s["phase"] == "racing", 5, "racing")
    press(c, "Backspace")
    wait_for(lambda s: s["phase"] == "idle", what="idle from Backspace")
    press(c, "F2")
    c.display.wait_for_selector("#debug:not([hidden])")
    text = c.display.inner_text("#debugText")
    check("Last keys received" in text and "Connected" in text, "debug panel content")
    shot(c, c.display, "debug_panel")
    press(c, "F2")


@scenario("18 Arabic keyboard layout: key 'ض' with code KeyQ counts as a hit; held keys (repeat) ignored")
def s_arabic(c):
    start_duel(c)
    c.display.evaluate("""() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'ض', bubbles: true }));
    }""")
    wait_for(lambda s: s["players"]["1"]["hits"] == 1, what="Arabic-layout hit")
    c.display.wait_for_timeout(1100)
    c.display.evaluate("""() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'ض', repeat: true, bubbles: true }));
    }""")
    c.display.wait_for_timeout(200)
    check(state()["players"]["1"]["hits"] == 1, "repeat ignored")


@scenario("Live score counts down with the fuel while racing")
def s_live_score(c):
    start_duel(c)
    a = int(c.display.inner_text("#half1 .score-num"))
    c.display.wait_for_timeout(1000)
    b = int(c.display.inner_text("#half1 .score-num"))
    check(a - b >= 8, f"score went {a} -> {b} in 1 s")
    phone = int(c.ref1.inner_text(".score-num"))
    check(abs(phone - b) <= 20, f"phone shows {phone}, display {b}")


@scenario("QR codes live on the Connect page, not on the display; it shows both phones connected")
def s_connect_page(c):
    check(c.display.locator("img.qr").count() == 0, "no QR code on the display")
    page = c.display.context.new_page()
    try:
        page.goto(BASE + "/connect")
        page.wait_for_function("[...document.querySelectorAll('img.qr')].every((i) => i.complete && i.naturalWidth > 0)")
        page.wait_for_selector('[data-player="1"] .state[data-on="true"]')
        page.wait_for_selector('[data-player="2"] .state[data-on="true"]')
        check("/ref/1?k=" in page.inner_text('[data-player="1"] .url'), "ref 1 link shown")
        page.wait_for_selector('.display-state[data-on="true"]')
        check("open" in page.inner_text(".display-state"), "connect page sees the display window")
        shot(c, page, "connect_page")
    finally:
        page.close()
        c.display.bring_to_front()


@scenario("Open pages (display and phones) reload by themselves when the game files are updated")
def s_auto_reload(c):
    for page in (c.display, c.ref1):
        page.evaluate("() => { window.__oldPage = true; }")
    target = ROOT / "public" / "js" / "strings.js"
    os.utime(target, None)  # same as copying in an updated file
    for page in (c.display, c.ref1):
        page.wait_for_function("() => !window.__oldPage", timeout=8000)
    c.ref1.wait_for_selector(".link[data-state='open']")
    c.display.wait_for_selector("#stage[data-phase='idle']")


@scenario("F2 test buttons on the display give a hit and a dock without the boards")
def s_test_buttons(c):
    start_duel(c)
    press(c, "F2")
    c.display.wait_for_selector("#debug:not([hidden]) .test-row button.hit")
    shot(c, c.display, "test_buttons")
    c.display.click('.test-row[data-player="1"] button.hit')
    wait_for(lambda s: s["players"]["1"]["hits"] == 1 and s["players"]["1"]["shields"] == 2, 2, "hit from the test button")
    c.display.click('.test-row[data-player="2"] button.dock')
    wait_for(lambda s: s["players"]["2"]["status"] == "docked", 2, "dock from the test button")
    press(c, "F2")


@scenario("Result screen shows for 3 seconds, then the scores")
def s_result_time(c):
    start_duel(c)
    press(c, "KeyW")
    press(c, "KeyI")
    s = wait_for(lambda s: s["phase"] == "result", 2, "result")
    t0 = time.time()
    wait_for(lambda s: s["phase"] == "idle", 6, "scores after the result")
    took = time.time() - t0
    check(2.6 < took < 3.6, f"result screen lasted {took:.1f} s")
    c.display.wait_for_selector("#lobby", state="visible")


@scenario("Reset scores on the Connect tab (laptop only) empties the top scores")
def s_reset_scores(c):
    check(len(api("/api/races")["leaderboard"]) > 0, "there are scores to reset")
    page = c.display.context.new_page()
    try:
        page.goto(BASE + "/connect")
        page.once("dialog", lambda d: d.accept())
        page.click(".reset-scores")
        page.wait_for_selector(".scores-msg:has-text('Scores reset.')")
    finally:
        page.close()
        c.display.bring_to_front()
    check(api("/api/races")["leaderboard"] == [], "leaderboard empty")
    check(len(api("/api/races")["races"]) > 0, "race records kept")
    c.display.wait_for_selector(".lb-empty", state="visible")


@scenario("Latency: key press to display change on localhost")
def s_latency(c):
    start_duel(c)
    ms = c.display.evaluate("""() => new Promise((resolve) => {
        const el = document.querySelector('#half2 .hits b');
        const t0 = performance.now();
        const obs = new MutationObserver(() => { obs.disconnect(); resolve(performance.now() - t0); });
        obs.observe(document.querySelector('#half2 .hits'), { childList: true, subtree: true, characterData: true });
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyU', key: 'u' }));
    })""")
    c.latency = ms
    print(f"    key press to display update: {ms:.1f} ms")
    check(ms < 100, f"{ms:.1f} ms")


@scenario("Frame rate with effects running")
def s_fps(c):
    start_duel(c)
    for code in ["KeyQ", "KeyU"]:
        press(c, code)
    fps = c.display.evaluate("""() => new Promise((resolve) => {
        let n = 0; const t0 = performance.now();
        function f(ts) { n++; if (ts - t0 < 2000) requestAnimationFrame(f); else resolve(n * 1000 / (ts - t0)); }
        requestAnimationFrame(f);
    })""")
    c.fps = fps
    print(f"    display frame rate: {fps:.0f} fps")
    check(fps > 50, f"{fps:.0f} fps")


# ---------------------------------------------------------------- main

def launch(p):
    for kwargs in ({}, {"channel": "msedge"}, {"channel": "chrome"}):
        try:
            return p.chromium.launch(headless=True, **kwargs)
        except Exception:  # noqa: BLE001
            continue
    raise RuntimeError("No Chromium, Edge or Chrome found for Playwright")


T0 = time.time()


def watch(page, label):
    def on_ws(ws):
        print(f"[{time.time() - T0:6.1f}s] {label} websocket open")
        ws.on("close", lambda _: print(f"[{time.time() - T0:6.1f}s] {label} websocket CLOSED"))
    page.on("websocket", on_ws)
    # The reconnect scenario takes the phone offline on purpose; its connection errors are expected.
    page.on("console", lambda m: console_errors.append(f"{label}: {m.text}")
            if m.type in ("error", "warning") and "ERR_INTERNET_DISCONNECTED" not in m.text else None)
    page.on("pageerror", lambda e: console_errors.append(f"{label} PAGE ERROR: {e}"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", help="folder for screenshots")
    ap.add_argument("--only", nargs="*", help="run only these scenario functions, e.g. s_false_start (uses fast settings)")
    args = ap.parse_args()
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)

    tmp = tempfile.mkdtemp(prefix="mrs-e2e-")
    server = Server(tmp)
    server.start()
    c = Ctx()
    c.shots = args.shots
    try:
        # Test the real defaults once (normal race at 60 s fuel), then speed up.
        with sync_playwright() as p:
            browser = launch(p)
            info = api("/api/info")
            key = info["refKey"]
            dctx = browser.new_context(viewport={"width": 1600, "height": 900})
            c.display = dctx.new_page()
            watch(c.display, "display")
            c.display.goto(BASE + "/")
            c.display.wait_for_selector("#stage[data-phase='idle']")
            phone = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            c.ref1_ctx = browser.new_context(**phone)
            c.ref2_ctx = browser.new_context(**phone)
            c.ref1_ctx.add_init_script("""(() => {
                const Real = window.WebSocket; window.__sockets = [];
                window.WebSocket = function (...a) { const s = new Real(...a); window.__sockets.push(s); return s; };
                window.WebSocket.prototype = Real.prototype; Object.assign(window.WebSocket, { OPEN: 1, CLOSED: 3, CONNECTING: 0, CLOSING: 2 });
            })()""")
            c.ref1 = c.ref1_ctx.new_page()
            c.ref2 = c.ref2_ctx.new_page()
            watch(c.ref1, "ref1")
            watch(c.ref2, "ref2")
            c.ref1.goto(f"{BASE}/ref/1?k={key}")
            c.ref2.goto(f"{BASE}/ref/2?k={key}")
            c.ref1.wait_for_selector(".link[data-state='open']")
            c.ref2.wait_for_selector(".link[data-state='open']")
            c.display.bring_to_front()
            shot(c, c.display, "idle")
            shot(c, c.ref1, "ref_idle")

            if args.only:
                api("/api/settings", {**api("/api/settings"), **FAST})
                for name in args.only:
                    globals()[name](c)
                browser.close()
                return report()
            check(api("/api/settings")["fuelSeconds"] == 60, "default fuel is 60 s")
            s_normal(c)  # with the real defaults: 60 s fuel, 3 s countdown, 10 s result

            api("/api/settings", {**api("/api/settings"), **FAST})
            for fn in [s_false_start, s_cooldown, s_shields_down, s_out_of_fuel, s_tie, s_dock_cooldown, s_undo,
                       s_phone_test_hit, s_manual_finish, s_reset, s_solo, s_refresh, s_phone_reconnect, s_focus, s_fallback,
                       s_arabic, s_live_score, s_connect_page, s_auto_reload, s_reset_scores, s_test_buttons,
                       s_result_time, s_latency, s_fps]:
                fn(c)

            browser.close()

        # 19: restart keeps the leaderboard
        t0 = time.time()
        board = api("/api/races")["leaderboard"]
        server.stop()
        server.start()
        after = api("/api/races")["leaderboard"]
        results.append(("19 Restarting the server keeps the leaderboard", "PASS" if after == board and board else "FAIL", f"{len(after)} entries, {time.time() - t0:.1f}s"))
    finally:
        server.stop()

    report()


def report():
    # 16: missing assets: no console errors anywhere above (13 Manus files are missing)
    results.append(("16 Missing asset files show placeholders with no console errors",
                     "PASS" if not console_errors else "FAIL", "; ".join(console_errors[:5]) or "0 console errors"))

    width = max(len(r[0]) for r in results)
    print()
    for name, status, detail in results:
        print(f"{status:4}  {name.ljust(width)}  {detail}")
    failed = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
