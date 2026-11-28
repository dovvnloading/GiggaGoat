"""Play through each real delivery. Relocate the goat between stops to keep CI bounded."""
from pathlib import Path
import json
import math
import sys
import time
from playwright.sync_api import sync_playwright


def low_graphics(page):
    page.locator('[data-action="settings"]').click(timeout=90000)
    page.locator('[data-tab="video"]').click()
    page.locator("#gg-setting-graphics").select_option("low")
    page.locator('[data-action="back"]').click()


def play(page, url, evidence):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    def wait(expression, timeout=35000):
        page.wait_for_function(expression, timeout=timeout)

    def click(action):
        page.locator(f'[data-action="{action}"]').click(timeout=45000)

    def album():
        click("travel")
        click("post")

    def boot():
        wait("!!window.session", 90000)
        page.evaluate("""() => {
          window.g = session.game;
          window.postPayments = [];
          g.rules.events.on('coins:changed', e => { if (e.reason === 'island-post') postPayments.push(e.after-e.before); });
        }""")

    def visit_target():
        site = page.evaluate("g.post.target.definition.id")
        page.evaluate("""() => {
          const {position, yaw} = g.post.target;
          const dist = 1.6;
          g.teleport({x:position.x+Math.sin(yaw)*dist,y:position.y+.25,z:position.z+Math.cos(yaw)*dist},yaw);
          session.view.alignCameraForPlay();
        }""")
        wait("g.atPostalStop")
        start = page.evaluate("g.physics.time")
        wait(f"g.physics.time > {start + .35}")
        if site == "honey-rolls":
            page.keyboard.press("e")
            wait("g.happenings.bakery.active(g.physics.time)")
            wait(f"g.physics.time > {start + 2.5}")
            for i in range(3):
                page.evaluate("""i => {
                  const landing={x:0,y:0,z:0};
                  if (g.happenings.bakery.roll(i,g.physics.time,landing)) g.teleport(landing);
                }""", i)
                wait(f"g.happenings.bakery.count >= {i + 1}")
        elif site == "needle-drop":
            page.keyboard.press("e")
            wait("g.happenings.records.age(g.physics.time) !== undefined")
            for beat in range(2, 16, 2):
                if page.evaluate("g.happenings.records.side === 1"):
                    break
                wait(f"g.happenings.records.age(g.physics.time) >= {beat - .15}")
                page.keyboard.press("e")
                page.wait_for_timeout(140)
        else:
            page.keyboard.press("e")
        wait("g.post.target?.definition.id !== " + json.dumps(site))

    try:
        page.goto(url, wait_until="commit")
        boot()
        low_graphics(page)
        album()
        assert page.locator(".gg-post-card").count() == 8
        page.screenshot(path=evidence / "dispatches.jpg", type="jpeg", quality=88)
        wait("session.audio.recordings?.effects.has('ui-postmaster') && session.audio.recordings.effects.has('postmark')")
        click("hear-postmaster")
        routes = page.evaluate("g.post.routes.map(route=>route.id)")
        for i, route in enumerate(routes):
            if i:
                page.keyboard.press("Escape")
                album()
            click("dispatch-" + route)
            wait("g.post.active?.id === " + json.dumps(route))
            visit_target()
            wait("g.post.carrying")
            if i == 0:
                wait("session.audio.recordings?.playing?.track === 'post'")
                page.keyboard.press("Escape")
                page.reload(wait_until="commit")
                boot()
                assert page.evaluate("g.post.active.id === 'breakfast' && g.post.carrying")
                click("play")
            visit_target()
            assert page.evaluate("id=>g.post.stamped.has(id)", route)
            assert page.evaluate("postPayments") == [40] * (i + 1)
            print(f"Delivered {route}", flush=True)
        page.keyboard.press("Escape")
        balance = page.evaluate("g.rules.wallet.coins")
        page.reload(wait_until="commit")
        boot()
        assert page.evaluate("g.rules.wallet.coins") == balance
        album()
        assert page.locator(".gg-post-card strong").count() == 8
        assert page.locator('[data-action^="dispatch-"]').count() == 0
        page.set_viewport_size({"width":390,"height":844})
        assert page.locator(".gg-shell-panel").evaluate("p => p.scrollWidth <= p.clientWidth + 1")
        page.screenshot(path=evidence / "mobile-stamped.jpg", type="jpeg", quality=88)
        (evidence / "dispatch-results.json").write_text(json.dumps({
            "routes": routes, "postCoins": len(routes) * 40, "walletAfterReload": balance,
            "renderer": page.locator("canvas").first.get_attribute("data-render-backend"), "errors": errors
        }, indent=2), encoding="utf-8")
        assert not errors, errors
    except Exception:
        print("Browser errors", errors, flush=True)
        try:
            state = page.evaluate("""() => {
              const g=window.session?.game;
              return {menu:document.querySelector('.gg-shell-panel')?.innerText?.slice(0,350),
                hud:document.querySelector('[data-gig-task]')?.textContent,
                route:g?.post.snapshot(), feet:g?.goat.torso.translation(), target:g?.post.target?.position,
                board:g?.gigs.nearBoard(), activeRide:g?.travel.active,time:g?.physics.time};
            }""")
            (evidence / "failure.json").write_text(json.dumps(state,indent=2), encoding="utf-8")
            print(state, flush=True)
            page.screenshot(path=evidence / "failure.jpg", type="jpeg")
        finally:
            raise


