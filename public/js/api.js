/**
 * Centralized API Client for CareCircle 360
 */
class ApiClient {
  constructor() {
    this.token = localStorage.getItem('carecircle_token') || null;
    this.user = JSON.parse(localStorage.getItem('carecircle_user') || 'null');
    this.activeCircleId = localStorage.getItem('carecircle_active_circle_id') || null;
  }

  setSession(token, user) {
    this.token = token;
    this.user = user;
    if (token) localStorage.setItem('carecircle_token', token);
    else localStorage.removeItem('carecircle_token');
    if (user) localStorage.setItem('carecircle_user', JSON.stringify(user));
    else localStorage.removeItem('carecircle_user');
  }

  clearSession() {
    this.token = null;
    this.user = null;
    this.activeCircleId = null;
    localStorage.removeItem('carecircle_token');
    localStorage.removeItem('carecircle_user');
    localStorage.removeItem('carecircle_active_circle_id');
  }

  setActiveCircle(circleId) {
    this.activeCircleId = circleId;
    if (circleId) localStorage.setItem('carecircle_active_circle_id', circleId);
    else localStorage.removeItem('carecircle_active_circle_id');
  }

  async request(endpoint, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(endpoint, {
        ...options,
        headers
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || `HTTP error ${response.status}: ${response.statusText}`);
      }

      return data;
    } catch (err) {
      console.error(`[API Error: ${endpoint}]`, err.message);
      throw err;
    }
  }

  get(endpoint, queryParams = {}) {
    const url = new URL(endpoint, window.location.origin);
    Object.entries(queryParams).forEach(([key, val]) => {
      if (val !== undefined && val !== null) url.searchParams.append(key, val);
    });
    return this.request(url.toString(), { method: 'GET' });
  }

  post(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  put(endpoint, body = {}) {
    return this.request(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
