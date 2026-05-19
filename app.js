(() => {
  'use strict';

  // ---------- state ----------
  const state = {
    deck: null,          // { language, locale, cards: [...] }
    cardsAll: [],        // all cards for the chosen language
    queue: [],           // current session queue (in display order)
    pos: 0,              // index into queue
    flipped: false,
    knownThisSession: new Set(), // ids marked known in current session run
    language: null,      // 'spanish'
    level: null,         // 1 | 2 | 3
    voice: null,
  };

  // ---------- DOM ----------
  const $ = (sel) => document.querySelector(sel);
  const body = document.body;
  const card = $('#card');
  const cardEnEl = $('#card-en');
  const cardEsEl = $('#card-es');
  const deckPosEl = $('#deck-pos');
  const deckTotalEl = $('#deck-total');
  const speakerBtn = $('#speaker-btn');
  const hintEl = $('#deck-hint');
  const summaryKnownEl = $('#summary-known');
  const summaryTotalEl = $('#summary-total');
  const summarySubEl = $('#summary-sub');
  const shuffleBtn = $('#shuffle-btn');
  const levelTitleEl = $('#level-title');
  const btnPrev = document.querySelector('.action-prev');
  const btnNext = document.querySelector('.action-next');
  const btnKnown = document.querySelector('.action-known');

  // ---------- utilities ----------
  const storageKey = (lang, level) => `lang-fc:${lang}:L${level}:known`;

  function loadKnown(lang, level) {
    try {
      const raw = localStorage.getItem(storageKey(lang, level));
      return new Set(raw ? JSON.parse(raw) : []);
    } catch {
      return new Set();
    }
  }

  function saveKnown(lang, level, set) {
    try {
      localStorage.setItem(storageKey(lang, level), JSON.stringify([...set]));
    } catch { /* quota or private mode */ }
  }

  function clearKnown(lang, level) {
    try { localStorage.removeItem(storageKey(lang, level)); } catch {}
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showView(name) {
    body.dataset.view = name;
    document.querySelectorAll('.view').forEach(v => {
      v.hidden = (v.dataset.viewName !== name);
    });
  }

  // ---------- data load ----------
  async function loadLanguage(lang) {
    if (state.deck && state.language === lang) return state.deck;
    const res = await fetch(`./data/${lang}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load ${lang}.json: ${res.status}`);
    state.deck = await res.json();
    state.cardsAll = state.deck.cards;
    state.language = lang;
    return state.deck;
  }

  // ---------- TTS ----------
  function pickVoice(locale) {
    if (!('speechSynthesis' in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;
    // Prefer exact locale, then language match.
    const exact = voices.find(v => v.lang === locale);
    if (exact) return exact;
    const langOnly = locale.split('-')[0];
    return voices.find(v => v.lang && v.lang.startsWith(langOnly)) || null;
  }

  function primeVoices() {
    if (!('speechSynthesis' in window)) return;
    state.voice = pickVoice(state.deck?.locale || 'es-MX');
    window.speechSynthesis.onvoiceschanged = () => {
      state.voice = pickVoice(state.deck?.locale || 'es-MX');
    };
  }

  function speak(text) {
    if (!('speechSynthesis' in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = state.deck?.locale || 'es-MX';
      if (state.voice) utter.voice = state.voice;
      utter.rate = 0.95;
      window.speechSynthesis.speak(utter);
    } catch { /* noop */ }
  }

  // ---------- rendering ----------
  function renderReview() {
    const listEl = document.getElementById('review-list');
    if (!listEl || !state.deck) return;
    listEl.innerHTML = '';
    let totalKnown = 0;

    for (const lvl of [1, 2, 3]) {
      const known = loadKnown(state.language, lvl);
      if (known.size === 0) continue;
      const cards = state.cardsAll.filter(c => c.level === lvl && known.has(c.id));
      totalKnown += cards.length;

      const hdr = document.createElement('div');
      hdr.className = 'review-level-header';
      hdr.textContent = `Level ${lvl} — ${cards.length} known`;
      listEl.appendChild(hdr);

      for (const c of cards) {
        const row = document.createElement('div');
        row.className = 'review-row';
        row.dataset.id = c.id;
        row.dataset.level = String(lvl);
        row.innerHTML = `
          <span class="review-es">${c.es}</span>
          <span class="review-divider">·</span>
          <span class="review-en">${c.en}</span>
          <span class="review-unmark-wrap">
            <button class="review-unmark-btn" type="button">↩ Mark as unknown</button>
          </span>`;
        listEl.appendChild(row);
      }
    }

    if (totalKnown === 0) {
      const empty = document.createElement('p');
      empty.className = 'review-empty';
      empty.textContent = 'No cards marked known yet. Flip cards and tap ✓ to build this list.';
      listEl.appendChild(empty);
    }
  }

  function renderLevelProgress() {
    if (!state.deck) return;
    for (const lvl of [1, 2, 3]) {
      const total = state.cardsAll.filter(c => c.level === lvl).length;
      const known = loadKnown(state.language, lvl).size;
      const el = document.querySelector(`[data-progress-for="${lvl}"]`);
      if (el) el.textContent = `${known} / ${total} known`;
    }
  }

  function renderCard() {
    const c = state.queue[state.pos];
    if (!c) return;
    cardEnEl.textContent = c.en;
    cardEsEl.textContent = c.es;
    deckPosEl.textContent = String(state.pos + 1);
    deckTotalEl.textContent = String(state.queue.length);
    setFlipped(false);
    updateActionButtons();
  }

  function setFlipped(flipped) {
    state.flipped = flipped;
    card.classList.toggle('is-flipped', flipped);
    card.setAttribute('aria-label', flipped ? 'Flashcard flipped, tap to flip back' : 'Flashcard, tap to flip');
    updateActionButtons();
  }

  function updateActionButtons() {
    if (!btnPrev || !btnNext || !btnKnown) return;
    btnPrev.disabled = state.pos === 0;
    btnNext.disabled = state.queue.length === 0;
    btnKnown.disabled = !state.flipped || state.queue.length === 0;
    updateHint();
  }

  function updateHint() {
    if (!hintEl) return;
    if (!state.flipped) {
      hintEl.textContent = 'Tap card to flip · swipe ← next  · → prev';
    } else {
      hintEl.textContent = 'Swipe ↑ or tap ✓ to mark known · ← next  · → prev';
    }
  }

  function fadeHint() { /* hint stays visible; text updates dynamically */ }

  // ---------- deck flow ----------
  function startDeck(lang, level, { onlyIds = null } = {}) {
    state.language = lang;
    state.level = level;
    state.knownThisSession = new Set();

    let pool = state.cardsAll.filter(c => c.level === level);
    if (onlyIds) {
      const set = new Set(onlyIds);
      pool = pool.filter(c => set.has(c.id));
    } else {
      // Exclude already-known from prior sessions.
      const known = loadKnown(lang, level);
      pool = pool.filter(c => !known.has(c.id));
      if (pool.length === 0) {
        // All known already — restart with full level.
        pool = state.cardsAll.filter(c => c.level === level);
      }
    }

    state.queue = shuffle(pool);
    state.pos = 0;
    showView('deck');
    renderCard();
  }

  function goNext() {
    if (state.pos < state.queue.length - 1) {
      state.pos += 1;
      renderCard();
    } else {
      finishDeck();
    }
  }

  function goPrev() {
    if (state.pos > 0) {
      state.pos -= 1;
      renderCard();
    }
  }

  function markKnownAndAdvance() {
    const c = state.queue[state.pos];
    if (!c) return;
    state.knownThisSession.add(c.id);
    // Persist incrementally.
    const known = loadKnown(state.language, state.level);
    known.add(c.id);
    saveKnown(state.language, state.level, known);
    goNext();
  }

  function finishDeck() {
    const total = state.queue.length;
    const known = state.knownThisSession.size;
    summaryKnownEl.textContent = String(known);
    summaryTotalEl.textContent = String(total);
    const remaining = total - known;
    if (known === total) {
      summarySubEl.textContent = '¡Excelente! Perfect run.';
      shuffleBtn.disabled = true;
      shuffleBtn.textContent = 'All known';
    } else {
      summarySubEl.textContent = `${remaining} still to learn.`;
      shuffleBtn.disabled = false;
      shuffleBtn.textContent = 'Shuffle remaining';
    }
    showView('summary');
  }

  function shuffleRemaining() {
    const remaining = state.queue
      .map(c => c.id)
      .filter(id => !state.knownThisSession.has(id));
    if (remaining.length === 0) return;
    startDeck(state.language, state.level, { onlyIds: remaining });
  }

  function resetDeckProgress() {
    if (!confirm('Reset known cards for this level?')) return;
    clearKnown(state.language, state.level);
    state.knownThisSession.clear();
    startDeck(state.language, state.level);
  }

  // ---------- card interactions: flip + swipe ----------
  let dragging = false;
  let pointerId = null;
  let startX = 0, startY = 0, startT = 0;
  let dx = 0, dy = 0;
  let didSwipe = false;

  const SWIPE_DIST = 60;
  const SWIPE_VEL = 0.45; // px/ms

  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    didSwipe = false;
    startX = e.clientX;
    startY = e.clientY;
    startT = performance.now();
    dx = 0; dy = 0;
    try { card.setPointerCapture(pointerId); } catch {}
  }

  function onPointerMove(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dx = e.clientX - startX;
    dy = e.clientY - startY;
    // Visual drag: translate the card-inner; cap rotation slightly for character.
    const inner = card.querySelector('.card-inner');
    if (!inner) return;
    // Compose base flip with drag transform.
    const flipPart = state.flipped ? 'rotateY(180deg)' : '';
    const rot = Math.max(-12, Math.min(12, dx / 14));
    inner.style.transition = 'none';
    inner.style.transform = `translate(${dx}px, ${Math.min(dy, 0)}px) rotate(${rot}deg) ${flipPart}`.trim();
  }

  function resetDragTransform() {
    const inner = card.querySelector('.card-inner');
    if (!inner) return;
    inner.style.transition = '';
    inner.style.transform = '';
  }

  function flyOff(direction, after) {
    const inner = card.querySelector('.card-inner');
    if (!inner) { after(); return; }
    const w = window.innerWidth || 400;
    const h = window.innerHeight || 600;
    let tx = 0, ty = 0, rot = 0;
    if (direction === 'left')  { tx = -w; rot = -20; }
    if (direction === 'right') { tx =  w; rot =  20; }
    if (direction === 'up')    { ty = -h; }
    inner.style.transition = 'transform 240ms ease-out';
    const flipPart = state.flipped ? 'rotateY(180deg)' : '';
    inner.style.transform = `translate(${tx}px, ${ty}px) rotate(${rot}deg) ${flipPart}`.trim();
    setTimeout(() => {
      inner.style.transition = 'none';
      inner.style.transform = '';
      // Strip is-flipped while transition is disabled so setFlipped(false)
      // in renderCard() is a no-op and never triggers the flip-back animation.
      card.classList.remove('is-flipped');
      void inner.offsetWidth;
      inner.style.transition = '';
      after();
    }, 240);
  }

  function onPointerUp(e) {
    if (!dragging || e.pointerId !== pointerId) return;
    dragging = false;
    try { card.releasePointerCapture(pointerId); } catch {}
    const elapsed = Math.max(1, performance.now() - startT);
    const absX = Math.abs(dx), absY = Math.abs(dy);
    const vX = absX / elapsed, vY = absY / elapsed;

    // Determine intent.
    let dir = null;
    if (absX > absY) {
      if (absX > SWIPE_DIST || vX > SWIPE_VEL) dir = dx < 0 ? 'left' : 'right';
    } else {
      if (dy < 0 && (absY > SWIPE_DIST || vY > SWIPE_VEL)) dir = 'up';
      // swipe down = no-op
    }

    if (!dir) {
      // Treat as tap if barely moved.
      if (absX < 8 && absY < 8) {
        resetDragTransform();
        setFlipped(!state.flipped);
        fadeHint();
        return;
      }
      // Snap back.
      resetDragTransform();
      return;
    }

    didSwipe = true;
    fadeHint();

    if (dir === 'up') {
      if (!state.flipped) {
        // Up swipe gated until flipped — snap back.
        resetDragTransform();
        return;
      }
      card.classList.add('swipe-known');
      flyOff('up', () => {
        card.classList.remove('swipe-known');
        markKnownAndAdvance();
      });
    } else if (dir === 'left') {
      flyOff('left', goNext);
    } else if (dir === 'right') {
      if (state.pos === 0) { resetDragTransform(); return; }
      flyOff('right', goPrev);
    }
  }

  function onCardKey(e) {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      setFlipped(!state.flipped);
      fadeHint();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      flyOff('left', goNext);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (state.pos > 0) flyOff('right', goPrev);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (state.flipped) {
        card.classList.add('swipe-known');
        flyOff('up', () => {
          card.classList.remove('swipe-known');
          markKnownAndAdvance();
        });
      }
    }
  }

  // ---------- wiring ----------
  function bindOnce() {
    // Home: language tiles.
    document.querySelectorAll('.lang-tile').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.classList.contains('is-disabled')) return;
        const lang = btn.dataset.lang;
        try {
          await loadLanguage(lang);
          primeVoices();
          levelTitleEl.textContent = state.deck.language;
          renderLevelProgress();
          showView('level');
        } catch (err) {
          console.error(err);
          alert('Could not load deck.');
        }
      });
    });

    // Level: level tiles.
    document.querySelectorAll('.level-tile').forEach(btn => {
      btn.addEventListener('click', () => {
        const lvl = Number(btn.dataset.level);
        startDeck(state.language, lvl);
      });
    });

    // Card: pointer + click + keyboard.
    card.addEventListener('pointerdown', onPointerDown);
    card.addEventListener('pointermove', onPointerMove);
    card.addEventListener('pointerup', onPointerUp);
    card.addEventListener('pointercancel', (e) => { dragging = false; resetDragTransform(); });
    card.addEventListener('keydown', onCardKey);

    // Speaker.
    speakerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const c = state.queue[state.pos];
      if (c) speak(c.es);
    });
    // Prevent speaker click from also triggering card swipe pointer logic.
    speakerBtn.addEventListener('pointerdown', (e) => e.stopPropagation());

    // Header buttons + summary actions (delegated by data-action).
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-action]');
      if (!t) return;
      const action = t.dataset.action;
      if (action === 'back-home') {
        showView('home');
      } else if (action === 'back-level') {
        if (state.deck) renderLevelProgress();
        showView('level');
      } else if (action === 'reset-deck') {
        resetDeckProgress();
      } else if (action === 'shuffle-remaining') {
        shuffleRemaining();
      } else if (action === 'prev') {
        if (state.pos > 0) { fadeHint(); flyOff('right', goPrev); }
      } else if (action === 'next') {
        if (state.queue.length) { fadeHint(); flyOff('left', goNext); }
      } else if (action === 'known') {
        if (state.flipped && state.queue.length) {
          fadeHint();
          card.classList.add('swipe-known');
          flyOff('up', () => {
            card.classList.remove('swipe-known');
            markKnownAndAdvance();
          });
        }
      } else if (action === 'open-review') {
        renderReview();
        showView('review');
      }
    });

    // Review: row tap expands; unmark button removes from known.
    document.getElementById('review-list').addEventListener('click', (e) => {
      const unmarkBtn = e.target.closest('.review-unmark-btn');
      const row = e.target.closest('.review-row');
      if (!row) return;

      if (unmarkBtn) {
        e.stopPropagation();
        const id = row.dataset.id;
        const lvl = Number(row.dataset.level);
        const known = loadKnown(state.language, lvl);
        known.delete(id);
        saveKnown(state.language, lvl, known);
        row.remove();
        // Update header count or remove it if section is now empty.
        const allRows = document.querySelectorAll(`.review-row[data-level="${lvl}"]`);
        if (allRows.length === 0) {
          const headers = document.querySelectorAll('.review-level-header');
          headers.forEach(h => {
            if (h.textContent.startsWith(`Level ${lvl}`)) h.remove();
          });
          const remaining = document.querySelectorAll('.review-row').length;
          if (remaining === 0) renderReview(); // show empty state
        } else {
          // Update header count.
          document.querySelectorAll('.review-level-header').forEach(h => {
            if (h.textContent.startsWith(`Level ${lvl}`)) {
              h.textContent = `Level ${lvl} — ${allRows.length} known`;
            }
          });
        }
        return;
      }

      // Toggle expanded state to show/hide unmark button.
      const wasExpanded = row.classList.contains('is-expanded');
      document.querySelectorAll('.review-row.is-expanded').forEach(r => r.classList.remove('is-expanded'));
      if (!wasExpanded) row.classList.add('is-expanded');
    });
  }

  // ---------- boot ----------
  bindOnce();
})();
