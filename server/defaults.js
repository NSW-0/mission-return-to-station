// Default settings. The live copy is config/settings.json (created on first start)
// and can be edited there or on the /admin page.
module.exports = {
  fuelSeconds: 60,
  shields: 3,
  hitCooldownMs: 1000,
  countdownSeconds: 3,
  resultSeconds: 3, // result screen, then the scores
  // Score for a docked run = seconds of fuel left × pointsPerSecond + shields left × pointsPerShield
  pointsPerSecond: 10,
  pointsPerShield: 100,
  falseStartSeconds: 4, // how long "False start: <name>" stays on screen
  port: 3000,
  // Leave empty to detect the laptop's Wi-Fi address automatically.
  // Set an address (for example "192.168.137.1" for a Windows hotspot) to force it.
  hostOverride: '',
  // Referee links carry a short key so people in the audience cannot control the game.
  requireRefKey: true,
  // A "Test hit" button on the referee phones, for trying the game without the boards.
  // Turn it off on event day so nobody taps it by accident.
  refTestButtons: true,
  colors: {
    p1: '#4F8BFF', // signal blue: mid lightness
    p2: '#FF5C5C', // signal red: warm against P1's cool blue, so the halves differ for colour-blind viewers too
  },
  // KeyboardEvent.code values sent by the Arduino Pro Micro. Must match the firmware.
  keys: {
    p1: { hit: 'KeyQ', dock: 'KeyW', padOn: 'KeyE', padOff: 'KeyR' },
    p2: { hit: 'KeyU', dock: 'KeyI', padOn: 'KeyO', padOff: 'KeyP' },
  },
  // Only facts with a source.
  facts: [
    {
      text: 'About 40,000 objects in orbit are tracked, and over 1.2 million pieces of debris larger than 1 cm are estimated to be up there.',
      source: 'ESA Space Environment Report 2025',
    },
    {
      text: 'Debris moves so fast that a 1 cm fragment can hit with the energy of a small car at 40 km/h.',
      source: 'ESA',
    },
    {
      text: 'By November 2024 the International Space Station had moved 39 times to dodge debris.',
      source: 'NASA',
    },
  ],
};
