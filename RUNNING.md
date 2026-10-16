# How to run and demo Less Receipts

This guide covers starting the stack, then clicking through the demo:

> **dashboard login → set up the till → sell → scan the QR → save the receipt in the wallet → pay → final receipt**

Commands run from the repo root unless a step says otherwise.

## 1. One-time setup

You need these installed:
- Docker Desktop, running
- Node 22.12 or newer
- An authenticator app on your phone (Google Authenticator, 1Password, …) for the dashboard's TOTP login

```sh
corepack enable pnpm            # gives you pnpm 12 (pinned in package.json)
pnpm install
```

## 2. Start everything

```sh
docker compose up -d --wait     # Postgres (5433), S3 mock (9090), Mailpit (1025 / web UI 8025)
pnpm db:migrate                 # schemas, roles, row-level security, job queues
pnpm db:seed                    # café "Café Het Plein", 2 tills, 200 receipts, owner + buyer users
pnpm dev                        # starts all 5 apps; leave this terminal open
```

The stack is ready when http://localhost:3001 loads. The wallet is built before it starts, so the first start takes about 20–30 s.

| What | URL | Who uses it |
|---|---|---|
| Merchant dashboard | http://localhost:3000/dashboard | the shop owner |
| POS simulator (the till) | http://localhost:3000/simulator | the till / cashier |
| Wallet + receipt viewer | http://localhost:3001 | the buyer (phone) |
| Mailpit (login codes) | http://localhost:8025 | you, to read the emailed codes |
| Merchant API docs | http://localhost:4001/docs | developers |
| Buyer API docs | http://localhost:4002/docs | developers |

### Demo logins (created by `pnpm db:seed`, local use only)

**Wallet (buyer): `buyer@example.test`**
- Open http://localhost:3001 and enter the email.
- There is no password; a 6-digit code is sent by email.
- Open Mailpit at http://localhost:8025, find the newest message to that address, and copy the code from the subject line ("Your login code: 123456").
- This buyer already has 30 receipts in the wallet.

You can also use any other address in the wallet, for example `me@example.test`. The login creates the account, and the code still arrives in Mailpit.

**Dashboard (merchant): `owner@example.test` with password `owner-dev-password`**
- Open http://localhost:3000/dashboard.
- On first login it asks you to enrol TOTP. Scan the QR or enter the shown secret/URI in an authenticator app, then enter the 6-digit code.
- Later logins only ask for the code.

The dashboard login only works if the seed ran. If it doesn't recognise the owner, run `pnpm db:seed` first.

> **The UI is now English-only.** The demo logins are unchanged: `buyer@example.test` in the wallet (code from Mailpit) and `owner@example.test` / `owner-dev-password` on the dashboard.

## 3. The demo flow (laptop only, no phone needed)

### Step 1: Log in to the dashboard (shop owner)
1. Open http://localhost:3000/dashboard and sign in as `owner@example.test` / `owner-dev-password`.
2. **First sign-in only:** the page shows a QR code. Scan it with your authenticator app, then type the 6-digit code. Later sign-ins only ask for the code.
3. You land on the **Archive**, which lists the 200 seeded receipts. Have a look around:
   - **Reports:** daily and monthly sales, BTW per rate, voids.
   - **Terminals:** the tills. "Create" shows the API key **once**. "Revoke" disables a till.
   - **Exports:** CSV and accountant BTW export (rubriek 1a/1b/1e). The download link is valid for 24 h.
   - **Locations, Organisation, Users:** setup and roles (owner, manager, accountant read-only).

### Step 2: Set up the till (once per browser)
1. In the same browser, open http://localhost:3000/simulator.
2. Click **Set up demo terminal**. This needs the dashboard session from step 1. The browser generates the till's signing keys and registers the public key, and the till appears under **Dashboard → Terminals**.

### Step 3: Sell and issue the receipt (cashier)
1. Click products (Koffie and Appeltaart at 9%, Bier and Wijn at 21%) to fill the cart.
2. Click **Issue receipt**. A large QR code appears. An issued receipt is taken as paid, so there is no pre-bill and no payment step.
3. The receipt URL is printed under the QR: `http://localhost:3001/r/<id>#<secret>`.

### Step 4: Open the receipt as the buyer
1. Copy the URL under the QR.
2. Open it in a **different browser profile or an incognito window**, so the buyer's session stays separate from the shop owner's. For a phone-shaped view, turn on Chrome DevTools → device toolbar → iPhone.
3. The receipt shows. Note that the `#secret` part is gone from the address bar.

