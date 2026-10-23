"""Export the existing five designs for ChatGPT's PNG upload field only."""
import io
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "assets" / "plugin-icons"
SOURCES = [
    ("01-sprout-256.png", "ygpt-local-512.png", "Current sprout"),
    ("02-green-y-256.png", "ygpt-local-green-y-512.png", "Green y_"),
    ("03-sky-y-256.png", "ygpt-local-sky-y-512.png", "Sky y_"),
    ("04-classic-green-256.png", "ygpt-local-green-512.png", "Classic green Y"),
    ("05-signature-256.png", "ygpt-local-signature-512.png", "Signature"),
]


def main():
    DEST.mkdir(exist_ok=True)
    rows = []
    for name, source, label in SOURCES:
        image = Image.open(ROOT / "assets" / "brand" / source).convert("RGBA")
        image = image.resize((256, 256), Image.Resampling.LANCZOS)
        for colors in (256, 192, 160, 128, 96, 64, 48, 32):
            out = io.BytesIO()
            image.quantize(colors, method=Image.Quantize.FASTOCTREE).save(out, "PNG", optimize=True)
            if len(out.getvalue()) < 10000:
                (DEST / name).write_bytes(out.getvalue())
                rows.append(dict(file=name, design=label, width=256, height=256, bytes=len(out.getvalue())))
                break
        else:
            raise RuntimeError("Cannot meet plugin upload size limit: " + name)
    (DEST / "icons.json").write_text(json.dumps(rows, indent=2) + "\n", encoding="utf-8")
    (DEST / "README.md").write_text(
        "# ChatGPT plugin upload icons\n\nOnly the PNGs in this folder are for the plugin upload field. "
        "Each design is 256 x 256 pixels and strictly below 10,000 bytes. "
        "Choose the design matching your approval-card choice. App windows, approval cards, "
        "browser-extension artwork and Windows icons use the separate HD assets.\n\n" +
        "\n".join("- {}: {} ({} bytes)".format(r["file"], r["design"], r["bytes"]) for r in rows) + "\n",
        encoding="utf-8")
    # The plugin package's logo obeys the same upload limit.
    (ROOT / "plugin" / "assets" / "logo.png").write_bytes((DEST / rows[0]["file"]).read_bytes())
    print(json.dumps(rows))


if __name__ == "__main__":
    main()
