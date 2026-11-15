/**
 * Accessibility Manager for CareCircle 360
 * Adheres strictly to WCAG AA / AAA standards:
 * - Dynamic font sizing (Normal: 16px, Large: 20px, Extra-Large: 24px)
 * - High contrast mode (WCAG AAA compliant dark/high-contrast palette)
 * - Reduced motion support (disables transitions, respects system settings)
 * - Native Web Speech Synthesis API voice reader for key screen information
 * - Screen-reader aria-live announcements for status transitions (e.g. marking dose Taken)
 * - User preferences persistence (localStorage + backend sync)
 */

import { api } from './api.js';

class AccessibilityManager {
  constructor() {
    this.fontSize = localStorage.getItem('cc_font_size') || 'normal';
    this.highContrast = localStorage.getItem('cc_high_contrast') === 'true';
    this.reduceMotion = localStorage.getItem('cc_reduce_motion') === 'true';
    this.voiceEnabled = localStorage.getItem('cc_voice_enabled') === 'true';
    this.elderSimpleMode = localStorage.getItem('cc_elder_simple_mode') === 'true';
    this.synth = window.speechSynthesis || null;
    this.liveRegion = null;
  }

  async init() {
    this.liveRegion = document.getElementById('aria-announcements');
    this.applySettings();
    this.bindEvents();

    // Sync from server if logged in
    window.addEventListener('auth:changed', async (e) => {
      if (e.detail?.user) {
        await this.syncFromServer();
      }
    });

    if (api.token) {
      await this.syncFromServer();
    }
  }

  async syncFromServer() {
    try {
      const res = await api.get('/api/auth/preferences');
      if (res.success && res.preferences) {
        const p = res.preferences;
        if (p.fontSize) this.fontSize = p.fontSize;
        if (p.highContrast !== undefined) this.highContrast = p.highContrast;
        if (p.reduceMotion !== undefined) this.reduceMotion = p.reduceMotion;
        if (p.voiceEnabled !== undefined) this.voiceEnabled = p.voiceEnabled;
        if (p.elderSimpleMode !== undefined) this.elderSimpleMode = p.elderSimpleMode;

        this.persistLocal();
        this.applySettings();
      }
    } catch (err) {
      // Offline fallback: keep local preferences
      console.info('Using local accessibility preferences cache');
    }
  }

  persistLocal() {
    localStorage.setItem('cc_font_size', this.fontSize);
    localStorage.setItem('cc_high_contrast', String(this.highContrast));
    localStorage.setItem('cc_reduce_motion', String(this.reduceMotion));
    localStorage.setItem('cc_voice_enabled', String(this.voiceEnabled));
    localStorage.setItem('cc_elder_simple_mode', String(this.elderSimpleMode));
  }

  async saveToServer() {
    this.persistLocal();
    if (api.token) {
      try {
        await api.put('/api/auth/preferences', {
          preferences: {
            fontSize: this.fontSize,
            highContrast: this.highContrast,
            reduceMotion: this.reduceMotion,
            voiceEnabled: this.voiceEnabled,
            elderSimpleMode: this.elderSimpleMode
          }
        });
      } catch (err) {
        console.warn('Could not sync preferences to backend:', err.message);
      }
    }
  }

  applySettings() {
    const root = document.documentElement;

    // 1. Text sizing (at least 3 levels)
    root.classList.remove('font-size-normal', 'font-size-large', 'font-size-xlarge');
    root.classList.add(`font-size-${this.fontSize}`);

    // 2. High contrast theme (WCAG AAA)
    if (this.highContrast) {
      root.classList.add('theme-high-contrast');
    } else {
      root.classList.remove('theme-high-contrast');
    }

    // 3. Reduce motion
    if (this.reduceMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }

    // 4. Elder Simple mode class
    if (this.elderSimpleMode) {
      root.classList.add('mode-elder-simple');
    } else {
      root.classList.remove('mode-elder-simple');
    }

    // Sync Quick Toolbar controls
    const contrastBtn = document.getElementById('toggle-contrast-btn');
    if (contrastBtn) {
      contrastBtn.setAttribute('aria-pressed', String(this.highContrast));
      contrastBtn.classList.toggle('active', this.highContrast);
    }

    const simpleBtn = document.getElementById('toggle-simple-mode-btn');
    if (simpleBtn) {
      simpleBtn.setAttribute('aria-pressed', String(this.elderSimpleMode));
      simpleBtn.classList.toggle('active', this.elderSimpleMode);
    }

    const fontSelect = document.getElementById('font-size-select');
    if (fontSelect) {
      fontSelect.value = this.fontSize;
    }

    // Sync Modal Form fields if modal exists
    const modalFontSize = document.getElementById('pref-font-size');
    if (modalFontSize) modalFontSize.value = this.fontSize;

    const modalContrast = document.getElementById('pref-high-contrast');
    if (modalContrast) modalContrast.checked = this.highContrast;

    const modalMotion = document.getElementById('pref-reduce-motion');
    if (modalMotion) modalMotion.checked = this.reduceMotion;

    const modalVoice = document.getElementById('pref-voice-enabled');
    if (modalVoice) modalVoice.checked = this.voiceEnabled;

    const modalSimple = document.getElementById('pref-elder-simple');
    if (modalSimple) modalSimple.checked = this.elderSimpleMode;
  }

