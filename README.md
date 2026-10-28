# 3rd Iris · Grimoire

A productivity and life-management app for a creative entrepreneur, styled as the 3rd Iris logo inverted: bone ink on a midnight page. Think whimsigoth meets dark academia, a cozy occult library.

## Sections

| | |
|---|---|
| **Sanctum** | Overview of the month: income, spending, net, budget left, bills due and expected in the next two weeks, today's tasks, upcoming appointments, spending by category, recent entries, client counts and the moon phase |
| **Ledger** | Personal and business expenses and income, each with a frequency (one-time, weekly, every 2 weeks, twice a month on chosen days, monthly, quarterly or annual). Recurring entries show when they're next due and are projected into the months ahead, with a projected month-end balance; recording a projected entry moves its series forward. One-time entries can have a fixed due date. Sort by any column, filter by month, kind and purse, search, bulk import, and export to CSV. A calendar view shows each day's entries, due dates, and recurring entries projected forward |
| **Agenda** | To-do list arranged as an Eisenhower matrix of four arcana: **I · The Tower** (urgent & important: do it now), **II · The Star** (important, not urgent: make time for it), **III · The Magician** (urgent, not important: batch, automate or hand off) and **IV · The Moon** (neither: let it fade). Tasks due within 2 days count as urgent automatically; unplaced tasks wait as unturned cards. Drag tasks between arcana, break them into steps, and follow the **Next up** card's suggested order. A by-date view, purse filter, client links and the overview's Today's agenda round it out |
| **Coffers** | Monthly budgets per category, split into personal and business purses, with progress bars and overspend warnings |
| **Almanac** | Month calendar with a day agenda and upcoming list. Click a day to select it, double-click to book on that day |
| **Codex** | Clients with standing (lead, active or past), contact details, rate, notes, lifetime earnings, next appointment, and quick *Book* and *Log payment* buttons |
| **Archive** | Name, currency and week-start settings; JSON backup and restore; CSV export; sample data; reset |

## Running it

There's no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Data is saved in the browser's `localStorage`. Use **Archive → Download backup** to keep a copy.

### Syncing between devices

**Archive → Sync across devices** keeps every device in step through a secret gist on your GitHub account:

1. Create a [GitHub token with only the `gist` scope](https://github.com/settings/tokens/new?scopes=gist&description=3rd%20Iris%20sync).
2. Paste it into the sync panel with a passphrase of your choosing, then do the same on each other device.

Data is encrypted in the browser (AES-GCM, key derived from the passphrase with PBKDF2) before it is uploaded, so the gist holds only ciphertext; a lost passphrase can't be recovered. Each device pulls, merges record by record (the most recent change to each record wins, and deletions sync too), then pushes. Syncing happens a few seconds after each change, when the app is opened or brought to the front, every couple of minutes while it's open, and on demand. The token and passphrase are stored only in that device's browser. The app can also be installed as a home-screen app (web manifest included).

## Deploying

`.github/workflows/pages.yml` publishes the repo root to GitHub Pages on every push to the default branch (or `main`), and can also be run by hand from the Actions tab. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site then lives at `https://thirdirisstyling-arch.github.io/3RDIRIS-MGMT/`.

## Files

- `index.html`: page shell and navigation
- `css/styles.css`: theme tokens and layout
- `js/store.js`: data model, persistence and sample data
- `js/sync.js`: encrypted sync through a GitHub gist
- `js/app.js`: views, forms and routing
- `assets/logo-inverted.png`: the logo inverted onto a transparent background in bone ink
