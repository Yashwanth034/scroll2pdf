(function initializeScroll2PDFResultStore(globalScope) {
  "use strict";

  if (globalScope.Scroll2PDFResultStore) {
    return;
  }

  const DATABASE_NAME = "Scroll2PDFResults";
  const DATABASE_VERSION = 1;
  const STORE_NAME = "results";

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
    });
  }

  function transactionComplete(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("IndexedDB transaction failed."));
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction was aborted."));
    });
  }

  function openDatabase() {
    if (!globalScope.indexedDB) {
      return Promise.reject(new Error("Temporary result storage is unavailable."));
    }
    return new Promise((resolve, reject) => {
      const request = globalScope.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "resultId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open temporary result storage."));
    });
  }

  async function saveResult(record) {
    if (!record?.resultId || !(record.blob instanceof Blob)) {
      throw new Error("A valid image result is required.");
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      store.clear();
      store.put(record);
      await transactionComplete(transaction);
      return record;
    } finally {
      database.close();
    }
  }

  async function getResult(resultId) {
    if (!resultId) {
      return undefined;
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readonly");
      return await requestResult(transaction.objectStore(STORE_NAME).get(resultId));
    } finally {
      database.close();
    }
  }

  async function deleteResult(resultId) {
    if (!resultId) {
      return;
    }
    const database = await openDatabase();
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(resultId);
      await transactionComplete(transaction);
    } finally {
      database.close();
    }
  }

  async function cleanupStaleResults(maxAgeMs = 24 * 60 * 60 * 1000) {
    const database = await openDatabase();
    const cutoff = Date.now() - maxAgeMs;
    try {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const records = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
      for (const record of records) {
        if (!record?.active && Number(record.createdAt) < cutoff) store.delete(record.resultId);
      }
      await transactionComplete(transaction);
    } finally { database.close(); }
  }

  Object.defineProperty(globalScope, "Scroll2PDFResultStore", {
    value: Object.freeze({
      DATABASE_NAME,
      STORE_NAME,
      deleteResult,
      cleanupStaleResults,
      getResult,
      saveResult,
    }),
    configurable: false,
    enumerable: true,
    writable: false,
  });
})(globalThis);