  bindEvents() {
    // Quick Font size selector in header
    const fontSelect = document.getElementById('font-size-select');
    if (fontSelect) {
      fontSelect.addEventListener('change', async (e) => {
        await this.setFontSize(e.target.value);
      });
    }

    // Quick High contrast toggle in header
    const contrastBtn = document.getElementById('toggle-contrast-btn');
    if (contrastBtn) {
      contrastBtn.addEventListener('click', async () => {
        await this.toggleHighContrast();
      });
    }

    // Quick Voice Read-Aloud button
    const speechBtn = document.getElementById('btn-voice-readout');
    if (speechBtn) {
      speechBtn.addEventListener('click', () => {
        this.readDailyOverview();
      });
    }

    // Open Accessibility Settings Modal
    const btnOpenSettings = document.getElementById('btn-open-a11y-settings');
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener('click', () => {
        const modal = document.getElementById('modal-accessibility-settings');
        if (modal) modal.classList.remove('hidden');
      });
    }

    // Accessibility Settings Form Submit
    const formSettings = document.getElementById('form-accessibility-settings');
    if (formSettings) {
      formSettings.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fontSize = document.getElementById('pref-font-size')?.value || 'normal';
        const highContrast = document.getElementById('pref-high-contrast')?.checked || false;
        const reduceMotion = document.getElementById('pref-reduce-motion')?.checked || false;
        const voiceEnabled = document.getElementById('pref-voice-enabled')?.checked || false;
        const elderSimpleMode = document.getElementById('pref-elder-simple')?.checked || false;

        this.fontSize = fontSize;
        this.highContrast = highContrast;
        this.reduceMotion = reduceMotion;
        this.voiceEnabled = voiceEnabled;
        this.elderSimpleMode = elderSimpleMode;

        this.applySettings();
        await this.saveToServer();

        // Also notify simpleMode manager if it changed
        window.dispatchEvent(new CustomEvent('simplemode:toggled', { detail: { active: this.elderSimpleMode } }));

        document.getElementById('modal-accessibility-settings')?.classList.add('hidden');
        this.announce('Accessibility settings saved and synchronized.');
      });
    }

    // Test Voice Speech Button inside Modal
    const btnTestVoice = document.getElementById('btn-test-voice-speech');
    if (btnTestVoice) {
      btnTestVoice.addEventListener('click', () => {
        this.speak('Hello! This is CareCircle 360 voice assistant. Ready to help you stay on track with your medicines.');
      });
    }
  }

  async setFontSize(size) {
    this.fontSize = size;
    this.applySettings();
    await this.saveToServer();
    this.announce(`Text size set to ${size}`);
  }

  async toggleHighContrast() {
    this.highContrast = !this.highContrast;
    this.applySettings();
    await this.saveToServer();
    this.announce(this.highContrast ? 'High contrast theme enabled' : 'Standard theme restored');
  }

  async toggleReduceMotion() {
    this.reduceMotion = !this.reduceMotion;
    this.applySettings();
    await this.saveToServer();
    this.announce(this.reduceMotion ? 'Reduced motion enabled' : 'Standard motion restored');
  }

  announce(message, priority = 'polite') {
    if (!this.liveRegion) {
      this.liveRegion = document.getElementById('aria-announcements');
    }
    if (this.liveRegion) {
      this.liveRegion.setAttribute('aria-live', priority);
      this.liveRegion.textContent = '';
      setTimeout(() => {
        this.liveRegion.textContent = message;
      }, 50);
    }
  }

  speak(text) {
    if (!this.synth) {
      alert('Text-to-speech speech synthesis is not supported on this browser.');
      return;
    }
    this.synth.cancel(); // Stop any pending speech

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.88; // Slower, clearer cadence for elderly listeners
    utterance.pitch = 1.0;
    this.synth.speak(utterance);
    this.announce('Voice reading key information out loud.');
  }

  /**
   * Reads the screen's key information out loud:
   * Next medicine, intake time, today's completion status, and next doctor appointment.
   */
  readDailyOverview() {
    const elderName = document.getElementById('active-elder-name')?.textContent || 'Elder';
    const completionText = document.getElementById('pulse-completion-text')?.textContent || '';
    const nextDoseText = document.getElementById('pulse-next-dose-text')?.textContent || '';
    const nextApptEl = document.querySelector('.quick-appt-item');

    let text = `Hello ${elderName}. CareCircle overview for today: `;

    if (nextDoseText && !nextDoseText.includes('Calculating')) {
      text += `Your next scheduled dose: ${nextDoseText}. `;
    }

    if (completionText) {
      text += `Progress: ${completionText}. `;
    }

    if (nextApptEl) {
      text += `Upcoming visit: ${nextApptEl.textContent.trim().replace(/\s+/g, ' ')}. `;
    }

    text += `Stay healthy and hydrated!`;
    this.speak(text);
  }
}

export const a11y = new AccessibilityManager();
