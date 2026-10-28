# 3rd Iris · Grimoire

A productivity and life-management app for a creative entrepreneur, styled as the 3rd Iris logo inverted: bone ink on a midnight page. Think whimsigoth meets dark academia, a cozy occult library.

## Sections

| | |
|---|---|
| **Sanctum** | Overview of the month: income, spending, net, budget left, bills due and expected in the next two weeks, today's tasks, upcoming appointments, spending by category, recent entries, client counts and the moon phase |
| **Ledger** | Personal and business expenses and income, each with a frequency (one-time, weekly, every 2 weeks, twice a month on chosen days, monthly, quarterly or annual). Recurring entries show when they're next due and are projected into the months ahead, with a projected month-end balance; recording a projected entry moves its series forward. One-time entries can have a fixed due date. Sort by any column, filter by month, kind and purse, search, bulk import, and export to CSV. A calendar view shows each day's entries, due dates, and recurring entries projected forward |
| **Agenda** | To-do list sorted into the four tarot suits as an Eisenhower matrix, the fast suits holding what's urgent: **Swords** (air: urgent & important, cut through it now), **Pentacles** (earth: important, not urgent, tend it steadily), **Wands** (fire: urgent, not important, batch it or pass it on) and **Cups** (water: neither, let it drift). Tasks due within 2 days count as urgent automatically; unplaced tasks wait as unturned cards. Drag tasks between suits, break them into steps, and follow the **Next up** card's suggested order. **The draw** shows a card of the day (the same on every device) or pulls a random card from the full 78-card deck, with its meaning and a task from its suit; major arcana belong to suits through their Golden Dawn elements. A by-date view, purse filter, client links and the overview's Today's agenda round it out |
| **Coffers** | Monthly budgets per category, split into personal and business purses, with progress bars and overspend warnings |
| **Cabinet** | A cabinet of curiosities for ideas and inspiration: notes, images and links on a moodboard, grouped onto shelves with tags, coloured inks and pins, and searchable. Capture by typing (a pasted link becomes a link card), picking images, or on a computer by pasting or dropping them in. Any curiosity can be turned into an Agenda task |
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

Data is encrypted in the browser (AES-GCM, key derived from the passphrase with PBKDF2) before it is uploaded, so the gist holds only ciphertext; a lost passphrase can't be recovered. Each device pulls, merges record by record (the most recent change to each record wins, and deletions sync too), then pushes. Syncing happens a few seconds after each change, when the app is opened or brought to the front, every couple of minutes while it's open, and on demand. The token and passphrase are stored only in that device's browser.

Images in the Cabinet are shrunk to at most 1600px and kept in the browser's IndexedDB rather than localStorage. Each syncs as its own encrypted gist, uploaded once and fetched once per device, so the main sync stays small; image copies nothing refers to any more are removed after an hour. Backups include the images. The app can be installed: on Android, Chrome's ⋮ menu → **Add to Home screen → Install**; on a computer, the install icon in Chrome or Edge's address bar; on iPhone, Safari's Share → **Add to Home Screen**. A service worker keeps the last-seen version available offline, while always fetching the newest version when online.

## Deploying

`.github/workflows/pages.yml` publishes the repo root to GitHub Pages on every push to the default branch (or `main`), and can also be run by hand from the Actions tab. One-time setup: **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site then lives at `https://thirdirisstyling-arch.github.io/3RDIRIS-MGMT/`.

## Files

- `index.html`: page shell and navigation
- `css/styles.css`: theme tokens and layout
- `js/store.js`: data model, persistence and sample data
- `js/tarot.js`: the 78-card deck, the suits and the card of the day
- `js/images.js`: image storage (IndexedDB) and shrinking for the Cabinet
- `js/sync.js`: encrypted sync through a GitHub gist
- `js/app.js`: views, forms and routing
- `assets/logo-inverted.png`: the logo inverted onto a transparent background in bone ink
