// assets/js/daily-admin.js
// Admin dashboard for managing daily meditations

class DailyAdmin {
  constructor() {
    this.adminEmail = null;
    this.currentDate = new Date().toISOString().split('T')[0];
    this.init();
  }

  async init() {
    // Check if user is admin
    const isAdmin = await this.checkAdminStatus();
    if (!isAdmin) {
      this.showUnauthorized();
      return;
    }
    
    this.loadMeditation(this.currentDate);
    this.attachEventListeners();
    this.populateDatePicker();
  }

  async checkAdminStatus() {
    try {
      // Get current user from localStorage (from your existing auth)
      const userData = localStorage.getItem('tc4c_user');
      if (!userData) return false;
      
      const user = JSON.parse(userData);
      this.adminEmail = user.email;
      
      // List of admin emails (store these in environment variables in production)
      const adminEmails = [
        'admin@tochristforchrist.org',
        'hello@tochristforchrist.org',
        'pastor@tochristforchrist.org'
      ];
      
      return adminEmails.includes(this.adminEmail);
    } catch (e) {
      console.error('Admin check failed:', e);
      return false;
    }
  }

  showUnauthorized() {
    const container = document.getElementById('daily-admin-container');
    if (container) {
      container.innerHTML = `
        <div class="admin-unauthorized">
          <span class="unauthorized-icon">🔒</span>
          <h3>Admin Access Required</h3>
          <p>You don't have permission to access this page.</p>
          <a href="/index.html" class="btn-primary">Return to Home</a>
        </div>
      `;
    }
  }

  populateDatePicker() {
    const datePicker = document.getElementById('admin-date-picker');
    if (!datePicker) return;
    
    // Set to current date
    datePicker.value = this.currentDate;
    
    // Add quick navigation buttons
    const navButtons = document.createElement('div');
    navButtons.className = 'date-nav-buttons';
    navButtons.innerHTML = `
      <button type="button" id="prev-day-btn" class="btn-small">← Previous Day</button>
      <button type="button" id="today-btn" class="btn-small">Today</button>
      <button type="button" id="next-day-btn" class="btn-small">Next Day →</button>
    `;
    datePicker.parentNode.insertBefore(navButtons, datePicker.nextSibling);
    
    document.getElementById('prev-day-btn')?.addEventListener('click', () => {
      const date = new Date(datePicker.value);
      date.setDate(date.getDate() - 1);
      datePicker.value = date.toISOString().split('T')[0];
      this.loadMeditation(datePicker.value);
    });
    
    document.getElementById('today-btn')?.addEventListener('click', () => {
      const today = new Date().toISOString().split('T')[0];
      datePicker.value = today;
      this.loadMeditation(today);
    });
    
    document.getElementById('next-day-btn')?.addEventListener('click', () => {
      const date = new Date(datePicker.value);
      date.setDate(date.getDate() + 1);
      datePicker.value = date.toISOString().split('T')[0];
      this.loadMeditation(datePicker.value);
    });
  }

  async loadMeditation(date) {
    this.showLoading(true);
    
    try {
      const response = await fetch(`/.netlify/functions/admin-daily-content?date=${date}`, {
        headers: {
          'Authorization': `Bearer ${this.getAuthToken()}`
        }
      });
      
      if (response.status === 404) {
        // No meditation for this date — clear form
        this.clearForm();
        this.showStatus('No meditation scheduled for this date. Create one below.', 'info');
        this.updatePreview();
        return;
      }
      
      if (!response.ok) throw new Error('Failed to load');
      
      const meditation = await response.json();
      this.populateForm(meditation);
      this.showStatus('Meditation loaded successfully', 'success');
      this.updatePreview();
      
    } catch (error) {
      console.error('Load error:', error);
      this.showStatus('Failed to load meditation', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async saveMeditation(formData) {
    this.showLoading(true);
    
    try {
      const response = await fetch('/.netlify/functions/admin-daily-content', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          date: this.currentDate,
          title: formData.title,
          verse: formData.verse,
          verseText: formData.verseText,
          reflection: formData.reflection,
          prayerPrompt: formData.prayerPrompt,
          actionStep: formData.actionStep,
          adminEmail: this.adminEmail
        })
      });
      
      if (!response.ok) throw new Error('Save failed');
      
      this.showStatus('Meditation saved successfully!', 'success');
      this.updatePreview();
      
      // Show success animation
      this.showSaveConfirmation();
      
    } catch (error) {
      this.showStatus('Failed to save. Please try again.', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  async deleteMeditation() {
    if (!confirm('Are you sure you want to delete this meditation? This action cannot be undone.')) return;
    
    this.showLoading(true);
    
    try {
      const response = await fetch('/.netlify/functions/admin-daily-content', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({ 
          date: this.currentDate, 
          adminEmail: this.adminEmail 
        })
      });
      
      if (!response.ok) throw new Error('Delete failed');
      
      this.clearForm();
      this.showStatus('Meditation deleted', 'success');
      this.updatePreview();
      
    } catch (error) {
      this.showStatus('Failed to delete', 'error');
    } finally {
      this.showLoading(false);
    }
  }

  populateForm(meditation) {
    document.getElementById('med-title').value = meditation.title || '';
    document.getElementById('med-verse').value = meditation.verse || '';
    document.getElementById('med-verse-text').value = meditation.verseText || '';
    document.getElementById('med-reflection').value = meditation.reflection || '';
    document.getElementById('med-prayer-prompt').value = meditation.prayerPrompt || '';
    document.getElementById('med-action-step').value = meditation.actionStep || '';
  }

  clearForm() {
    document.getElementById('med-title').value = '';
    document.getElementById('med-verse').value = '';
    document.getElementById('med-verse-text').value = '';
    document.getElementById('med-reflection').value = '';
    document.getElementById('med-prayer-prompt').value = '';
    document.getElementById('med-action-step').value = '';
  }

  updatePreview() {
    const title = document.getElementById('med-title')?.value || 'Untitled';
    const verse = document.getElementById('med-verse')?.value || 'Scripture Reference';
    const verseText = document.getElementById('med-verse-text')?.value || 'Scripture text will appear here...';
    const reflection = document.getElementById('med-reflection')?.value;
    
    const previewTitle = document.getElementById('preview-title');
    const previewVerse = document.getElementById('preview-verse');
    const previewText = document.getElementById('preview-text');
    const previewReflection = document.getElementById('preview-reflection');
    
    if (previewTitle) previewTitle.textContent = title;
    if (previewVerse) previewVerse.textContent = verse;
    if (previewText) previewText.textContent = verseText;
    
    if (previewReflection) {
      if (reflection && reflection.trim()) {
        previewReflection.textContent = reflection;
        previewReflection.style.display = 'block';
      } else {
        previewReflection.style.display = 'none';
      }
    }
  }

  showStatus(message, type) {
    const statusEl = document.getElementById('admin-status');
    if (!statusEl) return;
    
    statusEl.textContent = message;
    statusEl.className = `admin-status status-${type}`;
    
    setTimeout(() => {
      statusEl.className = 'admin-status';
    }, 3000);
  }

  showSaveConfirmation() {
    const btn = document.querySelector('#save-meditation-btn');
    if (!btn) return;
    
    const originalText = btn.textContent;
    btn.textContent = '✓ Saved!';
    btn.style.background = '#4A8C60';
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
    }, 2000);
  }

