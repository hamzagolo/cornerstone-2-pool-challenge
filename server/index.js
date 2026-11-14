import "dotenv/config";
import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import fs from "fs/promises";
import { fileURLToPath } from "url";
import { Server } from "socket.io";
import webpush from "web-push";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });

const PORT = process.env.PORT || 3001;
const ACCESS_CODE = process.env.ACCESS_CODE || "";
const WAIT_MS = 15 * 60 * 1000;

const SUBSCRIPTIONS_FILE =
  process.env.PUSH_SUBSCRIPTIONS_FILE ||
  path.join(__dirname, "push-subscriptions.json");

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

const pushReady = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushReady) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// One server instance for this MVP.
const players = new Map();
const challenges = new Map();

let subscriptions = {};

async function loadSubscriptions() {
  try {
    subscriptions = JSON.parse(await fs.readFile(SUBSCRIPTIONS_FILE, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not load subscriptions:", error);
    }
  }
}

async function saveSubscriptions() {
  await fs.mkdir(path.dirname(SUBSCRIPTIONS_FILE), {
    recursive: true,
  });

  await fs.writeFile(
    SUBSCRIPTIONS_FILE,
    JSON.stringify(subscriptions, null, 2),
    "utf8",
  );
}

async function sendPush(playerId, payload) {
  if (!pushReady || !playerId || !subscriptions[playerId]) {
    return;
  }

  try {
    await webpush.sendNotification(
      subscriptions[playerId],
      JSON.stringify(payload),
    );
  } catch (error) {
    if (error.statusCode === 404 || error.statusCode === 410) {
      delete subscriptions[playerId];
      await saveSubscriptions();
    } else {
      console.error("Push notification failed:", error.message);
    }
  }
}

await loadSubscriptions();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "Cornerstone 2 Pool Challenge",
    pushEnabled: pushReady,
  });
});

