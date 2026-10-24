"""Build portable CSS and native assets from tokens.json. Standard library only."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def declarations(values: dict[str, str]) -> str:
    return "\n".join(f"  --ui-{key}: {value};" for key, value in values.items())


def build() -> None:
    data = json.loads((ROOT / "tokens.json").read_text(encoding="utf-8"))
    foundation = {
        "font-sans": '"Segoe UI", Inter, system-ui, -apple-system, sans-serif',
        "font-display": 'Georgia, "Times New Roman", serif',
        "font-mono": 'Consolas, "Cascadia Code", monospace',
        "font-size-body": "14px", "line-height": "1.5", "motion-fast": "160ms",
        "space-1": "4px", "space-2": "8px", "space-3": "12px", "space-4": "16px",
        "space-5": "24px", "space-6": "32px", "space-7": "48px",
    }
    files = {"tokens/foundation.css": ":root {\n" + declarations(foundation) + "\n}"}
    for name, modes in data["themes"].items():
        chunks = []
        for mode, values in modes.items():
            selector = f':root[data-theme="{name}"][data-resolved-mode="{mode}"], :root[data-theme="{name}"][data-mode="{mode}"]'
            chunks.append(selector + " {\n  color-scheme: " + mode + ";\n" + declarations(values | data["status"][mode]) + "\n}")
        files[f"palettes/{name}.css"] = "\n".join(chunks)
    for group in ("styles", "density"):
        attr = "style" if group == "styles" else "density"
        for name, values in data[group].items():
            files[f"{group}/{name}.css"] = f':root[data-{attr}="{name}"] {{\n' + declarations(values) + "\n}"
    # Safe fallback when JS is blocked, before preferences are resolved.
    fallback = ":root {\n  color-scheme: light;\n" + declarations(data["themes"]["neutral"]["light"] | data["status"]["light"] | data["styles"]["minimal"] | data["density"]["comfortable"]) + "\n}\n"
    fallback += '@media(prefers-color-scheme:dark) { :root:not([data-mode="light"]):not([data-resolved-mode="light"]) {\n' + declarations(data["themes"]["neutral"]["dark"] | data["status"]["dark"]) + "\n color-scheme:dark;\n} }"
    files["tokens/semantic.css"] = fallback
    for path, text in files.items():
        target = ROOT / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("/* Generated from tokens.json — AI Themes " + data["version"] + " */\n" + text + "\n", encoding="utf-8")
    order = ["tokens/foundation.css", "tokens/semantic.css"] + [p for p in files if p not in {"tokens/foundation.css", "tokens/semantic.css"}]
    css = "\n".join((ROOT / p).read_text(encoding="utf-8") for p in order)
    css += "\n" + (ROOT / "runtime/components.css").read_text(encoding="utf-8")
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    (out / "theme.css").write_text(css, encoding="utf-8")
    (out / "theme.js").write_text((ROOT / "runtime/theme.js").read_text(encoding="utf-8"), encoding="utf-8")
    (ROOT / "theme.css").write_text('@import url("./dist/theme.css");\n', encoding="utf-8")
    print(f"Built AI Themes {data['version']}")


if __name__ == "__main__":
    build()
