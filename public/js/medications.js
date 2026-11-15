import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class MedicationManager {
  constructor() {
    this.medications = [];
    this.editingMedId = null;
  }

  init() {
    this.bindEvents();
    window.addEventListener('circle:changed', () => {
      this.loadMedications();
    });
  }

  bindEvents() {
    // Open modal to add medication
    const btnOpenAddMed = document.getElementById('btn-open-add-med');
    if (btnOpenAddMed) {
      btnOpenAddMed.addEventListener('click', () => {
        this.openAddModal();
      });
    }

    // Form submission (Add or Edit)
    const medForm = document.getElementById('form-add-medication');
    if (medForm) {
      medForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSaveMedication();
      });
    }

    // Dynamic Time row adder
    const btnAddTime = document.getElementById('btn-add-schedule-row');
    if (btnAddTime) {
      btnAddTime.addEventListener('click', () => {
        this.addTimeInputRow();
      });
    }

    // Frequency type change toggle (Daily vs Weekdays)
    const freqSelect = document.getElementById('med-input-frequency');
    if (freqSelect) {
      freqSelect.addEventListener('change', (e) => {
        const weekdaysFieldset = document.getElementById('weekdays-selector-fieldset');
        if (weekdaysFieldset) {
          if (e.target.value === 'weekdays') {
            weekdaysFieldset.classList.remove('hidden');
          } else {
            weekdaysFieldset.classList.add('hidden');
          }
        }
      });
    }
  }

  canUserManageMeds() {
    if (circle.isElder) return true;
    const perms = circle.activeCircle?.permissions || {};
    if (circle.userRole === 'caretaker' && perms.caretakerCanManageMeds !== false) return true;
    if (circle.userRole === 'family' && perms.familyCanManageMeds === true) return true;
    return false;
  }

  async loadMedications() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/medications', { circleId: circle.activeCircle.id });
      this.medications = res.medications || [];
      this.renderMedicationList();
    } catch (err) {
      console.error('Failed to load medications:', err);
    }
  }

  renderMedicationList() {
    const container = document.getElementById('medication-cards-grid');
    const addBtn = document.getElementById('btn-open-add-med');
    const canManage = this.canUserManageMeds();

    // Toggle main Add button visibility according to permissions
    if (addBtn) {
      if (canManage) {
        addBtn.classList.remove('hidden');
      } else {
        addBtn.classList.add('hidden');
      }
    }

    if (!container) return;
    container.innerHTML = '';

    if (this.medications.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No medications recorded yet for this Care Circle.</p>
          ${canManage ? '<p>Click "+ Add Medication" to schedule a prescription or daily supplement.</p>' : '<p>Only the Elder or an authorized Caretaker can add medications.</p>'}
        </div>
      `;
      return;
    }

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    this.medications.forEach(med => {
      const card = document.createElement('article');
      card.className = `med-card ${med.active ? '' : 'med-inactive'}`;
      card.setAttribute('aria-labelledby', `med-title-${med.id}`);

      // Times and Frequency Badges
      const timesList = (med.times && med.times.length > 0)
        ? med.times
        : (med.schedules ? med.schedules.map(s => typeof s === 'string' ? s : s.time) : []);

      const timeBadges = timesList.map(t =>
        `<span class="badge badge-time">⏰ ${t}</span>`
      ).join(' ');

      let frequencyText = 'Daily';
      if (med.frequencyType === 'weekdays' && Array.isArray(med.daysOfWeek)) {
        frequencyText = med.daysOfWeek.map(d => dayNames[d]).join(', ');
      }

      const sourceBadgeClass = med.sourceLabel === 'From the packaging' ? 'badge-verified' : 'badge-unverified';

      card.innerHTML = `
        <div class="med-header">
          <div>
            <span class="med-form-pill">${escapeHtml(med.form || 'Tablet')}</span>
            <h3 id="med-title-${med.id}" class="med-name">${escapeHtml(med.name)}</h3>
            <span class="med-strength">${escapeHtml(med.strength || med.dosage || 'Standard')}</span>
          </div>
          <span class="source-badge ${sourceBadgeClass}">
            ${escapeHtml(med.sourceLabel || 'Not verified - ask your pharmacist or doctor')}
          </span>
        </div>

        <div class="med-body">
          <div class="med-schedule-summary">
            <strong>Schedule:</strong>
            <span class="med-freq-pill">${escapeHtml(frequencyText)}</span>
            <div class="schedule-badges-list">${timeBadges}</div>
          </div>

          <div class="med-dates-row">
            <small>📅 Active: <strong>${med.startDate || 'Ongoing'}</strong> ${med.endDate ? `to <strong>${med.endDate}</strong>` : '(No end date)'}</small>
          </div>

          ${med.instructions ? `
            <div class="med-user-instructions" role="region" aria-label="Instructions entered by user">
              <span class="instruction-label">✍️ Instructions (Typed by User):</span>
              <p class="instruction-text">${escapeHtml(med.instructions)}</p>
            </div>
          ` : ''}

          ${med.notes ? `
            <div class="med-user-notes">
              <small>Notes: ${escapeHtml(med.notes)}</small>
            </div>
          ` : ''}
        </div>

        <div class="med-footer">
          <small class="med-added-by">Added by: ${escapeHtml(med.addedBy?.name || 'Elder')}</small>
          ${canManage ? `
            <div class="med-card-actions">
              <button class="btn btn-outline btn-sm btn-edit-med" data-med-id="${med.id}" aria-label="Edit ${escapeHtml(med.name)}">
                ✏️ Edit
              </button>
              <button class="btn btn-outline-danger btn-sm btn-delete-med" data-med-id="${med.id}" aria-label="Delete ${escapeHtml(med.name)}">
                🗑️ Delete
              </button>
            </div>
          ` : `
            <span class="permission-notice">View-only role</span>
          `}
        </div>
      `;

      container.appendChild(card);
    });

    // Attach Edit and Delete Event Handlers
    container.querySelectorAll('.btn-edit-med').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const medId = e.currentTarget.getAttribute('data-med-id');
        this.openEditModal(medId);
      });
    });

    container.querySelectorAll('.btn-delete-med').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const medId = e.currentTarget.getAttribute('data-med-id');
        if (confirm('Are you sure you want to remove this medication from the schedule?')) {
          await this.deleteMedication(medId);
        }
      });
    });
  }

  openAddModal() {
    this.editingMedId = null;
    const modal = document.getElementById('modal-add-medication');
    const modalTitle = document.getElementById('title-add-med');
    const form = document.getElementById('form-add-medication');

    if (modalTitle) modalTitle.textContent = 'Add Medication & Schedule';
    if (form) {
      form.reset();
      document.getElementById('med-input-start-date').value = new Date().toISOString().split('T')[0];
      this.resetTimeInputs(['08:00']);
      document.getElementById('weekdays-selector-fieldset')?.classList.add('hidden');
    }

    if (modal) {
      modal.classList.remove('hidden');
      document.getElementById('med-input-name')?.focus();
    }
  }

  openEditModal(medId) {
    const med = this.medications.find(m => m.id === medId);
    if (!med) return;

    this.editingMedId = medId;
    const modal = document.getElementById('modal-add-medication');
    const modalTitle = document.getElementById('title-add-med');

    if (modalTitle) modalTitle.textContent = `Edit Medication: ${med.name}`;

    document.getElementById('med-input-name').value = med.name || '';
    document.getElementById('med-input-strength').value = med.strength || med.dosage || '';
    document.getElementById('med-input-form').value = med.form || 'Tablet';
    document.getElementById('med-input-instructions').value = med.instructions || med.packagingInstructions || '';
    document.getElementById('med-input-start-date').value = med.startDate || '';
    document.getElementById('med-input-end-date').value = med.endDate || '';
    document.getElementById('med-input-source').value = med.sourceLabel || 'Not verified - ask your pharmacist or doctor';
    document.getElementById('med-input-notes').value = med.notes || '';

    // Frequency
    const freqSelect = document.getElementById('med-input-frequency');
    const weekdaysFieldset = document.getElementById('weekdays-selector-fieldset');
    if (freqSelect) {
      freqSelect.value = med.frequencyType || 'daily';
      if (med.frequencyType === 'weekdays') {
        weekdaysFieldset?.classList.remove('hidden');
        // Check days
        const days = Array.isArray(med.daysOfWeek) ? med.daysOfWeek : [];
        [0, 1, 2, 3, 4, 5, 6].forEach(d => {
          const cb = document.getElementById(`weekday-cb-${d}`);
          if (cb) cb.checked = days.includes(d);
        });
      } else {
        weekdaysFieldset?.classList.add('hidden');
      }
    }

    // Times
    const times = med.times || (med.schedules ? med.schedules.map(s => typeof s === 'string' ? s : s.time) : ['08:00']);
    this.resetTimeInputs(times);

    if (modal) {
      modal.classList.remove('hidden');
      document.getElementById('med-input-name')?.focus();
    }
  }

  resetTimeInputs(timesArray) {
    const list = document.getElementById('schedule-inputs-list');
    if (!list) return;
    list.innerHTML = '';
    timesArray.forEach(t => this.addTimeInputRow(t));
  }

  addTimeInputRow(defaultTime = '08:00') {
    const list = document.getElementById('schedule-inputs-list');
    if (!list) return;

    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.innerHTML = `
      <input type="time" class="input-field input-time" value="${defaultTime}" required aria-label="Scheduled dose time">
      <button type="button" class="btn btn-icon btn-remove-time" aria-label="Remove this time">✕</button>
    `;
    list.appendChild(row);

    row.querySelector('.btn-remove-time').addEventListener('click', () => {
      if (list.querySelectorAll('.schedule-row').length > 1) {
        row.remove();
      } else {
        alert('At least one intake time is required.');
      }
    });
  }

  async handleSaveMedication() {
    const name = document.getElementById('med-input-name').value.trim();
    const strength = document.getElementById('med-input-strength').value.trim();
    const form = document.getElementById('med-input-form').value;
    const instructions = document.getElementById('med-input-instructions').value.trim();
    const startDate = document.getElementById('med-input-start-date').value;
    const endDate = document.getElementById('med-input-end-date').value || null;
    const frequencyType = document.getElementById('med-input-frequency').value;
    const sourceLabel = document.getElementById('med-input-source').value;
    const notes = document.getElementById('med-input-notes').value.trim();

    // Collect Weekdays if frequencyType === 'weekdays'
    const daysOfWeek = [];
    if (frequencyType === 'weekdays') {
      [0, 1, 2, 3, 4, 5, 6].forEach(d => {
        const cb = document.getElementById(`weekday-cb-${d}`);
        if (cb && cb.checked) daysOfWeek.push(d);
      });
      if (daysOfWeek.length === 0) {
        alert('Please select at least one day of the week for weekday schedules.');
        return;
      }
    }

    // Collect Times
    const timeInputs = document.querySelectorAll('#schedule-inputs-list .input-time');
    const times = Array.from(timeInputs).map(inp => inp.value.trim()).filter(Boolean);

    if (times.length === 0) {
      alert('Please enter at least one scheduled intake time.');
      return;
    }

    const payload = {
      circleId: circle.activeCircle.id,
      name,
      strength,
      form,
      instructions,
      startDate,
      endDate,
      frequencyType,
      daysOfWeek,
      times,
      sourceLabel,
      notes
    };

    try {
      let res;
      if (this.editingMedId) {
        res = await api.put(`/api/medications/${this.editingMedId}`, payload);
      } else {
        res = await api.post('/api/medications', payload);
      }

      if (res.success) {
        document.getElementById('modal-add-medication').classList.add('hidden');
        document.getElementById('form-add-medication').reset();
        a11y.announce(`Medication ${name} saved successfully.`);
        await this.loadMedications();
        window.dispatchEvent(new CustomEvent('medications:changed'));
      }
    } catch (err) {
      alert(`Could not save medication: ${err.message}`);
    }
  }

  async deleteMedication(medId) {
    try {
      const res = await api.delete(`/api/medications/${medId}?circleId=${circle.activeCircle.id}`);
      if (res.success) {
        a11y.announce('Medication removed from circle schedule.');
        await this.loadMedications();
        window.dispatchEvent(new CustomEvent('medications:changed'));
      }
    } catch (err) {
      alert(`Could not delete medication: ${err.message}`);
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

export const medications = new MedicationManager();
