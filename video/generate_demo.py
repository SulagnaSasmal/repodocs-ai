"""RepoDocs AI demo video generator."""

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

# Brand colours
BG_DARK = (15, 17, 23)
BG_WARM = (30, 27, 24)
ACCENT = (255, 149, 0)
ACCENT_COOL = (56, 152, 255)
TEXT_PRIMARY = (255, 255, 255)
TEXT_MUTED = (180, 180, 190)
KICKER_COLOR = ACCENT

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
            "Diagram starters for common flows",
            "Export paths for Confluence, Notion, and PDF",
            "GitHub Pages publishing workflows",
            "A working payments documentation example",
        ],
        "narration": (
            "Here is what you get. Product and API documentation templates. "
            "Drafting and review workflows. Built-in structure validation. "
            "Diagram starters, export paths for Confluence, Notion, and PDF, "
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
            "overview, endpoints, authentication, errors, idempotency, "
            "and webhooks, built from the shipped templates."
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
            "1. Install: clone, install, validate in 5 minutes",
            "2. Inspect: review the payments example and templates",
            "3. Adapt: copy template packs into your own repo",
            "4. Publish: use the same workflow for review and publishing",
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
        "body": "sulagnasasmal.github.io/repodocs-ai",
        "narration": (
            "Ready to see the difference? Install RepoDocs AI in minutes. "
            "Visit the site, watch the demo, inspect the proof, and start shipping "
            "better API documentation today."
        ),
        "bg": BG_DARK,
    },
]

FONT_SIZES = {
    "logo": 24,
    "kicker": 28,
    "title": 64,
    "body": 36,
    "bullet": 32,
}

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


def _scene_elements(scene: dict) -> list[dict]:
    elements: list[dict] = []
    y_cursor = 180

    kicker = scene.get("kicker")
    if kicker:
        elements.append(
            {
                "kind": "kicker",
                "lines": [kicker],
                "x": 80,
                "y": y_cursor,
                "font": _get_font(FONT_SIZES["kicker"], bold=True),
                "fill": KICKER_COLOR,
                "line_gap": 34,
            }
        )
        y_cursor += 60

    for line in scene.get("title", "").split("\n"):
        elements.append(
            {
                "kind": "title",
                "lines": [line],
                "x": 80,
                "y": y_cursor,
                "font": _get_font(FONT_SIZES["title"], bold=True),
                "fill": TEXT_PRIMARY,
                "line_gap": 72,
            }
        )
        y_cursor += 80

    y_cursor += 30

    body_lines = _wrap_lines(scene.get("body", ""), 56)
    if body_lines:
        elements.append(
            {
                "kind": "body",
                "lines": body_lines,
                "x": 80,
                "y": y_cursor,
                "font": _get_font(FONT_SIZES["body"]),
                "fill": TEXT_MUTED,
                "line_gap": 46,
            }
        )
        y_cursor += 50 * len(body_lines)

    bullets = scene.get("bullets") or []
    if bullets:
        y_cursor += 10
        for bullet in bullets:
            wrapped = textwrap.wrap(
                bullet if bullet[0].isdigit() else f"• {bullet}",
                width=54,
                subsequent_indent="  ",
            )
            elements.append(
                {
                    "kind": "bullet",
                    "lines": wrapped,
                    "x": 80,
                    "y": y_cursor,
                    "font": _get_font(FONT_SIZES["bullet"]),
                    "fill": TEXT_MUTED,
                    "line_gap": 40,
                }
            )
            y_cursor += 52 * len(wrapped)

    return elements


def _draw_block(draw: ImageDraw.ImageDraw, element: dict) -> None:
    font = element["font"]
    x_pos = element["x"]
    y_pos = element["y"]
    for line in element["lines"]:
        draw.text((x_pos, y_pos), line, fill=element["fill"], font=font)
        y_pos += element["line_gap"]


def render_background(scene: dict) -> Image.Image:
    bg = scene.get("bg", BG_DARK)
    img = Image.new("RGB", (WIDTH, HEIGHT), bg)
    draw = ImageDraw.Draw(img)

    draw.rectangle([(0, 0), (WIDTH, 6)], fill=ACCENT)
    draw.text((80, 40), "RepoDocs AI", fill=ACCENT, font=_get_font(FONT_SIZES["logo"], bold=True))
    draw.rectangle([(0, HEIGHT - 4), (WIDTH, HEIGHT)], fill=ACCENT)

    orb_bounds = [(WIDTH - 470, 160), (WIDTH - 80, 550)]
    draw.ellipse(orb_bounds, fill=(43, 55, 61), outline=(88, 102, 109), width=2)
    draw.ellipse([(WIDTH - 390, 235), (WIDTH - 160, 465)], outline=ACCENT_COOL, width=4)
    draw.rounded_rectangle(
        [(WIDTH - 510, 610), (WIDTH - 150, 840)],
        radius=40,
        fill=(21, 29, 35),
        outline=(86, 100, 108),
        width=2,
    )
    draw.line([(WIDTH - 470, 665), (WIDTH - 210, 665)], fill=(104, 120, 130), width=6)
    draw.line([(WIDTH - 470, 720), (WIDTH - 240, 720)], fill=(78, 92, 101), width=6)
    draw.line([(WIDTH - 470, 775), (WIDTH - 280, 775)], fill=(78, 92, 101), width=6)

    if scene.get("kicker") == "INTRODUCING":
        draw.rectangle([(0, 0), (8, HEIGHT)], fill=ACCENT)
        draw.rectangle([(WIDTH - 8, 0), (WIDTH, HEIGHT)], fill=ACCENT)

    return img


