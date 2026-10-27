"""将已提交的自有引擎构建打包，并记录源码身份及 MPL 许可。"""

import hashlib
import json
import re
import shutil
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

ROOT = Path(__file__).resolve().parents[1]
VERSION = "4.6.6-recourse.3"


def main():
    """校验源码工作树后生成确定性 ZIP、源码归档与摘要。"""
    if subprocess.check_output(["git", "status", "--porcelain"], cwd=ROOT).strip():
        raise SystemExit("源码工作树未提交，拒绝生成无法对应源码的发行包")
    revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    dist = ROOT / "packages/webgal/dist"
    pdfjs = ROOT / "node_modules/pdfjs-dist"
    pdf_assets = dist / "assets/pdfjs"
    for directory in ("cmaps", "standard_fonts", "wasm"):
        shutil.copytree(pdfjs / directory, pdf_assets / directory, dirs_exist_ok=True)
    shutil.copy2(pdfjs / "LICENSE", pdf_assets / "LICENSE")
    source_url = f"https://github.com/CountlessBugs/WebGAL-ReCourse/tree/{revision}"
    entry = "assets/recourse.js"
    metadata = {"id": "recourse.webgal", "version": VERSION, "upstream": "4.6.6", "api_version": 1,
                "source_revision": revision, "source_url": source_url, "entry": entry,
                "entry_sha256": hashlib.sha256((dist / entry).read_bytes()).hexdigest(),
                "modules": {p.relative_to(dist).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                            for p in sorted((dist / "assets").rglob("*"))
                            if p.is_file() and (p.suffix in {".js", ".mjs"} or pdf_assets in p.parents)}}
    (dist / "recourse-runtime.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    (dist / "LICENSE").write_bytes((ROOT / "LICENSE").read_bytes())
    (dist / "SOURCE.txt").write_text(f"WebGAL-ReCourse {VERSION}\nMPL-2.0\n{source_url}\n", encoding="utf-8")
    index = dist / "index.html"
    html = index.read_text(encoding="utf-8")
    html = re.sub(r'(<script type="module"[^>]*src=")[^"]+("[^>]*></script>)',
                  rf'\g<1>./{entry}\g<2>', html)
    marker = "<!-- ReCourse source:"
    if marker in html:
        html = html[:html.index(marker)].rstrip() + "\n"
    index.write_text(html + f"\n{marker} {source_url} ; license: MPL-2.0 -->\n", encoding="utf-8")
    release = ROOT / "dist"
    release.mkdir(exist_ok=True)
    archive = release / f"WebGAL-ReCourse-{VERSION}-web.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=9) as output:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                info = ZipInfo(path.relative_to(dist).as_posix(), (2026, 1, 1, 0, 0, 0))
                info.compress_type = ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                output.writestr(info, path.read_bytes())
    source = release / f"WebGAL-ReCourse-{VERSION}-source.zip"
    subprocess.run(["git", "archive", "--format=zip", f"--output={source}", revision], cwd=ROOT, check=True)
    checksums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in (archive, source))
    (release / "SHA256SUMS").write_text(checksums, encoding="utf-8")
    print(checksums, end="")


if __name__ == "__main__":
    main()
