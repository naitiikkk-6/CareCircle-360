import admin from 'firebase-admin';
import { config } from './config.js';

class InMemoryDocument {
  constructor(id, data = null, collectionRef = null) {
    this.id = id;
    this._data = data ? JSON.parse(JSON.stringify(data)) : null;
    this._collectionRef = collectionRef;
  }

  get exists() {
    return this._data !== null;
  }

  data() {
    return this._data ? JSON.parse(JSON.stringify(this._data)) : undefined;
  }

  async get() {
    return this;
  }

  async set(data, options = {}) {
    const timestamp = new Date().toISOString();
    if (options.merge && this._data) {
      this._data = {
        ...this._data,
        ...data,
        updatedAt: timestamp
      };
    } else {
      this._data = {
        ...data,
        id: this.id,
        createdAt: this._data?.createdAt || timestamp,
        updatedAt: timestamp
      };
    }
    this._collectionRef._storage.set(this.id, this._data);
    return this;
  }

  async update(data) {
    if (!this._data) {
      throw new Error(`Document ${this.id} does not exist`);
    }
    this._data = {
      ...this._data,
      ...data,
      updatedAt: new Date().toISOString()
    };
    this._collectionRef._storage.set(this.id, this._data);
    return this;
  }

  async delete() {
    this._collectionRef._storage.delete(this.id);
    this._data = null;
    return true;
  }
}

class InMemoryQuery {
  constructor(collectionRef, filters = []) {
    this._collectionRef = collectionRef;
    this._filters = filters;
  }

  where(field, op, value) {
    return new InMemoryQuery(this._collectionRef, [...this._filters, { field, op, value }]);
  }

  async get() {
    let docs = Array.from(this._collectionRef._storage.entries()).map(([id, data]) => {
      return new InMemoryDocument(id, data, this._collectionRef);
    });

    for (const filter of this._filters) {
      docs = docs.filter((doc) => {
        const val = doc.data()?.[filter.field];
        if (filter.op === '==' || filter.op === '===') {
          return val === filter.value;
        }
        if (filter.op === '!=') {
          return val !== filter.value;
        }
        if (filter.op === 'array-contains') {
          return Array.isArray(val) && val.includes(filter.value);
        }
        if (filter.op === 'in') {
          return Array.isArray(filter.value) && filter.value.includes(val);
        }
        if (filter.op === '>=') {
          return val >= filter.value;
        }
        if (filter.op === '<=') {
          return val <= filter.value;
        }
        if (filter.op === '>') {
          return val > filter.value;
        }
        if (filter.op === '<') {
          return val < filter.value;
        }
        return true;
      });
    }

    return {
      empty: docs.length === 0,
      size: docs.length,
      docs,
      forEach: (cb) => docs.forEach(cb)
    };
  }
}

class InMemoryCollection {
  constructor(name) {
    this.name = name;
    this._storage = new Map();
  }

  doc(id) {
    const docId = id || 'doc_' + Math.random().toString(36).substring(2, 12);
    const existing = this._storage.get(docId) || null;
    return new InMemoryDocument(docId, existing, this);
  }

  async add(data) {
    const docId = 'doc_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const docRef = this.doc(docId);
    await docRef.set(data);
    return docRef;
  }

  where(field, op, value) {
    return new InMemoryQuery(this, [{ field, op, value }]);
  }

  async get() {
    return new InMemoryQuery(this, []).get();
  }

  clear() {
    this._storage.clear();
  }
}

class InMemoryFirestore {
  constructor() {
    this._collections = new Map();
  }

  collection(name) {
    if (!this._collections.has(name)) {
      this._collections.set(name, new InMemoryCollection(name));
    }
    return this._collections.get(name);
  }

  reset() {
    this._collections.clear();
  }
}

let dbInstance = null;
let isRealFirestore = false;

export function getDb() {
  if (dbInstance) return dbInstance;

  // Initialize Firebase Admin if project ID is provided and not explicitly using local DB
  if (!config.useLocalDb && config.firebaseProjectId) {
    try {
      if (!admin.apps.length) {
        admin.initializeApp({
          projectId: config.firebaseProjectId
        });
      }
      dbInstance = admin.firestore();
      isRealFirestore = true;
      return dbInstance;
    } catch (err) {
      console.warn(
        'Firebase Admin initialization skipped or failed; falling back to in-memory Firestore engine:',
        err.message
      );
    }
  }

  dbInstance = new InMemoryFirestore();
  isRealFirestore = false;
  return dbInstance;
}

export function isUsingRealFirestore() {
  return isRealFirestore;
}

export { admin };