def travel_trials(page, url, evidence):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    held = set()

    def keys(*buttons):
        wanted = set(buttons)
        for key in held - wanted:
            page.keyboard.up(key)
        for key in wanted - held:
            page.keyboard.down(key)
        held.clear()
        held.update(wanted)

    def click(action):
        page.locator(f'[data-action="{action}"]').click(timeout=45000)

    def stage(number):
        page.wait_for_function(f"session.game.travel.trials.active?.stage === {number}", timeout=45000)

    def steer_home():
        until = time.monotonic() + 100
        while time.monotonic() < until:
            state = page.evaluate("""() => {
              const t=session.game.travel, b=t.craft.boat;
              const x=b.home.x-b.position.x, z=b.home.z-b.position.z, a=Math.atan2(x,-z)-b.heading;
              return [!!t.trials.result,Math.hypot(x,z),Math.atan2(Math.sin(a),Math.cos(a)),b.speed];
            }""")
            done, distance, angle, speed = state
            if done:
                return
            buttons = []
            if abs(angle) > .09 and distance > 7:
                buttons.append("d" if angle > 0 else "a")
            target_speed = min(8, math.sqrt(4 * max(0, distance - 8)))
            if speed < target_speed - .45:
                buttons.append("w")
            elif speed > target_speed + 1.2:
                buttons.append("s")
            keys(*buttons)
            page.wait_for_timeout(80)
        raise AssertionError(f"Boat approach stalled at {state}")

    page.goto(url, wait_until="commit")
    page.wait_for_function("!!window.session", timeout=90000)
    low_graphics(page)
    start = page.evaluate("session.game.rules.wallet.coins")
    try:
        for i, id in enumerate(["boat","plane","balloon"]):
            click("travel")
            click("trials")
            click("trial-" + id)
            stage(0)
            if id == "boat":
                keys("w")
                stage(1)
                keys("w","a")
                stage(2)
                steer_home()
            elif id == "plane":
                keys("w","Space")
                stage(1)
                keys("d")
                stage(2)
                keys("s","Shift")
            else:
                keys("Space")
                stage(1)
                keys()
                stage(2)
                keys("Shift")
            page.wait_for_function("!!session.game.travel.trials.result", timeout=60000)
            keys()
            assert page.evaluate("session.game.rules.wallet.coins") == start + 60 * (i + 1)
            page.locator("[data-gig-detail]").filter(has_text="FIRST FINISH").wait_for()
            page.screenshot(path=evidence / (id + "-finish.jpg"), type="jpeg", quality=86)
            print("Finished", id, page.evaluate("session.game.travel.trials.result.seconds"), flush=True)
            page.keyboard.press("Escape")
            click("return-station")
            page.keyboard.press("Escape")
        page.reload(wait_until="commit")
        page.wait_for_function("!!window.session", timeout=90000)
        click("travel")
        click("trials")
        assert page.get_by_text(" · Best ", exact=False).count() == 3
        best = page.evaluate("session.game.travel.trials.best")
        assert len(best) == 3 and page.evaluate("session.game.rules.wallet.coins") == start + 180
        assert not errors, errors
        (evidence / "travel-results.json").write_text(json.dumps({"bestSeconds":best,"coins":180,"errors":errors},indent=2), encoding="utf-8")
    except Exception:
        print("Trial diagnostics", page.evaluate("""() => {
          const t=session.game.travel;return {active:t.trials.active, result:t.trials.result,
            craft:t.active && t.craft[t.active],tick:session.game.physics.time};
        }"""), errors, flush=True)
        page.screenshot(path=evidence / "failure.jpg", type="jpeg")
        raise


def public_smoke(page, url, evidence):
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)

    def click(action):
        page.locator(f'[data-action="{action}"]').click(timeout=60000)

    page.goto(url, wait_until="commit")
    low_graphics(page)
    click("travel")
    click("post")
    assert page.locator(".gg-post-card").count() == 8
    assert page.locator(".gg-post-head img").evaluate("i=>i.complete && i.naturalWidth > 0")
    click("hear-postmaster")
    page.screenshot(path=evidence / "public-album.jpg", type="jpeg", quality=90)
    click("dispatch-breakfast")
    page.locator("[data-gig-title]").filter(has_text="Breakfast by bell").wait_for()
    page.keyboard.down("w")
    page.wait_for_timeout(800)
    page.keyboard.up("w")
    page.keyboard.press("Escape")
    page.reload(wait_until="commit")
    click("travel")
    click("post")
    assert page.get_by_text("In your satchel", exact=True).is_visible()
    click("stop-post")
    click("back")
    for id, title in [("boat","Gullwing Runabout"), ("plane","Saltwind Floatplane"),
                      ("balloon","Honeycomb Balloon"), ("tram","Summit Cable Car")]:
        click("ride-" + id)
        page.locator("[data-gig-title]").filter(has_text=title).wait_for()
        page.keyboard.down("Space" if id == "balloon" else "w")
        page.wait_for_timeout(1200)
        page.keyboard.up("Space" if id == "balloon" else "w")
        if id == "boat":
            page.screenshot(path=evidence / "public-marina.jpg", type="jpeg", quality=90)
        page.keyboard.press("Escape")
        click("return-station")
        page.keyboard.press("Escape")
        click("travel")
        print("Boarded and returned", title, flush=True)
    assert not errors, errors
    (evidence / "pages-results.json").write_text(json.dumps({"url":url,"errors":errors}, indent=2), encoding="utf-8")


if __name__ == "__main__":
    evidence = Path(sys.argv[2])
    evidence.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required", "--disable-webgl"])
        try:
            run = public_smoke if "--public" in sys.argv[3:] else travel_trials if "--travel" in sys.argv[3:] else play
            run(browser.new_page(viewport={"width":800,"height":540}), sys.argv[1], evidence)
        finally:
            browser.close()
