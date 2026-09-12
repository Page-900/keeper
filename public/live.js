import { find, ask, saidBy } from './ui.js';

const DECK = ['block', 'layers', 'bound'];

const SWING = 6000;

const cardFor = (name) => document.querySelector(`[data-card="${name}"]`);

const deck = () => {
  const dots = Array.from(find('deckDots').children);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let at = 0;
  let timer = null;
  let held = false;

  const play = () => {
    if (timer !== null) window.clearInterval(timer);
    timer =
      still || held ? null : window.setInterval(() => go(DECK[(at + 1) % DECK.length]), SWING);
  };

  const go = (name) => {
    const wanted = DECK.indexOf(name);
    if (wanted === -1 || wanted === at) return;
    const forward = wanted > at;
    at = wanted;
    DECK.forEach((one, index) => {
      const card = cardFor(one);
      card.hidden = index !== at;
      card.classList.remove('in-next', 'in-back');
    });
    const shown = cardFor(name);
    void shown.offsetWidth;
    shown.classList.add(forward ? 'in-next' : 'in-back');
    dots.forEach((dot, index) => {
      dot.setAttribute('aria-current', index === at ? 'true' : 'false');
    });
  };

  const hold = (wanted) => {
    held = wanted;
    play();
  };

  dots.forEach((dot, index) => {
    dot.setAttribute('aria-current', index === 0 ? 'true' : 'false');
    dot.addEventListener('click', () => {
      go(dot.dataset.go);
      play();
    });
  });

  const box = document.querySelector('.status');
  box.addEventListener('pointerenter', () => hold(true));
  box.addEventListener('pointerleave', () => hold(false));
  box.addEventListener('focusin', () => hold(true));
  box.addEventListener('focusout', () => hold(false));
  document.addEventListener('visibilitychange', () => hold(document.hidden));

  play();
  return { go, hold, play, stop: () => window.clearInterval(timer) };
};

const LIVE_KEY = 'keeper.liveState';

/** Narrow screens stack the column under the page, so hiding it moves what is being read. */
const stacked = () => window.matchMedia('(max-width: 1150px)').matches;

/** A browser that keeps nothing is a fact about this visit, so it is said rather than swallowed. */
const kept = () => {
  try {
    return { on: window.localStorage.getItem(LIVE_KEY) === 'on', remembers: true };
  } catch {
    return { on: false, remembers: false };
  }
};

const FORGETS = 'This browser keeps nothing, so this choice is forgotten when you leave.';

const wireLive = (cards) => {
  const shell = document.querySelector('.shell');
  const button = find('liveOpen');
  const held = kept();
  let pinned = held.on;
  let shown = pinned || stacked();
  let fading = null;

  const paint = () => {
    shell.classList.toggle('noStatus', !shown && !stacked());
    button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
    button.title = held.remembers
      ? pinned
        ? 'Let it come and go on its own'
        : 'Keep the live state open'
      : FORGETS;
    button.textContent = pinned ? 'Hide live state' : 'Live state';
    if (shown) cards.play();
    else cards.stop();
  };

  const show = () => {
    if (fading !== null) window.clearTimeout(fading);
    shown = true;
    paint();
  };

  const letGo = (after) => {
    if (fading !== null) window.clearTimeout(fading);
    if (pinned || stacked()) return;
    fading = window.setTimeout(() => {
      shown = false;
      paint();
    }, after);
  };

  button.addEventListener('click', () => {
    pinned = !pinned;
    if (fading !== null) window.clearTimeout(fading);
    shown = pinned;
    try {
      window.localStorage.setItem(LIVE_KEY, pinned ? 'on' : 'off');
    } catch {
      held.remembers = false;
    }
    paint();
  });

  paint();
  return { show, letGo };
};

const wireExecute = () => {
  const box = find('executeBox');
  const toggle = find('executeOn');
  const state = find('executeState');

  const paint = (answer) => {
    if (answer.status !== 200) {
      state.textContent = saidBy(answer);
      return;
    }
    toggle.checked = answer.body.on === true;
    state.textContent = answer.body.says;
  };

  find('executeOpen').addEventListener('click', () => {
    box.showModal();
    void ask('/api/execute').then(paint);
  });

  toggle.addEventListener('change', () => {
    const wanted = toggle.checked;
    state.textContent = 'Telling the server';
    void ask('/api/execute', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ on: wanted }),
    })
      .then(paint)
      .catch(() => {
        toggle.checked = !wanted;
        state.textContent = 'This page could not reach its own server.';
      });
  });
};

export const wirePanel = () => {
  const cards = deck();
  const live = wireLive(cards);
  wireExecute();
  return { cards, live };
};
