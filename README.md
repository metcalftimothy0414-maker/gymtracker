[README.md](https://github.com/user-attachments/files/31355407/README.md)
# Operation Ripped — PRT-47 Tracker

Static single-file tracker for the Aug 23 → Oct 22 program:
- Daily workout checklist (auto-rotates by day of week — ankle-safe upper body split)
- Push-up log with progress chart toward the 47-rep goal
- Streak counter
- Countdown to Oct 22
- Ankle status check-in

## Deploy to GitHub Pages
1. Push this repo (just `index.html`) to a new GitHub repo.
2. Repo Settings → Pages → Source: `main` branch, `/ (root)`.
3. Site goes live at `https://<username>.github.io/<repo-name>/`.

No build step, no dependencies — pure HTML/CSS/JS. Data is stored in the browser's localStorage, so it stays on whatever device you open the site on (same as before — if you want cross-device sync later, that'd need a small backend, but for daily accountability this is enough).

## Editing the workout schedule
Edit the `WORKOUTS` object in `index.html` — keyed by day of week (0=Sunday...6=Saturday).
