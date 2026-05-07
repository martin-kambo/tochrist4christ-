// assets/community-pulse.js
//
// Drop-in Community Pulse widget.
// Add <div id="community-pulse"></div> anywhere in your HTML,
// then include this script and community-pulse.css.
//
// Auto-refreshes every 30 seconds.
// Animates new items in smoothly.

(function () {
  'use strict';

  const POLL_INTERVAL = 30000; // 30 seconds
  const API_URL = '/.netlify/functions/get-activities';
  const CONTAINER_ID = 'community-pulse';

  // Track last known feed to detect new items
  let lastFeedIds = new Set();
  let pollTimer = null;

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  function createStatBar(stats) {
    return `
      <div class="cp-stats">
        <div class="cp-stat">
          <span class="cp-stat-number">${stats.members || 0}</span>
          <span class="cp-stat-label">Members</span>
        </div>
        <div class="cp-stat-divider"></div>
        <div class="cp-stat">
          <span class="cp-stat-number">${stats.prayers || 0}</span>
          <span class="cp-stat-label">Prayers</span>
        </div>
        <div class="cp-stat-divider"></div>
        <div class="cp-stat">
          <span class="cp-stat-number">${stats.completions || 0}</span>
          <span class="cp-stat-label">Completions</span>
        </div>
      </div>
    `;
  }

  function createActivityItem(activity, isNew = false) {
    const li = document.createElement('li');
    li.className = `cp-item cp-type-${activity.type}${isNew ? ' cp-item--new' : ''}`;
    li.dataset.id = activity.id;
    li.innerHTML = `
      <span class="cp-icon" aria-hidden="true">${activity.icon}</span>
      <span class="cp-message">${escapeHtml(activity.message)}</span>
      <span class="cp-time">${escapeHtml(activity.timeAgo)}</span>
    `;
    return li;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(String(str)));
    return div.innerHTML;
  }

  function createEmptyState() {
    return `
      <li class="cp-empty">
        <span class="cp-empty-icon">✝</span>
        <span>Be the first to join the journey.</span>
      </li>
    `;
  }

  function createPulseIndicator() {
    return `<span class="cp-live-dot" title="Live activity feed"></span>`;
  }

  // ---------------------------------------------------------------------------
  // Initial render — builds the full widget skeleton
  // ---------------------------------------------------------------------------

  function buildWidget(container) {
    container.innerHTML = `
      <div class="cp-widget" role="region" aria-label="Community activity feed">
        <div class="cp-header">
          <h3 class="cp-title">Community Pulse ${createPulseIndicator()}</h3>
          <span class="cp-subtitle">What's happening right now</span>
        </div>
        <div class="cp-stats-wrapper" id="cp-stats-wrapper">
          <div class="cp-stats-skeleton"></div>
        </div>
        <ul class="cp-feed" id="cp-feed" aria-live="polite" aria-label="Recent activity">
          ${createLoadingSkeleton()}
        </ul>
      </div>
    `;
  }

  function createLoadingSkeleton() {
    return Array.from({ length: 4 }, () => `
      <li class="cp-skeleton">
        <span class="cp-skeleton-icon"></span>
        <span class="cp-skeleton-text"></span>
        <span class="cp-skeleton-time"></span>
      </li>
    `).join('');
  }

  // ---------------------------------------------------------------------------
  // Fetch and update feed
  // ---------------------------------------------------------------------------

  async function fetchAndRender(isFirstLoad = false) {
    try {
      const res = await fetch(`${API_URL}?limit=8&_=${Date.now()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      updateStats(data.stats || {});
      updateFeed(data.feed || [], isFirstLoad);
    } catch (err) {
      console.warn('[CommunityPulse] Fetch error:', err.message);
      if (isFirstLoad) {
        const feed = document.getElementById('cp-feed');
        if (feed) feed.innerHTML = createEmptyState();
      }
    }
  }

  function updateStats(stats) {
    const wrapper = document.getElementById('cp-stats-wrapper');
    if (!wrapper) return;
    wrapper.innerHTML = createStatBar(stats);
  }

  function updateFeed(feed, isFirstLoad) {
    const list = document.getElementById('cp-feed');
    if (!list) return;

    if (feed.length === 0) {
      list.innerHTML = createEmptyState();
      lastFeedIds = new Set();
      return;
    }

    const newIds = new Set(feed.map((a) => a.id));

    if (isFirstLoad) {
      // First render — add all items without "new" animation
      list.innerHTML = '';
      feed.forEach((activity) => {
        list.appendChild(createActivityItem(activity, false));
      });
      lastFeedIds = newIds;
      return;
    }

    // Subsequent updates — animate only genuinely new items
    const newItems = feed.filter((a) => !lastFeedIds.has(a.id));

    if (newItems.length === 0) {
      // Just update timestamps
      feed.forEach((activity) => {
        const existing = list.querySelector(`[data-id="${activity.id}"] .cp-time`);
        if (existing) existing.textContent = activity.timeAgo;
      });
      return;
    }

    // Prepend new items with animation, remove excess
    newItems.forEach((activity) => {
      const item = createActivityItem(activity, true);
      list.insertBefore(item, list.firstChild);
      // Trigger animation on next frame
      requestAnimationFrame(() => item.classList.add('cp-item--visible'));
    });

    // Remove items that are no longer in the feed (keep max 8)
    const allItems = list.querySelectorAll('.cp-item');
    if (allItems.length > 8) {
      Array.from(allItems).slice(8).forEach((el) => el.remove());
    }

    lastFeedIds = newIds;
  }

  // ---------------------------------------------------------------------------
  // Poll management
  // ---------------------------------------------------------------------------

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => fetchAndRender(false), POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Pause polling when tab is not visible (battery / bandwidth friendly)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPolling();
    } else {
      fetchAndRender(false);
      startPolling();
    }
  });

  // ---------------------------------------------------------------------------
  // Public API — log activity from other parts of your code
  // ---------------------------------------------------------------------------

  window.CommunityPulse = {
    /**
     * Log an activity. Call this after signup, module complete, etc.
     * @param {string} type - 'signup' | 'module_complete' | 'prayer' | 'testimony' | 'streak'
     * @param {string} name - User's first name
     * @param {string} location - User's city/country
     * @param {object} meta - Extra data, e.g. { module: 2 } or { streakDays: 7 }
     */
    log: async function (type, name, location = '', meta = {}) {
      try {
        const res = await fetch('/.netlify/functions/log-activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, name, location, meta }),
        });
        const data = await res.json();
        if (data.success) {
          // Refresh feed immediately to show new activity
          setTimeout(() => fetchAndRender(false), 500);
        }
        return data;
      } catch (err) {
        console.warn('[CommunityPulse] Log error:', err.message);
        return { success: false };
      }
    },

    refresh: () => fetchAndRender(false),
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init() {
    const container = document.getElementById(CONTAINER_ID);
    if (!container) {
      console.warn(`[CommunityPulse] No element with id="${CONTAINER_ID}" found.`);
      return;
    }
    buildWidget(container);
    fetchAndRender(true);
    startPolling();
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();