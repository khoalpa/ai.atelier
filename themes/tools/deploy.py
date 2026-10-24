"""Deploy pinned themes to the sibling projects. Back up every changed source file.

Run from the authoritative ai.atelier/themes/tools directory. No symlinks,
downloads, dependency installations, builds or running services are required.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path

from build import ROOT, build

PROJECTS = ROOT.parents[1]
DATA = json.loads((ROOT / "tokens.json").read_text(encoding="utf-8"))
STAMP = datetime.now().strftime("%Y%m%d-%H%M%S")
CHANGES = []


def write(path: Path, content: str) -> None:
    new = content.encode("utf-8")
    old = path.read_bytes() if path.exists() else None
    if old == new:
        return
    project = next((p for p in PROJECTS.iterdir() if p.is_dir() and path.is_relative_to(p)), None)
    backup = None
    if old is not None and project is not None:
        backup = project / ".theme-backups" / STAMP / path.relative_to(project)
        backup.parent.mkdir(parents=True, exist_ok=True)
        backup.write_bytes(old)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(new)
    CHANGES.append({"path": str(path), "backup": str(backup) if backup else None, "sha256": hashlib.sha256(new).hexdigest()})


def patch(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if new in text:
        return
    if old not in text:
        raise ValueError(f"Expected source not found: {path}: {old[:70]}")
    write(path, text.replace(old, new, 1))


def snapshot(name: str, theme="neutral", mode="system", style="minimal", density="comfortable") -> dict:
    project = PROJECTS / name
    settings = dict(version=DATA["version"], project=name, theme=theme, mode=mode, style=style, density=density)
    existing = project / "themes/project.json"
    if existing.exists():
        saved = json.loads(existing.read_text(encoding="utf-8"))
        options = {"theme": DATA["themes"], "mode": ("system", "light", "dark"), "style": DATA["styles"], "density": DATA["density"]}
        for key, allowed in options.items():
            if saved.get(key) in allowed:
                settings[key] = saved[key]
    ignore = project / ".gitignore"
    ignore_text = ignore.read_text(encoding="utf-8") if ignore.exists() else ""
    if ".theme-backups/" not in ignore_text:
        write(ignore, ignore_text.rstrip() + "\n\n# Local rollback copies for AI Themes\n.theme-backups/\n")
    if project != ROOT.parent:
        for folder in ("tokens", "palettes", "styles", "density", "dist", "runtime", "preview"):
            for source in (ROOT / folder).rglob("*"):
                if source.is_file() and "__pycache__" not in source.parts:
                    write(project / "themes" / source.relative_to(ROOT), source.read_text(encoding="utf-8"))
        for file in ("tokens.json", "theme.css", "README.md"):
            write(project / "themes" / file, (ROOT / file).read_text(encoding="utf-8"))
    write(project / "themes/project.json", json.dumps(settings, indent=2) + "\n")
    return settings


def portable_python(project: Path, folder: Path, settings: dict) -> None:
    for file, content in {
        "__init__.py": "# AI Themes runtime assets.\n",
        "python_theme.py": (ROOT / "runtime/python_theme.py").read_text(encoding="utf-8"),
        "tokens.json": (ROOT / "tokens.json").read_text(encoding="utf-8"),
        "project.json": json.dumps(settings, indent=2) + "\n",
    }.items():
        write(project / folder / file, content)


def aliases() -> str:
    pairs = {
        "color-bg-app":"bg", "color-bg-canvas":"canvas", "color-bg-panel":"panel", "color-bg-surface":"surface", "color-bg-raised":"raised", "color-bg-overlay":"panel",
        "color-text-primary":"text", "color-text-secondary":"muted", "color-text-disabled":"disabled", "color-border-subtle":"border-subtle", "color-border-default":"border", "color-border-strong":"border-strong",
        "color-accent":"accent", "color-accent-hover":"accent-hover", "color-accent-ink":"accent-ink", "color-focus":"accent",
        "canvas":"bg", "surface":"panel", "surface-subtle":"surface", "surface-strong":"raised", "text":"text", "muted":"muted", "border":"border", "brand":"accent", "brand-hover":"accent-hover", "brand-foreground":"accent-ink", "brand-soft":"accent-soft",
        "ink":"text", "paper":"bg", "card":"panel", "line":"border", "acid":"accent", "green":"success", "danger":"danger",
        "font-ui":"font-sans", "font-sans":"font-sans", "radius-control":"radius-md", "radius-card":"radius-lg", "radius-sm":"radius-sm", "radius-md":"radius-md", "radius-lg":"radius-lg", "radius-xl":"radius-lg",
        "control-height":"control-height", "control-height-sm":"control-height-sm", "control-height-lg":"control-height-lg", "button-height":"control-height", "button-height-sm":"control-height-sm", "button-height-lg":"control-height-lg",
        "shadow-sm":"shadow-sm", "shadow-md":"shadow-md", "shadow-lg":"shadow-md", "shadow-raised":"shadow-md",
    }
    for status in ("success", "warning", "danger", "info"):
        for suffix in ("", "-soft"):
            pairs["color-" + status + suffix] = status + suffix
            pairs[status + suffix] = status + suffix
    text = ':root[data-theme] {\n' + "\n".join(f" --{a}:var(--ui-{b});" for a, b in pairs.items()) + '\n}\n'
    text += ':root[data-theme] body { font-family:var(--ui-font-sans); }\n'
    text += ':root[data-style="editorial"] :is(h1,h2,h3) { font-family:var(--ui-font-display); }\n'
    text += ':root[data-style] :is(.panel,.card,.models-panel,.version-panel,.findings-panel,.result-card) { border-radius:var(--ui-radius-lg); box-shadow:var(--ui-shadow-sm); }\n'
    text += ':root[data-style] :is(.button,button:not(.icon-button):not(.ui-theme-trigger),input:not([type="range"]):not([type="checkbox"]):not([type="radio"]),select,textarea) { border-radius:var(--ui-radius-md); }\n'
    text += ':root[data-density] :is(.button,.primary-button,.secondary-button,.model-button,.version-button,button.primary,input[type="text"],select) { min-height:var(--ui-control-height); }\n'
    text += ':root[data-density] :is(.panel,.card) { padding:var(--ui-panel-padding); }\n'
    text += ':root[data-theme] :is(button,input,select,textarea):focus-visible { outline:2px solid var(--ui-accent); outline-offset:2px; }\n'
    text += '@media(prefers-reduced-motion:reduce) { html:root { scroll-behavior:auto; } body * { animation:none!important; transition:none!important; } }\n'
    return text


def web(name: str, public: str, settings: dict, prefix="") -> None:
    project = PROJECTS / name
    public = project / public
    css = (ROOT / "dist/theme.css").read_text(encoding="utf-8") + aliases()
    if name == "ai.atelier":
        # Bridge the old literal palette, retaining alpha for masks and shadows.
        import colorsys
        legacy = (public / "styles/tokens.css").read_text(encoding="utf-8")
        rules = []
        for key, value in re.findall(r"(--palette-[\w-]+):\s*(#[0-9a-fA-F]{3,8})\s*;", legacy):
            digits = value[1:]
            if len(digits) in (3, 4):
                digits = "".join(c*2 for c in digits)
            h, lightness, sat = colorsys.rgb_to_hls(*(int(digits[i:i+2], 16)/255 for i in (0, 2, 4)))
            role = "canvas" if lightness < .035 else "bg" if lightness < .065 else "panel" if lightness < .095 else "surface" if lightness < .14 else "raised" if lightness < .20 else "border" if lightness < .4 else "muted" if lightness < .76 else "text"
            if sat > .25 and .025 < lightness < .94 and not (.48 < h < .75 and lightness < .45):
                status = "danger" if h < .045 or h > .93 else "accent" if h < .17 else "success" if h < .48 else "info"
                role = status + "-soft" if lightness < .24 else status
            mapped = f"var(--ui-{role})"
            if len(digits) == 8:
                alpha = int(digits[6:8], 16) / 255 * 100
                mapped = f"color-mix(in srgb, {mapped} {alpha:.3f}%, transparent)"
            if int(digits[:6], 16) == 0:
                mapped = "var(--ui-shadow-color)" if len(digits) == 8 else "var(--ui-canvas)"
            rules.append(f" {key}:{mapped};")
        css += ':root[data-theme] {\n' + '\n'.join(rules) + '\n}\n'
    if name == "watermarks-remover":
        css += ':root[data-theme] { --shadow:var(--ui-shadow-md); }\n'
        # Replace the handful of old literal colors in all application styles.
        roles = {
            "#59a56e":"success", "#9b9b94":"muted", "#b9baaf":"border", "#faf9f4":"surface", "#f5f9e5":"accent-soft", "#92938c":"muted", "#f1f4e8":"success-soft", "#fff0ed":"danger-soft", "#edf1dc":"accent-soft", "#fff0cc":"warning-soft", "#885b09":"warning", "#20221d":"canvas", "#dfe8cf":"text", "#efeee9":"surface", "#aaa":"disabled", "#f0f3e7":"success-soft", "#77786f":"muted", "#686961":"muted", "#171714":"text", "#a8aa9f":"border", "#e6e6df":"surface", "#777":"disabled", "#a93b31":"danger", "#e7ece5":"success-soft", "#66685f":"muted", "#c8c8c1":"border", "#e7e6e0":"surface", "#85867f":"disabled", "#acc9af":"success", "#f2f8ef":"success-soft", "#d7ead7":"success-soft", "#dfb1aa":"danger", "#fff4f1":"danger-soft", "#f5d8d2":"danger-soft", "#9a3026":"danger"
        }
        roles.update({"#b7cfbd":"success", "#f1f7ee":"success-soft", "#d8ead7":"success-soft", "#2d6a42":"success", "#dec987":"warning", "#fff9df":"warning-soft", "#bfd2c1":"border", "#f7fbf5":"surface", "#a9c7ae":"success", "#e5f2e3":"success-soft", "#f2c94c":"warning-soft", "#4e3c00":"warning", "#6f7069":"muted", "#ded9c5":"border", "#fffefa":"panel", "#8b6b10":"warning"})
        roles.update({"#49636d":"info", "#696a65":"muted", "#8a8b83":"disabled", "#e8eef0":"info-soft", "#ecece5":"surface", "#fee2dc":"danger-soft"})
        for path in public.glob("*.css"):
            if path.name == "ai-theme.css":
                continue
            text = path.read_text(encoding="utf-8")
            # Keep root definitions for compatibility; semantic aliases override them.
            root_end = text.find("}") + 1 if text.lstrip().startswith(":root") else 0
            source = text[root_end:]
            source = re.sub(r'#[0-9a-fA-F]{3,8}\b', lambda m: f"var(--ui-{roles[m[0].lower()]})" if m[0].lower() in roles else m[0], source)
            # Dark ink buttons invert with the palette in either mode.
            source = re.sub(r'color:\s*white\b', 'color:var(--ui-panel)', source)
            write(path, text[:root_end] + source)
    write(public / "ai-theme.css", css)
    write(public / "ai-theme.js", (ROOT / "dist/theme.js").read_text(encoding="utf-8"))
    attrs = " ".join(f'data-{k}="{settings[k]}"' for k in ("theme", "mode", "style", "density")) + f' data-theme-app="{name}"'
    path = public / "index.html"
    html = path.read_text(encoding="utf-8")
    html = re.sub(r'<html([^>]*)>', lambda m: '<html' + re.sub(r'\sdata-(?:theme|mode|style|density|theme-app)="[^"]*"', '', m[1]) + ' ' + attrs + '>', html, count=1)
    # Controller runs before rendering to avoid a saved-preference flash.
    if 'src="' + prefix + '/ai-theme.js"' not in html:
        html = html.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n  <script src="' + prefix + '/ai-theme.js"></script>', 1)
        html = html.replace('</head>', '  <link rel="stylesheet" href="' + prefix + '/ai-theme.css">\n</head>', 1)
    write(path, html)


def streamlit(name: str) -> None:
    project = PROJECTS / name
    settings = snapshot(name)
    portable_python(project, Path("studio/themes"), settings)
    entry = project / "studio/gui_entry.py"
    anchor = "    render_studio_style()" if name == "ai.story" else '    st.set_page_config(page_title=app_title, page_icon=":material/movie:", layout="wide")'
    patch(entry, anchor, anchor + '\n\n    from studio.themes.python_theme import render_streamlit\n    render_streamlit()')
    # Standalone audio/video entry points also receive the same preferences.
    for rel, anchor in (("audio/gui/app.py", "    render_audio_workspace()"), ("video/gui/app.py", '        st.set_page_config(page_title=APP_TITLE, page_icon=":material/movie:", layout="wide")')):
        path = project / rel
        indent = "        " if rel.startswith("video") else "    "
        addition = indent + 'from studio.themes.python_theme import render_streamlit\n' + indent + 'render_streamlit()'
        if rel.startswith("audio"):
            text = path.read_text(encoding="utf-8")
            wrong = anchor + '\n' + addition
            right = addition + '\n' + anchor
            if wrong in text:
                write(path, text.replace(wrong, right, 1))
            elif right not in text:
                patch(path, anchor, right)
        else:
            patch(path, anchor, anchor + '\n' + addition)
    path = project / "pyproject.toml"
    text = path.read_text(encoding="utf-8")
    if 'studio = ["themes/*.json"]' not in text:
        if "[tool.setuptools.package-data]" in text:
            text = text.replace("[tool.setuptools.package-data]", '[tool.setuptools.package-data]\nstudio = ["themes/*.json"]', 1)
        else:
            text += '\n[tool.setuptools.package-data]\nstudio = ["themes/*.json"]\n'
        write(path, text)


def android(name: str, prefix: str, mapping: dict, default_mode="light") -> None:
    project = PROJECTS / name
    snapshot(name, mode="system")
    res = project / "app/src/main/res"
    for folder, mode in (("values", default_mode), ("values-night", "dark")):
        v = DATA["themes"]["neutral"][mode] | DATA["status"][mode]
        xml = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Generated from themes/tokens.json, v1.0.0 -->\n<resources>\n'
        xml += '\n'.join(f'    <color name="shared_{key.replace("-", "_")}">{value}</color>' for key, value in v.items())
        xml += '\n</resources>\n'
        write(res / folder / "shared-theme-colors.xml", xml)
        # Existing resource IDs remain stable, all drawables/layouts inherit them.
        path = res / folder / "colors.xml"
        text = path.read_text(encoding="utf-8") if path.exists() else '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'
        for resource, role in mapping.items():
            line = f'<color name="{resource}">@color/shared_{role.replace("-", "_")}</color>'
            if re.search(rf'<color name="{resource}">[^<]*</color>', text):
                text = re.sub(rf'<color name="{resource}">[^<]*</color>', line, text)
            else:
                text = text.replace('</resources>', '    ' + line + '\n</resources>')
        write(path, text)
    styles = res / "values/styles.xml"
    text = styles.read_text(encoding="utf-8")
    text = text.replace('Theme.Material.NoActionBar', 'Theme.Material.Light.NoActionBar')
    text = re.sub(r'(<item name="android:windowLightStatusBar">)[^<]+', r'\g<1>true' if default_mode == 'light' else r'\g<1>false', text)
    text = text.replace('</style>', '    <item name="android:windowBackground">@color/shared_bg</item>\n        <item name="android:textColorPrimary">@color/shared_text</item>\n        <item name="android:textColorSecondary">@color/shared_muted</item>\n    </style>') if '@color/shared_bg' not in text else text
    write(styles, text)
    night = text.replace('Theme.Material.Light.NoActionBar', 'Theme.Material.NoActionBar').replace('<item name="android:windowLightStatusBar">true', '<item name="android:windowLightStatusBar">false')
    write(res / "values-night/styles.xml", night)
    write(res / "values/shared-theme-dimens.xml", '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <dimen name="shared_control_height">48dp</dimen>\n    <dimen name="shared_space">12dp</dimen>\n    <dimen name="shared_corner">8dp</dimen>\n</resources>\n')


def deploy() -> None:
    build()
    s = snapshot("ai.atelier", "atelier", "dark", density="compact")
    web("ai.atelier", "app/public", s)
    s = snapshot("ai.studio")
    web("ai.studio", "src/ai_story/webapp", s)
    path = PROJECTS / "ai.studio/src/ai_story/web.py"
    patch(path, '{"index.html", "styles.css", "app.js"}', '{"index.html", "styles.css", "app.js", "ai-theme.css", "ai-theme.js"}')
    s = snapshot("watermarks-remover", "paper", "light", "editorial")
    web("watermarks-remover", "service/scripts/web", s, "/assets")
    path = PROJECTS / "watermarks-remover/service/scripts/server.py"
    patch(path, 'STATIC_ROUTES = {', 'STATIC_ROUTES = {\n    "/assets/ai-theme.css": ("ai-theme.css", "text/css; charset=utf-8"),\n    "/assets/ai-theme.js": ("ai-theme.js", "text/javascript; charset=utf-8"),')
    for name in ("ai.slide", "ai.story"):
        streamlit(name)
    project = PROJECTS / "ai.player"
    settings = snapshot("ai.player", mode="light", density="compact")
    portable_python(project, Path("ai_player/resources/themes"), settings)
    path = project / "ai_player/ui/player_window_ui.py"
    patch(path, '    def _apply_theme(self) -> None:\n        self.setStyleSheet(', '    def _apply_theme(self) -> None:\n        from ai_player.resources.themes.python_theme import qt_stylesheet\n\n        self.setStyleSheet(qt_stylesheet(')
    patch(path, '            """\n        )\n\n    def _set_dubbing_ready', '            """\n        ))\n\n    def _set_dubbing_ready')
    path = project / "pyproject.toml"
    patch(path, 'ai_player = [\n', 'ai_player = [\n    "resources/themes/*.json",\n    "resources/themes/*.py",\n')
    android("ai.meeting", "meeting", {"meeting_bg":"bg", "meeting_panel":"panel", "meeting_panel_alt":"surface", "meeting_text":"text", "meeting_muted":"muted", "meeting_primary":"accent", "meeting_primary_dark":"accent-hover", "meeting_accent":"info", "meeting_gold":"warning", "meeting_border":"border", "meeting_border_strong":"border-strong", "meeting_success_bg":"success-soft", "meeting_warning_bg":"warning-soft", "meeting_danger":"danger"})
    android("ai.player.android", "ai", {"ai_background":"bg", "ai_surface":"panel", "ai_text":"text", "ai_muted":"muted", "ai_primary":"accent", "ai_primary_dark":"accent-hover", "ai_ready":"success", "ai_warning":"warning"})
    player_android()
    compose()
    gradio()
    report = ROOT / "deployment" / (STAMP + ".json")
    report.parent.mkdir(exist_ok=True)
    report.write_text(json.dumps({"version": DATA["version"], "changes": CHANGES}, indent=2), encoding="utf-8")
    print(f"Deployed to 11 projects; {len(CHANGES)} changed files. Rollback manifest: {report}")


def compose() -> None:
    project = PROJECTS / "ai.telegram.android"
    snapshot(project.name)
    res = project / "app/src/main/res"
    for folder, mode in (("values", "light"), ("values-night", "dark")):
        v = DATA["themes"]["neutral"][mode] | DATA["status"][mode]
        write(res / folder / "shared-theme-colors.xml", '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' + '\n'.join(f'    <color name="shared_{key.replace("-", "_")}">{value}</color>' for key, value in v.items()) + '\n</resources>\n')
    # Explicit light/dark schemes preserve the existing in-app mode selector.
    fields = {"primary":"accent", "onPrimary":"accent-ink", "primaryContainer":"accent-soft", "onPrimaryContainer":"text", "secondary":"success", "onSecondary":"bg", "secondaryContainer":"success-soft", "onSecondaryContainer":"text", "tertiary":"warning", "background":"bg", "onBackground":"text", "surface":"panel", "onSurface":"text", "surfaceVariant":"surface", "onSurfaceVariant":"muted", "surfaceContainer":"panel", "surfaceContainerHigh":"surface", "outline":"border", "outlineVariant":"border-subtle", "error":"danger", "onError":"bg", "errorContainer":"danger-soft", "onErrorContainer":"text"}
    code = 'package ai.telegram.android.ui\n\nimport androidx.compose.material3.darkColorScheme\nimport androidx.compose.material3.lightColorScheme\nimport androidx.compose.ui.graphics.Color\n\n// Generated from themes/tokens.json, AI Themes 1.0.0.\n'
    for mode in ("light", "dark"):
        v = DATA["themes"]["neutral"][mode] | DATA["status"][mode]
        code += f'\ninternal val Shared{mode.title()}Colors = {mode}ColorScheme(\n' + ',\n'.join(f'    {field} = Color(0xFF{v[role][1:].upper()})' for field, role in fields.items()) + '\n)\n'
    folder = project / "app/src/main/java/ai/telegram/android/ui"
    write(folder / "SharedThemeColors.kt", code)
    path = folder / "AppTheme.kt"
    text = path.read_text(encoding="utf-8")
    text = re.sub(r'private val LightColors: ColorScheme = lightColorScheme\([\s\S]*?\n\)', 'private val LightColors: ColorScheme = SharedLightColors', text, count=1)
    text = re.sub(r'private val DarkColors: ColorScheme = darkColorScheme\([\s\S]*?\n\)', 'private val DarkColors: ColorScheme = SharedDarkColors', text, count=1)
    write(path, text)


def player_android() -> None:
    # This app builds its chrome in Java; resource aliases alone are insufficient.
    path = PROJECTS / "ai.player.android/app/src/main/java/com/aiplayer/android/MainActivity.java"
    text = path.read_text(encoding="utf-8")
    replacements = {
        "Color.rgb(8, 11, 16)": "getColor(R.color.shared_bg)",
        "Color.argb(220, 8, 11, 16)": "getColor(R.color.shared_bg)",
        "Color.rgb(18, 24, 33)": "getColor(R.color.shared_panel)",
        "Color.argb(245, 18, 24, 33)": "getColor(R.color.shared_panel)",
        "Color.argb(170, 18, 24, 33)": "getColor(R.color.shared_panel)",
        "Color.rgb(36, 107, 253)": "getColor(R.color.shared_accent)",
        "Color.rgb(34, 197, 94)": "getColor(R.color.shared_success)",
        "Color.rgb(22, 32, 42)": "getColor(R.color.shared_text)",
        "Color.rgb(96, 112, 128)": "getColor(R.color.shared_muted)",
        "Color.rgb(210, 216, 224)": "getColor(R.color.shared_muted)",
        "Color.argb(24, 36, 107, 253)": "getColor(R.color.shared_accent_soft)",
        "Color.argb(80, 255, 255, 255)": "getColor(R.color.shared_surface)",
    }
    for before, after in replacements.items():
        text = text.replace(before, after)
    # Preserve the video/subtitle rendering colors; only replace app chrome text.
    for widget in ("sourceLabel", "timeLabel", "transcriptView", "statusLabel", "button"):
        text = text.replace(f"{widget}.setTextColor(Color.WHITE)", f"{widget}.setTextColor(getColor(R.color.shared_text))")
    text = text.replace("modeLabel.setTextColor(Color.WHITE)", "modeLabel.setTextColor(getColor(R.color.shared_accent_ink))")
    write(path, text)


def gradio() -> None:
    project = PROJECTS / "VieNeu-TTS"
    settings = snapshot(project.name, mode="light", style="soft")
    portable_python(project, Path("apps/shared_themes"), settings)
    for file in ("theme.css", "theme.js"):
        write(project / "apps/shared_themes" / file, (ROOT / "dist" / file).read_text(encoding="utf-8"))
    package = project / "pyproject.toml"
    package_text = package.read_text(encoding="utf-8")
    if 'apps = ["shared_themes/*.json"]' in package_text:
        package_text = package_text.replace('apps = ["shared_themes/*.json"]', 'apps = ["shared_themes/*.json", "shared_themes/*.css", "shared_themes/*.js"]')
        write(package, package_text)
    if 'apps = ["shared_themes/*.json", "shared_themes/*.css", "shared_themes/*.js"]' not in package_text:
        if "[tool.setuptools.package-data]" in package_text:
            package_text = package_text.replace("[tool.setuptools.package-data]", '[tool.setuptools.package-data]\napps = ["shared_themes/*.json", "shared_themes/*.css", "shared_themes/*.js"]', 1)
        else:
            package_text += '\n[tool.setuptools.package-data]\napps = ["shared_themes/*.json", "shared_themes/*.css", "shared_themes/*.js"]\n'
        write(package, package_text)
    for name in ("gradio_main.py", "gradio_xpu.py"):
        path = project / "apps" / name
        text = path.read_text(encoding="utf-8")
        start = text.index("theme = gr.themes.Soft(") if "theme = gr.themes.Soft(" in text else -1
        if start >= 0:
            end = text.index('\ncss = """', start)
            text = text[:start] + 'try:\n    from apps.shared_themes.python_theme import gradio_theme\nexcept ModuleNotFoundError:\n    from shared_themes.python_theme import gradio_theme\n\ntheme = gradio_theme(gr)\n' + text[end:]
            write(path, text)
    path = project / "apps/web_stream.py"
    patch(path, '    return HTMLResponse(content=HTML_CONTENT)', '    try:\n        from apps.shared_themes.python_theme import theme_html\n    except ModuleNotFoundError:\n        from shared_themes.python_theme import theme_html\n    return HTMLResponse(content=theme_html(HTML_CONTENT))')
    path = project / "client/client.html"
    text = path.read_text(encoding="utf-8")
    text = text.replace('[data-theme="light"]', '[data-resolved-mode="light"]')
    text = text.replace("                const stored = localStorage.getItem('vieneu-theme');", "                if (window.AIThemes) return document.documentElement.dataset.resolvedMode;\n                const stored = localStorage.getItem('vieneu-theme');") if "if (window.AIThemes) return" not in text else text
    text = text.replace("                document.documentElement.setAttribute('data-theme', theme);\n                localStorage.setItem('vieneu-theme', theme);", "                const update = () => setTheme(document.documentElement.dataset.resolvedMode || 'dark');\n                document.addEventListener('ai-theme-change', update);\n                return () => document.removeEventListener('ai-theme-change', update);")
    text = text.replace("onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}", "onClick={() => { const mode = theme === 'dark' ? 'light' : 'dark'; if (window.AIThemes) window.AIThemes.set({mode}); else document.documentElement.setAttribute('data-resolved-mode', mode); setTheme(mode); }}")
    write(path, text)
    # SD WebUI loads extension style.css automatically; leave upstream files intact.
    project = PROJECTS / "sd.webui"
    snapshot(project.name, mode="system", style="soft")
    ext = project / "webui/extensions/ai-shared-themes"
    css = (ROOT / "dist/theme.css").read_text(encoding="utf-8")
    css += """
    :root .gradio-container, :root .dark { --body-background-fill:var(--ui-bg); --body-text-color:var(--ui-text); --body-text-color-subdued:var(--ui-muted); --background-fill-primary:var(--ui-panel); --background-fill-secondary:var(--ui-surface); --block-background-fill:var(--ui-panel); --block-border-color:var(--ui-border); --input-background-fill:var(--ui-panel); --input-border-color:var(--ui-border); --input-text-color:var(--ui-text); --button-primary-background-fill:var(--ui-accent); --button-primary-background-fill-hover:var(--ui-accent-hover); --button-primary-text-color:var(--ui-accent-ink); --button-secondary-background-fill:var(--ui-surface); --button-secondary-text-color:var(--ui-text); --button-secondary-border-color:var(--ui-border); --block-radius:var(--ui-radius-lg); --button-large-radius:var(--ui-radius-md); --input-radius:var(--ui-radius-md); }
    """
    write(ext / "style.css", css)
    js = 'document.documentElement.dataset.themeApp="sd.webui"; document.documentElement.dataset.style="soft";\n' + (ROOT / "dist/theme.js").read_text(encoding="utf-8")
    write(ext / "javascript/theme.js", js)
    write(ext / "scripts/shared_theme.py", '"""Registers the local AI Themes extension; styling is loaded by WebUI."""\n')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rollback", type=Path, help="Restore a deployment only if its generated files have not changed")
    args = parser.parse_args()
    if args.rollback:
        records = json.loads(args.rollback.read_text(encoding="utf-8"))["changes"]
        for record in records:
            path = Path(record["path"])
            if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != record["sha256"]:
                raise SystemExit(f"Changed since deployment; rollback refused: {path}")
        for record in reversed(records):
            path = Path(record["path"])
            if record["backup"]:
                shutil.copyfile(record["backup"], path)
            else:
                path.unlink()
        print("Restored deployment")
    else:
        deploy()
