// Keep library reads small: PDF bytes are read only when opening a document.
export function openDraftDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("bluekey-pdf", 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("documents"))
        db.createObjectStore("documents", { keyPath: "id" });
      const summaries = db.createObjectStore("summaries", { keyPath: "id" });
      const cursor = request.transaction.objectStore("documents").openCursor();
      cursor.onsuccess = () => {
        const row = cursor.result;
        if (row) {
          summaries.put(summary(row.value));
          row.continue();
        }
      };
    };
    let blocked = false;
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(Error("Close other BlueKey tabs to update draft storage."));
    };
  });
}

function summary(document) {
  return {
    id: document.id,
    name: document.name,
    updated: document.updated,
    pageCount: document.pages.length,
    thumb: document.thumb,
  };
}

export function draftTransaction(db, mode, operation) {
  if (!db)
    return Promise.reject(
      Error(
        "Browser storage is unavailable. Export your PDF or project to keep it.",
      ),
    );
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["documents", "summaries"], mode);
    let result;
    try {
      const documents = tx.objectStore("documents");
      const summaries = tx.objectStore("summaries");
      // The existing caller API is retained, with atomic summary updates.
      const store = {
        get: (id) => documents.get(id),
        getAll: () => summaries.getAll(),
        put: (document) => {
          summaries.put(summary(document));
          return documents.put(document);
        },
        delete: (id) => {
          summaries.delete(id);
          return documents.delete(id);
        },
      };
      const request = operation(store);
      if (request)
        request.onsuccess = () => {
          result = request.result;
        };
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () =>
      reject(tx.error || Error("Storage write was interrupted."));
  });
}
