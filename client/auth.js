/* ============================================================
   Tap Map — Auth Module
   Exposes window.Auth
   ============================================================ */

'use strict';

window.Auth = (() => {
  let currentUser = null;

  function qs(sel) { return document.querySelector(sel); }

  // ── API Helpers ────────────────────────────────────────────

  async function apiFetch(url, opts = {}) {
    const options = { credentials: 'same-origin', ...opts };
    if (opts.body) {
      options.headers = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
    }
    const res  = await fetch(url, options);
    const data = await res.json();
    return data;
  }

  // ── HUD ────────────────────────────────────────────────────

  function updateHUD() {
    if (currentUser) {
      qs('#user-hud').removeAttribute('hidden');
      qs('#auth-hud-btn').setAttribute('hidden', '');
      qs('#user-hud-name').textContent = `@${currentUser.username || '?'}`;
    } else {
      qs('#user-hud').setAttribute('hidden', '');
      qs('#auth-hud-btn').removeAttribute('hidden');
    }
  }

  // ── Modal Helpers ──────────────────────────────────────────

  function openModal(id) {
    const el = qs(id);
    el.removeAttribute('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visible')));
  }

  function closeModal(id) {
    const el = qs(id);
    el.classList.remove('visible');
    el.addEventListener('transitionend', () => el.setAttribute('hidden', ''), { once: true });
  }

  function setError(id, msg) {
    const el = qs(id);
    if (!el) return;
    if (msg) { el.textContent = msg; el.removeAttribute('hidden'); }
    else       el.setAttribute('hidden', '');
  }

  // ── History ────────────────────────────────────────────────

  function scoreGrade(total) {
    if (total >= 4500) return 'Navigator';
    if (total >= 3500) return 'Cartographer';
    if (total >= 2500) return 'Traveler';
    if (total >= 1500) return 'Explorer';
    return 'Landlubber';
  }

  function renderHistory(rows) {
    const container = qs('#history-content');
    if (!rows.length) {
      container.innerHTML = '<p class="history-empty">No completed games yet — play to see your history!</p>';
      return;
    }
    container.innerHTML = `
      <div class="history-header-row">
        <span>Date</span>
        <span>Rounds</span>
        <span>Score</span>
        <span>Rank</span>
      </div>
      ${rows.map(r => `
        <div class="history-row">
          <span class="history-date">${r.date}</span>
          <span class="history-emojis">${r.round_scores.map(s => s.emoji).join(' ')}</span>
          <span class="history-score">${r.total_score.toLocaleString()}</span>
          <span class="history-grade">${scoreGrade(r.total_score)}</span>
        </div>
      `).join('')}
    `;
  }

  async function showHistory() {
    openModal('#history-modal');
    qs('#history-content').innerHTML = '<div class="history-loading">Loading…</div>';
    try {
      const rows = await apiFetch('/api/user/history');
      if (Array.isArray(rows)) renderHistory(rows);
      else qs('#history-content').innerHTML = '<div class="history-loading">Could not load history.</div>';
    } catch {
      qs('#history-content').innerHTML = '<div class="history-loading">Could not load history.</div>';
    }
  }

  // ── Score Saving ───────────────────────────────────────────

  // Returns the player's daily rank (integer) or null
  async function saveScore(date, totalScore, roundScores) {
    if (!currentUser) return null;
    try {
      const data = await apiFetch('/api/user/score', {
        method: 'POST',
        body: JSON.stringify({ date, totalScore, roundScores }),
      });
      return data.rank ?? null;
    } catch (err) {
      console.error('Score save failed:', err);
      return null;
    }
  }

  // ── Leaderboard ────────────────────────────────────────────

  async function showLeaderboard() {
    openModal('#leaderboard-modal');
    loadLeaderboardTab('daily');
  }

  async function loadLeaderboardTab(tab) {
    const container = qs('#leaderboard-content');
    container.innerHTML = '<div class="history-loading">Loading…</div>';

    // Update tab UI
    qs('#leaderboard-modal').querySelectorAll('.modal-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    try {
      const url  = tab === 'daily'
        ? '/api/leaderboard/daily'
        : '/api/leaderboard/alltime';
      const data = await apiFetch(url);

      if (tab === 'daily') renderDailyLeaderboard(data, container);
      else                  renderAlltimeLeaderboard(data, container);
    } catch {
      container.innerHTML = '<div class="history-loading">Could not load leaderboard.</div>';
    }
  }

  const MEDALS = ['🥇', '🥈', '🥉'];

  function renderDailyLeaderboard({ date, entries, viewerRank }, container) {
    if (!entries.length) {
      container.innerHTML = `<p class="history-empty">No scores yet for ${date}.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="lb-date">📅 ${date}</div>
      ${viewerRank ? `<div class="lb-your-rank">Your rank today: <strong>#${viewerRank}</strong></div>` : ''}
      <div class="lb-header-row">
        <span>#</span><span>Player</span><span>Score</span><span>Rounds</span>
      </div>
      ${entries.map(e => `
        <div class="lb-row${currentUser && e.username === currentUser.username ? ' lb-row--you' : ''}">
          <span class="lb-rank">${MEDALS[e.rank - 1] ?? e.rank}</span>
          <span class="lb-username">@${e.username}</span>
          <span class="lb-score">${e.totalScore.toLocaleString()}</span>
          <span class="lb-emojis">${e.emojis}</span>
        </div>
      `).join('')}
    `;
  }

  function renderAlltimeLeaderboard({ entries, viewerRank }, container) {
    if (!entries.length) {
      container.innerHTML = '<p class="history-empty">No scores yet.</p>';
      return;
    }
    container.innerHTML = `
      ${viewerRank ? `<div class="lb-your-rank">Your all-time rank: <strong>#${viewerRank}</strong></div>` : ''}
      <div class="lb-header-row">
        <span>#</span><span>Player</span><span>Total</span><span>Avg</span><span>Games</span>
      </div>
      ${entries.map(e => `
        <div class="lb-row${currentUser && e.username === currentUser.username ? ' lb-row--you' : ''}">
          <span class="lb-rank">${MEDALS[e.rank - 1] ?? e.rank}</span>
          <span class="lb-username">@${e.username}</span>
          <span class="lb-score">${Number(e.total_score).toLocaleString()}</span>
          <span class="lb-avg">${Number(e.avg_score).toLocaleString()}</span>
          <span class="lb-games">${e.games_played}</span>
        </div>
      `).join('')}
    `;
  }

  // ── Event Wiring ───────────────────────────────────────────

  function wireEvents(googleEnabled) {

    // Tab switching in auth modal
    qs('#auth-modal').querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const t = tab.dataset.tab;
        qs('#auth-modal').querySelectorAll('.modal-tab')
          .forEach(b => b.classList.toggle('active', b === tab));
        qs('#signin-form').toggleAttribute('hidden', t !== 'signin');
        qs('#signup-form').toggleAttribute('hidden', t !== 'signup');
        setError('#signin-error', null);
        setError('#signup-error', null);
      });
    });

    // Sign in
    qs('#signin-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn  = qs('#signin-submit');
      const identifier = qs('#signin-identifier').value.trim();
      const pass       = qs('#signin-password').value;
      btn.disabled = true; btn.textContent = 'Signing in…';

      const data = await apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password: pass }),
      });

      btn.disabled = false; btn.textContent = 'Sign In';

      if (data.error) {
        setError('#signin-error', data.error);
      } else {
        currentUser = data.user;
        updateHUD();
        closeModal('#auth-modal');
      }
    });

    // Sign up
    qs('#signup-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn      = qs('#signup-submit');
      const username = qs('#signup-username').value.trim();
      const pass     = qs('#signup-password').value;
      btn.disabled = true; btn.textContent = 'Creating…';

      const data = await apiFetch('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password: pass }),
      });

      btn.disabled = false; btn.textContent = 'Create Account';

      if (data.error) {
        setError('#signup-error', data.error);
      } else {
        currentUser = data.user;
        updateHUD();
        closeModal('#auth-modal');
      }
    });

    // Play as guest
    qs('#guest-btn').addEventListener('click', () => closeModal('#auth-modal'));

    // Google button visibility
    if (!googleEnabled) {
      qs('#google-btn').setAttribute('hidden', '');
      qs('#auth-divider').setAttribute('hidden', '');
    }

    // HUD sign-in button
    qs('#auth-hud-btn').addEventListener('click', () => openModal('#auth-modal'));

    // User HUD dropdown toggle
    qs('#user-hud-btn').addEventListener('click', e => {
      e.stopPropagation();
      const dd   = qs('#user-dropdown');
      const open = !dd.hasAttribute('hidden');
      if (open) {
        dd.setAttribute('hidden', '');
        qs('#user-hud-btn').setAttribute('aria-expanded', 'false');
      } else {
        dd.removeAttribute('hidden');
        qs('#user-hud-btn').setAttribute('aria-expanded', 'true');
      }
    });

    // Close dropdown when clicking anywhere else
    document.addEventListener('click', () => {
      qs('#user-dropdown').setAttribute('hidden', '');
      qs('#user-hud-btn').setAttribute('aria-expanded', 'false');
    });

    // History button
    qs('#history-btn').addEventListener('click', () => {
      qs('#user-dropdown').setAttribute('hidden', '');
      showHistory();
    });
    qs('#history-close').addEventListener('click', () => closeModal('#history-modal'));
    qs('#history-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal('#history-modal');
    });

    // Leaderboard button (HUD + game-over)
    document.querySelectorAll('.leaderboard-trigger').forEach(btn => {
      btn.addEventListener('click', showLeaderboard);
    });
    qs('#leaderboard-modal').querySelectorAll('.modal-tab').forEach(tab => {
      tab.addEventListener('click', () => loadLeaderboardTab(tab.dataset.tab));
    });
    qs('#leaderboard-close').addEventListener('click', () => closeModal('#leaderboard-modal'));
    qs('#leaderboard-modal').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal('#leaderboard-modal');
    });

    // Logout
    qs('#logout-btn').addEventListener('click', async () => {
      await apiFetch('/api/auth/logout', { method: 'POST' });
      currentUser = null;
      updateHUD();
      qs('#user-dropdown').setAttribute('hidden', '');
    });

    // Username picker form
    qs('#username-form').addEventListener('submit', async e => {
      e.preventDefault();
      const btn      = qs('#username-submit');
      const username = qs('#username-input').value.trim();
      btn.disabled = true; btn.textContent = 'Setting…';

      const data = await apiFetch('/api/auth/username', {
        method: 'PUT',
        body: JSON.stringify({ username }),
      });

      btn.disabled = false; btn.textContent = 'Set Username';

      if (data.error) {
        setError('#username-error', data.error);
      } else {
        if (currentUser) currentUser.username = data.username;
        updateHUD();
        closeModal('#username-modal');
        history.replaceState({}, '', '/');
      }
    });
  }

  // ── Init ──────────────────────────────────────────────────

  async function init() {
    const [config, meData] = await Promise.all([
      apiFetch('/api/auth/config').catch(() => ({ googleEnabled: false })),
      apiFetch('/api/auth/me').catch(() => ({ user: null })),
    ]);

    wireEvents(config.googleEnabled);

    currentUser = meData.user ?? null;
    updateHUD();

    return currentUser;
  }

  // Called by main.js after the loading screen hides
  function onGameReady(user) {
    const params = new URLSearchParams(window.location.search);

    if (user && (user.needsUsername || params.has('setup'))) {
      openModal('#username-modal');
      history.replaceState({}, '', '/');
    } else if (!user) {
      if (params.get('auth') === 'error') {
        openModal('#auth-modal');
        setError('#signin-error', 'Google sign-in failed. Please try again.');
        history.replaceState({}, '', '/');
      } else {
        openModal('#auth-modal');
      }
    }
  }

  return { init, onGameReady, saveScore, getUser: () => currentUser };
})();
