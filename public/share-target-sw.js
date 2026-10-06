/* Share-target handler for Android (imported into the generated SW via workbox.importScripts).
 * Intercepts POST /share-target/ (multipart/form-data from the Android share sheet),
 * stashes files + text in IndexedDB (offline-safe), then redirects to /?shared=1
 * where the app decodes locally. No network required.
 */
(function () {
  var DB_NAME = 'qr-share-target';
  var STORE = 'payloads';
  var KEY = 'pending';

  function openDB() {
    return new Promise(function (resolve, reject) {
      try {
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(STORE)) {
            req.result.createObjectStore(STORE);
          }
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = function () {
          reject(req.error);
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  function savePending(value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        try {
          var tx = db.transaction(STORE, 'readwrite');
          var store = tx.objectStore(STORE);
          var req = store.put(value, KEY);
          req.onsuccess = function () {
            resolve();
          };
          req.onerror = function () {
            reject(req.error);
          };
          tx.oncomplete = function () {
            try {
              db.close();
            } catch (_) {}
          };
        } catch (err) {
          try {
            db.close();
          } catch (_) {}
          reject(err);
        }
      });
    });
  }

  function isShareTarget(url) {
    return url.pathname === '/share-target' || url.pathname === '/share-target/';
  }

  self.addEventListener('fetch', function (event) {
    var req = event.request;
    if (req.method !== 'POST') return;
    var url;
    try {
      url = new URL(req.url);
    } catch (_) {
      return;
    }
    if (url.origin !== self.location.origin || !isShareTarget(url)) return;

    event.respondWith(
      (async function () {
        try {
          var formData = await event.request.formData();
          var files = [];
          // Manifest uses name "images", but collect any File values defensively.
          try {
            for (var value of formData.values()) {
              if (value instanceof File && value.size > 0) files.push(value);
            }
          } catch (_) {
            var named = formData.getAll('images');
            for (var i = 0; i < named.length; i++) {
              if (named[i] instanceof File && named[i].size > 0) files.push(named[i]);
            }
          }
          var str = function (k) {
            var v = formData.get(k);
            return typeof v === 'string' ? v : '';
          };
          await savePending({
            files: files,
            title: str('title'),
            text: str('text'),
            url: str('url'),
            timestamp: Date.now()
          });
        } catch (_) {
          // Stash is best-effort — app shows an error when nothing is found.
        }
        return Response.redirect('/?shared=1', 303);
      })()
    );
  });
})();
