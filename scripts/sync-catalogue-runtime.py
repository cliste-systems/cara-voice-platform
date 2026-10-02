#!/usr/bin/env python3
"""Copy the reviewed app lookup runtime, preserving its matching and authorization.
Run after app catalogue changes: python3 scripts/sync-catalogue-runtime.py ../cara-platform
Generated files must not be edited independently. Manifest pins their source revision.
"""
import hashlib, json, pathlib, re, subprocess, sys
source = pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '../cara-platform').resolve()
target = pathlib.Path(__file__).resolve().parents[1] / 'src/lib/catalogue-runtime'
seen = set()
manifest = {'app_commit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(), 'files':{}, 'generated_files':{}}
def copy(name):
    if name in seen or name == 'utils/supabase/admin': return
    seen.add(name)
    origin = source/'src'/(name+'.ts')
    raw = origin.read_text()
    manifest['files'][name] = hashlib.sha256(raw.encode()).hexdigest()
    for dependency in re.findall(r'(?:from|import)\s+["\'](@/[^"\']+)["\']',raw): copy(dependency[2:])
    destination = target/(name+'.ts')
    destination.parent.mkdir(parents=True,exist_ok=True)
    def local(m):
        import os
        rel = os.path.relpath(target/(m[1][2:]+'.js'), destination.parent).replace('\\','/')
        return '"' + ('' if rel.startswith('.') else './') + rel + '"'

    text=re.sub(r'["\'](@/[^"\']+)["\']',local,raw)
    text=text.replace('import "server-only";','')
    text=text.replace('import { NextResponse } from "next/server";', 'const NextResponse = Response;')
    destination.write_text('// @ts-nocheck -- generated source is checked by the app build and catalogue tests.\n// Generated from cara-platform by scripts/sync-catalogue-runtime.py. Do not edit.\n'+text)
    manifest['generated_files'][name]=hashlib.sha256(destination.read_bytes()).hexdigest()
copy('app/api/voice/search-supervalu-products/route')
(target/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Synced {len(seen)} catalogue modules from {manifest["app_commit"]}')
