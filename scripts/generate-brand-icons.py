"""Package the supplied full VANIGA logo for login and installation surfaces."""
import argparse
from pathlib import Path

from PIL import Image, ImageOps

parser = argparse.ArgumentParser()
parser.add_argument("logo", type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
source = Image.open(args.logo).convert("RGBA")
art = Image.new("RGB", source.size, "white")
art.paste(source, mask=source.getchannel("A"))
for app, modes in [("admin-web", ["tenant", "platform"]), ("customer-portal", ["portal"])]:
    public = root / "apps" / app / "public"
    for name in ["vaniga-logo.png", "vaniga-icon.png"]:
        art.save(public / "brand" / name, optimize=True)
    for mode in modes:
        for size in [180, 192, 512]:
            art.resize((size, size), Image.Resampling.LANCZOS).save(
                public / "pwa" / f"vaniga-{mode}-{size}.png", optimize=True)
        # Keep the complete square artwork inside the circular mask safe area.
        maskable = Image.new("RGB", (512, 512), "white")
        inset = ImageOps.contain(art, (358, 358), Image.Resampling.LANCZOS)
        maskable.paste(inset, ((512 - inset.width) // 2, (512 - inset.height) // 2))
        maskable.save(public / "pwa" / f"vaniga-{mode}-maskable.png", optimize=True)
print("Updated login, favicon, Apple touch and PWA icons for all three consoles.")
