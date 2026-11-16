#!/usr/bin/env bash
set -euo pipefail
extension_id="${1:-${LINKRESURRECTOR_EXTENSION_ID:-}}"
if [[ ! "$extension_id" =~ ^[a-p]{32}$ ]]; then echo "Usage: $0 <32-character Chrome extension ID>" >&2; exit 2; fi
node_bin="$(command -v node || true)"
if [[ -z "$node_bin" ]] || (( $("$node_bin" -p 'Number(process.versions.node.split(".")[0])') < 18 )); then echo "Install Node.js 18 or newer, then rerun." >&2; exit 2; fi
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
python3 - "$extension_id" "$node_bin" "$source_dir" <<'PY'
import json, pathlib, sys, os
import shutil
ext,node,source=sys.argv[1:]
home=pathlib.Path.home()
install=home/".local/share/linkresurrector/native"
if install.exists(): shutil.rmtree(install)
shutil.copytree(pathlib.Path(source)/"src",install/"src")
shutil.copy2(pathlib.Path(source)/"native-host.js",install/"native-host.js")
shutil.copy2(pathlib.Path(source)/".env.example",install.parent/".env.example")
(install/"package.json").write_text('{"type":"module"}\n')
script=install/"native-host.js"
# Chromium's new native-host launcher (M124+) no longer forwards manifest
# "args", so the entrypoint lives in an executable wrapper: version-proof on
# old launchers too (they pass args=[] plus the origin, which is ignored).
launcher=install/"linkresurrector-host.sh"
launcher.write_text(
    "#!/usr/bin/env bash\n"
    "# LinkResurrector native messaging host launcher. \"$@\" is the caller\n"
    "# origin appended by the browser; the helper ignores extra argv.\n"
    f"exec {json.dumps(node)} {json.dumps(str(script))} \"$@\"\n"
)
os.chmod(launcher,0o755)
manifest={"name":"com.linkresurrector.native","description":"LinkResurrector on-device URL recovery helper","path":str(launcher),"type":"stdio","allowed_origins":[f"chrome-extension://{ext}/"]}
for target in (home/".config/google-chrome/NativeMessagingHosts", home/".config/BraveSoftware/Brave-Browser/NativeMessagingHosts", home/".config/chromium/NativeMessagingHosts"):
    target.mkdir(parents=True,exist_ok=True)
    (target/"com.linkresurrector.native.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(f"Installed native host registration: {target/'com.linkresurrector.native.json'}")
PY
echo "Restart Chrome, Chromium, or Brave to activate the native helper."
echo "Optional provider configuration template: $HOME/.local/share/linkresurrector/.env.example"
