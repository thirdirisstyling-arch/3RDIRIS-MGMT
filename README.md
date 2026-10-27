# 3rd Iris · Grimoire

A productivity and life-management app for a creative entrepreneur, styled as the 3rd Iris logo inverted: bone ink on a midnight page. Think whimsigoth meets dark academia, a cozy occult library.

## Sections

| | |
|---|---|
| **Sanctum** | Overview of the month: income, spending, net, budget left, upcoming appointments, spending by category, recent entries, client counts and the moon phase |
| **Ledger** | Personal and business expenses and income. Filter by month, kind and purse, search, and export to CSV |
| **Coffers** | Monthly budgets per category, split into personal and business purses, with progress bars and overspend warnings |
| **Almanac** | Month calendar with a day agenda and upcoming list. Click a day to select it, double-click to book on that day |
| **Codex** | Clients with standing (lead, active or past), contact details, rate, notes, lifetime earnings, next appointment, and quick *Book* and *Log payment* buttons |
| **Archive** | Name, currency and week-start settings; JSON backup and restore; CSV export; sample data; reset |

## Running it

There's no build step and no dependencies. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Data is saved in the browser's `localStorage`, so it stays on that device. Use **Archive → Download backup** to keep a copy or to move it to another device. The app can also be installed as a home-screen app (web manifest included).

## Files

- `index.html`: page shell and navigation
- `css/styles.css`: theme tokens and layout
- `js/store.js`: data model, persistence and sample data
- `js/app.js`: views, forms and routing
- `assets/logo-inverted.png`: the logo inverted onto a transparent background in bone ink
