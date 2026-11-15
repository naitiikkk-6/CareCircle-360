import { api } from './api.js';
import { a11y } from './accessibility.js';

// Dynamically import Firebase Auth Web SDK from Google CDN
let firebaseAuth = null;
let isFirebaseInitialized = false;

async function setupFirebaseAuth() {
  try {
    const configRes = await api.get('/api/auth/config');
    if (configRes.success && configRes.firebase?.isConfigured) {
      const { initializeApp } =
        await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js');
      const { getAuth } =
        await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');

      const app = initializeApp({
        apiKey: configRes.firebase.apiKey,
        authDomain: configRes.firebase.authDomain,
        projectId: configRes.firebase.projectId
      });

      firebaseAuth = getAuth(app);
      isFirebaseInitialized = true;
    }
  } catch (err) {
    console.info(
      'Firebase Auth CDN initialization deferred; using backend authentication service:',
      err.message
    );
  }
}

class AuthManager {
  constructor() {
    this.currentUser = api.user;
  }

  async init() {
    this.bindEvents();
    this.updateAuthUI();
    await setupFirebaseAuth();
  }

  bindEvents() {
    // Mode toggle: Login vs Register
    const toggleToRegister = document.getElementById('btn-show-register');
    const toggleToLogin = document.getElementById('btn-show-login');
    const loginView = document.getElementById('auth-login-view');
    const registerView = document.getElementById('auth-register-view');
    const authErrorBox = document.getElementById('auth-error-box');

    if (toggleToRegister && toggleToLogin && loginView && registerView) {
      toggleToRegister.addEventListener('click', () => {
        loginView.classList.add('hidden');
        registerView.classList.remove('hidden');
        if (authErrorBox) authErrorBox.classList.add('hidden');
        document.getElementById('register-email')?.focus();
      });

      toggleToLogin.addEventListener('click', () => {
        registerView.classList.add('hidden');
        loginView.classList.remove('hidden');
        if (authErrorBox) authErrorBox.classList.add('hidden');
        document.getElementById('login-email')?.focus();
      });
    }

    // Login Form Submit
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        await this.handleLogin(email, password);
      });
    }

    // Register Form Submit
    const registerForm = document.getElementById('register-form');
    if (registerForm) {
      registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('register-name').value.trim();
        const email = document.getElementById('register-email').value.trim();
        const password = document.getElementById('register-password').value;
        const role = document.getElementById('register-role')?.value || 'elder';
        await this.handleRegister(name, email, password, role);
      });
    }

    // Fast Demo Personas
    document.querySelectorAll('[data-persona]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const persona = e.currentTarget.getAttribute('data-persona');
        await this.loginDemoPersona(persona);
      });
    });

    // Logout button
    const logoutBtn = document.getElementById('btn-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', () => {
        this.logout();
      });
    }
  }

  showAuthError(message) {
    const errorBox = document.getElementById('auth-error-box');
    if (errorBox) {
      errorBox.textContent = message;
      errorBox.classList.remove('hidden');
      a11y.announce(`Authentication error: ${message}`, 'assertive');
    }
  }

  clearAuthError() {
    const errorBox = document.getElementById('auth-error-box');
    if (errorBox) {
      errorBox.textContent = '';
      errorBox.classList.add('hidden');
    }
  }

  async handleLogin(email, password) {
    this.clearAuthError();

    // Try Firebase Web SDK if initialized
    if (isFirebaseInitialized && firebaseAuth) {
      try {
        const { signInWithEmailAndPassword } =
          await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');
        const userCred = await signInWithEmailAndPassword(firebaseAuth, email, password);
        const idToken = await userCred.user.getIdToken();
        const userObj = {
          uid: userCred.user.uid,
          email: userCred.user.email,
          name: userCred.user.displayName || email.split('@')[0],
          authType: 'firebase'
        };
        this.setAuthenticatedSession(idToken, userObj);
        return;
      } catch (fbErr) {
        console.warn('Firebase client sign-in note, falling back to server route:', fbErr.message);
      }
    }

    // Server-side authentication
    try {
      const res = await api.post('/api/auth/login', { email, password });
      if (res.success) {
        this.setAuthenticatedSession(res.token, res.user);
      }
    } catch (err) {
      this.showAuthError(err.message || 'Login failed. Please check your email and password.');
    }
  }

  async handleRegister(name, email, password, role) {
    this.clearAuthError();

    // Try Firebase Web SDK if initialized
    if (isFirebaseInitialized && firebaseAuth) {
      try {
        const { createUserWithEmailAndPassword, updateProfile } =
          await import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js');
        const userCred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
        if (name) {
          await updateProfile(userCred.user, { displayName: name });
        }
        const idToken = await userCred.user.getIdToken();
        const userObj = {
          uid: userCred.user.uid,
          email: userCred.user.email,
          name: name || email.split('@')[0],
          defaultRole: role,
          authType: 'firebase'
        };
        this.setAuthenticatedSession(idToken, userObj);
        return;
      } catch (fbErr) {
        console.warn('Firebase client register note, falling back to server route:', fbErr.message);
      }
    }

    // Server-side registration
    try {
      const res = await api.post('/api/auth/register', { name, email, password, role });
      if (res.success) {
        this.setAuthenticatedSession(res.token, res.user);
      }
    } catch (err) {
      this.showAuthError(err.message || 'Registration failed.');
    }
  }

  async loginDemoPersona(persona) {
    this.clearAuthError();
    try {
      const res = await api.post('/api/auth/demo-login', { persona });
      if (res.success) {
        this.setAuthenticatedSession(res.token, res.user);
      }
    } catch (err) {
      this.showAuthError(`Demo sign-in failed: ${err.message}`);
    }
  }

  setAuthenticatedSession(token, user) {
    api.setSession(token, user);
    this.currentUser = user;
    this.updateAuthUI();
    a11y.announce(`Welcome ${user.name}!`);
    window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user } }));
  }

  logout() {
    if (isFirebaseInitialized && firebaseAuth) {
      import('https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js').then(({ signOut }) => {
        signOut(firebaseAuth).catch(() => {});
      });
    }

    api.clearSession();
    this.currentUser = null;
    this.updateAuthUI();
    a11y.announce('Signed out successfully.');
    window.dispatchEvent(new CustomEvent('auth:changed', { detail: { user: null } }));
  }

  updateAuthUI() {
    const authOverlay = document.getElementById('auth-modal');
    const appMain = document.getElementById('app-main');
    const userBadge = document.getElementById('nav-user-badge');
    const userNameSpan = document.getElementById('current-user-name');

    if (this.currentUser) {
      if (authOverlay) authOverlay.classList.add('hidden');
      if (appMain) appMain.classList.remove('hidden');
      if (userBadge) userBadge.classList.remove('hidden');
      if (userNameSpan) userNameSpan.textContent = this.currentUser.name;
    } else {
      if (authOverlay) authOverlay.classList.remove('hidden');
      if (appMain) appMain.classList.add('hidden');
      if (userBadge) userBadge.classList.add('hidden');
    }
  }

  isAuthenticated() {
    return Boolean(this.currentUser && api.token);
  }
}

export const auth = new AuthManager();
