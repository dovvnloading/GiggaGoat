"""Play Free Roam in Chrome, crossing a live lane and checking the installed fleet."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright


def play(page, url, evidence):
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("response", lambda response: errors.append(f"{response.status} {response.url}")
            if response.status >= 400 else None)
    page.goto(url, wait_until="commit")
    page.wait_for_function("window.session?.view?.renderer?.isWebGLRenderer", timeout=120000)
    page.evaluate("""() => {
      window.g = session.game;
      window.v = session.view;
      window.peak = 0;
      function sample() {
        if (!v.paused) window.peak = Math.max(window.peak, v.perfStats.triangles);
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }""")
    page.locator('[data-action="play"]').press("Enter", timeout=60000)
    page.wait_for_function("v.traffic.root.userData.ready && !v.paused", timeout=100000)
    fleet = page.evaluate("""() => ({
      vehicles: v.traffic.rigs.length,
      models: new Set(g.traffic.vehicles.map(c => c.service.model)).size,
      liveries: v.traffic.rigs.filter(r => r.root.getObjectByName('painted-service-panels')).length,
      rolling: v.traffic.rigs.every(r => r.wheels.length === 4),
      serviceDoors: v.traffic.rigs.filter(r => r.hatch).length
    })""")
    assert fleet["vehicles"] == 16 and fleet["models"] == 11 and fleet["liveries"] == 4, fleet
    assert fleet["rolling"] and fleet["serviceDoors"] >= 3, fleet

    def advance(seconds):
        goal = page.evaluate("g.physics.time") + seconds
        page.wait_for_function("goal => g.physics.time >= goal", arg=goal, timeout=120000)

    page.evaluate("""() => {
      window.car = g.traffic.vehicles.find(c => c.service.name === 'Harbour GT');
      window.crossing = car.lane.sample(car.distance + 14, {...car.pose});
      g.teleport({x:crossing.x, y:crossing.y+.05, z:crossing.z});
      v.alignCameraForPlay();
    }""")
    advance(3.6)
    stopped = page.evaluate("""() => {
      const goat = g.goat.torso.translation();
      return {speed:car.speed, separation:Math.hypot(goat.x-car.pose.x,goat.z-car.pose.z),
        collider:car.body?.isEnabled(), odometer:car.odometer};
    }""")
    assert stopped["collider"] and stopped["speed"] < .2 and 1.7 < stopped["separation"] < 9, stopped
    page.keyboard.press("e")
    advance(.25)
    answered = page.evaluate("g.traffic.time-car.answeredAt")
    assert 0 <= answered < 1.5, answered
    page.evaluate("""() => g.teleport({x:crossing.x+Math.cos(crossing.yaw)*9,
      y:crossing.y+1,z:crossing.z-Math.sin(crossing.yaw)*9})""")
    advance(6)
    moved = page.evaluate("car.odometer") - stopped["odometer"]
    assert moved > 2, moved
    page.screenshot(path=evidence / "crossing.jpg", type="jpeg", quality=85)
    report = {"fleet": fleet, "stopped": stopped, "resumedMetres": moved,
              "hornSecondsAgo": answered, "peakTriangles": page.evaluate("peak"), "errors": errors}
    (evidence / "road-traffic.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(report, flush=True)
    assert 1000 < report["peakTriangles"] <= 500000, report
    assert not errors, errors


if __name__ == "__main__":
    output = Path(sys.argv[2])
    output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--enable-webgl", "--ignore-gpu-blocklist",
                                     "--enable-unsafe-swiftshader"])
        try:
            play(browser.new_page(viewport={"width": 1152, "height": 680}), sys.argv[1], output)
        finally:
            browser.close()
