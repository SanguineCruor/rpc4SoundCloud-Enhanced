// rpc4SoundCloud Enhanced — content.js
const RELAY_URL = "ws://localhost:6989";
const POLL_INTERVAL_MS = 1000;

let socket = null;
let reconnectDelay = 1000;
let lastPayload = null;
let lastPosition = null;
let stuckCounter = 0;
let lastUrl = location.href;
let wasPlaying = false;

function clearPresence() {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(null));
  }
}

function connect() {
  socket = new WebSocket(RELAY_URL);
  socket.addEventListener("open", () => {
    console.log("[rpc4SoundCloud] connected to relay");
    reconnectDelay = 1000;
    lastPayload = null;
    lastPosition = null;
    stuckCounter = 0;
    clearPresence(); 
  });
  socket.addEventListener("close", scheduleReconnect);
  socket.addEventListener("error", () => socket.close());
}

function scheduleReconnect() {
  setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function readNowPlaying() {
  const ms = navigator.mediaSession;
  if (!ms || !ms.metadata) return null;

  const { title, artist, artwork } = ms.metadata;
  const artworkUrl = Array.isArray(artwork) && artwork.length > 0
    ? artwork[artwork.length - 1].src
    : null;

  const timeline = document.querySelector('.playbackTimeline__progressWrapper');
  
  let positionSeconds = null;
  let durationSeconds = null;
  let buffering = false;

  if (timeline) {
    const pos = timeline.getAttribute('aria-valuenow');
    const dur = timeline.getAttribute('aria-valuemax');
    if (pos !== null) positionSeconds = parseFloat(pos);
    if (dur !== null) durationSeconds = parseFloat(dur);
  }

  const isPlaying = ms.playbackState === "playing";

  // Если трек на паузе — принудительно очищаем статус
  if (!isPlaying && wasPlaying) {
    clearPresence();
    wasPlaying = false;
    return null; // Не отправляем данные, чтобы не висел статус
  }
  
  if (isPlaying) {
    wasPlaying = true;
  }

  if (positionSeconds === 0) {
    buffering = true;
  }

  if (positionSeconds !== null && lastPosition !== null && positionSeconds === lastPosition) {
    stuckCounter++;
    if (stuckCounter >= 2) buffering = true;
  } else {
    stuckCounter = 0;
  }
  lastPosition = positionSeconds;

  return {
    title: title || null,
    artist: artist || null,
    artworkUrl,
    playing: isPlaying,
    buffering: buffering,
    positionSeconds,
    durationSeconds,
    url: location.href,
  };
}

function tick() {
  if (location.href !== lastUrl) {
    lastUrl = location.href;
    lastPayload = null; 
    clearPresence(); 
  }

  const payload = readNowPlaying();
  if (!payload) {
    if (lastPayload !== null) {
        lastPayload = null;
        clearPresence();
    }
    return;
  }

  const serialized = JSON.stringify(payload);
  if (serialized !== lastPayload) {
    lastPayload = serialized;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(serialized);
    }
  }
}

connect();
setInterval(tick, POLL_INTERVAL_MS);
