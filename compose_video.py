"""
تركيب الفيديو التعليمي داخل الحاوية المعزولة:
شرائح عربية (Pillow + تشكيل عربي) + مقاطع سرد mp3 → مقاطع → دمج → تحقق FFprobe.

الاستخدام (داخل الحاوية):
  python3 /opt/compose_video.py /work/plan.json /work/artifact.mp4 /work/probe.json

مدخلات /work: plan.json + audio_0.mp3 ... audio_N.mp3 (يضعها الخادم قبل التشغيل).
التحقق إلزامي: إطارات > 0، مدة > 0 و≤ 600 ثانية، ووجود مسار صوتي — وإلا فشل صريح.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont
import arabic_reshaper
from bidi.algorithm import get_display

W, H = 1280, 720
BG = (21, 21, 23)          # ‎#151517
FG = (235, 235, 240)
MUTED = (150, 150, 160)
ACCENT = (36, 98, 144)     # ‎#246290

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/noto/NotoNaskhArabic-Regular.ttf",
    "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def pick_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def ar(text):
    """تشكيل الحروف العربية واتجاه RTL قبل الرسم (Pillow لا يشكّل وحده)."""
    return get_display(arabic_reshaper.reshape(text))


def wrap(draw, text, font, max_w):
    lines, cur = [], ""
    for word in text.split():
        trial = (cur + " " + word).strip()
        if draw.textlength(ar(trial), font=font) <= max_w:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render_slide(scene, path):
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    f_title = pick_font(52)
    f_body = pick_font(34)
    f_cite = pick_font(24)

    d.rectangle([0, 0, W, 8], fill=ACCENT)
    title = scene.get("title", "").strip()
    if title:
        d.text((W - 60, 50), ar(title), font=f_title, fill=FG, anchor="ra")
    y = 170
    for line in wrap(d, scene.get("body", ""), f_body, W - 160):
        d.text((W - 80, y), ar(line), font=f_body, fill=FG, anchor="ra")
        y += 62
    cite = scene.get("citation")
    if cite:
        d.text((W - 60, H - 55), ar("المصدر: " + cite), font=f_cite, fill=MUTED, anchor="ra")
    img.save(path)


def run(cmd):
    subprocess.run(cmd, check=True)


def main(plan_path, out_path, probe_path):
    with open(plan_path, encoding="utf-8") as f:
        plan = json.load(f)
    scenes = plan["scenes"]
    tmp = os.path.dirname(plan_path)

    segments = []
    for i, sc in enumerate(scenes):
        slide = os.path.join(tmp, f"slide_{i}.png")
        audio = os.path.join(tmp, f"audio_{i}.mp3")
        seg = os.path.join(tmp, f"seg_{i}.mp4")
        render_slide(sc, slide)
        if not (os.path.exists(audio) and os.path.getsize(audio) > 100):
            raise SystemExit(f"missing narration audio for scene {i}")
        run(["ffmpeg", "-y", "-loop", "1", "-i", slide, "-i", audio,
             "-c:v", "libx264", "-tune", "stillimage", "-c:a", "aac", "-b:a", "128k",
             "-pix_fmt", "yuv420p", "-shortest", seg])
        segments.append(seg)

    concat = os.path.join(tmp, "concat.txt")
    with open(concat, "w", encoding="utf-8") as f:
        for s in segments:
            f.write(f"file '{s}'\n")
    run(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", concat, "-c", "copy", out_path])

    # التحقق الفعلي: إطارات + مدة + مسار صوتي
    v = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
         "-show_entries", "stream=nb_read_frames,duration", "-of", "json", out_path],
        check=True, capture_output=True, text=True).stdout)
    a = json.loads(subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=codec_type", "-of", "json", out_path],
        check=True, capture_output=True, text=True).stdout)

    frames = int(v["streams"][0].get("nb_read_frames", 0))
    duration = float(v["streams"][0].get("duration", 0))
    has_audio = len(a.get("streams", [])) > 0
    if frames < 1 or duration <= 0 or duration > 600 or not has_audio:
        raise SystemExit(f"VERIFY_FAILED frames={frames} duration={duration} audio={has_audio}")

    with open(probe_path, "w", encoding="utf-8") as f:
        json.dump({"frames": frames, "duration": duration, "has_audio": has_audio}, f)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
