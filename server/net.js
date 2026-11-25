const os = require('os');

// Adapters that are almost never the network the phones are on.
const VIRTUAL = /vethernet|virtual|vmware|vbox|virtualbox|hyper-v|docker|wsl|loopback|tailscale|zerotier|bluetooth|npcap|vpn|tap|tun/i;
const WIFI = /wi-?fi|wlan|wireless|airport|^en0$/i;
const HOTSPOT = /local area connection\*|ap\d|hotspot/i;

/** Every IPv4 address of this laptop, best guess first. */
function listAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal || a.address.startsWith('169.254.')) continue;
      let score = 0;
      if (WIFI.test(name)) score += 30;
      if (HOTSPOT.test(name) || a.address.startsWith('192.168.137.')) score += 20; // Windows mobile hotspot
      if (/^192\.168\./.test(a.address)) score += 10;
      else if (/^10\./.test(a.address) || /^172\.(1[6-9]|2\d|3[01])\./.test(a.address)) score += 5;
      if (VIRTUAL.test(name)) score -= 100;
      out.push({ name, address: a.address, score });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

/** The address the phones should use: the override from settings, else the best guess. */
function pickHost(override) {
  if (override) return override;
  const list = listAddresses();
  return list.length ? list[0].address : 'localhost';
}

/** True when a connection comes from this laptop itself. */
function isLocalAddress(remote) {
  if (!remote) return false;
  const addr = remote.replace(/^::ffff:/, '');
  if (addr === '127.0.0.1' || addr === '::1' || addr === 'localhost') return true;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) if (a.address === addr) return true;
  }
  return false;
}

module.exports = { listAddresses, pickHost, isLocalAddress };