  showLoading(show) {
    const loader = document.getElementById('admin-loader');
    if (loader) {
      loader.style.display = show ? 'flex' : 'none';
    }
    
    const form = document.getElementById('meditation-form');
    if (form) {
      const inputs = form.querySelectorAll('input, textarea, button');
      inputs.forEach(input => {
        if (input.type !== 'submit') {
          input.disabled = show;
        }
      });
    }
  }

  getAuthToken() {
    // Get from your existing auth system
    return localStorage.getItem('auth_token') || '';
  }

  attachEventListeners() {
    const form = document.getElementById('meditation-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const formData = {
          title: document.getElementById('med-title').value.trim(),
          verse: document.getElementById('med-verse').value.trim(),
          verseText: document.getElementById('med-verse-text').value.trim(),
          reflection: document.getElementById('med-reflection').value,
          prayerPrompt: document.getElementById('med-prayer-prompt').value,
          actionStep: document.getElementById('med-action-step').value
        };
        
        if (!formData.title || !formData.verse || !formData.verseText) {
          this.showStatus('Please fill in title, verse reference, and scripture text', 'error');
          return;
        }
        
        this.saveMeditation(formData);
      });
    }
    
    const deleteBtn = document.getElementById('delete-meditation-btn');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.deleteMeditation());
    }
    
    const datePicker = document.getElementById('admin-date-picker');
    if (datePicker) {
      datePicker.addEventListener('change', (e) => {
        this.currentDate = e.target.value;
        this.loadMeditation(this.currentDate);
      });
    }
    
    // Real-time preview updates
    const previewInputs = ['med-title', 'med-verse', 'med-verse-text', 'med-reflection'];
    previewInputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => this.updatePreview());
    });
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      // Ctrl/Cmd + S to save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const submitBtn = document.querySelector('#save-meditation-btn');
        if (submitBtn && !submitBtn.disabled) {
          form?.dispatchEvent(new Event('submit'));
        }
      }
    });
  }

  // Analytics dashboard methods (for future phase)
  async loadAnalytics() {
    try {
      const response = await fetch('/.netlify/functions/daily-analytics', {
        headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
      });
      
      if (response.ok) {
        const analytics = await response.json();
        this.renderAnalytics(analytics);
      }
    } catch (e) {
      console.error('Failed to load analytics', e);
    }
  }

  renderAnalytics(analytics) {
    const container = document.getElementById('analytics-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="analytics-grid">
        <div class="analytics-card">
          <h4>🔥 Average Streak</h4>
          <div class="analytics-number">${analytics.avgStreak || 0}</div>
          <span>days</span>
        </div>
        <div class="analytics-card">
          <h4>✅ Daily Completion Rate</h4>
          <div class="analytics-number">${analytics.completionRate || 0}%</div>
          <span>of active users</span>
        </div>
        <div class="analytics-card">
          <h4>✍️ Journal Entries</h4>
          <div class="analytics-number">${analytics.totalJournals || 0}</div>
          <span>total written</span>
        </div>
        <div class="analytics-card">
          <h4>🙏 Most Prayed</h4>
          <div class="analytics-number">${analytics.topPrayerTopic || 'Thanksgiving'}</div>
          <span>this week</span>
        </div>
      </div>
    `;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Only initialize on admin page
  if (document.getElementById('daily-admin-container')) {
    window.dailyAdmin = new DailyAdmin();
  }
});