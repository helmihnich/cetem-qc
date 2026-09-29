# Mobile API connection

The app reads `EXPO_PUBLIC_API_URL` when Expo bundles JavaScript. Set it to the API origin only; the client appends `/api/v1` itself. Restart Expo after changing the value.

PowerShell example:

```powershell
$env:EXPO_PUBLIC_API_URL = "http://127.0.0.1:3001"
pnpm --filter @cetem-qc/mobile start
```

Use an address reachable from the device running the app:

- **iOS Simulator:** `http://127.0.0.1:3001` reaches the development computer's loopback API.
- **Android Emulator:** `http://10.0.2.2:3001` reaches the development computer from the standard Android emulator.
- **Physical device on a LAN:** use `http://<development-computer-LAN-IP>:3001`. The API must listen on a LAN-reachable interface and the computer firewall must allow the port. The current API development entry point binds to `127.0.0.1`, so it is not directly reachable by a physical device; use a LAN-accessible API deployment or launcher for this case.
- **Hosted API:** use its HTTPS origin, for example `https://api.example.test`.

Do not put credentials, access tokens, or other secrets in `EXPO_PUBLIC_API_URL`; Expo embeds public environment values in the client bundle.
