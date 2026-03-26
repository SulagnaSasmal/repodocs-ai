"""
RepoDocs AI — Automated Sales Demo Video Generator

Generates a narrated MP4 sales pitch video using:
- edge-tts for high-quality Microsoft neural narration
- Pillow for slide rendering
- FFmpeg for deterministic segment composition and final muxing

Usage:
    python generate_demo.py

Output:
    website/static/demo/repodocs-ai-demo.mp4
"""

import asyncio
import os
import shutil
import subprocess
import textwrap
from pathlib import Path

import edge_tts
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WIDTH, HEIGHT = 1920, 1080
FPS = 30
VOICE = "en-US-GuyNeural"  # professional male narrator
REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "website" / "static" / "demo"
TEMP_DIR = Path(__file__).parent / "tmp"
RUN_DIR = TEMP_DIR / f"run-{os.getpid()}"
VIDEO_PATH = OUTPUT_DIR / "repodocs-ai-demo.mp4"
POSTER_PATH = OUTPUT_DIR / "repodocs-ai-demo-poster.jpg"

# Brand colours
BG_DARK = (15, 17, 23)          # near-black
BG_WARM = (30, 27, 24)          # warm dark
ACCENT = (255, 149, 0)          # orange accent
ACCENT_COOL = (56, 152, 255)    # blue accent
TEXT_PRIMARY = (255, 255, 255)   # white
TEXT_MUTED = (180, 180, 190)     # grey
KICKER_COLOR = ACCENT

