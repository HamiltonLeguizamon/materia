from __future__ import annotations

import re


def split_sentences(text: str, max_chars: int) -> list[str]:
    normalized = " ".join(text.split())
    if len(normalized) <= max_chars:
        return [normalized]
    sentences = re.split(r"(?<=[.!?])\s+", normalized)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if not sentence:
            continue
        if current and len(current) + 1 + len(sentence) > max_chars:
            chunks.append(current)
            current = sentence
        elif current:
            current = f"{current} {sentence}"
        else:
            current = sentence
        while len(current) > max_chars:
            boundary = current.rfind(" ", 0, max_chars + 1)
            boundary = boundary if boundary > max_chars // 2 else max_chars
            chunks.append(current[:boundary].strip())
            current = current[boundary:].strip()
    if current:
        chunks.append(current)
    return chunks
