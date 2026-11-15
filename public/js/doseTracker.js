import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class DoseTracker {
  constructor() {
    this.doses = [];
    this.currentFilter = 'all';
    this.currentViewMode = 'today'; // 'today' or 'history'
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.historyData = null;
  }

  init() {
    this.bindEvents();
    window.addEventListener('circle:changed', () => {
      this.loadDoses();
      this.loadHistory();
    });
    window.addEventListener('medications:changed', () => this.loadDoses());
  }

  bindEvents() {
    // Filter buttons (All, Pending, Taken, Missed)
    document.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.filter-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        this.currentFilter = e.currentTarget.getAttribute('data-filter');
        this.renderDoseBoard();
      });
    });

    // Date selector
    const dateInput = document.getElementById('dose-date-selector');
    if (dateInput) {
      dateInput.value = this.selectedDate;
      dateInput.addEventListener('change', (e) => {
        this.selectedDate = e.target.value;
        this.loadDoses();
      });
    }

    // Refresh doses button
    const btnRefresh = document.getElementById('btn-refresh-doses');
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => {
        this.loadDoses();
      });
    }

    // View toggle: Today vs History
    const btnToggleHistory = document.getElementById('btn-toggle-dose-history');
    if (btnToggleHistory) {
      btnToggleHistory.addEventListener('click', () => {
        this.currentViewMode = this.currentViewMode === 'today' ? 'history' : 'today';
        btnToggleHistory.textContent =
          this.currentViewMode === 'today' ? '📊 View 30-Day History' : '💊 Back to Daily Doses';
        this.updateViewMode();
      });
    }
  }

  updateViewMode() {
    const dailyView = document.getElementById('dose-daily-container');
    const historyView = document.getElementById('dose-history-container');

    if (this.currentViewMode === 'history') {
      dailyView?.classList.add('hidden');
      historyView?.classList.remove('hidden');
      this.loadHistory();
    } else {
      historyView?.classList.add('hidden');
      dailyView?.classList.remove('hidden');
      this.loadDoses();
    }
  }

  async loadDoses() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/doses', {
        circleId: circle.activeCircle.id,
        date: this.selectedDate
      });

      this.doses = res.doses || [];
      this.renderDoseBoard();
      window.dispatchEvent(new CustomEvent('doses:changed', { detail: { doses: this.doses } }));
    } catch (err) {
      console.error('Failed to load doses:', err);
    }
  }

  async loadHistory() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/doses/history', {
        circleId: circle.activeCircle.id,
        days: 30
      });

      if (res.success) {
        this.historyData = res.history;
        this.renderHistoryView();
      }
    } catch (err) {
      console.error('Failed to load history:', err);
    }
  }

  canUserLogDoses() {
    if (circle.isElder) return true;
    const perms = circle.activeCircle?.permissions || {};
    if (circle.userRole === 'caretaker' && perms.caretakerCanLogDoses !== false) return true;
    if (circle.userRole === 'family' && perms.familyCanLogDoses === true) return true;
    return false;
  }

  renderDoseBoard() {
    const container = document.getElementById('dose-tracker-list');
    if (!container) return;

    container.innerHTML = '';

    const filtered = this.doses.filter((d) => {
      if (this.currentFilter === 'all') return true;
      return d.status.toLowerCase() === this.currentFilter.toLowerCase();
    });

    if (filtered.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No doses match the "${this.currentFilter}" filter for ${this.selectedDate}.</p>
        </div>
      `;
      return;
    }

    const canLog = this.canUserLogDoses();

    filtered.forEach((dose) => {
      const card = document.createElement('div');
      card.className = `dose-card status-${dose.status.toLowerCase()}`;
      card.setAttribute('data-status', dose.status);

      const statusIcons = {
        Taken: '✅ Taken',
        Pending: '⏳ Pending',
        Missed: '⚠️ Missed'
      };

      const sourceBadgeClass =
        dose.sourceLabel === 'From the packaging' ? 'badge-verified' : 'badge-unverified';

      // Audit info formatting
      let auditHtml = '';
      if (dose.loggedBy) {
        const timeStr = dose.loggedAt
          ? new Date(dose.loggedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '';
        auditHtml = `
          <div class="dose-audit-info">
            <small>Updated by <strong>${escapeHtml(dose.loggedBy.name)}</strong> (${escapeHtml(dose.loggedBy.role)}) at ${timeStr}</small>
            ${dose.notes ? `<p class="dose-note-text"><em>Note: ${escapeHtml(dose.notes)}</em></p>` : ''}
            ${dose.missedReason ? `<p class="dose-missed-reason"><em>Reason: ${escapeHtml(dose.missedReason)}</em></p>` : ''}
          </div>
        `;
      }

      card.innerHTML = `
        <div class="dose-time-column">
          <span class="dose-time">${escapeHtml(dose.scheduledTime)}</span>
          <span class="status-chip chip-${dose.status.toLowerCase()}">${statusIcons[dose.status] || dose.status}</span>
        </div>

        <div class="dose-details-column">
          <span class="med-form-pill">${escapeHtml(dose.form || 'Tablet')}</span>
          <h3 class="dose-med-name">${escapeHtml(dose.medicineName)}</h3>
          <p class="dose-dosage-text">Strength: <strong>${escapeHtml(dose.strength || dose.dosage || 'Standard')}</strong></p>
          ${
            dose.instructions
              ? `
            <div class="dose-instructions-box">
              <small>Instructions: ${escapeHtml(dose.instructions)}</small>
            </div>
          `
              : ''
          }
          <span class="source-badge ${sourceBadgeClass}">
            ${escapeHtml(dose.sourceLabel || 'From the packaging')}
          </span>
          ${auditHtml}
        </div>

        <div class="dose-actions-column">
          ${
            canLog
              ? `
            <button class="btn btn-take btn-dose-action btn-large-touch" data-dose-id="${dose.id}" data-action="Taken" aria-label="Mark ${escapeHtml(dose.medicineName)} as Taken">
              ✓ Mark Taken
            </button>
            <button class="btn btn-miss btn-dose-action" data-dose-id="${dose.id}" data-action="Missed" aria-label="Mark ${escapeHtml(dose.medicineName)} as Missed">
              ✕ Missed
            </button>
            ${
              dose.status !== 'Pending'
                ? `
              <button class="btn btn-reset btn-dose-action" data-dose-id="${dose.id}" data-action="Pending" aria-label="Reset ${escapeHtml(dose.medicineName)} to Pending">
                ↺ Reset
              </button>
            `
                : ''
            }
          `
              : `
            <span class="permission-notice">View-only role</span>
          `
          }
        </div>
      `;

      container.appendChild(card);
    });

    // Attach listeners
    container.querySelectorAll('.btn-dose-action').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const doseId = e.currentTarget.getAttribute('data-dose-id');
        const newStatus = e.currentTarget.getAttribute('data-action');
        await this.logDose(doseId, newStatus);
      });
    });
  }

  renderHistoryView() {
    if (!this.historyData) return;

    const percentageEl = document.getElementById('history-adherence-pct');
    const totalDueEl = document.getElementById('history-total-due');
    const takenEl = document.getElementById('history-taken-count');
    const missedEl = document.getElementById('history-missed-count');
    const missedListEl = document.getElementById('history-missed-doses-list');

    if (percentageEl) percentageEl.textContent = `${this.historyData.adherencePercentage}%`;
    if (totalDueEl) totalDueEl.textContent = this.historyData.totalDue;
    if (takenEl) takenEl.textContent = this.historyData.takenCount;
    if (missedEl) missedEl.textContent = this.historyData.missedCount;

    if (missedListEl) {
      missedListEl.innerHTML = '';
      const missed = this.historyData.missedDoses || [];

      if (missed.length === 0) {
        missedListEl.innerHTML =
          '<li class="empty-state">🎉 Outstanding! No missed doses recorded in the last 30 days.</li>';
      } else {
        missed.forEach((dose) => {
          const li = document.createElement('li');
          li.className = 'missed-dose-item';
          li.innerHTML = `
            <div class="missed-header">
              <span class="missed-date">📅 ${dose.scheduledDate} at ${dose.scheduledTime}</span>
              <span class="status-chip chip-missed">MISSED</span>
            </div>
            <h4 class="missed-med-name">${escapeHtml(dose.medicineName)} (${escapeHtml(dose.strength || dose.dosage)})</h4>
            ${dose.missedReason ? `<p class="missed-reason-text">Reason: <em>${escapeHtml(dose.missedReason)}</em></p>` : ''}
            ${dose.instructions ? `<small class="text-muted">Instructions: ${escapeHtml(dose.instructions)}</small>` : ''}
          `;
          missedListEl.appendChild(li);
        });
      }
    }
  }

  async logDose(doseId, status) {
    try {
      const res = await api.post('/api/doses/log', {
        circleId: circle.activeCircle.id,
        doseId,
        status,
        notes: status === 'Missed' ? 'Missed dose recorded' : 'Dose confirmed taken'
      });

      if (res.success) {
        const medName = res.dose?.medicineName || 'Medication';
        const announcement =
          status === 'Taken'
            ? `Success: ${medName} marked as Taken.`
            : `Notice: ${medName} recorded as ${status}.`;
        a11y.announce(announcement, 'assertive');
        if (status === 'Taken' && a11y.voiceEnabled) {
          a11y.speak(`${medName} marked as taken.`);
        }
        await this.loadDoses();
        await this.loadHistory();
      }
    } catch (err) {
      alert(`Could not update dose: ${err.message}`);
    }
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const doseTracker = new DoseTracker();