### Step 5: Save it to the wallet
1. Click **Save to wallet**.
2. In demo mode (the default in development) the login is a plain form: press **Fill in the demo account**, then **Sign in**. No code is needed. With `DEMO_MODE=false`, enter an email and the 6-digit code from Mailpit (http://localhost:8025) instead.
3. The **"Save this receipt?"** sheet shows the shop, total and time. Click **Save to wallet**; **Not mine** closes it without saving. The receipt is now in the wallet.

### Step 6: Void (cashier)
1. Back in the simulator: click **Void**. This creates version 2.
2. Reload the receipt in the wallet. It shows the voided version, with the version history.
3. **Dashboard → Archive** shows the same receipt with its versions. It shows **no** information about who saved it: that's the privacy model.

### Step 7: Offline demos (optional)
- **Till offline:** in the simulator, tick **Offline** and make 3 sales. "Outbox" counts them as pending, and the QR codes still work. Untick **Offline** and all 3 appear in **Dashboard → Archive**.
- **Phone offline:** in the buyer window, open DevTools → Network → **Offline**, then open a new receipt link. It shows as **"Arriving"**. Switch back online and the receipt is saved without a reload. Receipts you already saved still open while offline.

### Other things to try in the wallet
- **Insights:** spend per month, per category and top merchants. It's most interesting with `buyer@example.test`.
- **Settings:** consents (all off by default), push opt-in, data export, delete account, logout.
- **Add receipt (photo):** upload a photo of a paper receipt. Extraction uses the recorded mock outputs (`EXTRACTOR=recorded`); a real Qianfan server is not wired in. **Browser upload to the local S3 mock has not been verified** and may fail; the API side is tested.

## 4. Demo with a real phone (QR scanned by the phone camera)

The phone has to reach two services over **HTTPS**: the wallet and the buyer API. Push notifications and offline mode only work over HTTPS. The easiest way is two Cloudflare quick tunnels.

```sh
brew install cloudflared
cloudflared tunnel --url http://localhost:3001     # terminal A → prints https://<wallet>.trycloudflare.com
cloudflared tunnel --url http://localhost:4002     # terminal B → prints https://<api>.trycloudflare.com
```

Stop `pnpm dev` (Ctrl+C), then restart it with the tunnel URLs.

The APIs do **not** read `.env` files, and Turborepo only passes environment variables through with `--env-mode=loose`, so export the variables and add that flag:

```sh
export RECEIPT_HOST=https://<wallet>.trycloudflare.com          # QR links, wallet CORS origin, push links
export NUXT_PUBLIC_BUYER_API=https://<api>.trycloudflare.com    # where the wallet calls the buyer API
pnpm dev --env-mode=loose
```

Then:
1. On the laptop, open the simulator. It's still on `http://localhost:3000`, and the QR now points to the tunnel. Issue a receipt.
2. Scan the QR with the **phone camera** and open the link. Then follow Steps 5–6 above on the phone. The login code still arrives in Mailpit on the laptop.
3. **Use Android + Chrome for the smoothest demo.** On iPhone the link opens in Safari. That works for viewing and saving, but push needs the wallet added to the Home Screen first (iOS 16.4+), and the Home Screen app has separate storage from Safari.
4. **Push:** in the wallet go to **Settings → push opt-in**, allow notifications, then pay the bill in the simulator. A notification should arrive. **Real push to a phone has not been verified yet.**

Quick tunnels get a new URL every time they start, so re-export both variables after restarting a tunnel.

## 5. Run the checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # ~2 min, needs Docker running
pnpm test:journey       # the whole receipt journey in 6 steps over real HTTP + Postgres
pnpm test:privacy       # proves no buyer data leaks to logs / merchant side
pnpm eval:extraction    # photo extraction on the MOCK receipts (labelled MOCK)
pnpm test:e2e           # Playwright browser tests; reuses a running `pnpm dev`, otherwise starts one
```

For the full final browser check from a clean database:

```sh
docker compose down -v && docker compose up -d --wait && pnpm db:migrate && pnpm db:seed
pnpm test:e2e && pnpm e2e:report     # report copied to docs/e2e-report/index.html
```

## 6. Stop and reset

```sh
# Ctrl+C in the `pnpm dev` terminal stops the apps
docker compose stop                 # stop the containers, keep data
docker compose down -v              # delete ALL local data (database, S3, mail); re-run migrate + seed after
```

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `pnpm dev` fails with "address already in use" | Another stack is already running on 3000/3001/4001/4002. Stop it (Ctrl+C in its terminal), or find it with `lsof -nP -iTCP:3001 -sTCP:LISTEN`. |
| Dashboard login returns **429** | The login limiter allows 20 attempts per IP per 5 minutes and is reset by restarting `pnpm dev`. Running the E2E suite several times in a row also trips it. |
| TOTP code rejected | Your computer's clock must be correct, and codes change every 30 s. If you enrolled against a database you have since reset, enrol again: the seed creates a fresh owner. |
| Simulator says to log in | It needs the dashboard session, so log in at `/dashboard` in the **same** browser. "Forget terminal" clears the till from this browser. |
| Receipt shows "Arriving" forever | The till hasn't uploaded yet. Check that the simulator's Offline box is unticked and Outbox shows 0 pending. |
| Login email never arrives | Codes are not really sent; they land in Mailpit at http://localhost:8025. |
| Env overrides have no effect | The APIs read only exported shell variables, not `.env` files, and need `pnpm dev --env-mode=loose`. |
| Wallet changes don't show up | The wallet runs as a built app (needed for offline mode). Restart `pnpm dev`, or use `pnpm --filter @lr/wallet dev:hmr` while developing it. |

## Known limitations (from the code review)

The demo flow above works. Before any real pilot, these review findings must be fixed:
- photo-match lets someone claim a receipt without its secret
- login-code brute force with parallel requests
- error logs can contain receipt data
- job-queue tables open to merchant-side roles
- the secret coming back into browser history
- leftover data after a session expires on a shared phone
- a few cases where the till's offline queue can get stuck
- the lead threshold compared as text

Avoid demoing on a **shared** phone, and don't present the photo-match feature as secure yet.
