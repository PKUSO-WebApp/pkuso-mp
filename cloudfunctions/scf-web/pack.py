#!/usr/bin/env python3
"""把 SCF Web 函数的部署包打成 zip。

部署包 = app.js + core.js（= ../supabase-proxy/index.js 的现拷）+ scf_bootstrap。
scf_bootstrap 写入 0755 可执行位（Windows 下普通压缩工具打不出这个位，而 SCF
Web 函数要求启动文件可执行）。

用法：python cloudfunctions/scf-web/pack.py [输出路径，默认 <本目录>/scf-web.zip]
"""

import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
CORE_SRC = os.path.join(HERE, "..", "supabase-proxy", "index.js")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "scf-web.zip")

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(os.path.join(HERE, "app.js"), "app.js")
    z.write(CORE_SRC, "core.js")
    info = zipfile.ZipInfo.from_file(os.path.join(HERE, "scf_bootstrap"), "scf_bootstrap")
    info.external_attr = (0o755 << 16) | 0o20  # -rwxr-xr-x
    info.compress_type = zipfile.ZIP_DEFLATED
    with open(os.path.join(HERE, "scf_bootstrap"), "rb") as f:
        z.writestr(info, f.read())

print("written:", OUT, os.path.getsize(OUT), "bytes")
