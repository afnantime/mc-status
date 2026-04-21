# MC Status — Minecraft Server Status Dashboard

A beautiful, real-time Minecraft server status checker built for **Cloudflare Pages + Workers**.

## Features

- ✅ Java & Bedrock edition support
- 🎨 Gorgeous dark dashboard with glassmorphism + particle background
- 📊 Players online, ping, MOTD, version, software info
- 🎨 Full Minecraft §-code MOTD color rendering
- 👥 Player list with Minecraft avatars (via crafthead.net)
- 🔍 Expandable debug information panel
- 📋 Copy server address / JSON response
- ⚡ Edge-cached API via Cloudflare Workers (30s TTL)

## Project Structure

```
mc-status/
├── public/
│   ├── index.html        # Main SPA
│   ├── style.css         # Full dark theme stylesheet
│   ├── app.js            # Frontend logic
│   ├── _headers          # Security headers
│   └── _redirects        # CF Pages routing
├── functions/
│   └── api/
│       └── status.js     # Cloudflare Pages Function (Worker)
├── wrangler.toml
└── package.json
```

## Local Development

```bash
npm install
npm run dev
# → http://127.0.0.1:8788
```

## Deploy to Cloudflare Pages

### Option 1 — Wrangler CLI

```bash
# Login first
npx wrangler login

# Deploy
npm run deploy
```

### Option 2 — Cloudflare Dashboard (Git)

1. Push this repo to GitHub/GitLab
2. Go to **Cloudflare Dashboard → Pages → Create a project**
3. Connect your repository
4. Set build settings:
   - **Build command**: *(leave empty)*
   - **Build output directory**: `public`
5. Deploy — Cloudflare will auto-detect `functions/` for Workers

## API

`GET /api/status`

| Param  | Type   | Required | Description                    |
|--------|--------|----------|--------------------------------|
| `host` | string | ✅       | Server hostname or IP          |
| `port` | number | ❌       | Server port                    |
| `type` | string | ❌       | `java` (default) or `bedrock`  |

**Example:**
```
/api/status?host=mc.hypixel.net&type=java
/api/status?host=play.felixcraft.xyz&port=19132&type=bedrock
```

## Powered By

- [mcsrvstat.us](https://mcsrvstat.us) — Minecraft server status API
- [crafthead.net](https://crafthead.net) — Player avatar rendering
- [Cloudflare Pages](https://pages.cloudflare.com) — Hosting & edge computing
