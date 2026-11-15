import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class ElderSimpleModeManager {
  constructor() {
    this.currentPendingDose = null;
    this.todayDoses = [];
    this.nextAppointment = null;
    this.isActive = false;
  }

  init() {
    this.bindEvents();

    window.addEventListener('circle:changed', () => this.refreshData());
    window.addEventListener('doses:changed', () => this.refreshData());
    window.addEventListener('appointments:changed', () => this.refreshData());
    window.addEventListener('auth:changed', (e) => {
      if (e.detail.user?.role === 'elder') {
        // Default to Elder Simple Mode for Elder role if not already chosen
        if (localStorage.getItem('cc_elder_simple_mode') === null) {
          this.setSimpleMode(true);
        }
      }
    });

    // Check initial state from accessibility manager
    this.syncModeState();
  }

  syncModeState() {
    const isSimple = localStorage.getItem('cc_elder_simple_mode') === 'true';
    this.setSimpleMode(isSimple);
  }

  bindEvents() {
    // Large "Taken" button
    const btnTakeGiant = document.getElementById('simple-btn-take-now');
    if (btnTakeGiant) {
      btnTakeGiant.addEventListener('click', async () => {
        await this.handleTakeNextDose();
      });
    }

    // Switch back to full standard dashboard
    const btnSwitchFull = document.getElementById('btn-switch-full-dashboard');
    if (btnSwitchFull) {
      btnSwitchFull.addEventListener('click', () => {
        this.setSimpleMode(false);
      });
    }

    // Enter simple mode from header toggle
    const toggleSimpleBtn = document.getElementById('toggle-simple-mode-btn');
    if (toggleSimpleBtn) {
      toggleSimpleBtn.addEventListener('click', () => {
        const nextState = !this.isActive;
        this.setSimpleMode(nextState);
      });
    }

    // Simple mode voice readout
    const btnSimpleVoice = document.getElementById('btn-simple-voice-readout');
    if (btnSimpleVoice) {
      btnSimpleVoice.addEventListener('click', () => {
        this.speakSimpleOverview();
      });
    }

    // Simple mode open accessibility settings
    const btnSimpleA11y = document.getElementById('btn-simple-open-a11y');
    if (btnSimpleA11y) {
      btnSimpleA11y.addEventListener('click', () => {
        const modal = document.getElementById('modal-accessibility-settings');
        if (modal) modal.classList.remove('hidden');
      });
    }
  }

  setSimpleMode(active) {
    this.isActive = Boolean(active);
    localStorage.setItem('cc_elder_simple_mode', String(this.isActive));

    const root = document.documentElement;
    const simpleView = document.getElementById('elder-simple-view');
    const pulseHero = document.querySelector('.pulse-hero');
    const tabsNav = document.querySelector('.tabs-nav');
    const tabPanels = document.querySelectorAll('.tab-panel');
    const toggleBtn = document.getElementById('toggle-simple-mode-btn');

    if (this.isActive) {
      root.classList.add('mode-elder-simple');
      simpleView?.classList.remove('hidden');
      pulseHero?.classList.add('hidden');
      tabsNav?.classList.add('hidden');
      tabPanels.forEach((p) => p.classList.add('hidden'));

      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', 'true');
        toggleBtn.classList.add('active');
        toggleBtn.textContent = '📊 Full Dashboard';
      }

      a11y.announce('Elder Simple Mode active. Showing next medicine and large action button.');
      this.refreshData();
    } else {
      root.classList.remove('mode-elder-simple');
      simpleView?.classList.add('hidden');
      pulseHero?.classList.remove('hidden');
      tabsNav?.classList.remove('hidden');

      // Restore first active tab panel
      const activeTab =
        document.querySelector('.nav-tab.active') || document.querySelector('.nav-tab');
      const targetPanelId = activeTab?.getAttribute('data-target') || 'panel-doses';
      tabPanels.forEach((p) => {
        if (p.id === targetPanelId) p.classList.remove('hidden');
        else p.classList.add('hidden');
      });

      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.classList.remove('active');
        toggleBtn.textContent = '👵 Elder Simple Mode';
      }

      a11y.announce('Standard dashboard restored.');
    }
  }

  async refreshData() {
    if (!circle.activeCircle) return;

    try {
      // 1. Fetch today's doses
      const dosesRes = await api.get('/api/doses', { circleId: circle.activeCircle.id });
      this.todayDoses = dosesRes.doses || [];

      // Sort by scheduled time
      this.todayDoses.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));

      // 2. Fetch upcoming appointments
      const apptsRes = await api.get('/api/appointments', { circleId: circle.activeCircle.id });
      const appts = apptsRes.appointments || [];
      this.nextAppointment = appts.find((a) => a.status === 'Upcoming') || null;

      this.renderSimpleMode();
    } catch (err) {
      console.error('Failed to refresh simple mode data:', err);
    }
  }

  renderSimpleMode() {
    // 1. Determine next pending medicine
    const pendingDoses = this.todayDoses.filter((d) => d.status === 'Pending');
    this.currentPendingDose = pendingDoses.length > 0 ? pendingDoses[0] : null;

    const medNameEl = document.getElementById('simple-next-med-name');
    const medTimeEl = document.getElementById('simple-next-med-time');
    const medInstrEl = document.getElementById('simple-next-med-instructions');
    const btnTakeGiant = document.getElementById('simple-btn-take-now');
    const allDoneBanner = document.getElementById('simple-all-done-banner');
    const nextHeroCard = document.getElementById('simple-hero-card');

    if (this.currentPendingDose) {
      allDoneBanner?.classList.add('hidden');
      nextHeroCard?.classList.remove('hidden');

      if (medNameEl) medNameEl.textContent = this.currentPendingDose.medicineName;
      if (medTimeEl) {
        medTimeEl.textContent = `⏰ Due at ${this.currentPendingDose.scheduledTime} (${this.currentPendingDose.strength || 'Standard Dose'})`;
      }
      if (medInstrEl) {
        medInstrEl.textContent = this.currentPendingDose.instructions
          ? `📝 Packaging instruction: ${this.currentPendingDose.instructions}`
          : 'Take with warm water as directed on packaging.';
      }
      if (btnTakeGiant) {
        btnTakeGiant.disabled = false;
        btnTakeGiant.innerHTML = `✅ I TOOK THIS MEDICINE<br><span class="btn-subtext">Click to mark ${escapeHtml(this.currentPendingDose.medicineName)} as Taken</span>`;
      }
    } else {
      // All doses taken or none pending today
      nextHeroCard?.classList.add('hidden');
      allDoneBanner?.classList.remove('hidden');

      if (btnTakeGiant) {
        btnTakeGiant.disabled = true;
        btnTakeGiant.innerHTML = `🎉 All Medicines Taken for Today`;
      }
    }

    // 2. Render Today's List Below
    const checklistEl = document.getElementById('simple-today-checklist');
    if (checklistEl) {
      if (this.todayDoses.length === 0) {
        checklistEl.innerHTML =
          '<li class="empty-state"><p>No medications scheduled for today.</p></li>';
      } else {
        checklistEl.innerHTML = this.todayDoses
          .map((dose) => {
            const isTaken = dose.status === 'Taken';
            const isMissed = dose.status === 'Missed';
            const badgeClass = isTaken
              ? 'badge-taken'
              : isMissed
                ? 'badge-missed'
                : 'badge-pending';
            const statusText = `[STATUS: ${dose.status.toUpperCase()}]`;

            return `
            <li class="simple-dose-item ${badgeClass}">
              <div class="simple-dose-left">
                <span class="simple-dose-time">${escapeHtml(dose.scheduledTime)}</span>
                <span class="simple-dose-badge ${badgeClass}">${statusText}</span>
              </div>
              <div class="simple-dose-center">
                <strong class="simple-dose-name">${escapeHtml(dose.medicineName)}</strong>
                <span class="simple-dose-strength">${escapeHtml(dose.strength || 'Standard')}</span>
                ${dose.instructions ? `<p class="simple-dose-instructions">${escapeHtml(dose.instructions)}</p>` : ''}
              </div>
            </li>
          `;
          })
          .join('');
      }
    }

    // 3. Render Next Appointment Card
    const apptCardEl = document.getElementById('simple-next-appt-card');
    if (apptCardEl) {
      if (!this.nextAppointment) {
        apptCardEl.innerHTML = `
          <div class="empty-appt-box">
            <p>No upcoming doctor appointments scheduled.</p>
          </div>
        `;
      } else {
        const d = new Date(this.nextAppointment.datetime);
        const dateStr = isNaN(d.getTime())
          ? this.nextAppointment.datetime
          : d.toLocaleDateString('en-IN', {
              weekday: 'long',
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            });

        apptCardEl.innerHTML = `
          <div class="simple-appt-content">
            <span class="simple-appt-icon" aria-hidden="true">🩺</span>
            <div class="simple-appt-details">
              <h4 class="simple-appt-doctor">Dr. ${escapeHtml(this.nextAppointment.doctorName)}</h4>
              <p class="simple-appt-purpose"><strong>Purpose:</strong> ${escapeHtml(this.nextAppointment.purpose || this.nextAppointment.specialty || 'Checkup')}</p>
              <p class="simple-appt-datetime"><strong>When:</strong> ${escapeHtml(dateStr)}</p>
              <p class="simple-appt-place">📍 <strong>Where:</strong> ${escapeHtml(this.nextAppointment.place || this.nextAppointment.location || 'Clinic')}</p>
            </div>
          </div>
        `;
      }
    }
  }

  async handleTakeNextDose() {
    if (!this.currentPendingDose) return;

    const dose = this.currentPendingDose;
    try {
      const res = await api.put(`/api/doses/${dose.id}/status`, {
        circleId: circle.activeCircle.id,
        status: 'Taken',
        notes: 'Confirmed via Elder Simple Mode'
      });

      if (res.success) {
        // High visibility ARIA-LIVE announcement
        const message = `${dose.medicineName} marked as Taken. Good job!`;
        a11y.announce(message, 'assertive');

        // Optional speech synthesis feedback
        if (a11y.synth) {
          a11y.speak(`Thank you. ${dose.medicineName} has been recorded as taken.`);
        }

        window.dispatchEvent(new CustomEvent('doses:changed'));
        await this.refreshData();
      }
    } catch (err) {
      alert(`Could not record dose: ${err.message}`);
    }
  }

  speakSimpleOverview() {
    const elderName = circle.activeCircle?.elderName || 'Elder';
    let text = `Hello ${elderName}. `;

    if (this.currentPendingDose) {
      text += `Your next medicine is ${this.currentPendingDose.medicineName}, ${this.currentPendingDose.strength || ''}, scheduled for ${this.currentPendingDose.scheduledTime}. `;
      if (this.currentPendingDose.instructions) {
        text += `Packaging instruction: ${this.currentPendingDose.instructions}. `;
      }
      text += `Press the large green button to record it as taken. `;
    } else {
      text += `You have taken all scheduled medicines for today. Wonderful job! `;
    }

    if (this.nextAppointment) {
      text += `Your next doctor visit is with Dr. ${this.nextAppointment.doctorName} for ${this.nextAppointment.purpose || 'consultation'}. `;
    }

    a11y.speak(text);
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

export const simpleMode = new ElderSimpleModeManager();
