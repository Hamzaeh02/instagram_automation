from __future__ import annotations

from pathlib import Path


def read_env_values(path: str | Path) -> dict[str, str]:
    path = Path(path)
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        values[key.strip()] = value.strip()
    return values


def write_env_values(path: str | Path, updates: dict[str, str]) -> None:
    """Update or append KEY=VALUE pairs in a .env file in place, preserving
    comments, blank lines, and the order/formatting of everything else."""
    path = Path(path)
    lines = path.read_text().splitlines() if path.exists() else []
    remaining = dict(updates)

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in remaining:
            lines[i] = f"{key}={remaining.pop(key)}"

    if remaining:
        if lines and lines[-1].strip():
            lines.append("")
        for key, value in remaining.items():
            lines.append(f"{key}={value}")

    path.write_text("\n".join(lines) + "\n")
