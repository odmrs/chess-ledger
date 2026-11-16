# Chess Ledger

A small study companion for learning chess, following GM Rafael Leitão's training method.

- **Today** — the day's training, generated from the current chapter of `path.json`.
- **Path** — only the current chapter and the finished ones. Future chapters stay hidden on purpose.
- **Progress** — the ledger: habit, coordinates, puzzle accuracy, mistake types, monthly rating.

Games and ratings come from the public Lichess API. Puzzle-by-theme counts use an optional Lichess token (`puzzle:read`).
The training log is stored in a secret GitHub Gist, so it follows you across computers. Tokens stay in the browser's localStorage.

Static site, no build step: `index.html`, `style.css`, `app.js`, `path.json`.
