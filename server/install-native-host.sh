#!/usr/bin/env bash
set -euo pipefail

extension_id="${1:-${LINKRESURRECTOR_EXTENSION_ID:-}}"
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then
  echo "Usage: $0 <32-character Chrome extension ID>" >&2
  exit 2
fi
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]]; then
  echo "Node.js 18 or newer is required. Install it, then rerun this installer." >&2
  exit 2
fi
node_major="$("$node_bin" -p 'Number(process.versions.node.split(".")[0])')"
if (( node_major < 18 )); then echo "Node.js 18 or newer is required (found $node_major)." >&2; exit 2; fi
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$extension_id" "$node_bin" "$source_dir" <<'PY'
import json, pathlib, sys, os
import shutil
extension_id, node, source = sys.argv[1:]
base = pathlib.Path.home()
install = base/"Library/Application Support/LinkResurrector/native"
if install.exists(): shutil.rmtree(install)
shutil.copytree(pathlib.Path(source)/"src", install/"src")
shutil.copy2(pathlib.Path(source)/"native-host.js", install/"native-host.js")
shutil.copy2(pathlib.Path(source)/".env.example", install.parent/".env.example")
(install/"package.json").write_text('{"type":"module"}\n')
script = install/"native-host.js"
# Chromium's new native-host launcher (M124+, shipped in Brave 157) no longer
# forwards manifest "args" — it launches `path` with only the caller origin.
# So the entrypoint lives in an executable wrapper instead: version-proof on
# old launchers too (they pass args=[] plus the origin, which is ignored).
launcher = install/"linkresurrector-host.sh"
launcher.write_text(
    "#!/usr/bin/env bash\n"
    "# LinkResurrector native messaging host launcher. \"$@\" is the caller\n"
    "# origin appended by the browser; the helper ignores extra argv.\n"
    f"exec {json.dumps(node)} {json.dumps(str(script))} \"$@\"\n"
)
os.chmod(launcher, 0o755)
manifest = {"name":"com.linkresurrector.native", "description":"LinkResurrector on-device URL recovery helper", "path":str(launcher), "type":"stdio", "allowed_origins":[f"chrome-extension://{extension_id}/"]}
targets = [base/"Library/Application Support/Google/Chrome/NativeMessagingHosts", base/"Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"]
for target in targets:
    target.mkdir(parents=True, exist_ok=True)
    (target/"com.linkresurrector.native.json").write_text(json.dumps(manifest, indent=2)+"\n")
    print(f"Installed native host registration: {target/'com.linkresurrector.native.json'}")
PY
echo "Restart Chrome or Brave to activate the native helper."
echo "Optional provider configuration template: $HOME/Library/Application Support/LinkResurrector/.env.example"
