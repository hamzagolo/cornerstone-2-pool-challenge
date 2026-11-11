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
- Mobile-friendly dark green pool-hall design

## Requirements
- Node.js 18 or newer
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install dependencies:

   ```bash
   npm install
   ```

4. Optional: copy `.env.example` to `.env` and set `ACCESS_CODE` to a private code for residents. Leave it blank for open-link access.
5. Start the app:

   ```bash
   npm run dev
   ```

6. Open the Vite URL shown in the terminal (usually http://localhost:5173). The `src/` folder must be beside `index.html` (it is included in this corrected ZIP).

For testing with another phone, both devices must be on the same Wi-Fi and the second device must use your computer's local network IP with port 5173. For real building-wide use, deploy it to a public HTTPS host.

## Deploy to Render (single service)
This starter is configured to serve the built React app and Socket.IO from one Node service.

- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: `NODE_ENV=production`
- Optional environment variable: `ACCESS_CODE=your-private-building-code`

The service must run as one instance because the first version keeps live player presence in server memory. Do not scale it to multiple instances without adding a shared store such as Redis.

## Important MVP notes
- Player presence is temporary and is removed when their browser disconnects.
- Waiting players expire after 15 minutes. The server enforces this, not just the browser countdown.
- This version does not send push notifications when a browser is closed; users see live challenges while the website is open.
- Use nicknames only. Do not ask residents to post apartment numbers or personal contact details.
- Before sharing publicly, set an access code and distribute it only to residents.
# cornerstone-2-pool-challenge
