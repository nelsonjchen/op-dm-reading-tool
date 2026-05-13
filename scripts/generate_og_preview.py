from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "og-preview.png"
WIDTH = 1200
HEIGHT = 630


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/Library/Fonts/Arial Bold.ttf" if bold else "/Library/Fonts/Arial.ttf",
    ]
    for candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return ImageFont.truetype(str(path), size=size)
    return ImageFont.load_default(size=size)


def text(draw: ImageDraw.ImageDraw, xy: tuple[int, int], value: str, size: int, fill: str, bold: bool = False) -> None:
    draw.text(xy, value, font=font(size, bold), fill=fill)


def tolerance_row(draw: ImageDraw.ImageDraw, y: int, label: str, value_pct: float, value: str) -> None:
    left = 690
    right = 1080
    track_y = y + 52
    text(draw, (left, y), label, 28, "#eaf4ef", True)
    text(draw, (right - 92, y), value, 24, "#9ee6c1", True)
    draw.rounded_rectangle((left, track_y, right, track_y + 18), radius=9, fill="#274b46", outline="#58706c", width=2)
    marker_x = left + int((right - left) * value_pct)
    draw.ellipse((marker_x - 16, track_y - 7, marker_x + 16, track_y + 25), fill="#9ee6c1", outline="#ffffff", width=4)
    text(draw, (left, track_y + 30), "min", 20, "#91a39f", True)
    text(draw, (right - 38, track_y + 30), "max", 20, "#91a39f", True)


def main() -> None:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGB", (WIDTH, HEIGHT), "#eef2f0")
    draw = ImageDraw.Draw(image)

    draw.rounded_rectangle((44, 44, WIDTH - 44, HEIGHT - 44), radius=30, fill="#172226")
    draw.rounded_rectangle((80, 84, 332, 128), radius=22, fill="#d9f2e7")
    text(draw, (106, 94), "openpilot route utility", 22, "#173d39", True)

    text(draw, (80, 166), "Invalid", 72, "#f7fbf9", True)
    text(draw, (80, 244), "calibration", 72, "#f7fbf9", True)
    text(draw, (80, 322), "scanner", 72, "#f7fbf9", True)
    text(draw, (82, 424), "Quick look for current tolerance.", 30, "#cfe0da", False)
    text(draw, (82, 466), "Full qlog scan for invalid calibration.", 30, "#cfe0da", False)

    draw.rounded_rectangle((80, 530, 625, 582), radius=26, fill="#244540")
    text(draw, (108, 543), "ophwug.github.io/op-calibration-reading-tool", 22, "#9ee6c1", True)

    draw.rounded_rectangle((660, 130, 1120, 500), radius=24, fill="#203034", outline="#3a5550", width=2)
    text(draw, (700, 176), "Tolerance landing", 34, "#f7fbf9", True)
    tolerance_row(draw, 250, "Pitch", 0.93, "9.44 deg")
    tolerance_row(draw, 372, "Yaw", 0.53, "0.26 deg")

    image.save(OUT, "PNG", optimize=True)


if __name__ == "__main__":
    main()
