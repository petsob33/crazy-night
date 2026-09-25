#!/usr/bin/env python3
"""Render Crazy Night overlays with Pillow and composite onto raw Veo clips with ffmpeg.
usage: make.py <spec.json>"""
import json, subprocess, sys, os, textwrap
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 720, 1280
PINK = (236, 32, 138)
FB = "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-Black.otf"
FX = "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-ExtraBold.otf"
FS = "/usr/share/fonts/julietaula-montserrat-fonts/Montserrat-Bold.otf"


def font(p, s):
    return ImageFont.truetype(p, s)


def wrap(draw, text, f, maxw):
    words, lines, cur = text.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if draw.textlength(t, font=f) <= maxw:
            cur = t
        else:
            lines.append(cur); cur = w
    lines.append(cur)
    return lines


def caption(text, y, style="white", size=40):
    """TikTok-style caption: each line in its own rounded box."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(FX, size)
    bg, fg = {"white": ((255, 255, 255, 255), (0, 0, 0)),
              "pink": (PINK + (255,), (255, 255, 255)),
              "black": ((0, 0, 0, 235), (255, 255, 255))}[style]
    lines = wrap(d, text, f, W - 120)
    lh = int(size * 1.38)
    for i, ln in enumerate(lines):
        tw = d.textlength(ln, font=f)
        x0 = (W - tw) / 2
        yy = y + i * lh
        d.rounded_rectangle([x0 - 16, yy - 6, x0 + tw + 16, yy + lh - 8], 10, fill=bg)
        d.text((x0, yy), ln, font=f, fill=fg)
    return im


def card(text, label, scale=1.0):
    """Front of a Crazy Night card: matte black, pink chunky text, small label."""
    cw, ch = int(430 * scale), int(600 * scale)
    c = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle([0, 0, cw - 1, ch - 1], int(28 * scale), fill=(22, 22, 26, 255),
                        outline=(60, 60, 66, 255), width=2)
    fl = font(FS, int(24 * scale))
    lw = d.textlength(label.upper(), font=fl)
    d.text(((cw - lw) / 2, int(40 * scale)), label.upper(), font=fl, fill=(200, 200, 205))
    size = int(50 * scale)
    while True:
        f = font(FB, size)
        lines = wrap(d, text, f, cw - int(60 * scale))
        lh = int(size * 1.2)
        if len(lines) * lh < ch * 0.6 or size < 24:
            break
        size -= 2
    y = (ch - len(lines) * lh) / 2
    for ln in lines:
        tw = d.textlength(ln, font=f)
        d.text(((cw - tw) / 2, y), ln, font=f, fill=PINK)
        y += lh
    fb = font(FX, int(22 * scale))
    brand = "CrazyNight"
    d.text(((cw - d.textlength(brand, font=fb)) / 2, ch - int(62 * scale)), brand, font=fb, fill=(255, 255, 255))
    # glow + drop shadow
    pad = 60
    out = Image.new("RGBA", (cw + 2 * pad, ch + 2 * pad), (0, 0, 0, 0))
    glow = Image.new("RGBA", out.size, (0, 0, 0, 0))
    ImageDraw.Draw(glow).rounded_rectangle([pad, pad, pad + cw, pad + ch], 30, fill=PINK + (150,))
    out.alpha_composite(glow.filter(ImageFilter.GaussianBlur(22)))
    out.alpha_composite(c, (pad, pad))
    return out


def full(im_card, y):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    im.alpha_composite(im_card, ((W - im_card.width) // 2, y))
    return im


def endcard(cta):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    f = font(FB, 84)
    t = "CRAZY NIGHT"
    d.text(((W - d.textlength(t, font=f)) / 2, 470), t, font=f, fill=PINK)
    f2 = font(FX, 34)
    t2 = "párty karetní hra od SobGame"
    d.text(((W - d.textlength(t2, font=f2)) / 2, 580), t2, font=f2, fill="white")
    f3 = font(FS, 28)
    t3 = "18+  ·  4–10 hráčů  ·  hraješ na vlastní riziko"
    d.text(((W - d.textlength(t3, font=f3)) / 2, 635), t3, font=f3, fill=(220, 220, 220))
    im.alpha_composite(caption(cta, 740, "pink", 34))
    return im


# Fedora's ffmpeg-free has no x264; fall back to OpenH264.
_enc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
H264 = (["-c:v", "libx264", "-preset", "slow", "-crf", "19"] if " libx264 " in _enc
        else ["-c:v", "libopenh264", "-b:v", "6M"])


def main(spec_path):
    spec = json.load(open(spec_path))
    tmp = os.path.join(os.path.dirname(spec_path), "ov_" + spec["name"])
    os.makedirs(tmp, exist_ok=True)
    layers = []  # (png, start, end, fade)
    for i, o in enumerate(spec["overlays"]):
        if o["type"] == "caption":
            im = caption(o["text"], o.get("y", 170), o.get("style", "white"), o.get("size", 40))
        elif o["type"] == "card":
            im = full(card(o["text"], o.get("label", "Otázka"), o.get("scale", 1.0)), o.get("y", 300))
        elif o["type"] == "end":
            im = endcard(o["text"])
        p = f"{tmp}/{i:02d}.png"
        im.save(p)
        layers.append((p, o["start"], o["end"]))
    dur = spec["duration"]
    raw = spec["raw"]
    endstart = spec["end_start"]
    inputs = ["-i", raw]
    for p, *_ in layers:
        inputs += ["-loop", "1", "-t", str(dur), "-i", p]
    fc = []
    # base: scale to 720x1280, extend with freeze frame, darken+blur during end card
    fc.append(f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps=30,"
              f"tpad=stop_mode=clone:stop_duration={dur},trim=0:{dur},setpts=PTS-STARTPTS,split[a][b]")
    fc.append(f"[b]boxblur=18:2,eq=brightness=-0.28:saturation=0.4[bl]")
    fc.append(f"[a][bl]overlay=enable='gte(t,{endstart})'[v0]")
    last = "v0"
    for i, (p, s, e) in enumerate(layers):
        fc.append(f"[{i+1}:v]format=rgba,fade=t=in:st={s}:d=0.18:alpha=1[o{i}]")
        fc.append(f"[{last}][o{i}]overlay=0:0:enable='between(t,{s},{e})'[v{i+1}]")
        last = f"v{i+1}"
    # audio: raw audio, padded; optional duck after end_start
    # "raw_volume": 0 mutes Veo's own soundtrack; "music": path to a track mixed underneath
    rv = spec.get("raw_volume", 1.0)
    if spec.get("music"):
        inputs += ["-stream_loop", "-1", "-i", spec["music"]]
        mi = len(layers) + 1
        fc.append(f"[0:a]apad,atrim=0:{dur},volume={rv}[ra]")
        fc.append(f"[{mi}:a]atrim=0:{dur},volume={spec.get('music_volume', 0.8)}[ma]")
        fc.append(f"[ra][ma]amix=inputs=2:duration=first:normalize=0,afade=t=out:st={dur-1.2}:d=1.2[aout]")
    else:
        fc.append(f"[0:a]apad,atrim=0:{dur},volume={rv},afade=t=out:st={dur-1.2}:d=1.2[aout]")
    cmd = ["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(fc),
           "-map", f"[{last}]", "-map", "[aout]", *H264,
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
           "-t", str(dur), spec["out"]]
    subprocess.run(cmd, check=True)
    print("ok", spec["out"])


if __name__ == "__main__":
    main(sys.argv[1])
