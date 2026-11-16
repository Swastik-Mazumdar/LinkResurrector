# Recovery engine and native helper

The recovery engine is shared by the Native Messaging host (`native-host.js`) and the optional development HTTP API (`index.js`). The extension uses Native Messaging; it never calls the HTTP API. The helper is launched on demand by Chrome or Brave and does not bind a localhost or public network port.

## Native helper installation

Requires Node.js 18+. Load the extension in Chrome or Brave, copy the extension ID from its extensions page, and run the matching installer from the repository root:

```bash
bash server/install-native-host.sh EXTENSION_ID          # macOS
bash server/install-native-host-linux.sh EXTENSION_ID    # Linux
powershell -ExecutionPolicy Bypass -File server/install-native-host.ps1 EXTENSION_ID # Windows
```

Installers register `com.linkresurrector.native` for the current user and allow only that extension ID. Restart the browser afterward. If the extension ID changes, run the installer again. The host uses stdin/stdout framed JSON as required by Native Messaging; all logs go to stderr so they cannot corrupt the protocol.

To configure optional search APIs, copy the installed `.env.example` to `.env` in the adjacent `LinkResurrector` application-support folder and set `BING_API_KEY` and/or `GOOGLE_API_KEY` plus `GOOGLE_CSE_ID`. The helper reads this file at process startup; system environment variables override it. On Unix, the helper restricts the config file to the current user when it reads it. Restart the browser after changing those values. Without credentials, the helper uses available redirect and Internet Archive evidence and reports reduced coverage. Never put API keys in the extension or commit them.

## Development HTTP API (optional)

```bash
node server/index.js
```

For project development, copy `.env.example` to `server/.env` before launching. The config loader reads it without an added dependency. This diagnostic API defaults to `127.0.0.1:8787`; it is separate from the extension runtime and refuses non-loopback `HOST` values.

## Tests

From the project root, run `npm test` for frontend/native-protocol tests. The engine's deterministic suite can be run with `node --test server/test/`. The helper and installer have not been installed on another machine as part of these repository tests.
