import { api } from './api.js';
import { a11y } from './accessibility.js';
import { circle } from './circle.js';

class AppointmentManager {
  constructor() {
    this.appointments = [];
  }

  init() {
    this.bindEvents();
    window.addEventListener('circle:changed', () => this.loadAppointments());
  }

  bindEvents() {
    const btnOpenAddAppt = document.getElementById('btn-open-add-appt');
    if (btnOpenAddAppt) {
      btnOpenAddAppt.addEventListener('click', () => {
        const modal = document.getElementById('modal-add-appointment');
        if (modal) modal.classList.remove('hidden');
      });
    }

    const formAdd = document.getElementById('form-add-appointment');
    if (formAdd) {
      formAdd.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleAddAppointment();
      });
    }

    const formEdit = document.getElementById('form-edit-appointment');
    if (formEdit) {
      formEdit.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleEditAppointment();
      });
    }
  }

  canUserManageAppts() {
    if (circle.isElder) return true;
    const perms = circle.activeCircle?.permissions || {};
    if (circle.userRole === 'caretaker' && perms.caretakerCanManageAppointments !== false) return true;
    if (circle.userRole === 'family' && perms.familyCanManageAppointments === true) return true;
    return false;
  }

  async loadAppointments() {
    if (!circle.activeCircle) return;

    try {
      const res = await api.get('/api/appointments', { circleId: circle.activeCircle.id });
      this.appointments = res.appointments || [];
      this.renderAppointments();
      window.dispatchEvent(new CustomEvent('appointments:changed', { detail: { appointments: this.appointments } }));
    } catch (err) {
      console.error('Failed to load appointments:', err);
    }
  }

  renderAppointments() {
    const container = document.getElementById('appointments-list');
    if (!container) return;

    container.innerHTML = '';
    if (this.appointments.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>No doctor appointments scheduled yet.</p>
          <p>Click "Schedule Appointment" to record an upcoming doctor visit, consultation, or clinic checkup.</p>
        </div>
      `;
      return;
    }

    const canManage = this.canUserManageAppts();

    this.appointments.forEach(appt => {
      const card = document.createElement('article');
      card.className = `appt-card status-${appt.status.toLowerCase()}`;
      card.setAttribute('data-appt-id', appt.id);

      const dateObj = new Date(appt.datetime);
      const formattedDate = isNaN(dateObj.getTime())
        ? appt.datetime
        : dateObj.toLocaleDateString('en-IN', {
            weekday: 'short',
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          });

      const statusBadgeText = `[STATUS: ${appt.status.toUpperCase()}]`;

      card.innerHTML = `
        <div class="appt-date-badge" aria-hidden="true">
          📅
        </div>
        <div class="appt-main-content">
          <div class="appt-title-row">
            <h3 class="appt-doctor-name">Dr. ${escapeHtml(appt.doctorName)}</h3>
            <span class="appt-purpose-badge">${escapeHtml(appt.purpose || appt.specialty || 'General Consultation')}</span>
          </div>

          <p class="appt-time-text"><strong>Date & Time:</strong> ${escapeHtml(formattedDate)}</p>
          <p class="appt-location-text">📍 <strong>Place:</strong> ${escapeHtml(appt.place || appt.location || 'Clinic / Hospital')}</p>
          ${appt.notes ? `<p class="appt-notes-text">📝 <strong>Notes:</strong> ${escapeHtml(appt.notes)}</p>` : ''}

          <div class="appt-status-row">
            <span class="badge badge-appt-status badge-${appt.status.toLowerCase()}" aria-label="Appointment status">${statusBadgeText}</span>
            ${appt.reminderSent ? '<span class="badge badge-reminder-sent">🔔 Reminder Sent</span>' : ''}
          </div>
        </div>

        ${canManage ? `
          <div class="appt-actions" role="group" aria-label="Appointment actions">
            <button class="btn btn-outline btn-sm btn-edit-appt" data-appt-id="${appt.id}" aria-label="Edit appointment with Dr. ${escapeHtml(appt.doctorName)}">
              ✏️ Edit
            </button>
            ${appt.status === 'Upcoming' ? `
              <button class="btn btn-outline-success btn-sm btn-complete-appt" data-appt-id="${appt.id}" aria-label="Mark appointment completed">
                ✓ Done
              </button>
              <button class="btn btn-outline-warning btn-sm btn-cancel-appt" data-appt-id="${appt.id}" aria-label="Cancel appointment">
                ✕ Cancel
              </button>
            ` : ''}
            <button class="btn btn-outline-danger btn-sm btn-delete-appt" data-appt-id="${appt.id}" aria-label="Delete appointment record">
              🗑️
            </button>
          </div>
        ` : ''}
      `;

      container.appendChild(card);
    });

    // Attach actions
    container.querySelectorAll('.btn-edit-appt').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-appt-id');
        this.openEditModal(id);
      });
    });

    container.querySelectorAll('.btn-complete-appt').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-appt-id');
        await this.updateStatus(id, 'Completed');
      });
    });

    container.querySelectorAll('.btn-cancel-appt').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-appt-id');
        if (confirm('Are you sure you want to cancel this appointment?')) {
          await this.cancelAppointment(id);
        }
      });
    });

    container.querySelectorAll('.btn-delete-appt').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-appt-id');
        if (confirm('Permanently delete this appointment record?')) {
          await this.deleteAppointment(id);
        }
      });
    });
  }

  async handleAddAppointment() {
    const doctorName = document.getElementById('appt-doctor-name')?.value?.trim();
    const purpose = document.getElementById('appt-purpose')?.value?.trim();
    const datetime = document.getElementById('appt-datetime')?.value;
    const place = document.getElementById('appt-place')?.value?.trim();
    const notes = document.getElementById('appt-notes')?.value?.trim() || '';

    if (!doctorName || !purpose || !datetime || !place) {
      alert('Please fill in Doctor Name, Purpose, Date & Time, and Place.');
      return;
    }

    try {
      const res = await api.post('/api/appointments', {
        circleId: circle.activeCircle.id,
        doctorName,
        purpose,
        specialty: purpose,
        datetime,
        place,
        location: place,
        notes
      });

      if (res.success) {
        document.getElementById('modal-add-appointment')?.classList.add('hidden');
        document.getElementById('form-add-appointment')?.reset();
        a11y.announce(`Appointment with Dr. ${doctorName} scheduled.`);
        await this.loadAppointments();
      }
    } catch (err) {
      alert(`Could not schedule appointment: ${err.message}`);
    }
  }

  openEditModal(apptId) {
    const appt = this.appointments.find(a => a.id === apptId);
    if (!appt) return;

    const modal = document.getElementById('modal-edit-appointment');
    if (!modal) return;

    document.getElementById('edit-appt-id').value = appt.id;
    document.getElementById('edit-appt-doctor-name').value = appt.doctorName || '';
    document.getElementById('edit-appt-purpose').value = appt.purpose || appt.specialty || '';

    if (appt.datetime) {
      // Format as YYYY-MM-DDTHH:MM for datetime-local input
      const d = new Date(appt.datetime);
      if (!isNaN(d.getTime())) {
        const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        document.getElementById('edit-appt-datetime').value = iso;
      }
    }

    document.getElementById('edit-appt-place').value = appt.place || appt.location || '';
    document.getElementById('edit-appt-status').value = appt.status || 'Upcoming';
    document.getElementById('edit-appt-notes').value = appt.notes || '';

    modal.classList.remove('hidden');
  }

  async handleEditAppointment() {
    const id = document.getElementById('edit-appt-id')?.value;
    const doctorName = document.getElementById('edit-appt-doctor-name')?.value?.trim();
    const purpose = document.getElementById('edit-appt-purpose')?.value?.trim();
    const datetime = document.getElementById('edit-appt-datetime')?.value;
    const place = document.getElementById('edit-appt-place')?.value?.trim();
    const status = document.getElementById('edit-appt-status')?.value;
    const notes = document.getElementById('edit-appt-notes')?.value?.trim() || '';

    if (!id || !doctorName || !purpose || !datetime || !place) {
      alert('Please fill in all required fields.');
      return;
    }

    try {
      const res = await api.put(`/api/appointments/${id}`, {
        circleId: circle.activeCircle.id,
        doctorName,
        purpose,
        specialty: purpose,
        datetime,
        place,
        location: place,
        status,
        notes
      });

      if (res.success) {
        document.getElementById('modal-edit-appointment')?.classList.add('hidden');
        a11y.announce(`Appointment with Dr. ${doctorName} updated.`);
        await this.loadAppointments();
      }
    } catch (err) {
      alert(`Could not update appointment: ${err.message}`);
    }
  }

  async cancelAppointment(apptId) {
    try {
      const res = await api.post(`/api/appointments/${apptId}/cancel`, {
        circleId: circle.activeCircle.id,
        cancelReason: 'Cancelled from appointment list'
      });
      if (res.success) {
        a11y.announce('Appointment marked as cancelled.');
        await this.loadAppointments();
      }
    } catch (err) {
      alert(`Could not cancel appointment: ${err.message}`);
    }
  }

  async updateStatus(apptId, status) {
    try {
      const res = await api.put(`/api/appointments/${apptId}`, {
        circleId: circle.activeCircle.id,
        status
      });
      if (res.success) {
        a11y.announce(`Appointment marked as ${status}`);
        await this.loadAppointments();
      }
    } catch (err) {
      alert(`Error updating appointment: ${err.message}`);
    }
  }

  async deleteAppointment(apptId) {
    try {
      const res = await api.delete(`/api/appointments/${apptId}?circleId=${circle.activeCircle.id}`);
      if (res.success) {
        a11y.announce('Appointment removed.');
        await this.loadAppointments();
      }
    } catch (err) {
      alert(`Error removing appointment: ${err.message}`);
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

export const appointments = new AppointmentManager();
