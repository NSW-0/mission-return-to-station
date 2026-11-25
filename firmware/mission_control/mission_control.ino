/*
  Mission: Return to Station: buzz wire controller
  Board: Arduino Pro Micro (ATmega32U4), acting as a USB keyboard.

  Every contact on the two boards becomes ONE key press. The game reads
  KeyboardEvent.code (the physical key), so this works even when the laptop
  uses an Arabic keyboard layout.

  KEY MAP (must match config/settings.json "keys")
    Player 1: q = hit (loop touched the track)    w = docked (loop touched the docking pad)
              e = loop placed on the start pad    r = loop left the start pad
    Player 2: u = hit    i = docked    o = loop placed on the start pad    p = loop left the start pad

  WIRING
    Pin 2  Player 1 track (the long wire)
    Pin 3  Player 1 docking pad
    Pin 4  Player 1 start pad
    Pin 5  Player 2 track
    Pin 6  Player 2 docking pad
    Pin 7  Player 2 start pad
    Pin 8  Player 1 buzzer (+ leg; - leg to GND)
    Pin 9  Player 2 buzzer (+ leg; - leg to GND)
    Both hand-held loops go to GND.

  Inputs use INPUT_PULLUP, so a pin reads HIGH when nothing touches it and LOW
  when the loop (which is at GND) touches that wire or pad. No resistors needed.

  DEBOUNCE: a change is acted on immediately (so even a quick scrape counts),
  then that input ignores further changes for 25 ms. Metal-on-metal contact
  chatters, and this stops one touch from becoming several key presses.
  The game also ignores hits for 1000 ms after a hit (the "cooldown").

  BUZZERS: written for ACTIVE buzzers (they beep when given 5 V). Both can sound
  at once. If you have PASSIVE buzzers (they only click on 5 V), set
  PASSIVE_BUZZERS to 1; the sketch then uses tone(), which can only drive one
  buzzer at a time.

  TEST WITHOUT THE GAME: open Notepad, click in it, and touch each wire and pad
  with the loop. You should see one letter per touch: q w e r for Player 1 and
  u i o p for Player 2. Lifting the loop off a start pad types r or p.

  Upload: Arduino IDE > Tools > Board > "Arduino Micro" (or SparkFun Pro Micro
  5V/16MHz if you installed the SparkFun boards), pick the port, Upload.
*/

#include <Keyboard.h>

#define PASSIVE_BUZZERS 0     // 0 = active buzzers, 1 = passive buzzers
const unsigned long DEBOUNCE_MS = 25;
const unsigned long BEEP_MS = 250;
const unsigned int PASSIVE_TONE_HZ = 2200;
const unsigned long BOOT_DELAY_MS = 2000; // let the laptop finish recognising the keyboard

const uint8_t BUZZER_PIN[2] = { 8, 9 };

enum Role { TRACK, DOCK, START };

struct Input {
  uint8_t pin;
  uint8_t player;     // 0 = Player 1, 1 = Player 2
  Role role;
  char keyContact;    // sent when the loop touches (pin goes LOW)
  char keyRelease;    // sent when the loop lets go (pin goes HIGH), 0 = nothing
  bool touching;      // accepted state after debounce
  unsigned long lastChange;
};

Input inputs[] = {
  { 2, 0, TRACK, 'q', 0,   false, 0 },
  { 3, 0, DOCK,  'w', 0,   false, 0 },
  { 4, 0, START, 'e', 'r', false, 0 },
  { 5, 1, TRACK, 'u', 0,   false, 0 },
  { 6, 1, DOCK,  'i', 0,   false, 0 },
  { 7, 1, START, 'o', 'p', false, 0 },
};
const uint8_t INPUT_COUNT = sizeof(inputs) / sizeof(inputs[0]);

unsigned long beepUntil[2] = { 0, 0 };

void sendKey(char k) {
  // write() presses and releases the key. The Keyboard library sends the
  // physical key for a US layout, which is exactly the KeyboardEvent.code the
  // game reads, whatever layout Windows is set to.
  Keyboard.write(k);
}

void beep(uint8_t player) {
  beepUntil[player] = millis() + BEEP_MS;
#if PASSIVE_BUZZERS
  tone(BUZZER_PIN[player], PASSIVE_TONE_HZ, BEEP_MS);
#else
  digitalWrite(BUZZER_PIN[player], HIGH);
#endif
}

void updateBuzzers(unsigned long now) {
#if !PASSIVE_BUZZERS
  for (uint8_t p = 0; p < 2; p++) {
    if (beepUntil[p] && (long)(now - beepUntil[p]) >= 0) {
      digitalWrite(BUZZER_PIN[p], LOW);
      beepUntil[p] = 0;
    }
  }
#else
  (void)now; // tone() stops by itself
#endif
}

void setup() {
  for (uint8_t i = 0; i < INPUT_COUNT; i++) pinMode(inputs[i].pin, INPUT_PULLUP);
  for (uint8_t p = 0; p < 2; p++) {
    pinMode(BUZZER_PIN[p], OUTPUT);
    digitalWrite(BUZZER_PIN[p], LOW);
  }
  delay(BOOT_DELAY_MS);
  Keyboard.begin();

  // Read the starting state without sending hits. If a loop is already
  // resting on its start pad, tell the game (so it shows "Loop on the start pad").
  unsigned long now = millis();
  for (uint8_t i = 0; i < INPUT_COUNT; i++) {
    inputs[i].touching = digitalRead(inputs[i].pin) == LOW;
    inputs[i].lastChange = now;
    if (inputs[i].role == START && inputs[i].touching) sendKey(inputs[i].keyContact);
  }
}

void loop() {
  unsigned long now = millis();

  for (uint8_t i = 0; i < INPUT_COUNT; i++) {
    Input &in = inputs[i];
    bool touching = digitalRead(in.pin) == LOW;
    if (touching == in.touching) continue;
    if (now - in.lastChange < DEBOUNCE_MS) continue; // still chattering from the last change

    in.touching = touching;
    in.lastChange = now;

    if (touching) {
      sendKey(in.keyContact);
      if (in.role == TRACK) beep(in.player); // the physical buzzer only sounds on a hit
    } else if (in.keyRelease) {
      sendKey(in.keyRelease);
    }
  }

  updateBuzzers(now);
}
