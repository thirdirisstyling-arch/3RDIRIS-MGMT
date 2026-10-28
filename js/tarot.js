/* Tarot: the 78-card deck, the four suits that sort tasks, and the card of the day.
   Every card belongs to an element (the majors by their Golden Dawn correspondences),
   and every element to a suit, so any card drawn can point at a kind of task. */
(function () {
  /* the suits, as the four quadrants of the task matrix. The fast suits hold what's urgent. */
  const SUITS = {
    swords: { q: "q1", name: "Swords", element: "Air", speed: "swift as air", axes: "Urgent & important", action: "Cut through it now" },
    pentacles: { q: "q2", name: "Pentacles", element: "Earth", speed: "slow as earth", axes: "Important, not urgent", action: "Tend it steadily; give it a time" },
    wands: { q: "q3", name: "Wands", element: "Fire", speed: "quick as fire", axes: "Urgent, not important", action: "Burst through it, batch it or pass it on" },
    cups: { q: "q4", name: "Cups", element: "Water", speed: "flowing as water", axes: "Neither urgent nor important", action: "Let it drift, or savour it later" },
  };
  const ELEMENT_SUIT = { air: "swords", earth: "pentacles", fire: "wands", water: "cups" };

  // [name, element, meaning]
  const MAJORS = [
    ["The Fool", "air", "New beginnings; leap before you're sure."],
    ["The Magician", "air", "You already hold every tool you need. Use them."],
    ["The High Priestess", "water", "Trust your intuition; the answer is a quiet one."],
    ["The Empress", "earth", "Abundance and creation; nurture your work."],
    ["The Emperor", "fire", "Structure; build the system that holds it all."],
    ["The Hierophant", "earth", "Tradition; learn from those who came before."],
    ["The Lovers", "air", "A meaningful choice; align it with your values."],
    ["The Chariot", "water", "Willpower; take the reins and drive forward."],
    ["Strength", "fire", "Gentle courage; patience over force."],
    ["The Hermit", "earth", "Solitude; step back, reflect, work alone."],
    ["Wheel of Fortune", "fire", "Cycles turn; ride the change instead of fighting it."],
    ["Justice", "air", "Fairness; settle your accounts truthfully."],
    ["The Hanged Man", "water", "Pause; see it from another angle."],
    ["Death", "water", "An ending that makes room; let something go."],
    ["Temperance", "fire", "Balance; blend and pace yourself, don't rush."],
    ["The Devil", "earth", "Notice what binds you; break the habit."],
    ["The Tower", "fire", "Sudden upheaval; clear the rubble and rebuild."],
    ["The Star", "air", "Hope and renewal; keep going, gently."],
    ["The Moon", "water", "Uncertainty; feel your way through the fog."],
    ["The Sun", "fire", "Joy and success; let yourself shine."],
    ["Judgement", "fire", "Awakening; answer the call."],
    ["The World", "earth", "Completion; finish it and celebrate."],
  ];

  const RANKS = ["Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Page", "Knight", "Queen", "King"];
  const RANK_MARK = ["A", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "P", "Kn", "Q", "K"];
  const MINORS = {
    wands: [
      "A spark of inspiration; start the thing that excites you.",
      "Planning ahead; choose your next territory.",
      "Expansion; your efforts are beginning to travel.",
      "Celebration on a stable foundation.",
      "Competition and scattered energy; pick one battle.",
      "Recognition; share the win.",
      "Stand your ground; defend your boundaries.",
      "Swift movement; messages and momentum.",
      "Resilience; one last push.",
      "Overload; put something down or hand it off.",
      "Curious enthusiasm; try a small experiment.",
      "Bold, fast action; just begin.",
      "Confident, magnetic creativity; show your work.",
      "Visionary leadership; set the direction.",
    ],
    cups: [
      "An open heart; a new connection or creative feeling.",
      "Partnership; reach out to someone.",
      "Friendship and celebration; gather your people.",
      "Apathy; notice the offer you're overlooking.",
      "Regret; grieve it, then turn to what remains.",
      "Nostalgia; revisit something that once brought joy.",
      "Too many daydreams; choose one.",
      "Walking away from what no longer fulfils you.",
      "Contentment; the wish is granted, so enjoy it.",
      "Harmony at home; tend your relationships.",
      "A gentle message; follow your intuition.",
      "An invitation; follow where it leads.",
      "Compassion; care for yourself as well as your clients.",
      "Emotional balance; stay calm under pressure.",
    ],
    swords: [
      "Clarity; a breakthrough idea or decision.",
      "A stalemate; make the decision you've been avoiding.",
      "Heartache; acknowledge the hurt and move through it.",
      "Rest and recovery; pause before the next push.",
      "Conflict; ask whether winning is worth the cost.",
      "Transition; move toward calmer waters.",
      "Strategy, or evasion; check what you're dodging.",
      "Feeling trapped; the bindings are looser than they look.",
      "Worry; write it down and watch it shrink.",
      "Rock bottom; from here it only gets better.",
      "Curiosity; research and ask questions.",
      "Charging ahead; speed, but watch your aim.",
      "Clear boundaries; honest, direct words.",
      "Authority of mind; decide with logic.",
    ],
    pentacles: [
      "A new opportunity for money or craft.",
      "Juggling priorities; keep your balance.",
      "Collaboration; craft built with others.",
      "Holding on tightly; is it security, or scarcity?",
      "Hardship; ask for help, it's nearer than you think.",
      "Generosity; give and receive fairly.",
      "Patience; your investment is still growing.",
      "Diligence; practise the craft, detail by detail.",
      "Self-sufficiency; enjoy what you've built.",
      "Lasting wealth; legacy and long-term security.",
      "A student's mind; learn a new skill.",
      "Steady routine; slow and reliable wins.",
      "Nurturing abundance; practical care.",
      "Prosperity; lead with steady hands.",
    ],
  };

  const DECK = [
    ...MAJORS.map(([name, element, meaning], i) => ({ id: `major-${i}`, major: true, number: i, name, element, suit: ELEMENT_SUIT[element], meaning })),
    ...["wands", "cups", "swords", "pentacles"].flatMap((suit) => MINORS[suit].map((meaning, r) => ({
      id: `${suit}-${r}`, major: false, rank: RANKS[r], mark: RANK_MARK[r], name: `${RANKS[r]} of ${SUITS[suit].name}`,
      element: SUITS[suit].element.toLowerCase(), suit, meaning,
    }))),
  ];

  const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX", "XXI"];
  const markOf = (card) => (card.major ? ROMAN[card.number] : card.mark);

  /* the same card on every device for a given day */
  function cardOfDay(dateStr) {
    let h = 2166136261;
    for (const ch of `3rd-iris:${dateStr}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
    return DECK[h % DECK.length];
  }
  function draw(exceptId) {
    let card;
    do card = DECK[Math.floor(Math.random() * DECK.length)]; while (card.id === exceptId);
    return card;
  }

  /* hand-drawn suit marks, so they look the same everywhere (no emoji substitution) */
  const ICONS = {
    swords: '<path d="M12 2.5l1.8 2.7v9.8h-3.6V5.2z"/><path d="M7 15h10"/><path d="M12 15v4.5"/><circle cx="12" cy="21" r="1.1"/>',
    wands: '<path d="M12 22V5.5"/><path d="M12 9.5c2.6-.4 4-2 4.4-4.6-2.6.3-4 1.9-4.4 4.6z"/><path d="M12 13.5c-2.6-.4-4-2-4.4-4.6 2.6.3 4 1.9 4.4 4.6z"/><circle cx="12" cy="3.8" r="1.3"/>',
    cups: '<path d="M6 3.5h12c0 4.6-2.6 7.6-6 8-3.4-.4-6-3.4-6-8z"/><path d="M12 11.5V18"/><path d="M8.5 20.5h7"/><path d="M9.5 18h5"/>',
    pentacles: '<circle cx="12" cy="12" r="9"/><path d="M12 5l4.1 12.7L5.3 9.8h13.4L7.9 17.7z"/>',
    unturned: '<path d="M2.5 12c3-4.8 6-7 9.5-7s6.5 2.2 9.5 7c-3 4.8-6 7-9.5 7s-6.5-2.2-9.5-7z"/><circle cx="12" cy="12" r="3.2"/><path d="M12 1.5v1.8M12 20.7v1.8"/>',
  };
  const icon = (suit, cls = "") => `<svg class="suit-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${ICONS[suit] || ICONS.unturned}</svg>`;

  const suitOfQuadrant = (q) => Object.keys(SUITS).find((k) => SUITS[k].q === q) || "";

  const api = { SUITS, DECK, cardOfDay, draw, icon, markOf, suitOfQuadrant };
  if (typeof module !== "undefined") module.exports = api;
  else window.Tarot = api;
})();
