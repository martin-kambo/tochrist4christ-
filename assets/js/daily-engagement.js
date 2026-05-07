// assets/js/daily-engagement.js
// Daily Engagement Engine — Streaks, Meditation, Prayer, Journaling

class DailyEngagement {
  constructor() {
    this.user = null;
    this.today = new Date().toISOString().split('T')[0];
    this.meditation = null;
    this.engagement = null;
    this.streak = 0;
    this.streakHistory = [];
    this.init();
  }

  async init() {
    await this.loadUser();
    if (this.user) {
      await this.loadData();
      this.render();
      this.attachEventListeners();
    }
  }

  loadUser() {
    try {
      const userData = localStorage.getItem('tc4c_user');
      if (userData) {
        this.user = JSON.parse(userData);
        return true;
      }
    } catch (e) {
      console.error('Failed to load user', e);
    }
    return false;
  }

  async loadData() {
    try {
      // Load meditation and engagement in parallel
      const [contentRes, streakRes] = await Promise.all([
        fetch(`/.netlify/functions/daily-content?email=${encodeURIComponent(this.user.email)}&date=${this.today}`),
        fetch(`/.netlify/functions/daily-streak?email=${encodeURIComponent(this.user.email)}`)
      ]);
      
      const content = await contentRes.json();
      const streak = await streakRes.json();
      
      if (content.success) {
        this.meditation = content.meditation;
        this.engagement = content.engagement;
      }
      
      if (streak.success) {
        this.streak = streak.streak;
        this.streakHistory = streak.last7Days || [];
      }
    } catch (error) {
      console.error('Failed to load daily data', error);
    }
  }

