import express from "express";
import http from "http";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { Server } from "socket.io";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3001;
const ACCESS_CODE = process.env.ACCESS_CODE || "";
const WAIT_MS = 15 * 60 * 1000;

// In-memory presence: this MVP is intended for one running server instance.
const players = new Map(); // socketId -> player
const challenges = new Map(); // challengeId -> challenge

app.use(cors());
app.get("/api/health", (_req, res) => res.json({ ok: true, app: "Cornerstone 2 Pool Challenge" }));

function publicPlayers() {
  return [...players.values()].map(({ socketId, nickname, status, joinedAt, expiresAt }) => ({
    socketId, nickname, status, joinedAt, expiresAt
  }));
}
function broadcast() {
  io.emit("lobby:update", { players: publicPlayers(), challenges: [...challenges.values()] });
}
function cleanExpired() {
  const now = Date.now();
  let changed = false;
  for (const [id, player] of players) {
    if (player.status === "waiting" && player.expiresAt <= now) {
      players.delete(id);
      for (const [challengeId, challenge] of challenges) {
        if (challenge.fromId === id || challenge.toId === id) challenges.delete(challengeId);
      }
      changed = true;
    }
  }
  if (changed) broadcast();
}
setInterval(cleanExpired, 1000);

io.on("connection", (socket) => {
  socket.emit("lobby:update", { players: publicPlayers(), challenges: [...challenges.values()] });

  socket.on("player:join", ({ nickname, accessCode } = {}, reply = () => {}) => {
    const cleanName = String(nickname || "").trim().slice(0, 20);
    if (!cleanName) return reply({ ok: false, error: "Enter a nickname first." });
    if (ACCESS_CODE && accessCode !== ACCESS_CODE) return reply({ ok: false, error: "That building access code is incorrect." });

    // A reconnect/new tab replaces the same socket's old presence only.
    players.set(socket.id, {
      socketId: socket.id, nickname: cleanName, status: "waiting",
      joinedAt: Date.now(), expiresAt: Date.now() + WAIT_MS
    });
    reply({ ok: true });
    broadcast();
  });

  socket.on("player:cancel", () => {
    players.delete(socket.id);
    for (const [id, c] of challenges) if (c.fromId === socket.id || c.toId === socket.id) challenges.delete(id);
    broadcast();
  });

  socket.on("player:playing", () => {
    const player = players.get(socket.id);
    if (player) { player.status = "playing"; player.expiresAt = null; broadcast(); }
  });

  socket.on("player:available", () => {
    const player = players.get(socket.id);
    if (player) { player.status = "waiting"; player.joinedAt = Date.now(); player.expiresAt = Date.now() + WAIT_MS; broadcast(); }
  });

  socket.on("challenge:send", ({ toId } = {}, reply = () => {}) => {
    const from = players.get(socket.id);
    const to = players.get(toId);
    if (!from || from.status !== "waiting") return reply({ ok: false, error: "Join the lobby before challenging." });
    if (!to || to.status !== "waiting" || toId === socket.id) return reply({ ok: false, error: "That player is no longer available." });
    const existing = [...challenges.values()].find(c => c.fromId === socket.id || c.toId === socket.id || c.fromId === toId || c.toId === toId);
    if (existing) return reply({ ok: false, error: "One of you already has a pending challenge." });
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    challenges.set(id, { id, fromId: socket.id, fromName: from.nickname, toId, toName: to.nickname, createdAt: Date.now() });
    reply({ ok: true });
    io.to(toId).emit("challenge:received", { id, fromName: from.nickname });
    broadcast();
  });

  socket.on("challenge:respond", ({ id, accepted } = {}, reply = () => {}) => {
    const challenge = challenges.get(id);
    if (!challenge || challenge.toId !== socket.id) return reply({ ok: false, error: "This challenge is no longer active." });
    challenges.delete(id);
    if (accepted) {
      const a = players.get(challenge.fromId);
      const b = players.get(challenge.toId);
      if (a) { a.status = "playing"; a.expiresAt = null; }
      if (b) { b.status = "playing"; b.expiresAt = null; }
      io.to(challenge.fromId).emit("challenge:accepted", { opponent: challenge.toName });
      io.to(challenge.toId).emit("challenge:accepted", { opponent: challenge.fromName });
    } else {
      io.to(challenge.fromId).emit("challenge:declined", { opponent: challenge.toName });
    }
    reply({ ok: true });
    broadcast();
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    for (const [id, c] of challenges) if (c.fromId === socket.id || c.toId === socket.id) challenges.delete(id);
    broadcast();
  });
});

if (process.env.NODE_ENV === "production") {
  const clientDist = path.join(__dirname, "../dist");
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}
server.listen(PORT, () => console.log(`Cornerstone 2 server listening on ${PORT}`));
