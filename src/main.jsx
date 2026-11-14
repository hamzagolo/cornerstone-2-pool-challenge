import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import "./style.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || window.location.origin;
const socket = io(SERVER_URL, { autoConnect: true });
function getStablePlayerId() {
  let id = localStorage.getItem("c2-player-id");
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() || `c2-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("c2-player-id", id);
  }
  return id;
}
const WAIT_MS = 15 * 60 * 1000;

function timeLeft(expiresAt) {
  if (!expiresAt) return "";
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function App() {
  const [nickname, setNickname] = useState(localStorage.getItem("c2-nickname") || "");
  const [accessCode, setAccessCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [players, setPlayers] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [notice, setNotice] = useState("");
  const [incoming, setIncoming] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [pushStatus, setPushStatus] = useState("not-enabled");
  const [pushBusy, setPushBusy] = useState(false);
  const playerId = useMemo(() => getStablePlayerId(), []);
  const me = useMemo(() => players.find(p => p.socketId === socket.id), [players]);
  const myChallenge = challenges.find(c => c.fromId === socket.id || c.toId === socket.id);

  useEffect(() => {
    if ("serviceWorker" in navigator && "PushManager" in window) {
      navigator.serviceWorker.getRegistration().then(async registration => {
        if (!registration) return;
        const existing = await registration.pushManager.getSubscription();
        if (existing) setPushStatus("enabled");
      }).catch(() => {});
    }
    const tick = setInterval(() => setNow(Date.now()), 1000);
    socket.on("lobby:update", data => {
      setPlayers(data.players || []);
      setChallenges(data.challenges || []);
      if (socket.id && !(data.players || []).some(p => p.socketId === socket.id)) setJoined(false);
    });
    socket.on("challenge:received", data => setIncoming(data));
    socket.on("challenge:accepted", data => { setIncoming(null); setNotice(`Match confirmed! Head downstairs and play ${data.opponent}.`); });
    socket.on("challenge:declined", data => setNotice(`${data.opponent} couldn't play this time.`));
    return () => {
      clearInterval(tick);
      socket.off("lobby:update"); socket.off("challenge:received");
      socket.off("challenge:accepted"); socket.off("challenge:declined");
    };
  }, []);

  async function enableNotifications() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      setNotice("This browser does not support phone push notifications.");
      return;
    }
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Allow notifications in your browser settings to receive match alerts.");
      const keyResponse = await fetch(`${SERVER_URL}/api/push/public-key`);
      if (!keyResponse.ok) {
        const error = await keyResponse.json().catch(() => ({}));
        throw new Error(error.error || "Phone notifications are not configured on the server yet.");
      }
      const { publicKey } = await keyResponse.json();
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        const padding = "=".repeat((4 - publicKey.length % 4) % 4);
        const base64 = (publicKey + padding).replace(/-/g, "+").replace(/_/g, "/");
        const raw = atob(base64);
        const applicationServerKey = Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
        subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
      const saveResponse = await fetch(`${SERVER_URL}/api/push/subscribe`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, subscription: subscription.toJSON() })
      });
      const saved = await saveResponse.json().catch(() => ({}));
      if (!saveResponse.ok || !saved.ok) throw new Error(saved.error || "Could not save notification settings.");
      setPushStatus("enabled");
      setNotice("Phone notifications are enabled. We'll alert you when your challenge is accepted.");
    } catch (error) {
      setNotice(error.message || "Could not enable phone notifications.");
    } finally { setPushBusy(false); }
  }

  function join(e) {
    e.preventDefault();
    socket.emit("player:join", { nickname, accessCode, playerId }, result => {
      if (!result?.ok) return setNotice(result?.error || "Could not join.");
      localStorage.setItem("c2-nickname", nickname.trim());
      setJoined(true); setNotice("You're in the lobby. Your listing lasts up to 15 minutes.");
    });
  }
  function challenge(player) {
    socket.emit("challenge:send", { toId: player.socketId }, result => setNotice(result?.ok ? `Challenge sent to ${player.nickname}.` : result?.error));
  }
  function respond(accepted) {
    if (!incoming) return;
    socket.emit("challenge:respond", { id: incoming.id, accepted }, result => {
      if (!result?.ok) setNotice(result?.error || "Could not respond.");
      else if (!accepted) setNotice("Challenge declined.");
      setIncoming(null);
    });
  }
  function leave() {
    socket.emit("player:cancel"); setJoined(false); setNotice("You've left the lobby.");
  }
  function setPlaying() {
    socket.emit("player:playing"); setNotice("You're marked as playing. Have fun!");
  }
  function availableAgain() {
    socket.emit("player:available"); setNotice("You're back in the lobby for up to 15 minutes.");
  }

  const waiting = players.filter(p => p.status === "waiting");
  const others = waiting.filter(p => p.socketId !== socket.id);
  const mySeconds = me?.expiresAt ? Math.max(0, Math.ceil((me.expiresAt - now) / 1000)) : 0;

  return <main className="shell">
    <header className="topbar">
      <a className="brand" href="#"><span className="ball">8</span><span>CORNERSTONE <b>2</b><small>POOL CHALLENGE</small></span></a>
      <div className="topbar-actions">
        <span className="live"><i /> LIVE LOBBY</span>
        <button className="notify-button" type="button" onClick={enableNotifications} disabled={pushBusy || pushStatus === "enabled"}>
          {pushBusy ? "SETTING UP…" : pushStatus === "enabled" ? "✓ NOTIFICATIONS ON" : "🔔 ENABLE PHONE ALERTS"}
        </button>
      </div>
    </header>

    <section className="hero">
      <div className="eyebrow">YOUR BUILDING. YOUR TABLE. YOUR NEXT MATCH.</div>
      <h1>Who's ready<br/><em>for a game?</em></h1>
      <p>Find a neighbour, send a challenge, and get downstairs. No more playing alone.</p>
      {!joined ? <form className="join-card" onSubmit={join}>
        <label htmlFor="nickname">YOUR NICKNAME</label>
        <input id="nickname" value={nickname} onChange={e => setNickname(e.target.value)} maxLength="20" placeholder="e.g. Hamza" required />
        <label htmlFor="access">BUILDING ACCESS CODE <span>(if provided)</span></label>
        <input id="access" value={accessCode} onChange={e => setAccessCode(e.target.value)} placeholder="Enter access code" />
        <button className="primary" type="submit">🎱 &nbsp; I'M READY TO PLAY</button>
        <small className="privacy">Only use a nickname. Don't share your apartment number or personal details.</small>
      </form> : <div className="joined-card">
        <div><span className="check">✓</span><div><b>You're in the lobby, {nickname}.</b><small>Your listing expires in <strong>{timeLeft(me?.expiresAt)}</strong></small></div></div>
        <div className="joined-actions"><button className="outline" onClick={setPlaying}>I'm playing</button><button className="quiet" onClick={leave}>Leave lobby</button></div>
      </div>}
      {notice && <div className="notice" role="status">{notice}</div>}
    </section>

    {incoming && <section className="incoming">
      <div><span className="eyebrow">NEW CHALLENGE</span><h2>{incoming.fromName} wants to play!</h2><p>Ready to head downstairs?</p></div>
      <div className="challenge-actions"><button className="primary" onClick={() => respond(true)}>Accept</button><button className="outline" onClick={() => respond(false)}>Decline</button></div>
    </section>}

    <section className="lobby">
      <div className="section-head"><div><span className="eyebrow">THE NEIGHBOURHOOD</span><h2>Players waiting <span className="count">{waiting.length}</span></h2></div><span className="live"><i /> UPDATING LIVE</span></div>
      {!joined && <div className="hint">Join the lobby above to challenge a neighbour or let others know you're ready.</div>}
      {waiting.length === 0 ? <div className="empty"><div className="empty-icon">🎱</div><h3>No one's waiting just yet</h3><p>Be the first to call a game. Your neighbours will see you here.</p></div> :
        <div className="player-grid">{waiting.map(player => <article className="player-card" key={player.socketId}>
          <div className="player-top"><span className="avatar">{player.nickname.slice(0,1).toUpperCase()}</span><span className="available"><i/> AVAILABLE</span></div>
          <h3>{player.nickname} {player.socketId === socket.id && <small>(you)</small>}</h3>
          <div className="player-bottom"><span>⏱ {player.socketId === socket.id ? timeLeft(player.expiresAt) : timeLeft(player.expiresAt)} left</span>
            {player.socketId !== socket.id && joined && !myChallenge && <button className="challenge" onClick={() => challenge(player)}>Challenge ↗</button>}
            {player.socketId === socket.id && <span className="you-label">YOUR LISTING</span>}
          </div>
        </article>)}</div>}
      {joined && me?.status === "playing" && <div className="playing-banner"><b>You're marked as playing.</b><span>Finished your game?</span><button className="outline" onClick={availableAgain}>Find another opponent</button></div>}
      {myChallenge && <div className="hint pending">Challenge pending — hang tight. You can still leave the lobby.</div>}
    </section>
    <footer><span>© {new Date().getFullYear()} CORNERSTONE 2 POOL CHALLENGE</span><span>GOOD GAMES. GOOD NEIGHBOURS.</span></footer>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
