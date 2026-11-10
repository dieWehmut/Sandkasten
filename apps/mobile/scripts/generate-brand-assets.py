#!/usr/bin/env python3
"""Regenerate Android and web branding from the desktop icon. Requires Pillow."""

from pathlib import Path
from shutil import copyfile

from PIL import Image, ImageDraw


MOBILE = Path(__file__).resolve().parents[1]
SOURCE = MOBILE.parent / "desktop/build/icon.png"
RES = MOBILE / "android/app/src/main/res"


def save(image: Image.Image, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, optimize=True)


def rounded(source: Image.Image, size: int) -> Image.Image:
    image = source.resize((size, size), Image.Resampling.LANCZOS)
    mask = Image.new("L", image.size)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=size * 0.23, fill=255
    )
    image.putalpha(mask)
    return image


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    for obsolete in RES.glob("drawable*/splash.png"):
        obsolete.unlink()
    for obsolete in (
        "drawable-v24/ic_launcher_foreground.xml",
        "drawable/ic_launcher_background.xml",
    ):
        (RES / obsolete).unlink(missing_ok=True)

    web_icon = MOBILE / "src/assets/brand-icon.png"
    web_icon.parent.mkdir(parents=True, exist_ok=True)
    copyfile(SOURCE, web_icon)
    save(source.resize((64, 64), Image.Resampling.LANCZOS), MOBILE / "public/favicon.png")

    for density, scale in (
        ("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)
    ):
        folder = RES / f"mipmap-{density}"
        size = int(48 * scale)
        legacy = source.resize((size, size), Image.Resampling.LANCZOS)
        save(legacy, folder / "ic_launcher.png")
        save(legacy, folder / "ic_launcher_round.png")
        canvas_size, icon_size = int(108 * scale), int(72 * scale)
        foreground = Image.new("RGBA", (canvas_size, canvas_size))
        inset = (canvas_size - icon_size) // 2
        foreground.alpha_composite(rounded(source, icon_size), (inset, inset))
        save(foreground, folder / "ic_launcher_foreground.png")

    splash = Image.new("RGBA", (1152, 1152))
    splash.alpha_composite(rounded(source, 704), (224, 224))
    save(splash, RES / "drawable-nodpi/brand_splash_icon.png")
    print(f"Mobile branding generated from {SOURCE}")


if __name__ == "__main__":
    main()
