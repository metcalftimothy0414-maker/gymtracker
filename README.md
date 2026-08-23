# PRT-47 — Push-up Intercept Tracker

Single-file, no-build, offline-capable training log for an ankle-safe upper-body split,
built around one question: **will the trend line cross 47 before test day?**

Live: `https://metcalftimothy0414-maker.github.io/gymtracker/`

---

## What v2 fixes

**The date bug.** v1 stored every key with `toISOString().slice(0,10)` — that's UTC.
In Pacific time, anything checked off after 5:00 PM local was written to *tomorrow's*
key, while the streak counter walked backward in *local* time and found those days
empty. Evening sessions were silently resetting the streak. Every date operation in v2
uses local calendar dates.

Also fixed:
- Tapping the ankle checkbox fired the toggle twice and cancelled itself out.
- The chart spaced points evenly regardless of date gaps, so a 9-day layoff looked
  identical to a 1-day gap.
- The streak read 0 until you ticked something *today*, mid-run.
- There was no way to view, edit, or backfill any day other than today.

## What's new

**Date navigation.** Arrows, a date picker, swipe left/right, or tap any calendar cell.
Every screen — checklist, sets, readiness, test log, body weight — writes to the
selected date, so a missed day can be backfilled honestly.

**Per-exercise set logging.** Weight × reps per set, stored by exercise *name* so
history survives program edits. Each exercise shows what you did last time with a
one-tap **use** button to copy it forward. That's the whole point of progressive
overload and v1 had none of it.

**The intercept gauge.** Least-squares regression over your last 12 max tests,
projected to test day, against the 47-rep line. Reports rate (reps/week), sample size,
R², the projected number, and the reps/week required from your latest test to close the
gap. Flags a noisy fit rather than pretending R²=0.3 is a forecast. Needs n≥2 and says
so plainly until then.

**Rest timer** with 60/90/180s presets, audible tone and haptic buzz.

**Month view** — completion heatmap, current and longest streak, sessions completed,
adherence at 7/28/90 days, and weekly tonnage with week-over-week change.

**Editable program.** Change the split, the test date, and the rep goal in Setup
instead of editing source. Mark any weekday a rest day and it stops breaking the streak.

**Export / import.** localStorage is one "clear website data" away from gone.
Download a JSON backup or copy it to the clipboard; restore by pasting it back.

**Offline.** Installs to the home screen, opens with no signal.

## Deploy

Push `index.html` (required), plus `manifest.json` and `sw.js` (optional — home-screen
install and offline). Settings → Pages → Source: `main` / root.

`index.html` works standalone. Without the other two you lose offline and the app icon.

## Data

Everything is in `localStorage` under a single key, `prt47:v2`. Nothing leaves the
device — no accounts, no server, no analytics. v1 data (`pushupLog`, `checklist_*`,
`ankle_*`) is migrated automatically on first load; old keys are left untouched as a
fallback.

Cross-device sync would need a backend. Until then, export monthly.

## Editing the program

Setup tab → pick a weekday → one exercise per line:

```
Machine chest press | 4×10-12 | load
Push-up ladder      | 5/10/15/10/5 | reps
Recumbent bike      | 20 min | time
Core circuit        |  | check
```

Type controls the input: `load` = weight × reps (counts toward tonnage),
`reps` = bodyweight reps, `time` = minutes, `check` = tick only.

## Tests

`test.js` runs the page in jsdom — 76 assertions covering v1 migration, local-date
handling across DST and month boundaries, regression math, streak semantics, set
logging, backfill, calendar, program parsing, HTML escaping, and backup round-trip.

```
npm install jsdom
TZ=America/Los_Angeles node test.js
```