app.get("/api/push/public-key", (_req, res) => {
  if (!pushReady) {
    return res.status(503).json({
      ok: false,
      error: "Phone notifications are not configured yet.",
    });
  }

  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

app.post("/api/push/subscribe", async (req, res) => {
  const { playerId, subscription } = req.body || {};

  if (!pushReady) {
    return res.status(503).json({
      ok: false,
      error: "Phone notifications are not configured yet.",
    });
  }

  if (
    typeof playerId !== "string" ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(playerId) ||
    !subscription?.endpoint ||
    !subscription?.keys?.p256dh ||
    !subscription?.keys?.auth
  ) {
    return res.status(400).json({
      ok: false,
      error: "A valid player ID and push subscription are required.",
    });
  }

  subscriptions[playerId] = subscription;

  try {
    await saveSubscriptions();
    res.json({ ok: true });
  } catch (error) {
    console.error("Could not save push subscription:", error);
    res.status(500).json({
      ok: false,
      error: "Could not save notification settings.",
    });
  }
});

app.delete("/api/push/subscribe", async (req, res) => {
  const playerId = String(req.body?.playerId || "");

  if (playerId) {
    delete subscriptions[playerId];
  }

  try {
    await saveSubscriptions();
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

function publicPlayers() {
  return [...players.values()].map(
    ({ socketId, nickname, status, joinedAt, expiresAt }) => ({
      socketId,
      nickname,
      status,
      joinedAt,
      expiresAt,
    }),
  );
}

function broadcast() {
  io.emit("lobby:update", {
    players: publicPlayers(),
    challenges: [...challenges.values()],
  });
}

function cleanExpired() {
  const now = Date.now();
  let changed = false;

  for (const [id, player] of players) {
    if (player.status === "waiting" && player.expiresAt <= now) {
      players.delete(id);

      for (const [challengeId, challenge] of challenges) {
        if (challenge.fromId === id || challenge.toId === id) {
          challenges.delete(challengeId);
        }
      }

      changed = true;
    }
  }

  if (changed) broadcast();
}

setInterval(cleanExpired, 1000);

io.on("connection", (socket) => {
  socket.emit("lobby:update", {
    players: publicPlayers(),
    challenges: [...challenges.values()],
  });

  socket.on(
    "player:join",
    ({ nickname, accessCode, playerId } = {}, reply = () => {}) => {
      const cleanName = String(nickname || "")
        .trim()
        .slice(0, 20);
      const cleanPlayerId = String(playerId || "");

      if (!cleanName) {
        return reply({
          ok: false,
          error: "Enter a nickname first.",
        });
      }

      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(cleanPlayerId)) {
        return reply({
          ok: false,
          error: "Refresh the page and try again.",
        });
      }

      if (ACCESS_CODE && accessCode !== ACCESS_CODE) {
        return reply({
          ok: false,
          error: "That building access code is incorrect.",
        });
      }

      // Replace an older connection belonging to this browser.
      for (const [oldSocketId, oldPlayer] of players) {
        if (oldPlayer.playerId === cleanPlayerId && oldSocketId !== socket.id) {
          players.delete(oldSocketId);
        }
      }

      players.set(socket.id, {
        socketId: socket.id,
        playerId: cleanPlayerId,
        nickname: cleanName,
        status: "waiting",
        joinedAt: Date.now(),
        expiresAt: Date.now() + WAIT_MS,
      });

      reply({ ok: true });
      broadcast();
    },
  );

  socket.on("player:cancel", () => {
    players.delete(socket.id);

    for (const [id, challenge] of challenges) {
      if (challenge.fromId === socket.id || challenge.toId === socket.id) {
        challenges.delete(id);
      }
    }

    broadcast();
  });

  socket.on("player:playing", () => {
    const player = players.get(socket.id);

    if (player) {
      player.status = "playing";
      player.expiresAt = null;
      broadcast();
    }
  });

  socket.on("player:available", () => {
    const player = players.get(socket.id);

    if (player) {
      player.status = "waiting";
      player.joinedAt = Date.now();
      player.expiresAt = Date.now() + WAIT_MS;
      broadcast();
    }
  });

  socket.on("challenge:send", ({ toId } = {}, reply = () => {}) => {
    const from = players.get(socket.id);
    const to = players.get(toId);

    if (!from || from.status !== "waiting") {
      return reply({
        ok: false,
        error: "Join the lobby before challenging.",
      });
    }

    if (!to || to.status !== "waiting" || toId === socket.id) {
      return reply({
        ok: false,
        error: "That player is no longer available.",
      });
    }

    const existing = [...challenges.values()].find(
      (challenge) =>
        challenge.fromId === socket.id ||
        challenge.toId === socket.id ||
        challenge.fromId === toId ||
        challenge.toId === toId,
    );

    if (existing) {
      return reply({
        ok: false,
        error: "One of you already has a pending challenge.",
      });
    }

    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    challenges.set(id, {
      id,
      fromId: socket.id,
      fromPlayerId: from.playerId,
      fromName: from.nickname,
      toId,
      toName: to.nickname,
      createdAt: Date.now(),
    });

    reply({ ok: true });

    io.to(toId).emit("challenge:received", {
      id,
      fromName: from.nickname,
    });

    broadcast();
  });

  socket.on("challenge:respond", ({ id, accepted } = {}, reply = () => {}) => {
    const challenge = challenges.get(id);

    if (!challenge || challenge.toId !== socket.id) {
      return reply({
        ok: false,
        error: "This challenge is no longer active.",
      });
    }

    challenges.delete(id);

    if (accepted) {
      const challenger = players.get(challenge.fromId);
      const opponent = players.get(challenge.toId);

      if (challenger) {
        challenger.status = "playing";
        challenger.expiresAt = null;
      }

      if (opponent) {
        opponent.status = "playing";
        opponent.expiresAt = null;
      }

      io.to(challenge.fromId).emit("challenge:accepted", {
        opponent: challenge.toName,
      });

      io.to(challenge.toId).emit("challenge:accepted", {
        opponent: challenge.fromName,
      });

      // Notify the challenger, even if their browser is closed.
      void sendPush(challenge.fromPlayerId, {
        title: "Challenge accepted! 🎱",
        body: `${challenge.toName} accepted your pool challenge. Get ready to play!`,
        url: "/",
        tag: `challenge-${challenge.id}`,
      });
    } else {
      io.to(challenge.fromId).emit("challenge:declined", {
        opponent: challenge.toName,
      });
    }

    reply({ ok: true });
    broadcast();
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);

    // Preserve outgoing challenges if the challenger disconnects.
    // Remove challenges if the challenged player disconnects.
    for (const [id, challenge] of challenges) {
      if (challenge.toId === socket.id) {
        challenges.delete(id);
      }
    }

    broadcast();
  });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "../dist");

  app.use(express.static(clientDist));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

server.listen(PORT, () => {
  console.log(`Cornerstone 2 server listening on ${PORT}`);
});
