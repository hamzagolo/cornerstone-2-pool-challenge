# Cornerstone 2 Pool Challenge

A real-time, mobile-friendly pool matchmaking website for residents of Cornerstone 2.

## Included
- Live lobby using Socket.IO
- Join with a nickname
- Optional shared building access code
- Challenge another available player
- Accept or decline incoming challenges
- Mark yourself as playing / available again
- Waiting listings automatically expire after 15 minutes
- Phone push notification to the challenger when their opponent accepts
- Web app manifest and service worker for installed-phone notifications

## Run locally
1. Extract the ZIP and open a terminal in the project folder.
2. Install dependencies: `npm install`
3. Generate VAPID keys once: `npx web-push generate-vapid-keys`
4. Copy `.env.example` to `.env` and add the generated `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and a `VAPID_SUBJECT` email address you control. Optionally set `ACCESS_CODE`.
5. Start the app: `npm run dev`
6. Open the Vite URL shown in the terminal (usually http://localhost:5173).

For real phone push testing, use an HTTPS deployment; localhost is supported by some browsers for development.

## Enable phone notifications
1. Open the deployed website on the phone.
2. Tap **ENABLE PHONE ALERTS**.
3. Allow notifications when prompted.
4. The player can close the website. When someone accepts their challenge, the phone receives a push notification.

On iPhone (iOS 16.4 or later), open the site in Safari, choose **Add to Home Screen**, launch the installed web app from its Home Screen icon, and then enable notifications from inside that installed app. Android users can enable notifications in a supported browser.

## Deploy to Render (single service)
Build command: `npm install && npm run build`

Start command: `npm start`

Set these Render environment variables:
- `NODE_ENV=production`
- `VAPID_PUBLIC_KEY` = generated public key
- `VAPID_PRIVATE_KEY` = generated private key
- `VAPID_SUBJECT` = `mailto:your-real-email@example.com`
- `PUSH_SUBSCRIPTIONS_FILE` = `/var/data/push-subscriptions.json`
- `ACCESS_CODE` = optional private building code

**Persistent storage is required:** attach a persistent disk mounted at `/var/data`. Push subscriptions are saved there so they survive restarts and deploys. Without a persistent disk (or database-backed subscription store), subscriptions on Render's temporary filesystem can be lost. Keep one server instance for this MVP.

Do not share the VAPID private key publicly or commit it to GitHub. Put it only in local `.env` and Render environment variables.

## Important MVP notes
- Player presence and pending challenges remain in server memory. Run one server instance.
- Waiting players expire after 15 minutes. The server enforces this.
- Push delivery depends on browser permission and a valid subscription.
- This version sends the push notification to the person who sent the challenge when the opponent accepts it.
- Use nicknames only. Do not ask residents to post apartment numbers or personal contact details.
