"""Play through each real delivery. Relocate the goat between stops to keep CI bounded."""
from pathlib import Path
import json
import sys
from playwright.sync_api import sync_playwright


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
        page.evaluate("void(window.g = session.game)")

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
            wait(f"g.physics.time > {start + .9}")
            if page.evaluate("g.post.target?.definition.id") == site:
                # Shared stops can still be in the normal 12-second replay cooldown.
                wait(f"g.physics.time > {start + 12.5}", 60000)
                page.keyboard.press("e")
        wait("g.post.target?.definition.id !== " + json.dumps(site))

    try:
        page.goto(url, wait_until="commit")
        boot()
        album()
        assert page.locator(".gg-post-card").count() == 8
        page.screenshot(path=evidence / "dispatches.jpg", type="jpeg", quality=88)
        wait("session.audio.recordings?.effects.has('ui-postmaster')")
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
            print(f"Delivered {route}", flush=True)
        page.keyboard.press("Escape")
        album()
        assert page.locator(".gg-post-card strong").count() == 8
        assert page.locator('[data-action^="dispatch-"]').count() == 0
        page.set_viewport_size({"width":390,"height":844})
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
        page.screenshot(path=evidence / "mobile-stamped.jpg", type="jpeg", quality=88)
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


if __name__ == "__main__":
    evidence = Path(sys.argv[2])
    evidence.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required",
            "--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        try:
            play(browser.new_page(viewport={"width":960,"height":580}), sys.argv[1], evidence)
        finally:
            browser.close()
