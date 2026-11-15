import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';
import { medications } from './medications.js';

class MediGuideManager {
  constructor() {
    this.currentScanResult = null;
  }

  init() {
    this.bindEvents();
  }

  bindEvents() {
    // Open scanner modal
    const btnOpenScan = document.getElementById('btn-open-mediguide-scan');
    if (btnOpenScan) {
      btnOpenScan.addEventListener('click', () => {
        const modal = document.getElementById('modal-mediguide-scan');
        if (modal) modal.classList.remove('hidden');
      });
    }

    // Submit scan form
    const formScan = document.getElementById('form-mediguide-scan');
    if (formScan) {
      formScan.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleScan();
      });
    }

    // Confirm scan result and save
    const btnConfirmAdd = document.getElementById('btn-confirm-scan-add');
    if (btnConfirmAdd) {
      btnConfirmAdd.addEventListener('click', async () => {
        await this.confirmAndSaveMedication();
      });
    }
  }

  async handleScan() {
    const textInput = document.getElementById('scan-packaging-text').value;
    const fileInput = document.getElementById('scan-image-file');
    const statusEl = document.getElementById('scan-processing-status');

    let imageBase64 = null;
    let mimeType = 'image/jpeg';

    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      mimeType = file.type;
      imageBase64 = await fileToBase64(file);
    }

    if (!textInput.trim() && !imageBase64) {
      alert('Please provide medicine packaging text or upload a photo of the package.');
      return;
    }

    if (statusEl) {
      statusEl.classList.remove('hidden');
      statusEl.textContent = '🔍 Scanning packaging text with MediGuide AI... (Enforcing strict packaging-only safety rules)';
    }

    try {
      const res = await api.post('/api/ai/scan-packaging', {
        packagingText: textInput,
        imageBase64,
        mimeType
      });

      if (statusEl) statusEl.classList.add('hidden');

      if (res.success && res.analysis) {
        this.currentScanResult = res.analysis;
        this.renderScanResults(res.analysis);
        a11y.announce('Packaging scan completed. Please review details before confirming.');
      }
    } catch (err) {
      if (statusEl) statusEl.classList.add('hidden');
      alert(`MediGuide scan error: ${err.message}`);
    }
  }

  renderScanResults(data) {
    const resultsContainer = document.getElementById('scan-results-container');
    if (!resultsContainer) return;

    resultsContainer.classList.remove('hidden');

    const setText = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || 'None';
    };

    const setBadge = (id, label) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = label;
      el.className = `source-badge ${label === 'From the packaging' ? 'badge-verified' : 'badge-unverified'}`;
    };

    setText('scan-res-name', data.medicineName);
    setBadge('scan-res-name-source', data.medicineNameSource);

    setText('scan-res-strength', data.strength);
    setBadge('scan-res-strength-source', data.strengthSource);

    setText('scan-res-instructions', data.packagingInstructions);
    setBadge('scan-res-instructions-source', data.instructionsSource);

    setText('scan-res-food', data.foodOrLiquidNotice);
    setBadge('scan-res-food-source', data.foodNoticeSource);

    setText('scan-res-safety-warning', data.safetyWarning);
  }

  async confirmAndSaveMedication() {
    if (!this.currentScanResult || !circle.activeCircle) return;

    const data = this.currentScanResult;
    const intakeTime = document.getElementById('scan-intake-time').value || '08:00';

    try {
      const res = await api.post('/api/medications', {
        circleId: circle.activeCircle.id,
        name: data.medicineName,
        dosage: data.strength !== 'Not verified - ask your pharmacist or doctor' ? data.strength : 'As directed on package',
        packagingInstructions: data.packagingInstructions,
        sourceLabel: data.medicineNameSource === 'From the packaging' ? 'From the packaging' : 'Not verified - ask your pharmacist or doctor',
        notes: `MediGuide packaging scan confirmed. Active ingredients: ${data.activeIngredients || 'None stated'}. Food guidance: ${data.foodOrLiquidNotice}`,
        schedules: [{ time: intakeTime }]
      });

      if (res.success) {
        alert(`Medication "${data.medicineName}" added to circle schedule!`);
        document.getElementById('modal-mediguide-scan').classList.add('hidden');
        document.getElementById('form-mediguide-scan').reset();
        document.getElementById('scan-results-container').classList.add('hidden');
        this.currentScanResult = null;
        await medications.loadMedications();
        window.dispatchEvent(new CustomEvent('medications:changed'));
      }
    } catch (err) {
      alert(`Failed to save medication: ${err.message}`);
    }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
  });
}

export const mediguide = new MediGuideManager();
