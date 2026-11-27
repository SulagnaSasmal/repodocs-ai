"""RepoDocs AI demo video generator — motion graphics edition.

Design principles:
- No screenshots, no browser frames.
- Full frame-by-frame rendering via PIL so every element is genuinely animated.
- Text elements slide UP and fade in (standard motion-graphics convention).
- Each scene has a custom geometric illustration on the right that animates.
- xfade wipe transitions between scenes.
- Progress bar at the bottom.
"""

import asyncio
import math
import os
import shutil
import subprocess
import textwrap
from pathlib import Path

import edge_tts
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WIDTH, HEIGHT = 1920, 1080
FPS = 30
VOICE = "en-US-JennyNeural"
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "website" / "static" / "demo"
TEMP_DIR = Path(__file__).parent / "tmp"
RUN_DIR = TEMP_DIR / f"run-{os.getpid()}"
VIDEO_PATH = OUTPUT_DIR / "repodocs-ai-demo.mp4"
POSTER_PATH = OUTPUT_DIR / "repodocs-ai-demo-poster.jpg"

# Brand
BG_DARK  = (12, 14, 20)
BG_WARM  = (20, 16, 14)
ACCENT   = (255, 149, 0)
TEXT_HI  = (245, 245, 250)
TEXT_MID = (165, 172, 188)
TEXT_DIM = (90, 98, 115)
DIVIDER  = (38, 44, 58)

# Scene accent colours (right-panel illustration colour)
SCENE_ACCENTS = [
    (255,  80,  50),  # 0  THE PROBLEM   — red-orange
    (255, 130,  40),  # 1  THE PAIN      — deep orange
    (255, 205,  55),  # 2  INTRODUCING   — gold
    ( 70, 210, 120),  # 3  WHAT YOU GET  — green
    ( 50, 205, 180),  # 4  REAL PROOF    — teal
    (165, 105, 245),  # 5  HOW IT WORKS  — purple
    ( 95, 170, 225),  # 6  WHO IT'S FOR  — steel blue
    (255, 149,   0),  # 7  GET STARTED   — orange
]

# Layout
LEFT_X    = 110        # left text margin
TEXT_WRAP = 44         # characters per line for body text
MID_X     = 940        # divider between content and illustration
RIGHT_CX  = 1440       # centre-x of illustration panel
RIGHT_CY  = 530        # centre-y of illustration panel
TOP_BAR   = 6          # accent bar height
LOGO_Y    = 38

CONTENT_TOP = 145
CONTENT_BTM = 945

FONT_SIZES = {
    "logo"  : 24,
    "kicker": 29,
    "title" : 60,
    "body"  : 36,
    "bullet": 32,
    "cta"   : 50,
    "label" : 20,
    "small" : 22,
}

# Maximum pixel width for left-panel title lines (keeps text left of the divider)
TITLE_MAX_PX = MID_X - LEFT_X - 50  # = 780px

# ---------------------------------------------------------------------------
# Scene definitions
# ---------------------------------------------------------------------------