def render_overlay(element: dict, out_path: Path) -> None:
    image = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    _draw_block(draw, element)
    image.save(out_path, format="PNG")


def render_poster(scene: dict, out_path: Path) -> None:
    image = render_background(scene).convert("RGBA")
    draw = ImageDraw.Draw(image)
    for element in _scene_elements(scene):
        _draw_block(draw, element)
    image.convert("RGB").save(out_path, format="JPEG", quality=92)


def _run_command(command: list[str]) -> None:
    subprocess.run(command, check=True)


def _probe_duration(media_path: Path) -> float:
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
    for executable in ("ffmpeg", "ffprobe"):
        if shutil.which(executable) is None:
            raise RuntimeError(f"{executable} is required but was not found in PATH.")


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


def _reveal_schedule(count: int, duration: float) -> list[float]:
    if count == 0:
        return []
    start = 0.3
    available = max(duration - 1.1, 0.8)
    step = min(0.9, max(0.34, available / max(count, 1)))
    return [round(start + index * step, 2) for index in range(count)]


def compose_video(scenes: list[dict], audio_paths: list[Path]) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    RUN_DIR.mkdir(parents=True, exist_ok=True)
    segment_paths: list[Path] = []
    concat_file = RUN_DIR / "segments.txt"

    for i, (scene, audio_path) in enumerate(zip(scenes, audio_paths)):
        background_path = RUN_DIR / f"scene_{i:02d}_bg.png"
        segment_path = RUN_DIR / f"scene_{i:02d}.mp4"
        render_background(scene).save(background_path, format="PNG")
        elements = _scene_elements(scene)
        overlay_paths: list[Path] = []
        for element_index, element in enumerate(elements):
            overlay_path = RUN_DIR / f"scene_{i:02d}_overlay_{element_index:02d}.png"
            render_overlay(element, overlay_path)
            overlay_paths.append(overlay_path)

        duration = _probe_duration(audio_path) + 0.9
        fade_out_start = max(duration - 0.35, 0)
        frame_count = max(int(duration * FPS), 1)
        reveal_points = _reveal_schedule(len(overlay_paths), duration)

        command = [
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-framerate",
            str(FPS),
            "-i",
            str(background_path),
        ]

        for overlay_path in overlay_paths:
            command.extend(["-loop", "1", "-framerate", str(FPS), "-i", str(overlay_path)])

        command.extend(["-i", str(audio_path)])

        filter_steps = [
            (
                "[0:v]scale=2040:1148,"
                f"zoompan=z='min(zoom+0.00045,1.08)':x='iw/2-(iw/zoom/2)+18*sin(on/23)':"
                f"y='ih/2-(ih/zoom/2)+12*cos(on/27)':d={frame_count}:s={WIDTH}x{HEIGHT}:fps={FPS},"
                "format=rgba,"
                "fade=t=in:st=0:d=0.35,"
                f"fade=t=out:st={fade_out_start:.2f}:d=0.35[base0]"
            )
        ]

        current_label = "base0"
        for overlay_index, reveal_time in enumerate(reveal_points, start=1):
            overlay_label = f"ov{overlay_index}"
            next_label = f"base{overlay_index}"
            filter_steps.append(
                f"[{overlay_index}:v]format=rgba,fade=t=in:st=0:d=0.32:alpha=1,setpts=PTS-STARTPTS+{reveal_time:.2f}/TB[{overlay_label}]"
            )
            filter_steps.append(
                f"[{current_label}][{overlay_label}]overlay=0:0:eof_action=pass[{next_label}]"
            )
            current_label = next_label

        audio_index = len(overlay_paths) + 1
        filter_steps.append(f"[{audio_index}:a]apad=pad_dur=1[a]")

        command.extend(
            [
                "-filter_complex",
                ";".join(filter_steps),
                "-map",
                f"[{current_label}]",
                "-map",
                "[a]",
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

        _run_command(command)

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

    render_poster(SCENES[2], POSTER_PATH)
    return VIDEO_PATH


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
