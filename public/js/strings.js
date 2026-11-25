// Every visible text on the display and referee pages, in one place.
// {name}, {time}, {n}, {points} are filled in by the code.

export const STRINGS = {
  title:            'Mission: Return to Station',
  player:           'Player {n}',
  waitingPlayers:   'Waiting for players',
  loopOnPad:        'Loop on the start pad',
  loopOffPad:       'Place the loop on the start pad',
  refOnline:        'Referee phone connected',
  refOffline:       'Referee phone not connected (see the Connect tab)',

  // Player status
  statusWaiting:    'Not ready',
  statusReady:      'Ready',
  statusRacing:     'Racing',
  statusDocked:     'Docked {time} s',
  statusShieldsDown:'Shields down',
  statusOutOfFuel:  'Out of fuel',
  statusSittingOut: 'Solo race on the other side',

  fuel:             'Fuel',
  hits:             'Hits',
  shields:          'Shields',
  score:            'Score',
  points:           '{points} points',
  collisionAlert:   'Collision alert',
  go:               'GO',
  getReady:         'Hands steady',

  // Race messages
  falseStart:       'False start: {name}',
  falseStartHelp:   'Keep the loop on the start pad until GO. Referees, press Ready again.',
  winnerScore:      'Winner!',
  lastedLonger:     'Lasted longer!',
  moreShields:      'Kept more shields!',
  tie:              'Tie: rematch',
  missionComplete:  'Mission complete',
  missionFailed:    'Mission failed',
  manualFinishTag:  'referee finish',

  // Leaderboard
  leaderboard:      'Top scores',
  leaderboardEmpty: 'No dockings yet. The first steady hand takes the top spot.',
  colName:          'Name',
  colScore:         'Score',
  colTime:          'Time',
  colShields:       'Shields',
  scoreRule:        'Score = seconds of fuel left × {perSecond} + shields left × {perShield}',
  spaceFact:        'Did you know?',
  source:           'Source: {name}',

  // Display page system messages
  focusLost:        'Click here: the game window must be in front or hits will not count',
  serverLost:       'Lost contact with the game server. Is the black server window still open?',

  // Referee phone
  refTitle:         'Referee',
  nameLabel:        'Player name',
  namePlaceholder:  'Type the name',
  ready:            'Ready',
  cancelReady:      'Cancel ready',
  startSolo:        'Start solo race',
  soloHelp:         'Press Ready first',
  undoHit:          'Undo hit',
  testHit:          'Test hit',
  testHitHelp:      'Same as touching the wire. Turn off on /admin for the event.',
  manualFinish:     'Finish',
  manualFinishHelp: 'Docking pad did not register: docks the player now',
  reset:            'Reset',
  resetHelp:        'Ends the round. Nothing is saved.',
  connected:        'Connected',
  reconnecting:     'Reconnecting…',
  badKey:           'This link is out of date. Scan the QR code on the Connect page again.',
  phaseIdle:        'Type the name, then press Ready',
  phaseSoloOrWait:  'Waiting for the other referee, or start a solo race',
  phaseArmingWait:  'Waiting for the other referee',
  phaseCountdown:   'Countdown',
  phaseResult:      'Result on the big screen',
  youWon:           'Winner',
};

/** The text for a key with {placeholders} filled in. */
export function text(key, vars = {}) {
  const s = STRINGS[key];
  if (s == null) return key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}

/** Put a text into an element. */
export function put(el, key, vars) {
  el.textContent = text(key, vars);
}

export function seconds(ms, digits = 1) {
  return (Math.max(0, ms) / 1000).toFixed(digits);
}

/** Points a docked run scores. Must match server/scoring.js. */
export function scoreFor(fuelLeftMs, shields, rule) {
  return Math.round((Math.max(0, fuelLeftMs) / 1000) * rule.perSecond) + shields * rule.perShield;
}
