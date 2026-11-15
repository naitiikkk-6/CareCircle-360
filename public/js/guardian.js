import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class HealthGuardianManager {
  constructor() {
    this.readings = [];
  }

  init() {
    this.bindEvents();
    window.addEventListener('circle:changed', () => this.loadVitals());
  }

  bindEvents() {
    const btnSimulate = document.getElementById('btn-add-simulated-reading');
    if (btnSimulate) {
      btnSimulate.addEventListener('click', async () => {
        await this.addSimulatedReading();
      });
    }
  }

  async loadVitals() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/guardian/vitals', { circleId: circle.activeCircle.id });
      this.readings = res.readings || [];
      this.renderVitalsSummary();
      this.renderTrendChart();
    } catch (err) {
      console.error('Failed to load vitals:', err);
    }
  }

  renderVitalsSummary() {
    if (this.readings.length === 0) return;
    const latest = this.readings[this.readings.length - 1];

    const bpEl = document.getElementById('guardian-bp-val');
    const hrEl = document.getElementById('guardian-hr-val');
    const bgEl = document.getElementById('guardian-bg-val');
    const spo2El = document.getElementById('guardian-spo2-val');

    if (bpEl) bpEl.textContent = `${latest.bloodPressureSystolic}/${latest.bloodPressureDiastolic} mmHg`;
    if (hrEl) hrEl.textContent = `${latest.heartRate} bpm`;
    if (bgEl) bgEl.textContent = `${latest.bloodGlucose} mg/dL`;
    if (spo2El) spo2El.textContent = `${latest.spO2}%`;
  }

  renderTrendChart() {
    const chartContainer = document.getElementById('guardian-chart-container');
    if (!chartContainer) return;

    if (this.readings.length < 2) {
      chartContainer.innerHTML = '<p class="empty-state">Not enough reading points to draw chart.</p>';
      return;
    }

    const width = 600;
    const height = 240;
    const padding = 45;

    // We plot Systolic BP (typically 90 - 160)
    const minVal = 80;
    const maxVal = 160;

    const points = this.readings.map((r, i) => {
      const x = padding + (i / (this.readings.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((r.bloodPressureSystolic - minVal) / (maxVal - minVal)) * (height - 2 * padding);
      return { x, y, val: r.bloodPressureSystolic, date: r.date };
    });

    const pathD = points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
    }, '');

    // Area fill path
    const areaD = `${pathD} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;

    const svgHtml = `
      <svg viewBox="0 0 ${width} ${height}" class="guardian-chart-svg" role="img" aria-label="Simulated Blood Pressure 7-Day Trend Chart">
        <!-- Grid lines -->
        <line x1="${padding}" y1="${padding}" x2="${width - padding}" y2="${padding}" stroke="#e0e0e0" stroke-dasharray="3,3" />
        <line x1="${padding}" y1="${height / 2}" x2="${width - padding}" y2="${height / 2}" stroke="#e0e0e0" stroke-dasharray="3,3" />
        <line x1="${padding}" y1="${height - padding}" x2="${width - padding}" y2="${height - padding}" stroke="#cccccc" stroke-width="1.5" />

        <!-- Y Axis Labels -->
        <text x="${padding - 8}" y="${padding + 4}" font-size="11" text-anchor="end" fill="#666">160</text>
        <text x="${padding - 8}" y="${height / 2 + 4}" font-size="11" text-anchor="end" fill="#666">120</text>
        <text x="${padding - 8}" y="${height - padding + 4}" font-size="11" text-anchor="end" fill="#666">80</text>

        <!-- Area fill -->
        <path d="${areaD}" fill="rgba(11, 87, 208, 0.12)" />

        <!-- Trend Line -->
        <path d="${pathD}" fill="none" stroke="#0b57d0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />

        <!-- Data circles -->
        ${points.map(p => `
          <circle cx="${p.x}" cy="${p.y}" r="5" fill="#0b57d0" stroke="#ffffff" stroke-width="2">
            <title>${p.date}: ${p.val} mmHg (Simulated)</title>
          </circle>
          <text x="${p.x}" y="${p.y - 10}" font-size="10" font-weight="bold" text-anchor="middle" fill="#0b57d0">${p.val}</text>
          <text x="${p.x}" y="${height - padding + 18}" font-size="10" text-anchor="middle" fill="#777">${p.date.slice(5)}</text>
        `).join('')}
      </svg>
    `;

    chartContainer.innerHTML = svgHtml;
  }

  async addSimulatedReading() {
    if (!circle.activeCircle) return;
    try {
      // Create a random realistic synthetic variation
      const systolic = 115 + Math.floor(Math.random() * 14);
      const diastolic = 75 + Math.floor(Math.random() * 10);
      const heartRate = 70 + Math.floor(Math.random() * 12);
      const bloodGlucose = 100 + Math.floor(Math.random() * 20);

      const res = await api.post('/api/guardian/simulate-reading', {
        circleId: circle.activeCircle.id,
        systolic,
        diastolic,
        heartRate,
        bloodGlucose,
        spO2: 98
      });

      if (res.success) {
        a11y.announce('New simulated vital reading added.');
        await this.loadVitals();
      }
    } catch (err) {
      alert(`Simulation failed: ${err.message}`);
    }
  }
}

export const guardian = new HealthGuardianManager();