# ---------------------------------------------------------------------------
# Scene definitions — each scene is a dict with:
#   title       – large heading text
#   body        – supporting paragraph (optional)
#   kicker      – small label above the heading (optional)
#   bullets     – list of bullet strings (optional)
#   narration   – the spoken narration text for edge-tts
#   bg          – background colour tuple (optional, defaults to BG_DARK)
# ---------------------------------------------------------------------------

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
        "title": "AI drafts are fast.\nBut without guardrails, they're risky.",
        "body": (
            "Teams can generate content quickly, but without shared schema, "
            "review workflows, or validation, AI-generated docs drift and erode trust."
        ),
        "narration": (
            "Sure, AI can generate drafts quickly. But without a shared schema, "
            "structured review workflows, or validation rules — those AI-generated "
            "docs drift from reality and erode trust with every release."
        ),
        "bg": BG_WARM,
    },
    {
        "kicker": "INTRODUCING",
        "title": "RepoDocs AI",
        "body": "One repository-native documentation system\nfor SaaS teams building APIs.",
        "narration": (
            "Introducing RepoDocs AI. One repository-native documentation system "
            "for SaaS teams building APIs. Everything lives in your repo, "
            "validated by CI, and ready to publish."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker": "WHAT YOU GET",
        "title": "Everything a docs team needs,\nin one installable system.",
        "bullets": [
            "Product and API template packs",
            "AI prompt packs for drafting and review",
            "Frontmatter and structure validation",
            "Mermaid diagram starters",
            "Export pipelines for Confluence, Notion, PDF",
            "GitHub Pages publishing workflows",
        ],
        "narration": (
            "Here's what you get. Product and API template packs. "
            "AI prompt packs for drafting and review. "
            "Built-in frontmatter and structure validation. "
            "Mermaid diagram starters. Export pipelines for Confluence, Notion, and PDF. "
            "And GitHub Pages publishing workflows. All in one installable system."
        ),
        "bg": BG_DARK,
    },
    {
        "kicker": "REAL PROOF",
        "title": "A Stripe-style payments example.\nNot just templates.",
        "body": (
            "Inspect a complete payments API documentation set — "
            "overview, endpoints, authentication, errors, idempotency, "
            "and webhooks — built from the shipped templates."
        ),
        "narration": (
            "But don't take our word for it. RepoDocs AI ships with a complete "
            "Stripe-style payments API documentation example. API overview, "
            "endpoint docs, authentication, structured errors, idempotency, "
            "and webhooks. All built from the actual shipped templates and prompts."
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
            "First, install. Clone the repo, install dependencies, and validate — all in five minutes. "
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
        "title": "Install in 5 minutes.\nTry RepoDocs AI today.",
        "body": "sulagnasasmal.github.io/repodocs-ai",
        "narration": (
            "Ready to see the difference? Install RepoDocs AI in five minutes. "
            "Visit the site, read the docs, inspect the proof, and start shipping "
            "better API documentation today."
        ),
        "bg": BG_DARK,
    },
]

# ---------------------------------------------------------------------------
# Helper: get a TrueType font (falls back to default if system fonts missing)
# ---------------------------------------------------------------------------

def _get_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """Return a TrueType font, trying common system paths."""
    candidates = [
        # Windows
        "C:/Windows/Fonts/segoeui.ttf" if not bold else "C:/Windows/Fonts/segoeuib.ttf",
        "C:/Windows/Fonts/arial.ttf" if not bold else "C:/Windows/Fonts/arialbd.ttf",
        # Linux
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        # macOS
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for path in candidates:
        if os.path.isfile(path):
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


# ---------------------------------------------------------------------------
# Render a single slide image with Pillow
# ---------------------------------------------------------------------------

def render_slide(scene: dict) -> np.ndarray:
    """Return a numpy RGB array (H, W, 3) for one scene."""
    bg = scene.get("bg", BG_DARK)
    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    # Fonts
    font_kicker = _get_font(28, bold=True)
    font_title = _get_font(64, bold=True)
    font_body = _get_font(36)
    font_bullet = _get_font(32)

    y_cursor = 180  # vertical start

    # Accent bar at top
    draw.rectangle([(0, 0), (WIDTH, 6)], fill=ACCENT)

    # Small logo / product name in top-left
    font_logo = _get_font(24, bold=True)
    draw.text((80, 40), "RepoDocs AI", fill=ACCENT, font=font_logo)

    # Kicker
    kicker = scene.get("kicker")
    if kicker:
        draw.text((80, y_cursor), kicker, fill=KICKER_COLOR, font=font_kicker)
        y_cursor += 60

    # Title
    title = scene.get("title", "")
    for line in title.split("\n"):
        draw.text((80, y_cursor), line, fill=TEXT_PRIMARY, font=font_title)
        y_cursor += 80

    y_cursor += 30

    # Body
    body = scene.get("body")
    if body:
        wrapped = textwrap.fill(body, width=70)
        for line in wrapped.split("\n"):
            draw.text((80, y_cursor), line, fill=TEXT_MUTED, font=font_body)
            y_cursor += 50

    # Bullets
    bullets = scene.get("bullets")
    if bullets:
        y_cursor += 10
        for bullet in bullets:
            prefix = "  " if bullet[0].isdigit() else "  •  "
            text = prefix + bullet if not bullet[0].isdigit() else "  " + bullet
            draw.text((80, y_cursor), text, fill=TEXT_MUTED, font=font_bullet)
            y_cursor += 52

    # Bottom accent bar
    draw.rectangle([(0, HEIGHT - 4), (WIDTH, HEIGHT)], fill=ACCENT)

    # Decorative side accent for "INTRODUCING" scene
    if scene.get("kicker") == "INTRODUCING":
        draw.rectangle([(0, 0), (8, HEIGHT)], fill=ACCENT)
        draw.rectangle([(WIDTH - 8, 0), (WIDTH, HEIGHT)], fill=ACCENT)

    return np.array(img)


def render_slide_image(scene: dict, out_path: Path) -> None:
    """Write one rendered slide to disk."""
    image = Image.fromarray(render_slide(scene))
    image.save(out_path, format="PNG")


def _run_command(command: list[str]) -> None:
    """Run a subprocess command and raise on failure."""
    subprocess.run(command, check=True)


def _probe_duration(media_path: Path) -> float:
    """Return media duration in seconds using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "quiet",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(media_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def _ensure_ffmpeg() -> None:
    """Fail fast if ffmpeg/ffprobe are not installed."""
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            raise RuntimeError(f"{executable} is required but was not found in PATH.")


def clean_temp_dir() -> None:
    """Remove stale generated files from the temp directory."""
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
# Generate TTS audio for each scene
# ---------------------------------------------------------------------------

async def generate_audio(scenes: list[dict]) -> list[Path]:
    """Generate edge-tts audio files, one per scene. Return list of paths."""
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
# Compose the final video
# ---------------------------------------------------------------------------

def compose_video(scenes: list[dict], audio_paths: list[Path]) -> Path:
    """Build per-scene MP4 segments with ffmpeg and concatenate them."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    segment_paths: list[Path] = []
    concat_file = RUN_DIR / "segments.txt"

    for i, (scene, audio_path) in enumerate(zip(scenes, audio_paths)):
        slide_path = RUN_DIR / f"scene_{i:02d}.png"
        segment_path = RUN_DIR / f"scene_{i:02d}.mp4"
        render_slide_image(scene, slide_path)

        duration = _probe_duration(audio_path) + 1.0
        fade_out_start = max(duration - 0.35, 0)

        _run_command(
            [
                "ffmpeg",
                "-y",
                "-loop",
                "1",
                "-framerate",
                str(FPS),
                "-i",
                str(slide_path),
                "-i",
                str(audio_path),
                "-filter_complex",
                (
                    "[0:v]format=yuv420p,fade=t=in:st=0:d=0.35,"
                    f"fade=t=out:st={fade_out_start:.2f}:d=0.35[v];"
                    "[1:a]apad=pad_dur=1[a]"
                ),
                "-map",
                "[v]",
                "-map",
                "[a]",
                "-c:v",
                "libx264",
                "-preset",
                "medium",
                "-tune",
                "stillimage",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-r",
                str(FPS),
                "-movflags",
                "+faststart",
                "-shortest",
                "-t",
                f"{duration:.2f}",
                str(segment_path),
            ]
        )

        segment_paths.append(segment_path)
        print(f"  [video] scene {i}: {duration:.1f}s")

    concat_file.write_text(
        "\n".join(f"file '{path.as_posix()}'" for path in segment_paths),
        encoding="utf-8",
    )

    _run_command(
        [
            "ffmpeg",
            "-y",
            "-f",
            "concat",
            "-safe",
            "0",
            "-i",
            str(concat_file),
            "-c:v",
            "libx264",
            "-preset",
            "medium",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            str(VIDEO_PATH),
        ]
    )

    render_slide_image(SCENES[2], POSTER_PATH)
    return VIDEO_PATH


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print("=" * 60)
    print("  RepoDocs AI — Demo Video Generator")
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
