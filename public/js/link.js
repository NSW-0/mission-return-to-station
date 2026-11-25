// Connection to the game server, shared by the display, referee and admin pages.
// Reconnects by itself (Wi-Fi drops, phone screen locks) and keeps a clock offset
// so pages can show the server's monotonic race clock smoothly.

export function connect({ role, player, key, onState, onEvent, onConfig, onAssets, onStatus, onDenied }) {
  let ws = null;
  let retryMs = 500;
  let lastMessageAt = 0;
  let closedByDenial = false;
  const offsets = []; // recent (serverNow - localNow) samples
  let version = null;  // page files version; a change means this page is out of date

  function status(s) { if (onStatus) onStatus(s); }

  function open() {
    if (closedByDenial) return;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);
    status('connecting');
    ws.onopen = () => {
      retryMs = 500;
      lastMessageAt = performance.now();
      ws.send(JSON.stringify({ t: 'hello', role, player, key }));
      status('open');
    };
    ws.onmessage = (ev) => {
      lastMessageAt = performance.now();
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'state') {
        sample(msg.state.now);
        if (onState) onState(msg);
      } else if (msg.t === 'event') {
        if (onEvent) onEvent(msg);
      } else if (msg.t === 'reload') {
        location.reload();
      } else if (msg.t === 'config') {
        // After a reconnect (for example the game was restarted with an update),
        // a different version means this page is old: load the new one.
        if (msg.version && version && msg.version !== version) { location.reload(); return; }
        if (msg.version) version = msg.version;
        if (onConfig) onConfig(msg);
      } else if (msg.t === 'assets') {
        if (onAssets) onAssets(msg.files);
      } else if (msg.t === 'denied') {
        closedByDenial = true;
        if (onDenied) onDenied(msg.reason);
      }
    };
    ws.onclose = () => {
      status('closed');
      if (closedByDenial) return;
      setTimeout(open, retryMs);
      retryMs = Math.min(4000, retryMs * 1.6);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* already closed */ } };
  }

  // The server sends state at least once a second. Silence means a dead link
  // (common on phones after the screen locks), so force a fresh connection.
  setInterval(() => {
    if (ws && ws.readyState === 1 && performance.now() - lastMessageAt > 3500) {
      try { ws.close(); } catch { /* ignore */ }
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && ws && ws.readyState !== 1 && ws.readyState !== 0) open();
  });

  function sample(serverNow) {
    offsets.push(serverNow - performance.now());
    if (offsets.length > 8) offsets.shift();
  }

  open();

  return {
    send(msg) {
      if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
        return true;
      }
      return false;
    },
    /** The server's monotonic clock, estimated locally. The max of recent samples has the least network delay in it. */
    serverNow() {
      if (!offsets.length) return performance.now();
      return performance.now() + Math.max(...offsets);
    },
    isOpen() { return ws && ws.readyState === 1; },
  };
}