  async logActivity(activity, content = null) {
    if (!this.user) return false;
    
    try {
      const response = await fetch('/.netlify/functions/daily-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.user.email,
          activity,
          date: this.today,
          content
        })
      });
      
      const result = await response.json();
      
      if (result.success) {
        this.engagement[activity] = true;
        if (result.allCompleted) {
          this.streak = result.streak;
          this.showCelebration();
        }
        this.render();
        return true;
      }
    } catch (error) {
      console.error(`Failed to log ${activity}`, error);
    }
    return false;
  }

  showCelebration() {
    const celebration = document.createElement('div');
    celebration.className = 'daily-celebration';
    celebration.innerHTML = `
      <div class="celebration-content">
        <span class="celebration-icon">🎉</span>
        <h4>Day ${this.streak} Complete!</h4>
        <p>You've finished all your daily habits. Keep the streak going!</p>
        <button onclick="this.parentElement.parentElement.remove()">Continue →</button>
      </div>
    `;
    document.body.appendChild(celebration);
    setTimeout(() => celebration.remove(), 4000);
  }

  render() {
    const container = document.getElementById('daily-engagement-container');
    if (!container) return;
    
    if (!this.user) {
      container.innerHTML = this.renderSignedOut();
      return;
    }
    
    container.innerHTML = this.renderSignedIn();
    this.attachActivityListeners();
    this.updateStreakDisplay();
  }

  renderSignedOut() {
    return `
      <div class="daily-preview">
        <div class="daily-preview-header">
          <span class="daily-icon">🌅</span>
          <h3>Daily Growth</h3>
          <p>Build habits that transform your walk with God</p>
        </div>
        <div class="daily-preview-features">
          <div class="preview-feature">
            <span class="feature-icon">📖</span>
            <span>Daily Meditation</span>
          </div>
          <div class="preview-feature">
            <span class="feature-icon">🙏</span>
            <span>Prayer Prompts</span>
          </div>
          <div class="preview-feature">
            <span class="feature-icon">✍️</span>
            <span>Journaling</span>
          </div>
          <div class="preview-feature">
            <span class="feature-icon">🔥</span>
            <span>Streak Tracking</span>
          </div>
        </div>
        <a href="#signup" class="btn-primary daily-cta">Sign Up to Start Your Streak</a>
      </div>
    `;
  }

  renderSignedIn() {
    if (!this.meditation) {
      return `<div class="daily-loading">Loading today's meditation...</div>`;
    }
    
    const allCompleted = this.engagement.reflected && this.engagement.prayed && 
                         this.engagement.journaled && this.engagement.memorized;
    
    return `
      <div class="daily-grid">
        <!-- Streak Card -->
        <div class="daily-card streak-card">
          <div class="streak-header">
            <span class="streak-fire">🔥</span>
            <span class="streak-label">Current Streak</span>
          </div>
          <div class="streak-number" id="streak-number">${this.streak}</div>
          <div class="streak-days" id="streak-days"></div>
          <p class="streak-message">${this.getStreakMessage()}</p>
        </div>
        
        <!-- Meditation Card -->
        <div class="daily-card meditation-card">
          <div class="meditation-header">
            <span class="meditation-icon">📖</span>
            <span class="meditation-label">Today's Meditation</span>
          </div>
          <h3 class="meditation-title">${this.escapeHtml(this.meditation.title)}</h3>
          <p class="meditation-verse">${this.escapeHtml(this.meditation.verse)}</p>
          <blockquote class="meditation-text">${this.escapeHtml(this.meditation.verseText)}</blockquote>
          <div class="meditation-reflection">
            <p>${this.escapeHtml(this.meditation.reflection)}</p>
          </div>
          <button class="daily-action-btn reflected-btn ${this.engagement.reflected ? 'completed' : ''}" 
                  data-action="reflected" ${this.engagement.reflected ? 'disabled' : ''}>
            ${this.engagement.reflected ? '✓ Reflected' : '📝 I Reflected'}
          </button>
        </div>
        
        <!-- Prayer Card -->
        <div class="daily-card prayer-card">
          <div class="prayer-header">
            <span class="prayer-icon">🙏</span>
            <span class="prayer-label">Prayer Prompt</span>
          </div>
          <p class="prayer-prompt">${this.escapeHtml(this.meditation.prayerPrompt)}</p>
          <button class="daily-action-btn prayed-btn ${this.engagement.prayed ? 'completed' : ''}" 
                  data-action="prayed" ${this.engagement.prayed ? 'disabled' : ''}>
            ${this.engagement.prayed ? '✓ Prayed' : '🙏 I Prayed'}
          </button>
        </div>
        
        <!-- Action Step Card -->
        <div class="daily-card action-card">
          <div class="action-header">
            <span class="action-icon">⚡</span>
            <span class="action-label">Today's Action</span>
          </div>
          <p class="action-text">${this.escapeHtml(this.meditation.actionStep)}</p>
          <div class="habit-check-wrapper">
            <label class="habit-check-label">
              <input type="checkbox" class="habit-checkbox" data-habit="memorized" 
                     ${this.engagement.memorized ? 'checked disabled' : ''}>
              <span>I completed today's action</span>
            </label>
          </div>
        </div>
        
        <!-- Journal Card -->
        <div class="daily-card journal-card ${this.engagement.journaled ? 'completed-card' : ''}">
          <div class="journal-header">
            <span class="journal-icon">✍️</span>
            <span class="journal-label">Journal Entry</span>
          </div>
          <textarea class="journal-input" id="journal-input" 
                    placeholder="Write down what God is speaking to you today..."
                    ${this.engagement.journaled ? 'disabled' : ''}>${this.engagement.journalContent || ''}</textarea>
          <button class="daily-action-btn journal-btn ${this.engagement.journaled ? 'completed' : ''}" 
                  data-action="journaled" ${this.engagement.journaled ? 'disabled' : ''}>
            ${this.engagement.journaled ? '✓ Saved' : '✍️ Save Journal'}
          </button>
        </div>
        
        <!-- Completion Card -->
        <div class="daily-card completion-card ${allCompleted ? 'completed' : ''}">
          <div class="completion-header">
            <span class="completion-icon">🎯</span>
            <span class="completion-label">Daily Progress</span>
          </div>
          <div class="completion-progress">
            <div class="progress-steps">
              <div class="progress-step ${this.engagement.reflected ? 'done' : ''}">📖</div>
              <div class="progress-step ${this.engagement.prayed ? 'done' : ''}">🙏</div>
              <div class="progress-step ${this.engagement.journaled ? 'done' : ''}">✍️</div>
              <div class="progress-step ${this.engagement.memorized ? 'done' : ''}">⚡</div>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${this.getProgressPercent()}%"></div>
            </div>
          </div>
          ${allCompleted ? '<p class="completion-message">🎉 Day complete! Great job!</p>' : ''}
        </div>
      </div>
    `;
  }

  getProgressPercent() {
    let completed = 0;
    if (this.engagement.reflected) completed++;
    if (this.engagement.prayed) completed++;
    if (this.engagement.journaled) completed++;
    if (this.engagement.memorized) completed++;
    return (completed / 4) * 100;
  }

  getStreakMessage() {
    if (this.streak === 0) return "Start your streak by completing today's habits";
    if (this.streak === 1) return "Great start! One day down!";
    if (this.streak < 7) return `${this.streak} days in a row — keep going!`;
    if (this.streak === 7) return "🎉 One week! Your consistency is inspiring!";
    return `${this.streak} day streak — you're building a powerful habit!`;
  }

  updateStreakDisplay() {
    const streakDaysContainer = document.getElementById('streak-days');
    if (!streakDaysContainer || !this.streakHistory.length) return;
    
    streakDaysContainer.innerHTML = this.streakHistory.map(day => `
      <div class="streak-day ${day.completed ? 'completed' : 'missed'}">
        <span class="streak-day-name">${day.dayName}</span>
        <span class="streak-day-status">${day.completed ? '✓' : '○'}</span>
      </div>
    `).join('');
    
    const streakNumber = document.getElementById('streak-number');
    if (streakNumber) streakNumber.textContent = this.streak;
  }

  attachActivityListeners() {
    // Reflected button
    const reflectedBtn = document.querySelector('[data-action="reflected"]');
    if (reflectedBtn && !this.engagement.reflected) {
      reflectedBtn.addEventListener('click', () => this.logActivity('reflected'));
    }
    
    // Prayed button
    const prayedBtn = document.querySelector('[data-action="prayed"]');
    if (prayedBtn && !this.engagement.prayed) {
      prayedBtn.addEventListener('click', () => this.logActivity('prayed'));
    }
    
    // Journal button
    const journalBtn = document.querySelector('[data-action="journaled"]');
    const journalInput = document.getElementById('journal-input');
    if (journalBtn && !this.engagement.journaled) {
      journalBtn.addEventListener('click', () => {
        const content = journalInput?.value || '';
        if (content.trim().length < 10) {
          this.showToast('Please write at least a few sentences before saving', 'warning');
          return;
        }
        this.logActivity('journaled', content);
      });
    }
    
    // Habit checkbox
    const habitCheckbox = document.querySelector('[data-habit="memorized"]');
    if (habitCheckbox && !this.engagement.memorized) {
      habitCheckbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          this.logActivity('memorized');
        }
      });
    }
  }

  attachEventListeners() {
    // Already handled in attachActivityListeners
  }

  showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `daily-toast daily-toast-${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
      if (m === '&') return '&amp;';
      if (m === '<') return '&lt;';
      if (m === '>') return '&gt;';
      return m;
    });
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize if we're not on admin page
  if (!window.location.pathname.includes('/admin/')) {
    window.dailyEngagement = new DailyEngagement();
  }
});