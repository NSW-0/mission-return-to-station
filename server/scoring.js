// Race against time: only a docked run scores.
//   score = seconds of fuel left × pointsPerSecond + shields left × pointsPerShield
// With the defaults (10 and 100) one shield is worth 10 seconds.
// The display shows the same formula live (public/js/strings.js scoreFor).

function scoreFor(fuelLeftMs, shields, rule) {
  return Math.round((Math.max(0, fuelLeftMs) / 1000) * rule.perSecond) + shields * rule.perShield;
}

module.exports = { scoreFor };
