import { api } from './api.js';
import { a11y } from './accessibility.js';

class CircleManager {
  constructor() {
    this.circles = [];
    this.activeCircle = null;
    this.userRole = 'family';
    this.isElder = false;
  }

  init() {
    this.bindEvents();
    window.addEventListener('auth:changed', (e) => {
      if (e.detail.user) {
        this.loadCircles();
      } else {
        this.circles = [];
        this.activeCircle = null;
        this.renderCircleHeader();
      }
    });

    if (api.token) {
      this.loadCircles();
    }
  }

  bindEvents() {
    // Circle selector change
    const circleSelect = document.getElementById('circle-selector');
    if (circleSelect) {
      circleSelect.addEventListener('change', (e) => {
        const selectedId = e.target.value;
        if (selectedId === '__create__') {
          this.openCreateModal();
        } else if (selectedId === '__join__') {
          this.openJoinModal();
        } else if (selectedId) {
          this.setActiveCircle(selectedId);
        }
      });
    }

    // Modal open buttons
    const btnOpenCreate = document.getElementById('btn-open-create-circle');
    if (btnOpenCreate) {
      btnOpenCreate.addEventListener('click', () => this.openCreateModal());
    }

    const btnOpenJoin = document.getElementById('btn-open-join-circle');
    if (btnOpenJoin) {
      btnOpenJoin.addEventListener('click', () => this.openJoinModal());
    }

    // Create Circle Form
    const createForm = document.getElementById('form-create-circle');
    if (createForm) {
      createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleCreateCircle();
      });
    }

    // Join Circle Form
    const joinForm = document.getElementById('form-join-circle');
    if (joinForm) {
      joinForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleJoinCircle();
      });
    }

    // Save Elder Permissions Form
    const permForm = document.getElementById('form-circle-permissions');
    if (permForm) {
      permForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleUpdatePermissions();
      });
    }

    // Change Passcode Form
    const passcodeForm = document.getElementById('form-change-passcode');
    if (passcodeForm) {
      passcodeForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleChangePasscode();
      });
    }

    // Refresh Activity Log Button
    const btnRefreshLog = document.getElementById('btn-refresh-activity-log');
    if (btnRefreshLog) {
      btnRefreshLog.addEventListener('click', async () => {
        await this.loadActivityLog();
      });
    }

    // Member Permissions Form
    const memberPermForm = document.getElementById('form-member-permissions');
    if (memberPermForm) {
      memberPermForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSaveMemberPermissions();
      });
    }

    // Modal Revoke Button
    const btnModalRevoke = document.getElementById('btn-modal-revoke-member');
    if (btnModalRevoke) {
      btnModalRevoke.addEventListener('click', async () => {
        const uid = document.getElementById('edit-member-uid').value;
        if (uid) await this.handleRevokeMember(uid);
      });
    }

    // Delegated events on members list (Elder actions)
    const membersList = document.getElementById('circle-members-list');
    if (membersList) {
      membersList.addEventListener('click', async (e) => {
        const btnEdit = e.target.closest('.btn-edit-member-perms');
        if (btnEdit) {
          const uid = btnEdit.getAttribute('data-uid');
          this.openMemberPermissionsModal(uid);
          return;
        }

        const btnRevoke = e.target.closest('.btn-revoke-member');
        if (btnRevoke) {
          const uid = btnRevoke.getAttribute('data-uid');
          await this.handleRevokeMember(uid);
          return;
        }

        const btnRestore = e.target.closest('.btn-restore-member');
        if (btnRestore) {
          const uid = btnRestore.getAttribute('data-uid');
          await this.handleRestoreMember(uid);
          return;
        }
      });
    }

    // Modal close buttons
    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const modalId = e.currentTarget.getAttribute('data-close-modal');
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
      });
    });
  }

  async loadCircles() {
    try {
      const res = await api.get('/api/circles');
      this.circles = res.circles || [];

      // If user has no circles, automatically create a default demo circle for instant exploration
      if (this.circles.length === 0) {
        await this.createInitialDemoCircle();
        return;
      }

      // Check if previous active circle is valid
      const targetId =
        api.activeCircleId && this.circles.some((c) => c.id === api.activeCircleId)
          ? api.activeCircleId
          : this.circles[0].id;

      await this.setActiveCircle(targetId);
    } catch (err) {
      console.error('Failed to load circles:', err);
    }
  }

  async createInitialDemoCircle() {
    try {
      const res = await api.post('/api/circles/create', {
        name: 'Sharma Family Care Circle',
        elderName: 'Ramesh Sharma',
        passcode: 'care123',
        timezone: 'Asia/Kolkata'
      });
      if (res.success) {
        await this.loadCircles();
      }
    } catch (err) {
      console.warn('Initial circle creation note:', err.message);
    }
  }

  async setActiveCircle(circleId) {
    api.setActiveCircle(circleId);
    try {
      const res = await api.get(`/api/circles/${circleId}`);
      if (res.success) {
        this.activeCircle = res.circle;
        this.userRole = res.userRole;
        this.isElder = res.isElder;

        this.renderCircleHeader();
        this.renderCircleSelector();
        this.renderCircleDetails();
        this.renderPermissionsPanel();
        await this.loadActivityLog();

        a11y.announce(`Active Care Circle: ${this.activeCircle.name}. Your role: ${this.userRole}`);
        window.dispatchEvent(
          new CustomEvent('circle:changed', {
            detail: {
              circle: this.activeCircle,
              userRole: this.userRole,
              isElder: this.isElder
            }
          })
        );
      }
    } catch (err) {
      console.error('Failed to set active circle:', err);
    }
  }

  renderCircleSelector() {
    const selector = document.getElementById('circle-selector');
    if (!selector) return;

    selector.innerHTML = '';
    this.circles.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `${c.name} (${c.myRole})`;
      if (this.activeCircle && c.id === this.activeCircle.id) {
        opt.selected = true;
      }
      selector.appendChild(opt);
    });

    const optCreate = document.createElement('option');
    optCreate.value = '__create__';
    optCreate.textContent = '➕ Create New Circle...';
    selector.appendChild(optCreate);

    const optJoin = document.createElement('option');
    optJoin.value = '__join__';
    optJoin.textContent = '🔑 Join Circle with Passcode...';
    selector.appendChild(optJoin);
  }

  renderCircleHeader() {
    const nameEl = document.getElementById('active-circle-title');
    const elderEl = document.getElementById('active-elder-name');
    const roleBadge = document.getElementById('user-role-badge');

    if (this.activeCircle) {
      if (nameEl) nameEl.textContent = this.activeCircle.name;
      if (elderEl) elderEl.textContent = this.activeCircle.elderName || 'Elder';
      if (roleBadge) {
        roleBadge.textContent = this.userRole.toUpperCase();
        roleBadge.className = `role-badge badge-${this.userRole}`;
      }
    } else {
      if (nameEl) nameEl.textContent = 'No Care Circle Selected';
      if (elderEl) elderEl.textContent = '';
      if (roleBadge) roleBadge.textContent = '';
    }
  }

  renderCircleDetails() {
    const listEl = document.getElementById('circle-members-list');
    const circleIdEl = document.getElementById('info-circle-id');
    const elderDisplayEl = document.getElementById('info-elder-display');

    if (circleIdEl && this.activeCircle) circleIdEl.textContent = this.activeCircle.id;
    if (elderDisplayEl && this.activeCircle) {
      elderDisplayEl.textContent = `${this.activeCircle.elderName} (Owner)`;
    }

    if (listEl && this.activeCircle) {
      listEl.innerHTML = '';
      const members = this.activeCircle.members || [];
      if (members.length === 0) {
        listEl.innerHTML =
          '<li class="empty-state">No caretakers or family members joined yet. Share the Circle ID and Passcode to invite your care circle!</li>';
      } else {
        members.forEach((m) => {
          const li = document.createElement('li');
          const isRevoked = Boolean(m.isRevoked);
          li.className = `member-card ${isRevoked ? 'member-revoked' : ''}`;

          let actionsHtml;
          if (this.isElder) {
            if (isRevoked) {
              actionsHtml = `
                <div class="member-actions">
                  <span class="badge-revoked">ACCESS REVOKED</span>
                  <button class="btn btn-outline btn-sm btn-restore-member" data-uid="${m.uid}">Restore Access</button>
                </div>
              `;
            } else {
              actionsHtml = `
                <div class="member-actions">
                  <button class="btn btn-secondary btn-sm btn-edit-member-perms" data-uid="${m.uid}">⚙️ Sharing & Permissions</button>
                  <button class="btn btn-outline-danger btn-sm btn-revoke-member" data-uid="${m.uid}">Revoke</button>
                </div>
              `;
            }
          } else {
            actionsHtml = isRevoked ? '<span class="badge-revoked">REVOKED</span>' : '';
          }

          li.innerHTML = `
            <div class="member-info">
              <strong>${m.name}</strong>
              <span class="member-email">${m.email}</span>
            </div>
            <div class="member-meta">
              <span class="role-badge badge-${m.role}">${m.role.toUpperCase()}</span>
              ${actionsHtml}
            </div>
          `;
          listEl.appendChild(li);
        });
      }
    }
  }

  renderPermissionsPanel() {
    const panel = document.getElementById('elder-permissions-section');
    if (!panel) return;

    if (this.isElder) {
      panel.classList.remove('hidden');
      const perms = this.activeCircle.permissions || {};

      const setCheckbox = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.checked = Boolean(val);
      };

      setCheckbox('perm-caretaker-manage-meds', perms.caretakerCanManageMeds !== false);
      setCheckbox('perm-caretaker-log-doses', perms.caretakerCanLogDoses !== false);
      setCheckbox('perm-caretaker-appts', perms.caretakerCanManageAppointments !== false);
      setCheckbox('perm-family-log-doses', perms.familyCanLogDoses === true);
      setCheckbox('perm-family-manage-meds', perms.familyCanManageMeds === true);
      setCheckbox('perm-family-appts', perms.familyCanManageAppointments === true);
      setCheckbox('perm-family-vitals', perms.familyCanViewVitals !== false);
      setCheckbox('perm-family-weekly-summary', perms.familyCanReceiveWeeklySummary !== false);

      const ctDelayEl = document.getElementById('escalation-caretaker-delay');
      if (ctDelayEl) ctDelayEl.value = this.activeCircle.caretakerEscalationDelayMinutes || 15;

      const famDelayEl = document.getElementById('escalation-family-delay');
      if (famDelayEl) famDelayEl.value = this.activeCircle.familyEscalationDelayMinutes || 30;
    } else {
      panel.classList.add('hidden');
    }
  }

  openMemberPermissionsModal(uid) {
    const member = (this.activeCircle?.members || []).find((m) => m.uid === uid);
    if (!member) return;

    document.getElementById('edit-member-uid').value = member.uid;
    const descEl = document.getElementById('edit-member-description');
    if (descEl) {
      descEl.textContent = `Customize healthcare data access and alert permissions for ${member.name} (${member.role.toUpperCase()}).`;
    }

    const mPerms = member.permissions || {};
    const isCaretaker = member.role === 'caretaker';

    const setCheck = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(val);
    };

    // View
    setCheck('mperm-view-meds', mPerms.canViewMedicines !== false);
    setCheck('mperm-view-doses', mPerms.canViewDoses !== false);
    setCheck('mperm-view-appts', mPerms.canViewAppointments !== false);
    setCheck('mperm-view-readings', mPerms.canViewReadings !== false);

    // Edit
    setCheck(
      'mperm-edit-meds',
      mPerms.canEditMedicines !== undefined ? mPerms.canEditMedicines : isCaretaker
    );
    setCheck(
      'mperm-edit-doses',
      mPerms.canEditDoses !== undefined ? mPerms.canEditDoses : isCaretaker
    );
    setCheck(
      'mperm-edit-appts',
      mPerms.canEditAppointments !== undefined ? mPerms.canEditAppointments : isCaretaker
    );

    // Alerts
    setCheck(
      'mperm-alert-intake',
      mPerms.alertIntakeReminders !== undefined ? mPerms.alertIntakeReminders : isCaretaker
    );
    setCheck('mperm-alert-missed', mPerms.alertMissedDoses !== false);
    setCheck('mperm-alert-appts', mPerms.alertAppointments !== false);
    setCheck('mperm-alert-weekly', mPerms.alertWeeklySummary !== false);

    const modal = document.getElementById('modal-member-permissions');
    if (modal) modal.classList.remove('hidden');
  }

  async handleSaveMemberPermissions() {
    const memberUid = document.getElementById('edit-member-uid').value;
    if (!memberUid || !this.activeCircle) return;

    const permissions = {
      canViewMedicines: document.getElementById('mperm-view-meds').checked,
      canViewDoses: document.getElementById('mperm-view-doses').checked,
      canViewAppointments: document.getElementById('mperm-view-appts').checked,
      canViewReadings: document.getElementById('mperm-view-readings').checked,
      canEditMedicines: document.getElementById('mperm-edit-meds').checked,
      canEditDoses: document.getElementById('mperm-edit-doses').checked,
      canEditAppointments: document.getElementById('mperm-edit-appts').checked,
      alertIntakeReminders: document.getElementById('mperm-alert-intake').checked,
      alertMissedDoses: document.getElementById('mperm-alert-missed').checked,
      alertAppointments: document.getElementById('mperm-alert-appts').checked,
      alertWeeklySummary: document.getElementById('mperm-alert-weekly').checked
    };

    try {
      const res = await api.put(
        `/api/circles/${this.activeCircle.id}/members/${memberUid}/permissions`,
        { permissions }
      );
      if (res.success) {
        document.getElementById('modal-member-permissions').classList.add('hidden');
        a11y.announce('Member permissions updated successfully');
        await this.setActiveCircle(this.activeCircle.id);
        alert('Member sharing permissions successfully updated.');
      }
    } catch (err) {
      alert(`Failed to update member permissions: ${err.message}`);
    }
  }

  async handleRevokeMember(memberUid) {
    if (!this.isElder || !this.activeCircle) return;
    const member = (this.activeCircle.members || []).find((m) => m.uid === memberUid);
    const memberName = member ? member.name : 'this member';

    if (
      !confirm(
        `Are you sure you want to revoke access for ${memberName}? They will be immediately blocked from accessing this Care Circle.`
      )
    ) {
      return;
    }

    try {
      const res = await api.post(
        `/api/circles/${this.activeCircle.id}/members/${memberUid}/revoke`
      );
      if (res.success) {
        const modal = document.getElementById('modal-member-permissions');
        if (modal) modal.classList.add('hidden');
        a11y.announce(`Access revoked for ${memberName}`);
        await this.setActiveCircle(this.activeCircle.id);
        alert(`Access for ${memberName} has been revoked immediately.`);
      }
    } catch (err) {
      alert(`Failed to revoke member: ${err.message}`);
    }
  }

  async handleRestoreMember(memberUid) {
    if (!this.isElder || !this.activeCircle) return;
    try {
      const res = await api.post(
        `/api/circles/${this.activeCircle.id}/members/${memberUid}/restore`
      );
      if (res.success) {
        a11y.announce('Member access restored');
        await this.setActiveCircle(this.activeCircle.id);
        alert('Member access has been restored.');
      }
    } catch (err) {
      alert(`Failed to restore member access: ${err.message}`);
    }
  }

  async loadActivityLog() {
    const listEl = document.getElementById('circle-activity-log-list');
    if (!listEl || !this.activeCircle) return;

    try {
      const res = await api.get(`/api/circles/${this.activeCircle.id}/activity-log?limit=30`);
      const logs = res.logs || [];

      if (logs.length === 0) {
        listEl.innerHTML =
          '<li class="empty-state">No recorded activity yet. Actions such as medication changes, logged doses, and sharing updates will appear here.</li>';
        return;
      }

      listEl.innerHTML = '';
      logs.forEach((entry) => {
        const li = document.createElement('li');
        li.className = 'activity-log-item';

        const actorName = entry.actor?.name || 'System';
        const actorRole = entry.actor?.role ? `(${entry.actor.role.toUpperCase()})` : '';
        const timeFormatted = new Date(entry.timestamp).toLocaleString('en-IN', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });

        li.innerHTML = `
          <div class="activity-content">
            <span class="activity-actor">${actorName} <small class="text-muted">${actorRole}</small></span>
            <div class="activity-details">
              <span class="activity-badge">${entry.action || 'ACTIVITY'}</span>
              <span>${entry.details || ''}</span>
            </div>
          </div>
          <span class="activity-time">${timeFormatted}</span>
        `;
        listEl.appendChild(li);
      });
    } catch (err) {
      console.warn('Failed to load activity log:', err);
      listEl.innerHTML =
        '<li class="text-muted"><small>Activity log available to Care Circle members.</small></li>';
    }
  }

  openCreateModal() {
    const modal = document.getElementById('modal-create-circle');
    if (modal) modal.classList.remove('hidden');
  }

  openJoinModal() {
    const modal = document.getElementById('modal-join-circle');
    if (modal) modal.classList.remove('hidden');
  }

  async handleCreateCircle() {
    const name = document.getElementById('new-circle-name').value;
    const elderName = document.getElementById('new-circle-elder').value;
    const passcode = document.getElementById('new-circle-passcode').value;

    try {
      const res = await api.post('/api/circles/create', {
        name,
        elderName,
        passcode,
        timezone: 'Asia/Kolkata'
      });

      if (res.success) {
        document.getElementById('modal-create-circle').classList.add('hidden');
        document.getElementById('form-create-circle').reset();
        await this.loadCircles();
        await this.setActiveCircle(res.circle.id);
        alert(`Care Circle "${res.circle.name}" created! Passcode is saved securely.`);
      }
    } catch (err) {
      alert(`Could not create circle: ${err.message}`);
    }
  }

  async handleJoinCircle() {
    const circleId = document.getElementById('join-circle-id').value;
    const passcode = document.getElementById('join-circle-passcode').value;
    const role = document.getElementById('join-circle-role').value;

    try {
      const res = await api.post('/api/circles/join', {
        circleId,
        passcode,
        role
      });

      if (res.success) {
        document.getElementById('modal-join-circle').classList.add('hidden');
        document.getElementById('form-join-circle').reset();
        await this.loadCircles();
        await this.setActiveCircle(res.circle.id);
        alert(`Joined ${res.circle.name} successfully as ${role}!`);
      }
    } catch (err) {
      alert(`Join failed: ${err.message}`);
    }
  }

  async handleUpdatePermissions() {
    if (!this.isElder) return;

    const permissions = {
      caretakerCanManageMeds: document.getElementById('perm-caretaker-manage-meds').checked,
      caretakerCanLogDoses: document.getElementById('perm-caretaker-log-doses').checked,
      caretakerCanManageAppointments: document.getElementById('perm-caretaker-appts').checked,
      familyCanLogDoses: document.getElementById('perm-family-log-doses').checked,
      familyCanManageMeds: document.getElementById('perm-family-manage-meds').checked,
      familyCanManageAppointments: document.getElementById('perm-family-appts').checked,
      familyCanViewVitals: document.getElementById('perm-family-vitals').checked,
      familyCanReceiveWeeklySummary:
        document.getElementById('perm-family-weekly-summary')?.checked !== false
    };

    const caretakerDelay = parseInt(
      document.getElementById('escalation-caretaker-delay')?.value || '15',
      10
    );
    const familyDelay = parseInt(
      document.getElementById('escalation-family-delay')?.value || '30',
      10
    );

    try {
      const res = await api.put(`/api/circles/${this.activeCircle.id}/permissions`, {
        permissions,
        caretakerEscalationDelayMinutes: caretakerDelay,
        familyEscalationDelayMinutes: familyDelay
      });

      if (res.success) {
        this.activeCircle.permissions = res.permissions;
        this.activeCircle.caretakerEscalationDelayMinutes = res.caretakerEscalationDelayMinutes;
        this.activeCircle.familyEscalationDelayMinutes = res.familyEscalationDelayMinutes;
        a11y.announce('Circle permissions and escalation policy updated successfully');
        await this.loadActivityLog();
        alert('Elder authorization permissions and escalation policy successfully updated.');
      }
    } catch (err) {
      alert(`Error updating permissions: ${err.message}`);
    }
  }

  async handleChangePasscode() {
    if (!this.isElder) return;
    const newPasscode = document.getElementById('new-circle-passcode-field').value;

    try {
      const res = await api.put(`/api/circles/${this.activeCircle.id}/passcode`, { newPasscode });
      if (res.success) {
        document.getElementById('form-change-passcode').reset();
        await this.loadActivityLog();
        alert('Passcode updated securely. Members can now join with this new passcode.');
      }
    } catch (err) {
      alert(`Error changing passcode: ${err.message}`);
    }
  }
}

export const circle = new CircleManager();
