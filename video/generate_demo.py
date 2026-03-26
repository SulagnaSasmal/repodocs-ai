"""RepoDocs AI demo video generator — animated edition.

Key improvements over the previous version:
- Real website screenshots shown in a browser-frame mockup on the right panel
- Text elements slide in from the left instead of plain fade-in
- xfade wipe transitions between every scene
- Animated progress dots at the bottom of each frame
- Intro / outro scenes with full-width layout
"""

import asyncio
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
SCREENSHOTS_DIR = Path(__file__).parent / "screenshots"

# Brand colours
BG_DARK = (15, 17, 23)
BG_WARM = (30, 27, 24)
BG_SPLIT = (18, 21, 28)       # slightly blue-tinted dark for split scenes
ACCENT = (255, 149, 0)
ACCENT_COOL = (56, 152, 255)
TEXT_PRIMARY = (245, 245, 250)
TEXT_MUTED = (170, 175, 190)
KICKER_COLOR = ACCENT

# Per-scene accent ring / highlight colours
_RING_COLORS = [
    (255, 80,  50),   # 0  THE PROBLEM     red-orange
    (255, 120, 40),   # 1  THE PAIN        deep orange
    (255, 200, 50),   # 2  INTRODUCING     gold
    (80,  200, 120),  # 3  WHAT YOU GET    green
    (56,  200, 180),  # 4  REAL PROOF      teal
    (150, 100, 230),  # 5  HOW IT WORKS    purple
    (100, 170, 220),  # 6  WHO IT'S FOR    steel blue
    (255, 149, 0),    # 7  GET STARTED     brand orange
]

# Which screenshot file to show in the right panel (None = decorative graphic)
_SCENE_SCREENSHOTS = [
    None,              # 0  THE PROBLEM
    None,              # 1  THE PAIN
    "homepage.png",    # 2  INTRODUCING
    "homepage.png",    # 3  WHAT YOU GET
    "payments.png",    # 4  REAL PROOF
    "installation.png",# 5  HOW IT WORKS
    "docs.png",        # 6  WHO IT'S FOR
    "homepage.png",    # 7  GET STARTED
]

