import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class CarePulseManager {
  constructor() {
    this.pulse = null;
  }

  init() {
    this.bindEvents();
    window.addEventListener('circle:changed', () => this.loadPulse());
    window.addEventListener('doses:changed', () => this.loadPulse());
    window.addEventListener('appointments:changed', () => this.loadPulse());
  }

  bindEvents() {
    // Manual trigger for Cloud Scheduler routine
    const btnTriggerScheduler = document.getElementById('btn-trigger-scheduler');
    if (btnTriggerScheduler) {
      btnTriggerScheduler.addEventListener('click', async () => {
        await this.triggerSchedulerCheck();
      });
    }

    // View Email Audit Logs
    const btnViewAudit = document.getElementById('btn-view-audit-logs');
    if (btnViewAudit) {
      btnViewAudit.addEventListener('click', async () => {
        await this.openAuditLogsModal();
      });
    }

    // Send Daily Pulse Email button
    const btnSendPulseEmail = document.getElementById('btn-send-pulse-email');
    if (btnSendPulseEmail) {
      btnSendPulseEmail.addEventListener('click', async () => {
        await this.dispatchDailyPulseEmail();
      });
    }

    // Dispatch Weekly Family Summary Email
    const btnDispatchWeekly = document.getElementById('btn-dispatch-weekly-email');
    if (btnDispatchWeekly) {
      btnDispatchWeekly.addEventListener('click', async () => {
        await this.dispatchWeeklySummaryEmail();
      });
    }
  }

  async loadPulse() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/doses/pulse', { circleId: circle.activeCircle.id });
      if (res.success) {
        this.pulse = res.pulse;
        this.renderPulseUI();
      }
      await this.loadWeeklySummary();
    } catch (err) {
      console.error('Failed to load care pulse:', err);
    }
  }

  async loadWeeklySummary() {
    if (!circle.activeCircle) return;

    const card = document.getElementById('card-weekly-family-summary');
    if (!card) return;

    try {
      const res = await api.get(`/api/circles/${circle.activeCircle.id}/weekly-summary`);
      if (res.success && res.summary) {
        const s = res.summary;
        const adhPill = document.getElementById('weekly-adherence-pill');
        const rangePill = document.getElementById('weekly-range-pill');
        const narrativeText = document.getElementById('weekly-narrative-text');
        const metaInfo = document.getElementById('weekly-meta-info');

        if (adhPill) adhPill.textContent = `${s.adherenceRate}% Adherence`;
        if (rangePill) rangePill.textContent = s.weekRange || 'Past 7 Days';
        if (narrativeText) narrativeText.textContent = s.summaryText;

        const valMorn = document.getElementById('val-slot-morning');
        const valAft = document.getElementById('val-slot-afternoon');
        const valEve = document.getElementById('val-slot-evening');
        const valNight = document.getElementById('val-slot-night');

        if (valMorn) valMorn.textContent = s.missedByTimeOfDay?.morning || 0;
        if (valAft) valAft.textContent = s.missedByTimeOfDay?.afternoon || 0;
        if (valEve) valEve.textContent = s.missedByTimeOfDay?.evening || 0;
        if (valNight) valNight.textContent = s.missedByTimeOfDay?.night || 0;

        if (metaInfo) {
          metaInfo.textContent = `Generated via ${s.generatedBy === 'gemini' ? 'Gemini AI' : 'Safe Template'}. Sent once weekly to permitted family circle.`;
        }
      }
    } catch (err) {
      console.warn('Could not load weekly summary:', err);
    }
  }

  async dispatchWeeklySummaryEmail() {
    if (!circle.activeCircle) return;
    try {
      const res = await api.post(`/api/circles/${circle.activeCircle.id}/weekly-summary/send`);
      if (res.success) {
        a11y.announce('Weekly family summary email sent');
        alert(res.message || 'Weekly family summary dispatched!');
      }
    } catch (err) {
      alert(`Could not send weekly summary: ${err.message}`);
    }
  }

  renderPulseUI() {
    if (!this.pulse) return;

    const adherenceEl = document.getElementById('pulse-adherence-percentage');
    const adherenceBar = document.getElementById('pulse-progress-bar');
    const statusTextEl = document.getElementById('pulse-status-text');
    const takenEl = document.getElementById('pulse-count-taken');
    const pendingEl = document.getElementById('pulse-count-pending');
    const missedEl = document.getElementById('pulse-count-missed');
    const completionEl = document.getElementById('pulse-completion-text');
    const plainMessageEl = document.getElementById('pulse-plain-message');
    const nextDoseTextEl = document.getElementById('pulse-next-dose-text');
    const nextDoseSubEl = document.getElementById('pulse-next-dose-sub');
    const alertsContainer = document.getElementById('pulse-alerts-container');
    const apptsListEl = document.getElementById('pulse-upcoming-appts-list');

    const rate = this.pulse.adherenceRate ?? 100;
    const taken = this.pulse.takenCount ?? this.pulse.taken ?? 0;
    const pending = this.pulse.pendingCount ?? this.pulse.pending ?? 0;
    const missed = this.pulse.missedCount ?? this.pulse.missed ?? 0;
    const total = this.pulse.totalDosesToday ?? this.pulse.totalDoses ?? (taken + pending + missed);

    // 1. Adherence metrics & Progress bar
    if (adherenceEl) adherenceEl.textContent = `${rate}%`;
    if (adherenceBar) {
      adherenceBar.style.width = `${rate}%`;
      adherenceBar.setAttribute('aria-valuenow', rate);
      if (rate >= 80) adherenceBar.className = 'progress-bar-fill progress-high';
      else if (rate >= 60) adherenceBar.className = 'progress-bar-fill progress-medium';
      else adherenceBar.className = 'progress-bar-fill progress-low';
    }

    // 2. Status badge (text label, never color alone)
    if (statusTextEl) {
      statusTextEl.textContent = this.pulse.statusTextBadge || this.pulse.statusText || (rate >= 80 ? '[EXCELLENT: ON TRACK]' : '[ATTENTION REQUIRED]');
    }

    // 3. Stat counters
    if (takenEl) takenEl.textContent = taken;
    if (pendingEl) pendingEl.textContent = pending;
    if (missedEl) missedEl.textContent = missed;

    // 4. Completion indicator (e.g. "3 of 5 doses taken (60% complete)")
    if (completionEl) {
      completionEl.textContent = this.pulse.completionText || (total > 0
        ? `${taken} of ${total} doses taken (${Math.round((taken / total) * 100)}% complete)`
        : 'No doses scheduled for today');
    }

    if (plainMessageEl) {
      plainMessageEl.textContent = this.pulse.plainStatusMessage || (missed > 0
        ? `${missed} dose was missed today. Follow-up is recommended.`
        : (pending > 0 ? `${pending} dose remaining to be taken today.` : 'All scheduled doses taken for today.'));
    }

    // 5. Next upcoming dose
    if (nextDoseTextEl) {
      if (this.pulse.nextUpcomingDose) {
        nextDoseTextEl.textContent = this.pulse.nextUpcomingDose.textLabel || 'No dose pending.';
        if (nextDoseSubEl) {
          nextDoseSubEl.textContent = this.pulse.nextUpcomingDose.instructions
            ? `Instructions: ${this.pulse.nextUpcomingDose.instructions}`
            : '';
        }
      } else {
        nextDoseTextEl.textContent = 'All doses taken or none scheduled for today.';
        if (nextDoseSubEl) nextDoseSubEl.textContent = '';
      }
    }

    // 6. Active Alerts Banner (Never color alone)
    if (alertsContainer) {
      const alerts = this.pulse.activeAlerts || [];
      if (alerts.length === 0) {
        alertsContainer.innerHTML = '';
        alertsContainer.classList.add('hidden');
      } else {
        alertsContainer.classList.remove('hidden');
        alertsContainer.innerHTML = alerts.map(alert => `
          <div class="alert-box alert-${alert.level || 'warning'}" role="alert">
            <span class="alert-badge-text">${escapeHtml(alert.badgeText)}</span>
            <div class="alert-content">
              <strong>${escapeHtml(alert.title)}</strong>
              <p>${escapeHtml(alert.message)}</p>
            </div>
          </div>
        `).join('');
      }
    }

    // 7. Upcoming Appointments Quick List
    if (apptsListEl) {
      const appts = this.pulse.upcomingAppointments || [];
      if (appts.length === 0) {
        apptsListEl.innerHTML = '<li class="empty-quicklist text-muted">No upcoming doctor visits in the next few days.</li>';
      } else {
        apptsListEl.innerHTML = appts.map(appt => {
          const d = new Date(appt.datetime);
          const dateStr = isNaN(d.getTime()) ? appt.datetime : d.toLocaleDateString('en-IN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });
          return `
            <li class="quick-appt-item">
              <span class="quick-appt-time">📅 ${escapeHtml(dateStr)}</span>
              <strong class="quick-appt-doc">Dr. ${escapeHtml(appt.doctorName)}</strong>
              <span class="quick-appt-purpose">(${escapeHtml(appt.purpose || appt.specialty || 'Checkup')})</span>
              <span class="quick-appt-place">📍 ${escapeHtml(appt.place || appt.location || '')}</span>
            </li>
          `;
        }).join('');
      }
    }
  }

  async triggerSchedulerCheck() {
    if (!circle.activeCircle) return;
    try {
      a11y.announce('Running Cloud Scheduler reminder and escalation check...');
      const res = await api.post('/api/scheduler/check-reminders', {
        circleId: circle.activeCircle.id
      });
      if (res.success) {
        const { upcomingRemindersSent, missedEscalationsSent, appointmentRemindersSent } = res.result;
        alert(`Scheduler Cycle Completed:\n- Upcoming dose reminders: ${upcomingRemindersSent}\n- Missed dose escalations: ${missedEscalationsSent}\n- Appointment reminders: ${appointmentRemindersSent}`);
        await this.loadPulse();
        window.dispatchEvent(new CustomEvent('doses:changed'));
      }
    } catch (err) {
      alert(`Scheduler check failed: ${err.message}`);
    }
  }

  async dispatchDailyPulseEmail() {
    if (!circle.activeCircle) return;
    try {
      const res = await api.post('/api/scheduler/daily-pulse', {
        circleId: circle.activeCircle.id
      });
      if (res.success) {
        alert('Daily Care Pulse email generated and dispatched to circle members!');
      }
    } catch (err) {
      alert(`Could not send pulse email: ${err.message}`);
    }
  }

  async openAuditLogsModal() {
    try {
      const res = await api.get('/api/scheduler/audit-logs');
      const modal = document.getElementById('modal-audit-logs');
      const listEl = document.getElementById('audit-logs-list');

      if (!modal || !listEl) return;

      listEl.innerHTML = '';
      if (!res.logs || res.logs.length === 0) {
        listEl.innerHTML = '<li class="empty-state">No email notifications sent yet in this session. Trigger a reminder or log a dose to see simulated email logs.</li>';
      } else {
        res.logs.forEach(log => {
          const li = document.createElement('li');
          li.className = 'audit-log-item';
          const time = new Date(log.timestamp).toLocaleTimeString();
          li.innerHTML = `
            <div class="audit-header">
              <span class="audit-time">⏰ ${time}</span>
              <span class="audit-to">To: <strong>${escapeHtml(log.to)}</strong></span>
            </div>
            <div class="audit-subject">Subject: <em>${escapeHtml(log.subject)}</em></div>
            <div class="audit-body">${log.html}</div>
          `;
          listEl.appendChild(li);
        });
      }

      modal.classList.remove('hidden');
    } catch (err) {
      alert(`Failed to fetch audit logs: ${err.message}`);
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

export const pulse = new CarePulseManager();
