"""Validate shared token contrast, deployed assets and Python/XML syntax."""
from __future__ import annotations

import ast
import importlib.util
import itertools
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROJECTS = ROOT.parents[1]


def luminance(hex_color: str) -> float:
    rgb = [int(hex_color[i:i+2], 16) / 255 for i in (1, 3, 5)]
    linear = [c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in rgb]
    return sum(c*w for c, w in zip(linear, (.2126, .7152, .0722)))


def contrast(a: str, b: str) -> float:
    high, low = sorted((luminance(a), luminance(b)), reverse=True)
    return (high + .05) / (low + .05)


def verify() -> None:
    data = json.loads((ROOT / "tokens.json").read_text(encoding="utf-8"))
    count = 0
    for name, mode, style, density in itertools.product(data["themes"], ("light", "dark"), data["styles"], data["density"]):
        v = data["themes"][name][mode] | data["status"][mode]
        for foreground, background in (("text", "bg"), ("text", "panel"), ("muted", "panel"), ("accent-ink", "accent"), ("accent-ink", "accent-hover")):
            ratio = contrast(v[foreground], v[background])
            assert ratio >= 4.5, (name, mode, foreground, background, ratio)
        for status in ("success", "warning", "danger", "info"):
            assert contrast(v[status], v[status + "-soft"]) >= 4.5, (name, mode, status)
        count += 1
    css = (ROOT / "dist/theme.css").read_text(encoding="utf-8")
    definitions = set(re.findall(r'(--ui-[\w-]+)\s*:', css))
    refs = set(re.findall(r'var\((--ui-[\w-]+)', css))
    assert refs <= definitions, refs - definitions
    assert "https://" not in css and "http://" not in css
    spec = importlib.util.spec_from_file_location("shared_theme", PROJECTS / "ai.player/ai_player/resources/themes/python_theme.py")
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    # QSS conversion must preserve layout and map neutral text to readable text.
    v = adapter.values()
    qss = adapter.qt_stylesheet('QLabel { color: #172033; } QWidget { background: #ffffff; padding: 7px; }')
    assert f'color: {v["text"]}' in qss
    assert 'padding: 7px' in qss
    projects = ["ai.atelier", "ai.meeting", "ai.player", "ai.player.android", "ai.slide", "ai.story", "ai.studio", "ai.telegram.android", "sd.webui", "VieNeu-TTS", "watermarks-remover"]
    for name in projects:
        folder = PROJECTS / name / "themes"
        cfg = json.loads((folder / "project.json").read_text(encoding="utf-8"))
        assert cfg["version"] == data["version"]
        assert (folder / "tokens.json").read_bytes() == (ROOT / "tokens.json").read_bytes()
        assert (folder / "dist/theme.css").read_text(encoding="utf-8") == (ROOT / "dist/theme.css").read_text(encoding="utf-8")
    files = ["ai.player/ai_player/ui/player_window_ui.py", "ai.studio/src/ai_story/web.py", "watermarks-remover/service/scripts/server.py", "VieNeu-TTS/apps/gradio_main.py", "VieNeu-TTS/apps/gradio_xpu.py", "VieNeu-TTS/apps/web_stream.py"]
    for name in ("ai.slide", "ai.story"):
        files += [f"{name}/studio/gui_entry.py", f"{name}/audio/gui/app.py", f"{name}/video/gui/app.py", f"{name}/studio/themes/python_theme.py"]
    for name in files:
        ast.parse((PROJECTS / name).read_text(encoding="utf-8"), filename=name)
    spec = importlib.util.spec_from_file_location("stream_theme", PROJECTS / "VieNeu-TTS/apps/shared_themes/python_theme.py")
    stream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(stream)
    html = stream.theme_html((PROJECTS / "VieNeu-TTS/client/client.html").read_text(encoding="utf-8"))
    assert 'data-theme-app="vieneu-stream"' in html and 'window.AIThemes' in html and '--ui-bg:' in html
    for name in ("ai.meeting", "ai.player.android", "ai.telegram.android"):
        res = PROJECTS / name / "app/src/main/res"
        for folder in ("values", "values-night"):
            for path in (res / folder).glob("*.xml"):
                ET.parse(path)
    # Check Gradio adapter keyword arguments against its installed source API,
    # independently of optional native inference/Pillow dependencies.
    gradio = PROJECTS / "VieNeu-TTS/.venv/Lib/site-packages/gradio/themes/base.py"
    if gradio.exists():
        tree = ast.parse(gradio.read_text(encoding="utf-8"))
        fn = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "set")
        allowed = {arg.arg for arg in fn.args.args + fn.args.kwonlyargs}
        source = ast.parse((ROOT / "runtime/python_theme.py").read_text(encoding="utf-8"))
        fn = next(n for n in source.body if isinstance(n, ast.FunctionDef) and n.name == "gradio_theme")
        call = next(n for n in ast.walk(fn) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "set")
        assert {kw.arg for kw in call.keywords} <= allowed
    print(f"PASS: {count} combinations, text/status contrast, CSS references, 11 pinned projects, Python/XML syntax, Qt palette and Gradio API")


if __name__ == "__main__":
    verify()