SCENES = [
    {
        "kicker"   : "THE PROBLEM",
        "title"    : "Your API docs are scattered,\ninconsistent, and always behind.",
        "graphic"  : "chaos",
        "narration": (
            "Let's be honest. Your API documentation is scattered across wikis, "
            "Google Docs, and random markdown files. Every team documents differently, "
            "and the docs are always behind the product."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker"   : "THE PAIN",
        "title"    : "Fast drafting helps.\nLoose process still creates risk.",
        "body"     : (
            "Without shared structure, review steps, and release checks, "
            "documentation drifts and teams stop trusting what they publish."
        ),
        "graphic"  : "drift",
        "narration": (
            "Fast drafting helps, but loose process still creates risk. "
            "Without shared structure, clear review steps, and release checks, "
            "documentation drifts away from the product and teams stop trusting what they publish."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker"   : "INTRODUCING",
        "title"    : "RepoDocs AI",
        "body"     : "A repository-based documentation system\nfor SaaS teams shipping APIs.",
        "graphic"  : "orb",
        "narration": (
            "Introducing RepoDocs AI. A repository-based documentation system "
            "for SaaS teams shipping APIs. Everything lives in your repo, "
            "validated by CI, and ready to publish."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker"   : "WHAT YOU GET",
        "title"    : "Everything a docs team needs,\nin one installable system.",
        "bullets"  : [
            "Product and API documentation templates",
            "Drafting and review workflows",
            "Frontmatter and structure validation",
            "Export paths for Confluence, Notion, and PDF",
            "GitHub Pages publishing workflows",
            "A working payments documentation example",
        ],
        "graphic"  : "checklist",
        "narration": (
            "Here is what you get. Product and API documentation templates. "
            "Drafting and review workflows. Built-in structure validation. "
            "Export paths for Confluence, Notion, and PDF, "
            "GitHub Pages publishing workflows, and a working payments example. "
            "All in one installable system."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker"   : "REAL PROOF",
        "title"    : "A Stripe-style payments example.\nNot just templates.",
        "body"     : (
            "Inspect a complete payments API documentation set with "
            "overview, endpoints, authentication, errors, and webhooks, "
            "built from the shipped templates."
        ),
        "graphic"  : "document",
        "narration": (
            "But don't take our word for it. RepoDocs AI ships with a complete "
            "Stripe-style payments API documentation example. "
            "API overview, endpoint docs, authentication, structured errors, "
            "idempotency, and webhooks - all built from the shipped templates."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker"   : "HOW IT WORKS",
        "title"    : "From zero to published docs\nin four steps.",
        "bullets"  : [
            "1. Install: clone, install, validate in 5 minutes",
            "2. Inspect: review the payments example and templates",
            "3. Adapt: copy template packs into your own repo",
            "4. Publish: use the same workflow for review and publishing",
        ],
        "graphic"  : "steps",
        "narration": (
            "Getting started takes four steps. "
            "Install: clone the repo and validate in five minutes. "
            "Inspect: review the payments example and templates. "
            "Adapt: copy the template packs into your own docs repository. "
            "Publish: use the same workflow for review, validation, and publishing."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker"   : "WHO IT'S FOR",
        "title"    : "SaaS API teams that\nship documentation from repos.",
        "body"     : (
            "CTOs, engineering leads, DevRel teams, and technical writers "
            "working in GitHub-based documentation workflows."
        ),
        "graphic"  : "personas",
        "narration": (
            "RepoDocs AI is built for SaaS API teams. CTOs, engineering leads, "
            "developer relations teams, and technical writers who already work "
            "in GitHub-based documentation workflows."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker"   : "GET STARTED",
        "title"    : "Install in minutes.\nSee the product in action.",
        "cta_url"  : "sulagnasasmal.github.io/repodocs-ai",
        "graphic"  : "cta",
        "narration": (
            "Ready to see the difference? Install RepoDocs AI in minutes. "
            "Visit the site, watch the demo, inspect the proof, and start shipping "
            "better API documentation today."
        ),
        "bg": BG_DARK,
    },
]

# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

_font_cache: dict = {}

def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _font_cache:
        return _font_cache[key]
    candidates = [
        ("C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"),
        ("C:/Windows/Fonts/arialbd.ttf"  if bold else "C:/Windows/Fonts/arial.ttf"),
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.isfile(path):
            f = ImageFont.truetype(path, size)
            _font_cache[key] = f
            return f
    f = ImageFont.load_default()
    _font_cache[key] = f
    return f


def _wrap(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width) if text else []


def _wrap_px(text: str, font, max_px: int) -> list[str]:
    """Wrap text so each line fits within max_px using actual font metrics."""
    if not text:
        return []
    _tmp = Image.new("RGBA", (1, 1))
    _d   = ImageDraw.Draw(_tmp)
    words   = text.split()
    lines   = []
    current: list[str] = []
    for word in words:
        test = " ".join(current + [word])
        w    = _d.textbbox((0, 0), test, font=font)[2]
        if w > max_px and current:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return lines or [text]

# ---------------------------------------------------------------------------
# Animation utilities
# ---------------------------------------------------------------------------

def _ease_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1.0 - (1.0 - t) ** 3


def _ease_in_out(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _progress(t: float, delay: float, dur: float = 0.45) -> float:
    """Eased progress [0,1] at global time t, starting after delay, over dur seconds."""
    if t <= delay:
        return 0.0
    return _ease_out((t - delay) / dur)


def _lerp(a, b, p):
    return a + (b - a) * p

# ---------------------------------------------------------------------------
# Alpha-aware drawing
# ---------------------------------------------------------------------------

def _draw_text_a(img: Image.Image, xy, text: str, fnt, rgb, alpha: int) -> None:
    """Draw text with per-pixel alpha onto an RGBA image."""
    if alpha <= 0 or not text:
        return
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    d.text(xy, text, fill=(*rgb, alpha), font=fnt)
    img.alpha_composite(tmp)


def _draw_rect_a(img: Image.Image, box, rgb, alpha: int, radius: int = 0) -> None:
    if alpha <= 0:
        return
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    fill = (*rgb, alpha)
    if radius:
        d.rounded_rectangle(box, radius=radius, fill=fill)
    else:
        d.rectangle(box, fill=fill)
    img.alpha_composite(tmp)


def _draw_ellipse_a(img: Image.Image, box, fill_rgb=None, fill_a=255,
                    outline_rgb=None, outline_a=255, width=1) -> None:
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    fill    = (*fill_rgb,    fill_a)    if fill_rgb    else None
    outline = (*outline_rgb, outline_a) if outline_rgb else None
    d.ellipse(box, fill=fill, outline=outline, width=width)
    img.alpha_composite(tmp)


def _draw_line_a(img: Image.Image, pts, rgb, alpha: int, width: int = 2) -> None:
    if alpha <= 0:
        return
    tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(tmp)
    d.line(pts, fill=(*rgb, alpha), width=width)
    img.alpha_composite(tmp)

# ---------------------------------------------------------------------------
# Scene content elements
# ---------------------------------------------------------------------------

def _content_elements(scene: dict) -> list[dict]:
    """Return ordered list of text elements with their geometry."""
    elems = []

    # Calculate total height for vertical centering
    title_fnt = _font(FONT_SIZES["title"], bold=True)
    h = 0
    if scene.get("kicker"):
        h += 52
    for raw in (scene.get("title") or "").split("\n"):
        h += 78 * len(_wrap_px(raw, title_fnt, TITLE_MAX_PX) or [raw])
    h += 28  # gap after title
    for line in _wrap(scene.get("body", ""), TEXT_WRAP):
        h += 48
    if scene.get("cta_url"):
        h += 72
    for bullet in scene.get("bullets") or []:
        h += 10
        wrapped = _wrap(bullet if bullet[0].isdigit() else f"• {bullet}", TEXT_WRAP - 2,)
        h += 50 * max(len(wrapped), 1)

    avail = CONTENT_BTM - CONTENT_TOP
    y = CONTENT_TOP + max(0, (avail - h) // 2)

    kicker = scene.get("kicker")
    if kicker:
        elems.append({"kind": "kicker", "text": kicker, "x": LEFT_X, "y": y})
        y += 52

    for raw in (scene.get("title") or "").split("\n"):
        for line in (_wrap_px(raw, title_fnt, TITLE_MAX_PX) or [raw]):
            elems.append({"kind": "title", "text": line, "x": LEFT_X, "y": y})
            y += 78

    y += 28

    for line in _wrap(scene.get("body", ""), TEXT_WRAP):
        elems.append({"kind": "body", "text": line, "x": LEFT_X, "y": y})
        y += 48

    cta = scene.get("cta_url", "")
    if cta:
        elems.append({"kind": "cta", "text": cta, "x": LEFT_X, "y": y})
        y += 72

    for bullet in scene.get("bullets") or []:
        y += 10
        prefix = "" if bullet[0].isdigit() else "• "
        wrapped = _wrap(prefix + bullet, TEXT_WRAP - 2)
        elems.append({"kind": "bullet", "lines": wrapped, "x": LEFT_X, "y": y})
        y += 50 * max(len(wrapped), 1)

    return elems


_REVEAL_START  = 0.25
_REVEAL_STEP   = 0.42   # seconds between each element reveal
_SLIDE_DUR     = 0.45
_SLIDE_OFFSET  = 38     # pixels the element starts below its final position


def _reveal_schedule(elems: list, duration: float) -> list[float]:
    times = []
    t = _REVEAL_START
    step = min(_REVEAL_STEP, max(0.28, (duration - 1.2) / max(len(elems), 1)))
    for _ in elems:
        times.append(t)
        t += step
    return times


def _draw_content(img: Image.Image, scene: dict, t: float, duration: float) -> None:
    elems = _content_elements(scene)
    schedule = _reveal_schedule(elems, duration)

    for elem, reveal in zip(elems, schedule):
        p     = _progress(t, reveal, _SLIDE_DUR)
        alpha = int(255 * p)
        y_off = int(_SLIDE_OFFSET * (1.0 - _ease_out(p)))

        kind = elem["kind"]

        if kind == "kicker":
            _draw_text_a(img, (elem["x"], elem["y"] + y_off), elem["text"],
                         _font(FONT_SIZES["kicker"], bold=True), ACCENT, alpha)

        elif kind == "title":
            _draw_text_a(img, (elem["x"], elem["y"] + y_off), elem["text"],
                         _font(FONT_SIZES["title"], bold=True), TEXT_HI, alpha)

        elif kind == "body":
            _draw_text_a(img, (elem["x"], elem["y"] + y_off), elem["text"],
                         _font(FONT_SIZES["body"]), TEXT_MID, alpha)

        elif kind == "cta":
            _draw_text_a(img, (elem["x"], elem["y"] + y_off), elem["text"],
                         _font(FONT_SIZES["cta"], bold=True), ACCENT, alpha)

        elif kind == "bullet":
            by = elem["y"]
            for line in elem["lines"]:
                _draw_text_a(img, (elem["x"], by + y_off), line,
                             _font(FONT_SIZES["bullet"]), TEXT_MID, alpha)
                by += 50

# ---------------------------------------------------------------------------
# Right-panel illustrations (one per graphic type)
# ---------------------------------------------------------------------------

def _draw_chaos(img: Image.Image, t: float, accent: tuple) -> None:
    """Scattered document cards — represents unstructured, chaotic docs."""
    cards = [
        (RIGHT_CX - 190, RIGHT_CY - 230, 260, 160, -14),
        (RIGHT_CX +  50, RIGHT_CY - 270, 220, 140,   8),
        (RIGHT_CX - 260, RIGHT_CY -  40, 200, 150,   5),
        (RIGHT_CX +  90, RIGHT_CY -  90, 240, 155, -10),
        (RIGHT_CX - 140, RIGHT_CY + 110, 230, 145,  12),
        (RIGHT_CX +  30, RIGHT_CY + 160, 210, 140,  -6),
    ]
    labels = ["wiki", "Google Docs", "Notion", "Slack thread", "Git issues", "Old PDF"]
    colors = [
        (50, 58, 75), (42, 52, 65), (58, 48, 70),
        (45, 60, 58), (65, 55, 45), (48, 65, 68),
    ]

    for idx, (cx, cy, w, h, angle_deg, label, color) in enumerate(
        zip(*zip(*[(c[0], c[1], c[2], c[3], c[4]) for c in cards]), labels, colors)
    ):
        reveal = 0.2 + idx * 0.18
        p = _progress(t, reveal, 0.5)
        if p <= 0:
            continue
        alpha_card = int(200 * p)
        alpha_txt  = int(180 * p)

        # Draw card as a rotated rectangle approximation (use bbox + slight angle hint)
        rad = math.radians(angle_deg)
        cos_a, sin_a = math.cos(rad), math.sin(rad)

        corners = [
            (-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)
        ]
        rotated = [
            (cx + cos_a * px - sin_a * py,
             cy + sin_a * px + cos_a * py)
            for px, py in corners
        ]

        # Draw filled polygon
        tmp = Image.new("RGBA", img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(tmp)
        d.polygon(rotated, fill=(*color, alpha_card),
                  outline=(*accent, alpha_card // 2), width=2)
        # Mini lines on the card (simulating text rows)
        for row in range(3):
            row_y = cy - h * 0.15 + row * (h * 0.22)
            line_w = w * (0.6 if row == 0 else 0.4 + 0.15 * row)
            lx = cx - line_w / 2
            rx = cx + line_w / 2
            d.line([(lx, row_y), (rx, row_y)], fill=(100, 112, 130, alpha_card // 2), width=3)
        img.alpha_composite(tmp)

        # Label
        fnt = _font(24, bold=True)
        _draw_text_a(img, (cx - 55, cy - 14), label, fnt,
                     (200, 210, 225), int(230 * p))

    # Slow drift — very subtle rotation of the whole composition over time
    # (We can't rotate the whole image here easily, but the staggered reveal gives motion)


def _draw_drift(img: Image.Image, t: float, accent: tuple) -> None:
    """Two diverging lines — ideal vs reality."""
    cx, cy = RIGHT_CX, RIGHT_CY
    line_len = 340

    p_line = _progress(t, 0.3, 1.0)  # lines draw in over 1 second

    if p_line > 0:
        # Ideal line (straight, accent colour)
        x1, y1 = cx - int(line_len * p_line), cy - 80
        x2, y2 = cx + int(line_len * p_line), cy - 80
        _draw_line_a(img, [(x1, y1), (cx, cy - 80), (x2, y2)],
                     accent, int(220 * p_line), width=5)

        # Ideal label
        if p_line > 0.5:
            _draw_text_a(img, (x2 + 12, y2 - 12), "What it should be",
                         _font(FONT_SIZES["small"]), accent, int(200 * (p_line - 0.5) * 2))

        # Drift line (wavy, muted)
        p2 = max(0.0, p_line - 0.2)
        if p2 > 0:
            pts = []
            steps = int(40 * p2)
            for s in range(steps + 1):
                frac = s / 40
                sx = cx - line_len + int(line_len * 2 * frac * p_line)
                sy = cy + 80 + int(80 * math.sin(frac * math.pi * 3) * frac)
                pts.append((sx, sy))
            if len(pts) >= 2:
                _draw_line_a(img, pts, (200, 80, 60), int(220 * p2), width=4)
            if p2 > 0.6:
                last = pts[-1]
                _draw_text_a(img, (last[0] + 12, last[1] - 8), "What actually ships",
                             _font(FONT_SIZES["small"]), (200, 80, 60),
                             int(200 * (p2 - 0.6) * 2.5))

    # Pulsing gap indicator
    if p_line > 0.7:
        gap_p = _progress(t, 1.5, 0.4)
        if gap_p > 0:
            mid_x = cx + 20
            _draw_line_a(img, [(mid_x, cy - 80), (mid_x, cy + 80 + 30)],
                         (120, 130, 145), int(180 * gap_p), width=2)
            _draw_text_a(img, (mid_x + 10, cy), "the gap",
                         _font(FONT_SIZES["small"]), (120, 130, 145),
                         int(180 * gap_p))


def _draw_orb(img: Image.Image, t: float, accent: tuple) -> None:
    """Central pulsing orb — for the Introducing scene."""
    cx, cy = RIGHT_CX, RIGHT_CY
    pulse = 0.5 + 0.5 * math.sin(t * 2.0 * math.pi * 0.7)

    p_enter = _progress(t, 0.2, 0.8)
    if p_enter <= 0:
        return

    # Outer glow rings
    for ring_i, (base_r, base_a, ring_scale) in enumerate([
        (240, 30, 1.0), (200, 50, 0.95), (165, 80, 0.9),
    ]):
        r = int(base_r * p_enter)
        glow_a = int(base_a * p_enter * (0.8 + 0.2 * pulse if ring_i == 0 else 1.0))
        _draw_ellipse_a(img, [(cx - r, cy - r), (cx + r, cy + r)],
                        outline_rgb=accent, outline_a=glow_a, width=2)

    # Core orb
    core_r = int(120 * p_enter)
    _draw_ellipse_a(img, [(cx - core_r, cy - core_r), (cx + core_r, cy + core_r)],
                    fill_rgb=(25, 30, 42), fill_a=255)
    # Inner accent ring
    inner_r = int(85 * p_enter)
    _draw_ellipse_a(img, [(cx - inner_r, cy - inner_r), (cx + inner_r, cy + inner_r)],
                    outline_rgb=accent, outline_a=int(230 * p_enter), width=4)
    # Centre dot
    dot_r = int(18 * p_enter)
    _draw_ellipse_a(img, [(cx - dot_r, cy - dot_r), (cx + dot_r, cy + dot_r)],
                    fill_rgb=accent, fill_a=int(255 * p_enter))

    # Rotating satellite dots
    for angle_offset in [0, 120, 240]:
        a = math.radians(angle_offset + t * 40)
        sx = cx + int(math.cos(a) * 155 * p_enter)
        sy = cy + int(math.sin(a) * 155 * p_enter)
        sr = int(10 * p_enter)
        _draw_ellipse_a(img, [(sx - sr, sy - sr), (sx + sr, sy + sr)],
                        fill_rgb=accent, fill_a=int(180 * p_enter))


def _draw_checklist(img: Image.Image, t: float, accent: tuple, items: list[str]) -> None:
    """Animated checklist building up item by item."""
    items = items[:6]
    n = len(items)
    row_h = 72
    total_h = n * row_h
    start_y = RIGHT_CY - total_h // 2
    list_x = RIGHT_CX - 240

    for idx, item in enumerate(items):
        reveal = 0.3 + idx * 0.45
        p = _progress(t, reveal, 0.4)
        if p <= 0:
            continue
        alpha = int(255 * p)
        y_off = int(20 * (1 - p))
        row_y = start_y + idx * row_h

        # Row background pill
        _draw_rect_a(img, [(list_x - 10, row_y - 8 + y_off),
                            (list_x + 490, row_y + 46 + y_off)],
                     (35, 42, 58), int(alpha * 0.7), radius=10)

        # Checkmark circle
        cr = 16
        cx_c, cy_c = list_x + 22, row_y + 18 + y_off
        _draw_ellipse_a(img, [(cx_c - cr, cy_c - cr), (cx_c + cr, cy_c + cr)],
                        fill_rgb=accent, fill_a=alpha)
        # Check tick
        tick_a = min(alpha, int(255 * _progress(t, reveal + 0.15, 0.25)))
        _draw_line_a(img,
                     [(cx_c - 8, cy_c), (cx_c - 2, cy_c + 7), (cx_c + 9, cy_c - 6)],
                     (15, 18, 26), tick_a, width=3)

        # Item text — show full text, truncate only if truly long
        short = item if len(item) <= 44 else item[:41] + "…"
        _draw_text_a(img, (list_x + 52, row_y + 4 + y_off), short,
                     _font(24, bold=False), TEXT_HI, alpha)


def _draw_document(img: Image.Image, t: float, accent: tuple) -> None:
    """Animated document/page mockup building up section by section."""
    doc_x  = RIGHT_CX - 220
    doc_y  = RIGHT_CY - 280
    doc_w  = 440
    doc_h  = 560

    p_card = _progress(t, 0.2, 0.5)
    if p_card <= 0:
        return

    # Card background
    _draw_rect_a(img, [(doc_x, doc_y), (doc_x + doc_w, doc_y + doc_h)],
                 (22, 27, 38), int(240 * p_card), radius=18)
    _draw_rect_a(img, [(doc_x, doc_y), (doc_x + doc_w, doc_y + 6)],
                 accent, int(255 * p_card), radius=0)

    # Animated sections
    sections = [
        ("API OVERVIEW",        0.5,  60, 18, 80, accent),
        ("Endpoint reference",  0.75, 90, 14, 60, TEXT_MID),
        ("Authentication",      1.0,  110, 14, 60, TEXT_MID),
        ("Errors & webhooks",   1.25, 130, 14, 60, TEXT_MID),
    ]
    sy = doc_y + 50
    for label, reveal, line_w, fnt_sz, line_off, color in sections:
        p_s = _progress(t, reveal, 0.4)
        if p_s <= 0:
            sy += 80
            continue
        a = int(255 * p_s)
        _draw_text_a(img, (doc_x + 28, sy), label,
                     _font(fnt_sz, bold=(color == accent)), color, a)
        # Body line stubs
        for li in range(2):
            lw = int((line_w - li * 18) * p_s)
            _draw_line_a(img,
                         [(doc_x + 28, sy + 30 + li * 18),
                          (doc_x + 28 + lw, sy + 30 + li * 18)],
                         (70, 80, 100), a // 2, width=4)
        sy += 80

    # Checkmark badge
    p_badge = _progress(t, 2.0, 0.5)
    if p_badge > 0:
        bx, by = doc_x + doc_w - 50, doc_y + doc_h - 50
        br = 22
        _draw_ellipse_a(img, [(bx - br, by - br), (bx + br, by + br)],
                        fill_rgb=accent, fill_a=int(255 * p_badge))
        _draw_line_a(img, [(bx - 10, by), (bx - 3, by + 8), (bx + 12, by - 9)],
                     (15, 18, 26), int(255 * p_badge), width=3)


def _draw_steps(img: Image.Image, t: float, accent: tuple) -> None:
    """Four numbered steps with connecting arrows."""
    labels = ["Install", "Inspect", "Adapt", "Publish"]
    n = len(labels)
    gap = 190
    start_x = RIGHT_CX - gap * (n - 1) // 2
    step_y = RIGHT_CY - 30

    for idx, label in enumerate(labels):
        reveal = 0.25 + idx * 0.5
        p = _progress(t, reveal, 0.45)
        if p <= 0:
            continue
        a = int(255 * p)
        sx = start_x + idx * gap

        # Circle
        cr = 42
        _draw_ellipse_a(img, [(sx - cr, step_y - cr), (sx + cr, step_y + cr)],
                        fill_rgb=(28, 34, 46), fill_a=a,
                        outline_rgb=accent, outline_a=a, width=3)
        # Number
        _draw_text_a(img, (sx - 14, step_y - 22), str(idx + 1),
                     _font(36, bold=True), accent, a)
        # Label below
        _draw_text_a(img, (sx - 35, step_y + cr + 14), label,
                     _font(FONT_SIZES["label"], bold=True), TEXT_MID, a)

        # Arrow to next
        if idx < n - 1:
            p_arrow = _progress(t, reveal + 0.3, 0.3)
            if p_arrow > 0:
                ax1 = sx + cr + 4
                ax2 = sx + gap - cr - 4
                am = (ax1 + ax2) // 2
                _draw_line_a(img, [(ax1, step_y), (ax2, step_y)],
                             (70, 80, 100), int(200 * p_arrow), width=3)
                # Arrow head
                _draw_line_a(img, [(ax2 - 10, step_y - 6), (ax2, step_y), (ax2 - 10, step_y + 6)],
                             (70, 80, 100), int(200 * p_arrow), width=3)

    # Active highlight on first step
    p_hi = _progress(t, 0.2, 0.4)
    if p_hi > 0:
        sx = start_x
        pulse = 0.5 + 0.5 * math.sin(t * 2.5 * math.pi)
        glow_r = int(52 * (0.9 + 0.1 * pulse))
        _draw_ellipse_a(img, [(sx - glow_r, step_y - glow_r), (sx + glow_r, step_y + glow_r)],
                        outline_rgb=accent, outline_a=int(60 * p_hi * pulse), width=6)


def _draw_personas(img: Image.Image, t: float, accent: tuple) -> None:
    """Persona bubbles for the 'Who It's For' scene."""
    personas = [
        ("CTO",            "Sets the direction",           RIGHT_CX - 300, RIGHT_CY - 140),
        ("Engineering Lead","Owns the process",            RIGHT_CX + 60,  RIGHT_CY - 200),
        ("DevRel",         "Writes the content",           RIGHT_CX - 220, RIGHT_CY + 100),
        ("Tech Writer",    "Maintains the system",         RIGHT_CX + 100, RIGHT_CY + 80),
    ]

    for idx, (role, sub, px, py) in enumerate(personas):
        reveal = 0.3 + idx * 0.4
        p = _progress(t, reveal, 0.5)
        if p <= 0:
            continue
        a = int(255 * p)
        y_off = int(20 * (1 - p))

        # Bubble card
        w, h = 270, 86
        _draw_rect_a(img, [(px - w//2, py - h//2 + y_off), (px + w//2, py + h//2 + y_off)],
                     (32, 40, 56), a, radius=16)
        _draw_rect_a(img, [(px - w//2, py - h//2 + y_off), (px - w//2 + 5, py + h//2 + y_off)],
                     accent, a, radius=0)

        # Avatar circle
        avr = 24
        _draw_ellipse_a(img, [(px - w//2 + 18, py - avr + y_off),
                               (px - w//2 + 18 + avr*2, py + avr + y_off)],
                        fill_rgb=accent, fill_a=a // 2,
                        outline_rgb=accent, outline_a=a, width=2)

        # Text
        _draw_text_a(img, (px - w//2 + 60, py - 16 + y_off), role,
                     _font(22, bold=True), TEXT_HI, a)
        _draw_text_a(img, (px - w//2 + 60, py + 8 + y_off), sub,
                     _font(20), TEXT_MID, a)


def _draw_cta_graphic(img: Image.Image, t: float, accent: tuple, url: str) -> None:
    """CTA scene: URL + button + animated underline."""
    cx, cy = RIGHT_CX, RIGHT_CY

    p_enter = _progress(t, 0.2, 0.6)
    if p_enter <= 0:
        return

    a = int(255 * p_enter)
    y_off = int(30 * (1 - p_enter))

    # Decorative large orb background
    orb_r = int(200 * p_enter)
    pulse = 0.5 + 0.5 * math.sin(t * math.pi * 0.8)
    _draw_ellipse_a(img, [(cx - orb_r, cy - orb_r), (cx + orb_r, cy + orb_r)],
                    fill_rgb=(28, 22, 12), fill_a=int(180 * p_enter))
    _draw_ellipse_a(img, [(cx - orb_r, cy - orb_r), (cx + orb_r, cy + orb_r)],
                    outline_rgb=accent, outline_a=int(80 * p_enter * pulse), width=4)

    # URL text
    url_fnt = _font(FONT_SIZES["cta"], bold=True)
    short_url = url.replace("https://", "")
    _draw_text_a(img, (cx - 240, cy - 45 + y_off), short_url, url_fnt, accent, a)

    # Animated underline
    p_line = _progress(t, 0.6, 0.5)
    if p_line > 0:
        line_w = int(480 * p_line)
        _draw_line_a(img, [(cx - 240, cy + 28 + y_off), (cx - 240 + line_w, cy + 28 + y_off)],
                     accent, int(220 * p_line), width=3)

    # CTA button
    p_btn = _progress(t, 1.0, 0.4)
    if p_btn > 0:
        bw, bh = 280, 58
        bx, by = cx - bw // 2, cy + 70 + y_off
        _draw_rect_a(img, [(bx, by), (bx + bw, by + bh)],
                     accent, int(255 * p_btn), radius=14)
        _draw_text_a(img, (bx + 52, by + 14), "Install in 5 minutes",
                     _font(FONT_SIZES["label"], bold=True), (15, 15, 20),
                     int(255 * p_btn))


def _draw_right_graphic(img: Image.Image, scene: dict, scene_idx: int, t: float) -> None:
    accent  = SCENE_ACCENTS[scene_idx % len(SCENE_ACCENTS)]
    graphic = scene.get("graphic", "orb")

    if   graphic == "chaos"    : _draw_chaos(img, t, accent)
    elif graphic == "drift"    : _draw_drift(img, t, accent)
    elif graphic == "orb"      : _draw_orb(img, t, accent)
    elif graphic == "checklist": _draw_checklist(img, t, accent, scene.get("bullets", []))
    elif graphic == "document" : _draw_document(img, t, accent)
    elif graphic == "steps"    : _draw_steps(img, t, accent)
    elif graphic == "personas" : _draw_personas(img, t, accent)
    elif graphic == "cta"      : _draw_cta_graphic(img, t, accent, scene.get("cta_url", ""))
    else                       : _draw_orb(img, t, accent)

# ---------------------------------------------------------------------------
# Chrome elements (logo bar, divider, progress dots)
# ---------------------------------------------------------------------------

def _draw_chrome(img: Image.Image, scene_idx: int) -> None:
    d = ImageDraw.Draw(img)

    # Top accent bar
    d.rectangle([(0, 0), (WIDTH, TOP_BAR)], fill=ACCENT)
    # Logo
    d.text((LEFT_X, LOGO_Y), "RepoDocs AI",
           fill=ACCENT, font=_font(FONT_SIZES["logo"], bold=True))
    # Copyright
    d.text((WIDTH - 310, LOGO_Y), "© Sulagna Sasmal",
           fill=(110, 118, 135), font=_font(20))
    # Bottom accent bar
    d.rectangle([(0, HEIGHT - 4), (WIDTH, HEIGHT)], fill=ACCENT)

    # Subtle vertical divider between content and illustration
    d.line([(MID_X, 70), (MID_X, HEIGHT - 40)], fill=DIVIDER, width=1)

    # Progress dots
    n = len(SCENES)
    dot_r, spacing = 5, 22
    total_w = (n - 1) * spacing
    sx = (WIDTH - total_w) // 2
    y_dot = HEIGHT - 26
    for i in range(n):
        cx = sx + i * spacing
        if i == scene_idx:
            d.ellipse([(cx - dot_r, y_dot - dot_r), (cx + dot_r, y_dot + dot_r)],
                      fill=ACCENT)
        elif i < scene_idx:
            d.ellipse([(cx - dot_r + 1, y_dot - dot_r + 1),
                       (cx + dot_r - 1, y_dot + dot_r - 1)],
                      fill=(110, 120, 135))
        else:
            d.ellipse([(cx - dot_r, y_dot - dot_r), (cx + dot_r, y_dot + dot_r)],
                      outline=(65, 72, 88), width=2)

# ---------------------------------------------------------------------------
# Per-frame renderer
# ---------------------------------------------------------------------------

def render_frame(scene: dict, scene_idx: int, t: float, duration: float) -> Image.Image:
    bg = scene.get("bg", BG_DARK)
    img = Image.new("RGBA", (WIDTH, HEIGHT), (*bg, 255))

    # Scene fade-in / fade-out
    fade_in_dur  = 0.3
    fade_out_dur = 0.35
    fade_out_st  = max(duration - fade_out_dur, 0)
    if t < fade_in_dur:
        overlay_a = int(255 * (1.0 - t / fade_in_dur))
        _draw_rect_a(img, [(0, 0), (WIDTH, HEIGHT)], bg, overlay_a)
    elif t > fade_out_st:
        overlay_a = int(255 * (t - fade_out_st) / fade_out_dur)
        _draw_rect_a(img, [(0, 0), (WIDTH, HEIGHT)], bg, min(overlay_a, 255))

    # Chrome (static per frame — fast, uses ImageDraw directly)
    _draw_chrome(img, scene_idx)

    # Right illustration
    _draw_right_graphic(img, scene, scene_idx, t)

    # Left text content
    _draw_content(img, scene, t, duration)

    return img.convert("RGB")

# ---------------------------------------------------------------------------
# ffmpeg helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True, stderr=subprocess.DEVNULL)


def _probe_duration(path: Path) -> float:
    r = subprocess.run(
        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        check=True, capture_output=True, text=True,
    )
    return float(r.stdout.strip())


def _ensure_ffmpeg() -> None:
    for exe in ("ffmpeg", "ffprobe"):
        if shutil.which(exe) is None:
            raise RuntimeError(f"{exe} not found in PATH.")


def clean_temp_dir() -> None:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    for p in TEMP_DIR.iterdir():
        if p == RUN_DIR:
            continue
        if p.is_dir():
            shutil.rmtree(p, ignore_errors=True)
        else:
            try:
                p.unlink()
            except PermissionError:
                pass

# ---------------------------------------------------------------------------
# Audio generation
# ---------------------------------------------------------------------------

async def generate_audio(scenes: list[dict]) -> list[Path]:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, scene in enumerate(scenes):
        out = RUN_DIR / f"scene_{i:02d}.mp3"
        comm = edge_tts.Communicate(scene["narration"], VOICE, rate="-5%")
        await comm.save(str(out))
        paths.append(out)
        print(f"  [audio] scene {i}: {out.name}")
    return paths

# ---------------------------------------------------------------------------
# Per-scene video encoding (pipe frames directly to ffmpeg)
# ---------------------------------------------------------------------------

def _encode_scene(
    scene: dict,
    scene_idx: int,
    audio_path: Path,
    seg_path: Path,
    duration: float,
) -> None:
    total_frames = int(duration * FPS)

    # Open ffmpeg process expecting raw RGB24 frames on stdin
    cmd = [
        "ffmpeg", "-y",
        "-f", "rawvideo", "-vcodec", "rawvideo",
        "-s", f"{WIDTH}x{HEIGHT}", "-pix_fmt", "rgb24",
        "-r", str(FPS), "-i", "pipe:0",
        "-i", str(audio_path),
        "-c:v", "libx264", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        "-t", f"{duration:.3f}",
        str(seg_path),
    ]

    err_path = seg_path.with_suffix(".ffmpeg_err.txt")
    with open(err_path, "w") as err_fh:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=err_fh)
        try:
            for f in range(total_frames):
                t = f / FPS
                frame = render_frame(scene, scene_idx, t, duration)
                proc.stdin.write(frame.tobytes())
            proc.stdin.close()
            proc.wait()
            if proc.returncode != 0:
                err_txt = err_path.read_text(errors="replace")
                raise RuntimeError(f"ffmpeg failed (scene {scene_idx}):\n{err_txt}")
        except Exception:
            proc.kill()
            raise

# ---------------------------------------------------------------------------
# Concatenation with xfade
# ---------------------------------------------------------------------------

def _concat_xfade(seg_paths: list[Path], durations: list[float]) -> None:
    n = len(seg_paths)
    XFADE = 0.4

    cmd = ["ffmpeg", "-y"]
    for sp in seg_paths:
        cmd.extend(["-i", str(sp)])

    parts = []
    cumulative = 0.0
    cur_v = "[0:v]"
    cur_a = "[0:a]"

    for i in range(1, n):
        cumulative += durations[i - 1] - XFADE
        nxt_v = f"[xv{i}]" if i < n - 1 else "[vout]"
        nxt_a = f"[xa{i}]" if i < n - 1 else "[aout]"
        parts.append(
            f"{cur_v}[{i}:v]xfade=transition=wipeleft:"
            f"duration={XFADE}:offset={cumulative:.3f}{nxt_v}"
        )
        parts.append(f"{cur_a}[{i}:a]acrossfade=d={XFADE}{nxt_a}")
        cur_v = nxt_v
        cur_a = nxt_a

    cmd.extend([
        "-filter_complex", ";".join(parts),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "medium", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
        str(VIDEO_PATH),
    ])
    _run(cmd)

# ---------------------------------------------------------------------------
# Poster
# ---------------------------------------------------------------------------

def render_poster(scene: dict, scene_idx: int, out_path: Path) -> None:
    # Use t=1.5 so most elements are fully revealed
    img = render_frame(scene, scene_idx, 1.5, 20.0)
    img.save(out_path, format="JPEG", quality=92)

# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def compose_video(scenes: list[dict], audio_paths: list[Path]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)

    seg_paths  = []
    durations  = []

    for i, (scene, audio) in enumerate(zip(scenes, audio_paths)):
        seg = RUN_DIR / f"scene_{i:02d}.mp4"
        dur = _probe_duration(audio) + 0.9
        _encode_scene(scene, i, audio, seg, dur)
        seg_paths.append(seg)
        durations.append(dur)
        print(f"  [video] scene {i}: {dur:.1f}s  ({int(dur * FPS)} frames)", flush=True)

    print("\n  [concat] applying xfade transitions …")
    _concat_xfade(seg_paths, durations)

    render_poster(SCENES[2], 2, POSTER_PATH)
    return VIDEO_PATH


def main():
    print("=" * 60)
    print("  RepoDocs AI — Motion Graphics Demo Generator")
    print("=" * 60)

    _ensure_ffmpeg()
    clean_temp_dir()

    print("\n[1/3] Generating narration audio …")
    audio_paths = asyncio.run(generate_audio(SCENES))

    print("\n[2/3] Rendering and encoding scenes …")
    output = compose_video(SCENES, audio_paths)

    print("\n[3/3] Done!")
    print(f"  Output : {output}")
    print(f"  Size   : {output.stat().st_size / (1024*1024):.1f} MB")
    print("=" * 60)


if __name__ == "__main__":
    main()
