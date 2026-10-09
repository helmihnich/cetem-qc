# CETEM-QC mobile (Technicien)

## Run on a phone with Expo Go

1. Put the phone and the development computer on the same Wi-Fi network.
2. Start the API so it listens on the network: set `HOST=0.0.0.0` in the root `.env`, then `pnpm dev:api`.
   Allow Node.js through the Windows firewall (private networks) when prompted, or open TCP port 3001.
3. Start Expo: `pnpm dev:mobile` (runs `expo start --lan`) and scan the QR code with Expo Go (Android) or the Camera app (iOS).

The app finds the API on its own: when `EXPO_PUBLIC_API_URL` is not set, it uses the computer that serves the bundle
(the Expo dev server's LAN address) on port 3001. If the phone cannot reach the computer directly (guest Wi-Fi,
client isolation), use `pnpm --filter @cetem-qc/mobile start:tunnel` together with a publicly reachable API in
`EXPO_PUBLIC_API_URL`.

Expo Go ships SQLite without SQLCipher, so local drafts are stored unencrypted while running inside Expo Go; a development
or production build applies the `useSQLCipher` plugin from `app.json`.

## API address override

`EXPO_PUBLIC_API_URL` (read when Expo bundles JavaScript) overrides the automatic address. Set it to the API origin only;
the client appends `/api/v1` itself. Restart Expo after changing the value.

```powershell
$env:EXPO_PUBLIC_API_URL = "http://192.168.1.20:3001"
pnpm --filter @cetem-qc/mobile start
```

- **iOS Simulator:** `http://127.0.0.1:3001`.
- **Android Emulator:** `http://10.0.2.2:3001`.
- **Hosted API:** its HTTPS origin, for example `https://api.example.test`.

Do not put credentials, access tokens, or other secrets in `EXPO_PUBLIC_API_URL`; Expo embeds public environment values in the client bundle.
