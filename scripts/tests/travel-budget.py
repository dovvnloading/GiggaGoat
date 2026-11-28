"""Measure the production WebGL triangle counter, including sun-shadow refreshes."""
import json
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


def sample_view(page, settle=12):
    return page.evaluate("""async settle => {
      const frames=[];
      for (let i=0; i<settle+24; i++) {
        await new Promise(requestAnimationFrame);
        if (i>=settle) frames.push(v.perfStats.triangles);
      }
      const sorted=[...frames].sort((a,b)=>a-b);
      const position=g.travel.active ? g.travel.craft[g.travel.active].position : g.goat.torso.translation();
      return {median:sorted[12],peak:sorted[23],frames,quality:v.currentSettings.graphics,
        fov:v.camera.fov,aspect:v.camera.aspect,position:{...position}};
    }""", settle)


def check_rides(page, url, evidence):
    errors, profile = [], {}
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
    page.goto(url, wait_until="commit")
    page.wait_for_function("!!window.session", timeout=90000)
    page.evaluate("void(window.g = session.game)")
    page.evaluate("void(window.v = session.view)")
    assert page.evaluate("!!v.renderer.isWebGLRenderer && v.currentSettings.graphics === 'high'")
    for district in ["hoofington", "downtown"]:
        page.wait_for_function(f"v.world.group.getObjectByName('{district}-library-models')?.userData.ready", timeout=90000)

    def click(action):
        page.locator(f'[data-action="{action}"]').click(timeout=45000)

    for ride, district, keys in [
        ("boat", "baa-ardwalk", ["w"]), ("plane", "baa-ardwalk", ["w", "Space"]),
        ("balloon", "hoofington", ["Space"]), ("tram", "mt-gigga", []),
    ]:
        click("travel")
        click("ride-" + ride)
        disembark = page.locator("[data-board-hint]").filter(has_text="DISEMBARK")
        if ride == "boat":
            disembark.wait_for(state="visible")
        for key in keys:
            page.keyboard.down(key)
        start = page.evaluate("g.physics.time")
        page.wait_for_function(f"g.physics.time > {start + 3.8}", timeout=90000)
        for key in keys:
            page.keyboard.up(key)
        if ride in ("boat", "plane", "balloon"):
            disembark.wait_for(state="hidden")
            controls = page.locator("[data-gig-task]").inner_text()
            assert "leave" not in controls.lower() and "dock" not in controls.lower(), (ride, controls)
        page.evaluate("""district => {
          const p=g.travel.craft[g.travel.active].position, to=g.island.pois.find(s=>s.id===district).center;
          v.input.yaw=Math.atan2(to.x-p.x,p.z-to.z); v.input.pitch=.24;
        }""", district)
        stats = sample_view(page)
        profile[ride] = stats
        print(ride, "median", stats["median"], "peak", stats["peak"], flush=True)
        page.screenshot(path=evidence / (ride + "-view.jpg"), type="jpeg", quality=83)
        page.keyboard.press("Escape")
        click("return-station")
        page.keyboard.press("Escape")
    # From this Downtown crossing, the camera can see the Hoofington skyline
    # beyond the arcade. The northwest turn exceeded budget on shadow refreshes.
    page.set_viewport_size({"width":1152,"height":680})
    click("resume")
    start = page.evaluate("""() => {
      g.teleport({x:145,y:5.92,z:155},0);
      v.alignCameraForPlay(); v.input.yaw=0; v.input.pitch=.12;
      return g.physics.time;
    }""")
    page.keyboard.down("w")
    page.wait_for_function(f"g.physics.time > {start+.75}", timeout=45000)
    page.keyboard.up("w")
    streets = {}
    for name, angle in [("north",0), ("northwest",-45), ("northeast",45)]:
        page.evaluate("degrees => {v.input.yaw=degrees*Math.PI/180}",angle)
        streets[name] = sample_view(page,settle=24)
        print("Downtown",name,"peak",streets[name]["peak"],flush=True)
    # The northwest skyline also has to fit when the player opens the lens on an ultrawide display.
    page.keyboard.press("Escape")
    click("settings")
    page.locator('[data-tab="video"]').click()
    page.locator("#gg-setting-fov").press("End")
    click("back")
    page.set_viewport_size({"width":1260,"height":540})
    click("resume")
    page.evaluate("v.input.yaw=-Math.PI/4")
    page.wait_for_function("v.camera.fov>94.75", timeout=45000)
    streets["northwest-wide"] = sample_view(page,settle=24)
    print("Downtown wide","peak",streets["northwest-wide"]["peak"],flush=True)
    (evidence / "ride-budgets.json").write_text(json.dumps({"rides":profile,"downtown":streets,"errors":errors},indent=2), encoding="utf-8")
    assert not errors, errors
    for view, stats in {**profile, **streets}.items():
        assert 1000 < stats["peak"] <= 500000, (view, stats)


if __name__ == "__main__":
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--enable-unsafe-swiftshader","--ignore-gpu-blocklist"])
        try:
            check_rides(browser.new_page(viewport={"width":896,"height":504}), sys.argv[1], output)
        finally:
            browser.close()
