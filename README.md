# 3rd Iris · Grimoire

A productivity and life-management app for a creative entrepreneur, styled as the 3rd Iris logo inverted: bone ink on a midnight page. Think whimsigoth meets dark academia, a cozy occult library.

## Sections

Five sections, plus Settings. Sections that hold several pages have tabs under the title, and each section opens on the tab you used last. On a computer the menu is on the left; on a phone it's a tab bar along the bottom, with Settings in the ☰ menu. Badges show tasks due today and bills past due.

| | |
|---|---|
| **Sanctum** | What needs you now: the card of the day, three numbers (net this month, budget left, what's coming due), one timeline of the week ahead (appointments, bills, shopping trips, follow-ups, milestones, posts and lives, plus anything that slipped past) with filters, today's tasks, and spending by category. One **+ Add** button for everything; on phones it floats in the corner |
| **Coffers** · Ledger | Personal and business expenses and income, each with a frequency (one-time, weekly, every 2 weeks, twice a month on chosen days, monthly, quarterly or annual). Recurring entries show when they're next due and are projected into the months ahead, with a projected month-end balance; recording a projected entry moves its series forward. A payment made early or late can say which due date it counts as, so the schedule doesn't shift, and any single projected payment can be skipped (and brought back). One-time entries can have a fixed due date. Sort by any column; view a month or a whole calendar quarter (with each month's in, out and net side by side); filter by kind and purse; search, bulk import, and export what's on show to CSV. Recurring entries that came due and weren't recorded are listed under **Past due** at the top, whichever month is open, to record or skip. A calendar view shows each day's entries, due dates, and recurring entries projected forward |
| **Coffers** · Budget, Plans | Monthly budgets per category, split into personal and business purses, with progress bars and overspend warnings, plus **Plans** for spending you can see coming: **occasions** (an event to pay for) and **shopping lists** (items with estimates, quantities, need or want, and an optional cap). Set money aside and see what to put away each week to be ready; compare an item's price at different stores and sizes (price per unit, best value marked) and pick where to buy it, or view the list grouped by store; tick items off with what they really cost and they're recorded in the Ledger. The monthly budget shows what's planned this month. **Wish lists** hold things to buy someday, with no dates: each item is need-ish, want or dream, money set aside toward the list marks what's ✦ within reach, and buying something can draw on that money. **⇄** moves any item between lists (say, from a shopping list to a wish list when it has to wait), keeping its prices and store options |
| **Agenda** · Tasks | To-do list sorted into the four tarot suits as an Eisenhower matrix, the fast suits holding what's urgent: **Swords** (air: urgent & important, cut through it now), **Pentacles** (earth: important, not urgent, tend it steadily), **Wands** (fire: urgent, not important, batch it or pass it on) and **Cups** (water: neither, let it drift). Tasks due within 2 days count as urgent automatically; unplaced tasks wait as unturned cards. Drag tasks between suits, break them into steps, and follow the **Next up** card's suggested order. **The draw** shows a card of the day (the same on every device) or pulls a random card from the full 78-card deck, with its meaning and a task from its suit; major arcana belong to suits through their Golden Dawn elements. A by-date view, purse filter, client links and the overview's Today's tasks round it out |
| **Agenda** · Calendar | Month calendar with a day agenda and upcoming list. Click a day to select it, double-click to book on that day |
| **Workings** · Projects, Timeline, Content, Metrics | Projects ("workings") carried from idea to done: a stage (seed, brewing, working, resting, complete), start and target dates, a budget, milestones, and their own tasks, curiosities, posts and ledger entries. Each has a page with *the path* (everything dated, in order, today marked) and its spending against budget. A **Timeline** shows every working across the months with milestones and posts, the **Content calendar** plans posts by date or as a pipeline (idea → drafting → ready → scheduled → posted), including **lives** (start time, planned length, weekly repeats, and results afterwards), and **Metrics** charts followers and engagement per platform over time from quick weekly logs or pasted analytics exports, alongside how each live went. Tasks, ledger entries and curiosities can be linked to a working, and any curiosity can start one |
| **Workings** · Cabinet | A cabinet of curiosities for ideas and inspiration: notes, images and links on a moodboard, grouped onto shelves with tags, coloured inks and pins, and searchable. Capture by typing (a pasted link becomes a link card), picking images, or on a computer by pasting or dropping them in. Any curiosity can be turned into an Agenda task |
| **Codex** | Clients (contact details, rate, notes, lifetime earnings, next appointment, quick *Book* and *Log payment*), plus every other relationship the business keeps: **brand partnerships**, **affiliates** (links and discount codes with one-tap copy), **sources** (suppliers, makers, freelancers) and **collaborators**. Relationships move through stages (wishlist → applied → in talks → active, or paused/closed) on a board, each with a next step and follow-up date, a log of updates (stage changes recorded automatically), terms and rates, a linked working, and the ledger entries tied to them. Due follow-ups show at the top of the Codex and on the overview |
| **Settings** | Name, currency and week-start settings; JSON backup and restore; CSV export; sample data; reset (the ⚙ link under the menu; old `#archive` links still work) |

## Running it

There's no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Data is saved in the browser's `localStorage`. Use **Settings → Download backup** to keep a copy.

### Adding a plan from a link

A link of the form `…/3RDIRIS-MGMT/#add/<code>` opens the app with a ready-made plan of posts and tasks (for example, one written in a chat) and asks before adding anything. Things already in the calendar or on the agenda are left out, so opening a link twice does no harm. A link can also reschedule posts already in the calendar: each change is matched to exactly one post by its title (or an older title), and the dialog shows what moves before anything does. The code is base64url-encoded JSON, `{"t": title, "p": posts, "k": tasks, "u": changes}`, where posts and tasks are CSV in the same columns the importers read, and changes are CSV with `was` (old titles separated by ` | `), `title`, `date`, `time`, `status` and `notes`.

### Syncing between devices

**Settings → Sync across devices** keeps every device in step through a secret gist on your GitHub account:

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
- `js/charts.js`: small single-series SVG charts (line and columns) with hover and keyboard readouts
- `js/sync.js`: encrypted sync through a GitHub gist
- `js/app.js`: views, forms and routing
- `assets/logo-inverted.png`: the logo inverted onto a transparent background in bone ink
