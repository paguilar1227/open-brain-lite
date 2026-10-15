#!/usr/bin/env python3
"""Regenerate E2E test fixtures (sample.pdf, sample.png) from source.

Usage: python3 tests/fixtures/e2e/generate.py

Audio (sample.wav) is generated separately via the macOS-only
`say` + `ffmpeg` pipeline — see README.md.

Dependencies:
  pip3 install --user reportlab pillow
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

HERE = Path(__file__).parent
SAMPLE_MD = HERE / "sample.md"
SAMPLE_PDF = HERE / "sample.pdf"
SAMPLE_PNG = HERE / "sample.png"


def md_to_pdf(md_path: Path, pdf_path: Path) -> None:
    """Render the markdown to a multi-page PDF.

    Tiny markdown handler — h1 (`#`), h2 (`##`), and paragraphs. Skips bullet
    list parsing because the source doesn't need it. Anyone editing sample.md
    should keep the structure simple.
    """
    text = md_path.read_text(encoding="utf-8")
    styles = getSampleStyleSheet()
    h1_style = ParagraphStyle(
        "H1", parent=styles["Heading1"], fontSize=20, spaceAfter=14,
    )
    h2_style = ParagraphStyle(
        "H2", parent=styles["Heading2"], fontSize=15, spaceBefore=12, spaceAfter=8,
    )
    body_style = ParagraphStyle(
        "Body", parent=styles["BodyText"], fontSize=11, leading=15, spaceAfter=8,
    )

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=letter,
        leftMargin=1 * inch, rightMargin=1 * inch,
        topMargin=1 * inch, bottomMargin=1 * inch,
    )

    flow = []
    paragraph_buf: list[str] = []

    def flush_paragraph() -> None:
        if paragraph_buf:
            joined = " ".join(paragraph_buf).strip()
            if joined:
                # Escape XML-like chars that reportlab interprets
                safe = (
                    joined
                    .replace("&", "&amp;")
                    .replace("<", "&lt;")
                    .replace(">", "&gt;")
                )
                flow.append(Paragraph(safe, body_style))
            paragraph_buf.clear()

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
            flush_paragraph()
            continue
        if line.startswith("# "):
            flush_paragraph()
            flow.append(Paragraph(line[2:].strip(), h1_style))
        elif line.startswith("## "):
            flush_paragraph()
            flow.append(Paragraph(line[3:].strip(), h2_style))
        else:
            paragraph_buf.append(line.lstrip("- ").strip())

    flush_paragraph()
    doc.build(flow)
    print(f"wrote {pdf_path}")


def make_png(out_path: Path) -> None:
    """White-background image with high-contrast black text for OCR."""
    width, height = 1024, 600
    img = Image.new("RGB", (width, height), "white")
    draw = ImageDraw.Draw(img)

    # Try a few common system font paths; fall back to PIL's default if none load.
    font_candidates = [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
    ]
    font = None
    for path in font_candidates:
        if os.path.exists(path):
            try:
                font = ImageFont.truetype(path, 36)
                break
            except OSError:
                continue
    if font is None:
        font = ImageFont.load_default()

    lines = [
        "pgvector + HNSW",
        "IVFFlat tradeoffs",
        "Anthropic Haiku 4.5",
        "Open Brain v2 OCR test",
    ]
    y = 60
    for line in lines:
        draw.text((50, y), line, fill="black", font=font)
        y += 80

    img.save(out_path, "PNG")
    print(f"wrote {out_path}")


def main() -> None:
    md_to_pdf(SAMPLE_MD, SAMPLE_PDF)
    make_png(SAMPLE_PNG)


if __name__ == "__main__":
    main()
