#!/usr/bin/env python3
"""
scripts/update_docs.py — Documentation auto-update script.

Scans the codebase and updates generated sections of documentation files
to keep them in sync with the actual code.

Run after making structural changes:
    python scripts/update_docs.py

Updates:
    1. docs/SCHEMA_REFERENCE.md   — Pydantic model definitions from engine/config/schema.py
    2. docs/API_CONTRACTS.md      — Route definitions from server/routes/*.js
    3. docs/JURISDICTION_GUIDE.md — Available jurisdictions from engine/jurisdictions/templates/
    4. docs/ARCHITECTURE.md       — File map and dependency versions
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import textwrap
from pathlib import Path
from datetime import datetime

# ── Resolve project root ──
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

DOCS_DIR = PROJECT_ROOT / "docs"
ENGINE_DIR = PROJECT_ROOT / "engine"
SERVER_DIR = PROJECT_ROOT / "server"
APP_DIR = PROJECT_ROOT / "app"
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"


def _heading(text: str, level: int = 2) -> str:
    return f"{'#' * level} {text}"


# ============================================================================
# 1. Extract Pydantic models from schema.py → SCHEMA_REFERENCE.md
# ============================================================================

def extract_pydantic_models(schema_path: Path) -> str:
    """Parse schema.py and extract all Pydantic model class definitions."""
    if not schema_path.exists():
        return "⚠️ schema.py not found\n"

    source = schema_path.read_text(encoding="utf-8")
    tree = ast.parse(source)

    models: list[dict] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.ClassDef):
            continue
        # Check if it inherits from BaseModel
        bases = [
            getattr(b, "id", getattr(b, "attr", "")) for b in node.bases
        ]
        if "BaseModel" not in bases:
            continue

        docstring = ast.get_docstring(node) or ""
        fields: list[dict] = []
        validators: list[str] = []

        for item in node.body:
            # Fields (annotated assignments)
            if isinstance(item, ast.AnnAssign) and isinstance(item.target, ast.Name):
                field_name = item.target.id
                # Get type annotation as string
                ann_str = ast.get_source_segment(source, item.annotation) or "Any"
                fields.append({"name": field_name, "type": ann_str})

            # Validators (decorated functions)
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for dec in item.decorator_list:
                    dec_name = ""
                    if isinstance(dec, ast.Name):
                        dec_name = dec.id
                    elif isinstance(dec, ast.Attribute):
                        dec_name = dec.attr
                    elif isinstance(dec, ast.Call):
                        func = dec.func
                        if isinstance(func, ast.Name):
                            dec_name = func.id
                        elif isinstance(func, ast.Attribute):
                            dec_name = func.attr
                    if dec_name in ("field_validator", "model_validator", "validator", "root_validator"):
                        validators.append(f"`{item.name}` ({dec_name})")

            # Computed fields
            if isinstance(item, ast.FunctionDef):
                for dec in item.decorator_list:
                    if isinstance(dec, ast.Name) and dec.id == "computed_field":
                        fields.append({"name": f"{item.name} (computed)", "type": "property"})

        models.append({
            "name": node.name,
            "docstring": docstring.split("\n")[0] if docstring else "",
            "fields": fields,
            "validators": validators,
        })

    # Build markdown
    lines = [
        "# Schema Reference",
        "",
        f"**Auto-generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        f"**Source:** `engine/config/schema.py`",
        "",
        f"Total Pydantic models: **{len(models)}**",
        "",
    ]

    for m in models:
        lines.append(f"## `{m['name']}`")
        if m["docstring"]:
            lines.append(f"\n{m['docstring']}\n")
        if m["fields"]:
            lines.append("| Field | Type |")
            lines.append("|-------|------|")
            for f in m["fields"]:
                lines.append(f"| `{f['name']}` | `{f['type']}` |")
            lines.append("")
        if m["validators"]:
            lines.append("**Validators:** " + ", ".join(m["validators"]))
            lines.append("")
        lines.append("---\n")

    return "\n".join(lines)


# ============================================================================
# 2. Extract route definitions from server/routes/*.js
# ============================================================================

def extract_routes(routes_dir: Path) -> str:
    """Scan Express route files and extract endpoint definitions."""
    if not routes_dir.exists():
        return "⚠️ server/routes/ not found\n"

    route_pattern = re.compile(
        r"router\.(get|post|put|delete|patch)\s*\(\s*['\"]([^'\"]+)['\"]",
        re.IGNORECASE,
    )

    routes: list[dict] = []
    for js_file in sorted(routes_dir.glob("*.js")):
        content = js_file.read_text(encoding="utf-8")
        for match in route_pattern.finditer(content):
            method = match.group(1).upper()
            path = match.group(2)
            # Find comments above the route
            line_start = content.rfind("\n", 0, match.start()) + 1
            above = content[max(0, line_start - 200):line_start].strip()
            comment = ""
            for line in reversed(above.split("\n")):
                line = line.strip()
                if line.startswith("//") or line.startswith("*"):
                    comment = line.lstrip("/").lstrip("*").strip()
                    break
            routes.append({
                "file": js_file.name,
                "method": method,
                "path": path,
                "comment": comment,
            })

    lines = [
        "",
        "## Auto-Discovered Routes",
        "",
        f"**Scanned:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "| Method | Path | Source | Description |",
        "|--------|------|--------|-------------|",
    ]
    for r in routes:
        lines.append(f"| `{r['method']}` | `{r['path']}` | `{r['file']}` | {r['comment']} |")

    return "\n".join(lines)


# ============================================================================
# 3. List available jurisdictions from templates
# ============================================================================

def list_jurisdictions(templates_dir: Path) -> str:
    """Scan jurisdiction JSON templates and produce a table."""
    if not templates_dir.exists():
        return "⚠️ engine/jurisdictions/templates/ not found\n"

    rows: list[str] = []
    for json_file in sorted(templates_dir.glob("*.json")):
        try:
            data = json.loads(json_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        jid = data.get("id", json_file.stem)
        name = data.get("name", "")
        country = data.get("country", "")
        institution = data.get("institution", "")
        restart = "✓" if data.get("supports_restart", True) else "✗"
        rows.append(f"| `{jid}` | {name} | {country} | {institution} | {restart} |")

    lines = [
        "",
        "| ID | Name | Country | Institution | Supports Restart |",
        "|----|------|---------|-------------|:----------------:|",
    ] + rows
    return "\n".join(lines)


# ============================================================================
# 4. Generate project file tree
# ============================================================================

def generate_file_tree(root: Path, max_depth: int = 3) -> str:
    """Walk the project and produce a directory listing."""
    ignore_dirs = {
        "__pycache__", "node_modules", ".git", ".pytest_cache", "dist",
        ".venv", "runs", ".next", "build",
    }
    ignore_exts = {".pyc", ".pyo"}

    lines = [
        "",
        "## Project File Map",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
        "```",
    ]

    def _walk(directory: Path, prefix: str, depth: int) -> None:
        if depth > max_depth:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return
        dirs = [e for e in entries if e.is_dir() and e.name not in ignore_dirs]
        files = [e for e in entries if e.is_file() and e.suffix not in ignore_exts]

        for i, d in enumerate(dirs):
            connector = "├── " if (i < len(dirs) - 1 or files) else "└── "
            lines.append(f"{prefix}{connector}{d.name}/")
            extension = "│   " if (i < len(dirs) - 1 or files) else "    "
            _walk(d, prefix + extension, depth + 1)

        for i, f in enumerate(files):
            connector = "├── " if i < len(files) - 1 else "└── "
            lines.append(f"{prefix}{connector}{f.name}")

    lines.append(f"{root.name}/")
    _walk(root, "", 1)
    lines.append("```")
    return "\n".join(lines)


# ============================================================================
# 5. Read package.json dependencies
# ============================================================================

def extract_dependencies(root: Path) -> str:
    """Find all package.json files and list dependencies with versions."""
    lines = [
        "",
        "## Dependency Versions",
        "",
        f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}",
        "",
    ]

    # Python requirements
    req_file = root / "engine" / "requirements.txt"
    if req_file.exists():
        lines.append("### Python Engine (`engine/requirements.txt`)")
        lines.append("")
        lines.append("| Package | Version |")
        lines.append("|---------|---------|")
        for line in req_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ">=" in line:
                pkg, ver = line.split(">=", 1)
                lines.append(f"| {pkg.strip()} | ≥{ver.strip()} |")
            elif "==" in line:
                pkg, ver = line.split("==", 1)
                lines.append(f"| {pkg.strip()} | {ver.strip()} |")
            else:
                lines.append(f"| {line} | latest |")
        lines.append("")

    # Node.js package.json files
    for subdir in ["server", "app", "dashboard"]:
        pkg_path = root / subdir / "package.json"
        if not pkg_path.exists():
            continue
        try:
            pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue

        name = pkg.get("name", subdir)
        lines.append(f"### {subdir.title()} (`{subdir}/package.json`)")
        lines.append("")
        deps = pkg.get("dependencies", {})
        dev_deps = pkg.get("devDependencies", {})
        if deps:
            lines.append("| Package | Version | Type |")
            lines.append("|---------|---------|------|")
            for k, v in sorted(deps.items()):
                lines.append(f"| {k} | {v} | prod |")
            for k, v in sorted(dev_deps.items()):
                lines.append(f"| {k} | {v} | dev |")
            lines.append("")

    return "\n".join(lines)


# ============================================================================
# Update helpers
# ============================================================================

def _replace_section(content: str, marker: str, replacement: str) -> str:
    """Replace content between AUTO-GENERATED markers."""
    start_marker = f"<!-- AUTO-GENERATED: {marker} -->"
    end_marker = f"<!-- /AUTO-GENERATED: {marker} -->"

    # Check for end marker
    if start_marker in content and end_marker in content:
        pattern = re.compile(
            re.escape(start_marker) + r".*?" + re.escape(end_marker),
            re.DOTALL,
        )
        return pattern.sub(
            f"{start_marker}\n{replacement}\n{end_marker}",
            content,
        )
    elif start_marker in content:
        # No end marker — insert after the start marker line and add end marker
        return content.replace(
            start_marker,
            f"{start_marker}\n{replacement}\n{end_marker}",
        )
    return content


def _update_file(path: Path, marker: str, replacement: str) -> bool:
    """Update a section in a markdown file. Returns True if changed."""
    if not path.exists():
        print(f"  ⚠️  File not found: {path}")
        return False

    content = path.read_text(encoding="utf-8")
    start_marker = f"<!-- AUTO-GENERATED: {marker} -->"
    if start_marker not in content:
        print(f"  ⚠️  No marker '{marker}' in {path.name}")
        return False

    new_content = _replace_section(content, marker, replacement)
    if new_content != content:
        path.write_text(new_content, encoding="utf-8")
        print(f"  ✅ Updated {path.name} [{marker}]")
        return True
    else:
        print(f"  — {path.name} [{marker}] unchanged")
        return False


# ============================================================================
# Main
# ============================================================================

def main() -> None:
    print(f"📄 Documentation auto-update")
    print(f"   Project root: {PROJECT_ROOT}")
    print()

    changes = 0

    # 1. Schema reference (standalone file)
    print("1. Extracting Pydantic models from schema.py...")
    schema_path = ENGINE_DIR / "config" / "schema.py"
    schema_md = extract_pydantic_models(schema_path)
    schema_out = DOCS_DIR / "SCHEMA_REFERENCE.md"
    existing = schema_out.read_text(encoding="utf-8") if schema_out.exists() else ""
    if schema_md != existing:
        schema_out.write_text(schema_md, encoding="utf-8")
        print(f"  ✅ Written {schema_out.name}")
        changes += 1
    else:
        print(f"  — {schema_out.name} unchanged")

    # 2. Routes → API_CONTRACTS.md
    print("\n2. Scanning server routes...")
    routes_md = extract_routes(SERVER_DIR / "routes")
    if _update_file(DOCS_DIR / "API_CONTRACTS.md", "ROUTES", routes_md):
        changes += 1

    # 3. Jurisdictions → JURISDICTION_GUIDE.md
    print("\n3. Listing jurisdiction templates...")
    jurisdictions_md = list_jurisdictions(ENGINE_DIR / "jurisdictions" / "templates")
    if _update_file(DOCS_DIR / "JURISDICTION_GUIDE.md", "JURISDICTIONS", jurisdictions_md):
        changes += 1

    # 4. File tree → ARCHITECTURE.md
    print("\n4. Generating project file map...")
    file_tree_md = generate_file_tree(PROJECT_ROOT)
    if _update_file(DOCS_DIR / "ARCHITECTURE.md", "FILE_MAP", file_tree_md):
        changes += 1

    # 5. Dependencies → ARCHITECTURE.md
    print("\n5. Extracting dependency versions...")
    deps_md = extract_dependencies(PROJECT_ROOT)
    if _update_file(DOCS_DIR / "ARCHITECTURE.md", "DEPENDENCIES", deps_md):
        changes += 1

    print(f"\n{'='*50}")
    print(f"Done. {changes} file(s) updated.")
    if changes == 0:
        print("All documentation is already up to date.")


if __name__ == "__main__":
    main()