SCENES = [
    {
        "kicker": "THE PROBLEM",
        "title": "Your API docs are scattered,\ninconsistent, and always behind.",
        "narration": (
            "Let's be honest. Your API documentation is scattered across wikis, "
            "Google Docs, and random markdown files. Every team documents differently, "
            "and the docs are always behind the product."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker": "THE PAIN",
        "title": "Fast drafting helps.\nLoose process still creates risk.",
        "body": (
            "Without shared structure, review steps, and release checks, "
            "documentation drifts and teams stop trusting what they publish."
        ),
        "narration": (
            "Fast drafting helps, but loose process still creates risk. Without shared structure, "
            "clear review steps, and release checks, documentation drifts away from the product "
            "and teams stop trusting what they publish."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker": "INTRODUCING",
        "title": "RepoDocs AI",
        "body": "A repository-based documentation system\nfor SaaS teams shipping APIs.",
        "narration": (
            "Introducing RepoDocs AI. A repository-based documentation system "
            "for SaaS teams shipping APIs. Everything lives in your repo, "
            "validated by CI, and ready to publish."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker": "WHAT YOU GET",
        "title": "Everything a docs team needs,\nin one installable system.",
        "bullets": [
            "Product and API documentation templates",
            "Drafting and review workflows",
            "Frontmatter and structure validation",
            "Export paths for Confluence, Notion, and PDF",
            "GitHub Pages publishing workflows",
            "A working payments documentation example",
        ],
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
        "kicker": "REAL PROOF",
        "title": "A Stripe-style payments example.\nNot just templates.",
        "body": (
            "Inspect a complete payments API documentation set with "
            "overview, endpoints, authentication, errors, and webhooks, "
            "built from the shipped templates."
        ),
        "narration": (
            "But don't take our word for it. RepoDocs AI ships with a complete "
            "Stripe-style payments API documentation example. API overview, "
            "endpoint docs, authentication, structured errors, idempotency, "
            "and webhooks. All built from the shipped templates and review flow."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker": "HOW IT WORKS",
        "title": "From zero to published docs\nin four steps.",
        "bullets": [
            "1. Install — clone, install, validate in 5 minutes",
            "2. Inspect — review the payments example and templates",
            "3. Adapt — copy template packs into your own repo",
            "4. Publish — use the same workflow for review and publishing",
        ],
        "narration": (
            "Getting started takes four steps. "
            "First, install. Clone the repo, install dependencies, and validate, all in five minutes. "
            "Second, inspect. Review the payments example and templates to see the quality. "
            "Third, adapt. Copy the template packs into your own docs repository. "
            "Fourth, publish. Use the same repository workflow for review, validation, and publishing."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker": "WHO IT'S FOR",
        "title": "SaaS API teams that\nship documentation from repos.",
        "body": (
            "CTOs, engineering leads, DevRel teams, and technical writers "
            "working in GitHub-based documentation workflows."
        ),
        "narration": (
            "RepoDocs AI is built for SaaS API teams. CTOs, engineering leads, "
            "developer relations teams, and technical writers who already work "
            "in GitHub-based documentation workflows."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker": "GET STARTED",
        "title": "Install in minutes.\nSee the product in action.",
        "cta_url": "sulagnasasmal.github.io/repodocs-ai",
        "narration": (
            "Ready to see the difference? Install RepoDocs AI in minutes. "
            "Visit the site, watch the demo, inspect the proof, and start shipping "
            "better API documentation today."
        ),
        "bg": BG_DARK,
    },
]

FONT_SIZES = {
    "logo": 26,
    "kicker": 30,
    "title": 68,
    "body": 38,
    "bullet": 34,
    "cta": 52,
    "progress": 18,
}

# Left-panel content area
LEFT_PANEL_RIGHT = 920   # content lives in x: 0..920
CONTENT_LEFT = 100
CONTENT_TOP = 120
CONTENT_BOTTOM = 960


# ---------------------------------------------------------------------------
# Font helpers
# ---------------------------------------------------------------------------

def _get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "C:/Windows/Fonts/segoeui.ttf" if not bold else "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arial.ttf" if not bold else "C:/Windows/Fonts/arialbd.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def _wrap_lines(text: str, width: int) -> list[str]:
    return textwrap.wrap(text, width=width) if text else []


# ---------------------------------------------------------------------------
# Content height calculation (used for vertical centering)
# ---------------------------------------------------------------------------

def _calc_content_height(scene: dict) -> int:
    h = 0
    if scene.get("kicker"):
        h += 60
    for _ in scene.get("title", "").split("\n"):
        h += 88
    h += 32
    body_lines = _wrap_lines(scene.get("body", ""), 52)
    if body_lines:
        h += 52 * len(body_lines)
    if scene.get("cta_url"):
        h += 80
    for bullet in scene.get("bullets") or []:
        wrapped = textwrap.wrap(
            bullet if bullet[0].isdigit() else f"• {bullet}",
            width=50,
            subsequent_indent="  ",
        )
        h += 10 + 54 * max(len(wrapped), 1)
    return h


# ---------------------------------------------------------------------------
# Scene elements list (left-panel text blocks)
# ---------------------------------------------------------------------------

def _scene_elements(scene: dict) -> list[dict]:
    elements: list[dict] = []

    content_height = _calc_content_height(scene)
    available = CONTENT_BOTTOM - CONTENT_TOP
    y_cursor = CONTENT_TOP + max(0, (available - content_height) // 2)

    kicker = scene.get("kicker")
    if kicker:
        elements.append({
            "kind": "kicker",
            "lines": [kicker],
            "x": CONTENT_LEFT,
            "y": y_cursor,
            "font": _get_font(FONT_SIZES["kicker"], bold=True),
            "fill": KICKER_COLOR,
            "line_gap": 36,
        })
        y_cursor += 60

    for line in scene.get("title", "").split("\n"):
        elements.append({
            "kind": "title",
            "lines": [line],
            "x": CONTENT_LEFT,
            "y": y_cursor,
            "font": _get_font(FONT_SIZES["title"], bold=True),
            "fill": TEXT_PRIMARY,
            "line_gap": 78,
        })
        y_cursor += 88

    y_cursor += 32

    body_lines = _wrap_lines(scene.get("body", ""), 52)
    if body_lines:
        elements.append({
            "kind": "body",
            "lines": body_lines,
            "x": CONTENT_LEFT,
            "y": y_cursor,
            "font": _get_font(FONT_SIZES["body"]),
            "fill": TEXT_MUTED,
            "line_gap": 50,
        })
        y_cursor += 52 * len(body_lines)

    cta_url = scene.get("cta_url", "")
    if cta_url:
        elements.append({
            "kind": "cta",
            "lines": [cta_url],
            "x": CONTENT_LEFT,
            "y": y_cursor,
            "font": _get_font(FONT_SIZES["cta"], bold=True),
            "fill": ACCENT,
            "line_gap": 72,
        })
        y_cursor += 80

    for bullet in scene.get("bullets") or []:
        y_cursor += 10
        wrapped = textwrap.wrap(
            bullet if bullet[0].isdigit() else f"• {bullet}",
            width=50,
            subsequent_indent="  ",
        )
        elements.append({
            "kind": "bullet",
            "lines": wrapped,
            "x": CONTENT_LEFT,
            "y": y_cursor,
            "font": _get_font(FONT_SIZES["bullet"]),
            "fill": TEXT_MUTED,
            "line_gap": 44,
        })
        y_cursor += 54 * max(len(wrapped), 1)

    return elements


def _draw_block(draw: ImageDraw.ImageDraw, element: dict) -> None:
    font = element["font"]
    x_pos = element["x"]
    y_pos = element["y"]
    for line in element["lines"]:
        draw.text((x_pos, y_pos), line, fill=element["fill"], font=font)
        y_pos += element["line_gap"]


# ---------------------------------------------------------------------------
# Right panel: browser mockup with real screenshot
# ---------------------------------------------------------------------------

_SCREENSHOT_CACHE: dict[str, Image.Image] = {}

BROWSER_LEFT = 980
BROWSER_TOP = 80
BROWSER_RIGHT = WIDTH - 40
BROWSER_BOTTOM = HEIGHT - 80
BROWSER_W = BROWSER_RIGHT - BROWSER_LEFT   # ~900
BROWSER_H = BROWSER_BOTTOM - BROWSER_TOP   # ~920
CHROME_H = 44   # address bar height


def _load_screenshot(filename: str) -> Image.Image | None:
    if filename in _SCREENSHOT_CACHE:
        return _SCREENSHOT_CACHE[filename]
    path = SCREENSHOTS_DIR / filename
    if not path.exists():
        return None
    img = Image.open(path).convert("RGB")
    _SCREENSHOT_CACHE[filename] = img
    return img


def _draw_browser_panel(img: Image.Image, screenshot_filename: str | None, ring_color: tuple) -> None:
    """Draw a browser chrome + screenshot on the right half of img."""
    draw = ImageDraw.Draw(img)

    # Outer card shadow / glow
    glow = (*ring_color, 35)
    for inset in range(6, 0, -1):
        draw.rounded_rectangle(
            [(BROWSER_LEFT - inset, BROWSER_TOP - inset),
             (BROWSER_RIGHT + inset, BROWSER_BOTTOM + inset)],
            radius=18 + inset,
            outline=glow,
            width=1,
        )

    # Browser frame background
    draw.rounded_rectangle(
        [(BROWSER_LEFT, BROWSER_TOP), (BROWSER_RIGHT, BROWSER_BOTTOM)],
        radius=16,
        fill=(24, 28, 36),
        outline=(60, 68, 82),
        width=2,
    )

    # Chrome / address bar strip
    chrome_bottom = BROWSER_TOP + CHROME_H
    draw.rounded_rectangle(
        [(BROWSER_LEFT, BROWSER_TOP), (BROWSER_RIGHT, chrome_bottom + 6)],
        radius=16,
        fill=(32, 36, 46),
    )
    # Flat bottom on chrome strip
    draw.rectangle(
        [(BROWSER_LEFT, chrome_bottom - 6), (BROWSER_RIGHT, chrome_bottom)],
        fill=(32, 36, 46),
    )
    draw.line(
        [(BROWSER_LEFT, chrome_bottom), (BROWSER_RIGHT, chrome_bottom)],
        fill=(52, 58, 72),
        width=1,
    )

    # Traffic-light dots
    dot_y = BROWSER_TOP + CHROME_H // 2
    for i, dot_color in enumerate([(255, 95, 87), (255, 189, 46), (39, 201, 63)]):
        draw.ellipse(
            [(BROWSER_LEFT + 16 + i * 22 - 6, dot_y - 6),
             (BROWSER_LEFT + 16 + i * 22 + 6, dot_y + 6)],
            fill=dot_color,
        )

    # Address bar pill
    addr_left = BROWSER_LEFT + 80
    addr_right = BROWSER_RIGHT - 20
    addr_top = BROWSER_TOP + 9
    addr_bottom = BROWSER_TOP + CHROME_H - 9
    draw.rounded_rectangle(
        [(addr_left, addr_top), (addr_right, addr_bottom)],
        radius=6,
        fill=(20, 24, 32),
        outline=(70, 78, 95),
        width=1,
    )
    addr_font = _get_font(14)
    url_text = "sulagnasasmal.github.io/repodocs-ai"
    draw.text((addr_left + 10, addr_top + 4), url_text, fill=(120, 135, 155), font=addr_font)

    # Screenshot area
    ss_top = chrome_bottom + 1
    ss_left = BROWSER_LEFT + 2
    ss_right = BROWSER_RIGHT - 2
    ss_bottom = BROWSER_BOTTOM - 2
    ss_w = ss_right - ss_left
    ss_h = ss_bottom - ss_top

    if screenshot_filename:
        shot = _load_screenshot(screenshot_filename)
        if shot:
            # Fit screenshot: scale to fill width, then crop height
            scale = ss_w / shot.width
            new_h = int(shot.height * scale)
            resized = shot.resize((ss_w, max(new_h, ss_h)), Image.LANCZOS)
            cropped = resized.crop((0, 0, ss_w, ss_h))
            # Paste into rounded corner area
            img.paste(cropped, (ss_left, ss_top))
        else:
            draw.rectangle([(ss_left, ss_top), (ss_right, ss_bottom)], fill=(20, 24, 32))
    else:
        # Decorative placeholder for scenes without a screenshot
        draw.rectangle([(ss_left, ss_top), (ss_right, ss_bottom)], fill=(18, 22, 30))
        _draw_decorative_placeholder(draw, ss_left, ss_top, ss_w, ss_h, ring_color)

    # Round-corner mask: draw the outer card frame on top to re-clip corners
    draw.rounded_rectangle(
        [(BROWSER_LEFT, BROWSER_TOP), (BROWSER_RIGHT, BROWSER_BOTTOM)],
        radius=16,
        outline=(60, 68, 82),
        width=2,
    )


def _draw_decorative_placeholder(
    draw: ImageDraw.ImageDraw,
    x: int, y: int, w: int, h: int,
    ring_color: tuple,
) -> None:
    """Fallback graphic for scenes without a screenshot."""
    cx, cy = x + w // 2, y + h // 2
    r_outer = min(w, h) // 3
    draw.ellipse(
        [(cx - r_outer, cy - r_outer), (cx + r_outer, cy + r_outer)],
        fill=(30, 38, 48),
        outline=(70, 82, 95),
        width=2,
    )
    r_inner = int(r_outer * 0.62)
    draw.ellipse(
        [(cx - r_inner, cy - r_inner), (cx + r_inner, cy + r_inner)],
        outline=ring_color,
        width=5,
    )
    r_core = int(r_inner * 0.42)
    draw.ellipse(
        [(cx - r_core, cy - r_core), (cx + r_core, cy + r_core)],
        outline=(*ring_color, 80),
        width=2,
    )
    # Decorative horizontal lines below orb
    line_y = cy + r_outer + 32
    for idx, length in enumerate([220, 170, 190]):
        lx = cx - length // 2
        draw.line([(lx, line_y + idx * 34), (lx + length, line_y + idx * 34)],
                  fill=(80, 95, 110) if idx == 0 else (55, 68, 80), width=5)


# ---------------------------------------------------------------------------
# Progress dots
# ---------------------------------------------------------------------------

def _draw_progress(draw: ImageDraw.ImageDraw, scene_index: int, total: int) -> None:
    dot_r = 5
    spacing = 22
    total_w = (total - 1) * spacing + dot_r * 2
    start_x = (WIDTH - total_w) // 2
    y = HEIGHT - 30
    for i in range(total):
        cx = start_x + i * spacing + dot_r
        if i == scene_index:
            draw.ellipse([(cx - dot_r, y - dot_r), (cx + dot_r, y + dot_r)], fill=ACCENT)
        elif i < scene_index:
            draw.ellipse([(cx - dot_r + 1, y - dot_r + 1), (cx + dot_r - 1, y + dot_r - 1)],
                         fill=(120, 130, 140))
        else:
            draw.ellipse([(cx - dot_r, y - dot_r), (cx + dot_r, y + dot_r)],
                         outline=(70, 80, 92), width=2)


# ---------------------------------------------------------------------------
# Background rendering
# ---------------------------------------------------------------------------

def render_background(scene: dict, scene_index: int = 0) -> Image.Image:
    bg = scene.get("bg", BG_DARK)
    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    # Top accent bar
    draw.rectangle([(0, 0), (WIDTH, 6)], fill=ACCENT)
    # Logo
    draw.text((CONTENT_LEFT, 38), "RepoDocs AI",
              fill=ACCENT, font=_get_font(FONT_SIZES["logo"], bold=True))
    # Bottom accent bar
    draw.rectangle([(0, HEIGHT - 4), (WIDTH, HEIGHT)], fill=ACCENT)

    # Vertical divider between left and right panels
    draw.line([(LEFT_PANEL_RIGHT, 70), (LEFT_PANEL_RIGHT, HEIGHT - 40)],
              fill=(45, 52, 65), width=1)

    ring_color = _RING_COLORS[scene_index % len(_RING_COLORS)]
    _draw_browser_panel(img, _SCENE_SCREENSHOTS[scene_index], ring_color)

    # INTRODUCING scene: extra side accent bars
    if scene.get("kicker") == "INTRODUCING":
        draw.rectangle([(0, 0), (8, HEIGHT)], fill=ACCENT)
        draw.rectangle([(WIDTH - 8, 0), (WIDTH, HEIGHT)], fill=ACCENT)

    _draw_progress(draw, scene_index, len(SCENES))

    return img


# ---------------------------------------------------------------------------
# Overlay rendering (transparent PNG per text element — slide-in source)
# ---------------------------------------------------------------------------

def render_overlay(element: dict, out_path: Path) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    _draw_block(draw, element)
    image.save(out_path, format="PNG")


def render_poster(scene: dict, scene_index: int, out_path: Path) -> None:
    image = render_background(scene, scene_index).convert("RGBA")
    draw = ImageDraw.Draw(image)
    for element in _scene_elements(scene):
        _draw_block(draw, element)
    image.convert("RGB").save(out_path, format="JPEG", quality=92)


# ---------------------------------------------------------------------------
# ffmpeg helpers
# ---------------------------------------------------------------------------

def _run_command(command: list[str]) -> None:
    subprocess.run(command, check=True, stderr=subprocess.DEVNULL)


def _probe_duration(media_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "quiet",
         "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1",
         str(media_path)],
        check=True, capture_output=True, text=True,
    )
    return float(result.stdout.strip())


def _ensure_ffmpeg() -> None:
    for exe in ("ffmpeg", "ffprobe"):
        if shutil.which(exe) is None:
            raise RuntimeError(f"{exe} is required but was not found in PATH.")


def clean_temp_dir() -> None:
    TEMP_DIR.mkdir(parents=True, exist_ok=True)
    for path in TEMP_DIR.iterdir():
        if path == RUN_DIR:
            continue
        if path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        else:
            try:
                path.unlink()
            except PermissionError:
                continue


# ---------------------------------------------------------------------------
# TTS audio generation
# ---------------------------------------------------------------------------

async def generate_audio(scenes: list[dict]) -> list[Path]:
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    audio_paths: list[Path] = []
    for i, scene in enumerate(scenes):
        out_path = RUN_DIR / f"scene_{i:02d}.mp3"
        communicate = edge_tts.Communicate(scene["narration"], VOICE, rate="-5%")
        await communicate.save(str(out_path))
        audio_paths.append(out_path)
        print(f"  [audio] scene {i}: {out_path.name}")
    return audio_paths


# ---------------------------------------------------------------------------
# Reveal schedule (staggered slide-in timings)
# ---------------------------------------------------------------------------

def _reveal_schedule(count: int, duration: float) -> list[float]:
    if count == 0:
        return []
    start = 0.3
    available = max(duration - 1.1, 0.8)
    step = min(0.85, max(0.32, available / max(count, 1)))
    return [round(start + i * step, 2) for i in range(count)]


# ---------------------------------------------------------------------------
# Per-scene video composition
#
# Animation: each text overlay slides in from the LEFT side of the screen.
# The background has a subtle zoompan drift.
# Scenes fade in/out at their edges.
# ---------------------------------------------------------------------------

def _compose_scene(
    i: int,
    scene: dict,
    audio_path: Path,
    segment_path: Path,
) -> None:
    background_path = RUN_DIR / f"scene_{i:02d}_bg.png"
    render_background(scene, i).save(background_path, format="PNG")

    elements = _scene_elements(scene)
    overlay_paths: list[Path] = []
    for ei, element in enumerate(elements):
        op = RUN_DIR / f"scene_{i:02d}_ov_{ei:02d}.png"
        render_overlay(element, op)
        overlay_paths.append(op)

    duration = _probe_duration(audio_path) + 0.9
    fade_out_start = max(duration - 0.35, 0)
    frame_count = max(int(duration * FPS), 1)
    reveal_points = _reveal_schedule(len(overlay_paths), duration)

    # Build ffmpeg command
    # Input 0: background PNG (looped)
    # Inputs 1..N: overlay PNGs (looped)
    # Input N+1: audio
    cmd = ["ffmpeg", "-y",
           "-loop", "1", "-framerate", str(FPS), "-i", str(background_path)]
    for op in overlay_paths:
        cmd.extend(["-loop", "1", "-framerate", str(FPS), "-i", str(op)])
    cmd.extend(["-i", str(audio_path)])

    # filter_complex
    # Step 1: zoompan on background + fade in/out
    filter_steps = [
        (
            f"[0:v]scale={WIDTH + 120}:{HEIGHT + 68},"
            f"zoompan="
            f"z='min(zoom+0.00045,1.08)':"
            f"x='iw/2-(iw/zoom/2)+14*sin(on/22)':"
            f"y='ih/2-(ih/zoom/2)+9*cos(on/28)':"
            f"d={frame_count}:s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"format=rgba,"
            f"fade=t=in:st=0:d=0.35,"
            f"fade=t=out:st={fade_out_start:.2f}:d=0.35[base0]"
        )
    ]

    # Step 2: each overlay slides in from the left
    # The overlay PNG contains text positioned absolutely at its final x.
    # We shift the entire overlay canvas by -W (off-screen left) and animate
    # x from -W toward 0 over 0.28 seconds starting at reveal_time.
    current_label = "base0"
    for oi, reveal_time in enumerate(reveal_points, start=1):
        ov_label = f"ov{oi}"
        next_label = f"base{oi}"
        slide_dur = 0.28
        # x expression: before reveal → off-screen left (-W)
        #               during slide → eased from -W to 0
        #               after slide  → 0
        x_expr = (
            f"if(lt(t,{reveal_time:.2f}),"
            f"-{WIDTH},"
            f"if(lt(t,{reveal_time:.2f}+{slide_dur}),"
            f"(t-{reveal_time:.2f})/{slide_dur}*{WIDTH}-{WIDTH},"
            f"0))"
        )
        filter_steps.append(
            f"[{oi}:v]format=rgba,"
            f"setpts=PTS-STARTPTS[{ov_label}raw]"
        )
        filter_steps.append(
            f"[{current_label}][{ov_label}raw]"
            f"overlay=x='{x_expr}':y=0:eof_action=pass[{next_label}]"
        )
        current_label = next_label

    audio_index = len(overlay_paths) + 1
    filter_steps.append(f"[{audio_index}:a]apad=pad_dur=1[a]")

    cmd.extend([
        "-filter_complex", ";".join(filter_steps),
        "-map", f"[{current_label}]",
        "-map", "[a]",
        "-c:v", "libx264",
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-r", str(FPS),
        "-movflags", "+faststart",
        "-shortest",
        "-t", f"{duration:.2f}",
        str(segment_path),
    ])

    _run_command(cmd)


# ---------------------------------------------------------------------------
# Final concatenation with xfade transitions
# ---------------------------------------------------------------------------

def _concat_with_xfade(segment_paths: list[Path], durations: list[float]) -> None:
    """Concatenate segments using xfade video transitions and acrossfade audio."""
    n = len(segment_paths)
    XFADE_DUR = 0.4

    # Build inputs
    cmd = ["ffmpeg", "-y"]
    for sp in segment_paths:
        cmd.extend(["-i", str(sp)])

    # Build filter_complex
    # Accumulate xfade offsets: offset_i = sum(dur[0..i-1]) - i*XFADE_DUR
    filter_parts = []
    cumulative = 0.0
    current_v = "[0:v]"
    current_a = "[0:a]"

    for i in range(1, n):
        cumulative += durations[i - 1] - XFADE_DUR
        next_v = f"[xv{i}]" if i < n - 1 else "[vout]"
        next_a = f"[xa{i}]" if i < n - 1 else "[aout]"
        filter_parts.append(
            f"{current_v}[{i}:v]xfade=transition=wipeleft:"
            f"duration={XFADE_DUR}:offset={cumulative:.3f}{next_v}"
        )
        filter_parts.append(
            f"{current_a}[{i}:a]acrossfade=d={XFADE_DUR}{next_a}"
        )
        current_v = next_v
        current_a = next_a

    cmd.extend([
        "-filter_complex", ";".join(filter_parts),
        "-map", "[vout]",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", "medium",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(VIDEO_PATH),
    ])

    _run_command(cmd)


# ---------------------------------------------------------------------------
# Main composition orchestrator
# ---------------------------------------------------------------------------

def compose_video(scenes: list[dict], audio_paths: list[Path]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)

    segment_paths: list[Path] = []
    durations: list[float] = []

    for i, (scene, audio_path) in enumerate(zip(scenes, audio_paths)):
        segment_path = RUN_DIR / f"scene_{i:02d}.mp4"
        duration = _probe_duration(audio_path) + 0.9
        _compose_scene(i, scene, audio_path, segment_path)
        segment_paths.append(segment_path)
        durations.append(duration)
        print(f"  [video] scene {i}: {duration:.1f}s")

    print("\n  [concat] applying xfade transitions …")
    _concat_with_xfade(segment_paths, durations)

    render_poster(SCENES[2], 2, POSTER_PATH)
    return VIDEO_PATH


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  RepoDocs AI Demo Video Generator")
    print("=" * 60)

    _ensure_ffmpeg()
    clean_temp_dir()

    print("\n[1/3] Generating narration audio …")
    audio_paths = asyncio.run(generate_audio(SCENES))

    print("\n[2/3] Composing video scenes …")
    output = compose_video(SCENES, audio_paths)

    print("\n[3/3] Done!")
    print(f"  Output: {output}")
    print(f"  Size:   {output.stat().st_size / (1024*1024):.1f} MB")
    print("=" * 60)


if __name__ == "__main__":
    main()
