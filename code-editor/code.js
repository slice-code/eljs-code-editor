(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
      (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.codeEditorEl = factory());
})(this, (function () {

  const Elcode = {}

  const connector = {}

  var currentFile = null;
  var currentProject = 'Untitled Project';
  var editor = null;
  var debounceTimer = null;
  var isLoadingFile = false;
  var autoSaveEnabled = true;
  var editorFontSize = 15;
  var aceSnippetManager = null;
  var builtInSnippets = [];
  var customSnippets = [];
  var authUser = null;
  var apiProjectId = null;
  var pendingThumbnailRequest = null;
  var isPublishing = false;
  var headerDropdownMenus = [];
  
  // Per-file sessions to maintain separate undo/redo history
  var fileSessions = {};
  
  function cleanupFileStacks(name) {
    delete fileSessions[name];
  }

  const uuid = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ===== IndexedDB Helpers =====
  const DB_NAME = 'elcode-editor';
  const DB_VERSION = 3;
  const FILE_STORE = 'files';
  const PROJECT_STORE = 'projects';
  const SETTINGS_STORE = 'settings';
  var db = null;
  var dbInitPromise = null;

  function openDB() {
    return new Promise(function(resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function(e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(FILE_STORE)) {
          d.createObjectStore(FILE_STORE, { keyPath: ['project', 'name'] });
        }
        if (!d.objectStoreNames.contains(PROJECT_STORE)) {
          d.createObjectStore(PROJECT_STORE, { keyPath: 'name' });
        }
        if (!d.objectStoreNames.contains(SETTINGS_STORE)) {
          d.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = function(e) { db = e.target.result; resolve(db); };
      req.onerror = function(e) { reject(e); };
    });
  }

  function ensureDB() {
    if (db) return Promise.resolve(db);
    if (!dbInitPromise) {
      dbInitPromise = openDB().catch(function(err) {
        dbInitPromise = null;
        throw err;
      });
    }
    return dbInitPromise;
  }

  function saveFile(name, content) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(FILE_STORE, 'readwrite');
        tx.objectStore(FILE_STORE).put({ project: currentProject, name: name, content: content });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
      });
    });
  }

  function loadFile(name) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(FILE_STORE, 'readonly');
        var req = tx.objectStore(FILE_STORE).get([currentProject, name]);
        req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.content : null); };
        req.onerror = function(e) { reject(e); };
      });
    });
  }

  function listFiles() {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(FILE_STORE, 'readonly');
        var store = tx.objectStore(FILE_STORE);
        var req = store.getAll();
        req.onsuccess = function(e) {
          var results = e.target.result.filter(function(f) { return f.project === currentProject; });
          resolve(results.map(function(f) { return f.name; }));
        };
        req.onerror = function(e) { reject(e); };
      });
    });
  }

  function deleteFile(name) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(FILE_STORE, 'readwrite');
        tx.objectStore(FILE_STORE).delete([currentProject, name]);
        tx.oncomplete = function() { 
          // Clean up undo/redo stacks for deleted file
          cleanupFileStacks(name);
          resolve(); 
        };
        tx.onerror = function(e) { reject(e); };
      });
    });
  }

  // ===== Settings Helpers =====
  function saveSetting(key, value) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(SETTINGS_STORE, 'readwrite');
        tx.objectStore(SETTINGS_STORE).put({ key: key, value: value });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
      });
    });
  }

  function loadSetting(key) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(SETTINGS_STORE, 'readonly');
        var req = tx.objectStore(SETTINGS_STORE).get(key);
        req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.value : null); };
        req.onerror = function(e) { reject(e); };
      });
    });
  }

  function deleteSetting(key) {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(SETTINGS_STORE, 'readwrite');
        tx.objectStore(SETTINGS_STORE).delete(key);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
      });
    });
  }

  function renameFile(oldName, newName) {
    return ensureDB().then(function() { return new Promise(function(resolve, reject) {
      // Use current editor content if this file is open (captures unsaved changes)
      var content = (currentFile === oldName) ? editor.getValue() : null;

      function doRename(fileContent) {
        var tx = db.transaction(FILE_STORE, 'readwrite');
        var store = tx.objectStore(FILE_STORE);
        store.put({ project: currentProject, name: newName, content: fileContent });
        store.delete([currentProject, oldName]);
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
      }

      if (content !== null) {
        // Use editor content directly
        doRename(content);
      } else {
        // Load from IndexedDB for non-open files
        loadFile(oldName).then(function(fileContent) {
          if (fileContent === null) { reject(new Error('File not found')); return; }
          doRename(fileContent);
        }).catch(function(e) { reject(e); });
      }
    }); });
  }

  // ===== Project Helpers =====
  function saveProject() {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(PROJECT_STORE, 'readwrite');
        tx.objectStore(PROJECT_STORE).put({ name: currentProject, updatedAt: Date.now() });
        tx.oncomplete = function() { resolve(); };
        tx.onerror = function(e) { reject(e); };
      });
    });
  }

  function listProjects() {
    return ensureDB().then(function() {
      return new Promise(function(resolve, reject) {
        var tx = db.transaction(PROJECT_STORE, 'readonly');
        var req = tx.objectStore(PROJECT_STORE).getAll();
        req.onsuccess = function(e) { resolve(e.target.result || []); };
        req.onerror = function(e) { reject(e); };
      });
    });
  }

  function deleteProject(name) {
    return ensureDB().then(function() { return new Promise(function(resolve, reject) {
      // Delete project entry
      var tx = db.transaction(PROJECT_STORE, 'readwrite');
      tx.objectStore(PROJECT_STORE).delete(name);
      tx.oncomplete = function() {
        // Delete all files in this project
        var tx2 = db.transaction(FILE_STORE, 'readwrite');
        var store = tx2.objectStore(FILE_STORE);
        var req = store.getAll();
        req.onsuccess = function(e) {
          var files = e.target.result.filter(function(f) { return f.project === name; });
          files.forEach(function(f) { store.delete([name, f.name]); });
        };
        tx2.oncomplete = function() { resolve(); };
      };
      tx.onerror = function(e) { reject(e); };
    }); });
  }

  function loadProject(name) {
    console.log('[loadProject] Loading project:', name);
    currentProject = name;
    apiProjectId = null;
    localStorage.setItem('elcode-lastProject', name);
    connector.projectName.textContent = name;
    currentFile = null;
    isLoadingFile = true;
    editor.setValue('', -1);
    
    // Clear all file sessions when switching projects
    fileSessions = {};
    console.log('[loadProject] Cleared file sessions');
    
    refreshFileList();
    listFiles().then(function(files) {
      console.log('[loadProject] Files in project:', files);
      if (files.indexOf('main.js') !== -1) {
        console.log('[loadProject] Opening main.js');
        openFile('main.js');
      } else if (files.length > 0) {
        console.log('[loadProject] Opening first file:', files[0]);
        openFile(files[0]);
      } else {
        // No files in project, clear editor
        console.log('[loadProject] No files in project');
        isLoadingFile = false;
      }
      setTimeout(function() { 
        console.log('[loadProject] Running preview');
        runPreview(); 
      }, 300);
    }).catch(function(err) {
      console.error('[loadProject] Failed to list files:', err);
      isLoadingFile = false;
    });
  }

  function renameProject(oldName, newName) {
    ensureDB().then(function() {
    // Copy all files to new project name, delete old ones
    var tx = db.transaction(FILE_STORE, 'readwrite');
    var store = tx.objectStore(FILE_STORE);
    var req = store.getAll();
    req.onsuccess = function(e) {
      var files = e.target.result.filter(function(f) { return f.project === oldName; });
      files.forEach(function(f) {
        store.put({ project: newName, name: f.name, content: f.content });
        store.delete([oldName, f.name]);
      });
    };
    tx.oncomplete = function() {
      // Update project store
      var tx2 = db.transaction(PROJECT_STORE, 'readwrite');
      var pStore = tx2.objectStore(PROJECT_STORE);
      pStore.delete(oldName);
      pStore.put({ name: newName, updatedAt: Date.now() });
      tx2.oncomplete = function() {
        currentProject = newName;
        connector.projectName.textContent = newName;
        appendLog('info', ['Project renamed to "' + newName + '".']);
      };
    };
    });
  }

  var API_BASE_URL = 'https://slice-code.com';

  function buildApiUrl(path) {
    if (/^https?:\/\//i.test(path || '')) return path;
    var cleanPath = String(path || '');
    if (!cleanPath) return API_BASE_URL;
    if (cleanPath.charAt(0) !== '/') cleanPath = '/' + cleanPath;
    return API_BASE_URL.replace(/\/$/, '') + cleanPath;
  }

  function apiRequest(path, options) {
    var requestOptions = options || {};
    requestOptions.credentials = 'include';
    if (!requestOptions.headers) requestOptions.headers = {};
    return fetch(buildApiUrl(path), requestOptions).then(function(res) {
      return res.json().catch(function() { return {}; }).then(function(body) {
        if (!res.ok || body.success === false) {
          var message = (body && body.error && body.error.message) || body.message || ('Request failed (' + res.status + ')');
          var err = new Error(message);
          err.status = res.status;
          err.body = body;
          throw err;
        }
        return body;
      });
    });
  }

  function updateAuthUi() {
    if (!connector.authStatus || !connector.authActionBtn || !connector.authRegisterBtn || !connector.authLogoutBtn || !connector.publishBtn) return;
    if (authUser) {
      connector.authStatus.textContent = 'Hi, ' + (authUser.name || authUser.email || 'User');
      connector.authActionBtn.textContent = 'Session';
      connector.authActionBtn.style.background = '#2563eb';
      connector.authRegisterBtn.style.display = 'none';
      connector.authLogoutBtn.style.display = 'block';
      if (!isPublishing) {
        connector.publishBtn.textContent = 'Publish';
        connector.publishBtn.disabled = false;
        connector.publishBtn.style.opacity = '1';
        connector.publishBtn.style.cursor = 'pointer';
      }
    } else {
      connector.authStatus.textContent = 'Not logged in';
      connector.authActionBtn.textContent = 'Login';
      connector.authActionBtn.style.background = '#16a34a';
      connector.authRegisterBtn.style.display = 'block';
      connector.authLogoutBtn.style.display = 'none';
      if (!isPublishing) {
        connector.publishBtn.textContent = 'Publish';
        connector.publishBtn.disabled = true;
        connector.publishBtn.style.opacity = '0.6';
        connector.publishBtn.style.cursor = 'not-allowed';
      }
    }
  }

  function setPublishLoadingState(loading) {
    isPublishing = !!loading;
    if (!connector.publishBtn) return;
    if (isPublishing) {
      connector.publishBtn.textContent = 'Publishing...';
      connector.publishBtn.disabled = true;
      connector.publishBtn.style.opacity = '0.75';
      connector.publishBtn.style.cursor = 'progress';
      return;
    }
    updateAuthUi();
  }

  function closeHeaderDropdowns() {
    headerDropdownMenus.forEach(function(menuEl) {
      if (menuEl) menuEl.style.display = 'none';
    });
  }

  function createHeaderDropdown(label, buttonBg, items) {
    var menuRef = {};
    var container = el('div').css({ position: 'relative' });
    var button = el('button').text(label).css({
      padding: '4px 12px', background: buttonBg, color: '#fff', border: 'none',
      borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
    }).click(function(e) {
      e.stopPropagation();
      var menuNode = menuRef.menu;
      if (!menuNode) return;
      var willOpen = menuNode.style.display !== 'block';
      closeHeaderDropdowns();
      menuNode.style.display = willOpen ? 'block' : 'none';
    });

    var menu = el('div').link(menuRef, 'menu').css({
      position: 'absolute',
      right: '0',
      top: 'calc(100% + 6px)',
      minWidth: '170px',
      background: '#1f2937',
      border: '1px solid #374151',
      borderRadius: '6px',
      boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
      display: 'none',
      zIndex: '2000',
      padding: '6px'
    }).child(items.map(function(item) {
      var menuItem = el('a').text(item.label).css({
        display: 'block',
        color: item.color || '#e5e7eb',
        textDecoration: 'none',
        padding: '7px 9px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '12px',
        fontFamily: 'sans-serif'
      }).hover(
        function() { this.style.backgroundColor = '#334155'; },
        function() { this.style.backgroundColor = 'transparent'; }
      ).click(function(e) {
        e.stopPropagation();
        closeHeaderDropdowns();
        if (item.onClick) item.onClick();
      });
      if (item.linkName) {
        menuItem.link(connector, item.linkName);
      }
      return menuItem;
    }));

    var node = container.child([button, menu]).get();
    if (menuRef.menu) headerDropdownMenus.push(menuRef.menu);
    return node;
  }

  function refreshAuthState() {
    return apiRequest('/api/editor/auth/me', { method: 'GET' })
      .then(function(resp) {
        authUser = resp.data || null;
        updateAuthUi();
        return authUser;
      })
      .catch(function() {
        authUser = null;
        updateAuthUi();
        return null;
      });
  }

  function showLoginDialog() {
    var overlayNode;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }

    var emailInput = el('input').attr('type', 'email').attr('placeholder', 'email').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var passwordInput = el('input').attr('type', 'password').attr('placeholder', 'password').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var overlay = el('div').css({
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', fontFamily: 'sans-serif'
    });
    var box = el('div').css({
      background: '#2d2d2d', borderRadius: '8px', padding: '20px', width: '360px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
    }).child([
      el('div').css({ fontSize: '16px', fontWeight: 'bold', color: '#eee', marginBottom: '12px' }).text('Login untuk Publish'),
      el('div').css({ marginBottom: '10px' }).child([el(emailInput)]),
      el('div').css({ marginBottom: '16px' }).child([el(passwordInput)]),
      el('div').css({ display: 'flex', justifyContent: 'flex-end', gap: '8px' }).child([
        el('button').text('Cancel').css({
          padding: '6px 12px', background: '#555', color: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() { closeDialog(); }),
        el('button').text('Login').css({
          padding: '6px 12px', background: '#16a34a', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() {
          var email = String(emailInput.value || '').trim();
          var password = String(passwordInput.value || '');
          if (!email || !password) {
            appendLog('error', ['Email dan password wajib diisi.']);
            return;
          }
          apiRequest('/api/editor/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
          }).then(function() {
            closeDialog();
            appendLog('info', ['Login berhasil.']);
            return refreshAuthState();
          }).catch(function(err) {
            appendLog('error', ['Login gagal: ' + (err.message || err)]);
          });
        })
      ])
    ]);
    overlay.child([box]);
    overlayNode = overlay.get();
    document.body.appendChild(overlayNode);
  }

  function showRegisterDialog() {
    var overlayNode;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }

    var nameInput = el('input').attr('type', 'text').attr('placeholder', 'name').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var emailInput = el('input').attr('type', 'email').attr('placeholder', 'email').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var passwordInput = el('input').attr('type', 'password').attr('placeholder', 'password (min 8)').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var confirmInput = el('input').attr('type', 'password').attr('placeholder', 'confirm password').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();

    var overlay = el('div').css({
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', fontFamily: 'sans-serif'
    });
    var box = el('div').css({
      background: '#2d2d2d', borderRadius: '8px', padding: '20px', width: '380px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
    }).child([
      el('div').css({ fontSize: '16px', fontWeight: 'bold', color: '#eee', marginBottom: '12px' }).text('Daftar akun editor'),
      el('div').css({ marginBottom: '10px' }).child([el(nameInput)]),
      el('div').css({ marginBottom: '10px' }).child([el(emailInput)]),
      el('div').css({ marginBottom: '10px' }).child([el(passwordInput)]),
      el('div').css({ marginBottom: '16px' }).child([el(confirmInput)]),
      el('div').css({ display: 'flex', justifyContent: 'flex-end', gap: '8px' }).child([
        el('button').text('Cancel').css({
          padding: '6px 12px', background: '#555', color: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() { closeDialog(); }),
        el('button').text('Register').css({
          padding: '6px 12px', background: '#0ea5e9', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() {
          var name = String(nameInput.value || '').trim();
          var email = String(emailInput.value || '').trim();
          var password = String(passwordInput.value || '');
          var passwordConfirmation = String(confirmInput.value || '');

          if (!name || !email || !password || !passwordConfirmation) {
            appendLog('error', ['Semua field register wajib diisi.']);
            return;
          }
          if (password.length < 8) {
            appendLog('error', ['Password minimal 8 karakter.']);
            return;
          }
          if (password !== passwordConfirmation) {
            appendLog('error', ['Konfirmasi password tidak sama.']);
            return;
          }

          apiRequest('/api/editor/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name,
              email: email,
              password: password,
              password_confirmation: passwordConfirmation
            })
          }).then(function() {
            closeDialog();
            alert('Register berhasil. Anda sudah login.');
            appendLog('info', ['Register berhasil. Anda sudah login.']);
            return refreshAuthState();
          }).catch(function(err) {
            appendLog('error', ['Register gagal: ' + (err.message || err)]);
          });
        })
      ])
    ]);
    overlay.child([box]);
    overlayNode = overlay.get();
    document.body.appendChild(overlayNode);
  }

  function collectProjectFiles() {
    return listFiles().then(function(files) {
      var loadPromises = files.map(function(name) {
        return loadFile(name).then(function(content) { return { name: name, content: content || '' }; });
      });
      return Promise.all(loadPromises);
    }).then(function(allFiles) {
      if (currentFile && editor && !isLoadingFile) {
        var found = false;
        for (var i = 0; i < allFiles.length; i++) {
          if (allFiles[i].name === currentFile) {
            allFiles[i].content = editor.getValue();
            found = true;
            break;
          }
        }
        if (!found) allFiles.push({ name: currentFile, content: editor.getValue() });
      }
      return allFiles;
    });
  }

  function ensureRemoteProject() {
    if (apiProjectId) return Promise.resolve(apiProjectId);
    return apiRequest('/api/editor/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: currentProject, description: 'Created from el.js editor', template: 'default' })
    }).then(function(resp) {
      apiProjectId = resp.data && resp.data.project_id;
      if (!apiProjectId) throw new Error('project_id tidak ditemukan dari API');
      return apiProjectId;
    });
  }

  /** Deskripsi terbaru dari server untuk dialog publish (PUT terpisah dari body publish). */
  function fetchRemoteProjectDescription() {
    if (!apiProjectId) return Promise.resolve('');
    return apiRequest('/api/editor/projects/' + apiProjectId, { method: 'GET' }).then(function(resp) {
      var d = resp.data || {};
      return String(d.description != null ? d.description : '').trim();
    }).catch(function() {
      return '';
    });
  }

  function updateRemoteProjectMeta(name, description) {
    return apiRequest('/api/editor/projects/' + apiProjectId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, description: description })
    });
  }

  function syncProjectToApi() {
    return ensureRemoteProject().then(function(projectId) {
      return collectProjectFiles().then(function(files) {
        return apiRequest('/api/editor/projects/' + projectId + '/files', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            files: files,
            client_updated_at: new Date().toISOString()
          })
        });
      });
    });
  }

  function buildFallbackThumbnail() {
    var canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111827';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2563eb';
    ctx.fillRect(0, 0, canvas.width, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px sans-serif';
    ctx.fillText('el.js Editor Preview', 36, 76);
    ctx.font = '30px sans-serif';
    ctx.fillText(currentProject || 'Untitled Project', 36, 190);
    ctx.font = '22px monospace';
    ctx.fillStyle = '#93c5fd';
    ctx.fillText(new Date().toISOString(), 36, 232);
    var dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    return {
      mime_type: 'image/jpeg',
      data_base64: dataUrl.split(',')[1] || '',
      width: canvas.width,
      height: canvas.height
    };
  }

  function getPreviewThumbnail() {
    return new Promise(function(resolve) {
      var iframeEl = connector.preview;
      if (!iframeEl || !iframeEl.contentWindow) {
        resolve(buildFallbackThumbnail());
        return;
      }

      pendingThumbnailRequest = {
        resolve: resolve,
        timeoutId: setTimeout(function() {
          pendingThumbnailRequest = null;
          resolve(buildFallbackThumbnail());
        }, THUMBNAIL_CAPTURE_TIMEOUT_MS)
      };

      iframeEl.contentWindow.postMessage({
        type: '__elcode_capture_thumbnail__',
        maxWidth: 1280,
        maxHeight: 720
      }, '*');
    });
  }

  /** Raster iframe → canvas di parent (max 1280×720 JPEG) untuk payload publish */
  function normalizeThumbnailOnCanvas(thumbnail) {
    return new Promise(function(resolve) {
      if (!thumbnail || !thumbnail.data_base64) {
        resolve(buildFallbackThumbnail());
        return;
      }
      var img = new Image();
      img.onload = function() {
        var maxW = 1280;
        var maxH = 720;
        var scale = Math.min(maxW / img.width, maxH / img.height, 1);
        var tw = Math.max(1, Math.floor(img.width * scale));
        var th = Math.max(1, Math.floor(img.height * scale));
        var c = document.createElement('canvas');
        c.width = tw;
        c.height = th;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
        ctx.drawImage(img, 0, 0, tw, th);
        try {
          var du = c.toDataURL('image/jpeg', 0.9);
          var parts = du.split(',');
          resolve({
            mime_type: 'image/jpeg',
            data_base64: parts[1] || '',
            width: tw,
            height: th
          });
        } catch (e2) {
          resolve(thumbnail);
        }
      };
      img.onerror = function() {
        resolve(thumbnail);
      };
      img.src = 'data:' + (thumbnail.mime_type || 'image/jpeg') + ';base64,' + thumbnail.data_base64;
    });
  }

  /** Thumbnail publish: pakai canvas modal jika sudah ada frame; kalau tidak iframe → canvas → JPEG */
  function getThumbnailPayloadForPublish() {
    return new Promise(function(resolve) {
      if (livePreviewModalCanvas && livePreviewCanvasHasFrame &&
          livePreviewModalCanvas.width > 0 && livePreviewModalCanvas.height > 0) {
        try {
          var dataUrl = livePreviewModalCanvas.toDataURL('image/jpeg', 0.9);
          var b64 = dataUrl.split(',')[1];
          if (b64) {
            resolve({
              mime_type: 'image/jpeg',
              data_base64: b64,
              width: livePreviewModalCanvas.width,
              height: livePreviewModalCanvas.height
            });
            return;
          }
        } catch (e) {}
      }
      getPreviewThumbnail().then(function(thumb) {
        return normalizeThumbnailOnCanvas(thumb);
      }).then(resolve);
    });
  }

  function createNewProject() {
    var name = prompt('New project name:', 'New Project');
    if (!(name && name.trim())) return;
    console.log('[New Project] Creating project:', name.trim());
    currentProject = name.trim();
    apiProjectId = null;
    localStorage.setItem('elcode-lastProject', currentProject);
    connector.projectName.textContent = currentProject;

    // Clear state for new project
    currentFile = null;
    fileSessions = {};
    isLoadingFile = true;
    editor.setValue('', -1);
    console.log('[New Project] Cleared editor state');

    // Save main.js with default template
    var defaultTemplate = "// ============================================\n"
      + "// el.js Editor - Getting Started\n"
      + "// ============================================\n"
      + "// el.js is a lightweight DOM builder. Create elements with `el(tag)`,\n"
      + "// chain methods to style/structure them, then call `.get()` to get\n"
      + "// the real DOM node for appending.\n\n"
      + "let app = document.getElementById('app');\n\n"
      + "// --- Basic element with text ---\n"
      + "let title = el('h1')\n"
      + "  .text('Welcome to el.js!')\n"
      + "  .class('text-2xl font-bold mb-4 text-gray-600');\n\n"
      + "// --- HTML content (great for large lists) ---\n"
      + "let subtitle = el('p')\n"
      + "  .html('<span class=\\\"text-gray-400\\\">Build UI with simple method chaining</span>');\n\n"
      + "// --- Nested children with .child() ---\n"
      + "let card = el('div')\n"
      + "  .class('bg-gray-800 p-4 rounded-lg mb-4')\n"
      + "  .child([\n"
      + "    el('h2').text('Features').class('text-lg font-semibold mb-2 text-white'),\n"
      + "    el('ul').class('list-disc pl-5 space-y-1 text-gray-300').child([\n"
      + "      el('li').text('.text()  - set text content'),\n"
      + "      el('li').text('.html() - set innerHTML (fast for bulk)'),\n"
      + "      el('li').text('.child() - nest other el() elements'),\n"
      + "      el('li').text('.class() - add Tailwind / CSS classes'),\n"
      + "      el('li').text('.css()  - inline styles'),\n"
      + "      el('li').text('.click() - attach event handlers'),\n"
      + "    ])\n"
      + "  ]);\n\n"
      + "// --- Event handling ---\n"
      + "let btn = el('button')\n"
      + "  .text('Click Me')\n"
      + "  .class('px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white cursor-pointer')\n"
      + "  .click(function() {\n"
      + "    alert('Hello from el.js!');\n"
      + "  });\n\n"
      + "// --- Import another file ---\n"
      + "// 1. Create a new file (e.g., card.js) in the file list.\n"
      + "// 2. Export your element: export default el('div').text('My Card');\n"
      + "// 3. Import it here: import myCard from './card.js';\n"
      + "// 4. Append it: app.appendChild(myCard.get());\n\n"
      + "// --- Render everything ---\n"
      + "let container = el('div').padding('10px').child([title, subtitle, card]);\n"
      + "app.appendChild(container.get());\n";

    saveFile('main.js', defaultTemplate).then(function() {
      console.log('[New Project] main.js saved to IndexedDB');
      return saveProject();
    }).then(function() {
      console.log('[New Project] Project saved, opening main.js');
      refreshFileList();
      openFile('main.js');
      setTimeout(function() {
        console.log('[New Project] Running preview');
        runPreview();
      }, 300);
      appendLog('info', ['New project "' + currentProject + '" created.']);
    }).catch(function(err) {
      console.error('[New Project] Failed to create project:', err);
      isLoadingFile = false;
      appendLog('error', ['Failed to create new project: ' + (err.message || err)]);
    });
  }

  /** Baca slug impor dari session / query lalu hapus session agar tidak ter-import ulang. */
  function consumeEditorStoreImportIntent() {
    var slug = '';
    var fromMyPublish = false;
    try {
      slug = String(sessionStorage.getItem('editor:storeSlug') || '').trim();
      if (slug) {
        fromMyPublish = String(sessionStorage.getItem('editor:storeImportSource') || '').trim() === 'my-publish';
        sessionStorage.removeItem('editor:storeSlug');
        sessionStorage.removeItem('editor:storeImportSource');
        return { slug: slug, fromMyPublish: fromMyPublish };
      }
    } catch (e) {}

    try {
      var params = new URLSearchParams(window.location.search || '');
      var qSlug = String(params.get('storeSlug') || '').trim();
      if (qSlug) {
        return { slug: qSlug, fromMyPublish: false };
      }
    } catch (e2) {}

    return { slug: '', fromMyPublish: false };
  }

  /**
   * Impor project dari Store API ke IndexedDB.
   * @param {string} slug
   * @param {{ fromMyPublish?: boolean }} options — dari halaman My Published: nama project = nama API; timpa project lokal bernama sama.
   */
  function importStoreProjectFromSlug(slug, options) {
    if (!slug) return Promise.resolve(false);
    options = options || {};
    var fromMyPublish = !!options.fromMyPublish;

    appendLog('info', ['Mengambil project dari Store: ' + slug + ' ...']);

    return apiRequest('/api/editor/store/' + encodeURIComponent(slug), { method: 'GET' }).then(function(resp) {
      var data = resp && resp.data ? resp.data : {};
      var files = Array.isArray(data.files) ? data.files : [];
      if (!files.length) {
        throw new Error('Project store tidak memiliki file.');
      }

      var rawName = String(data.name || 'Store Project').trim() || 'Store Project';

      var filePayload = files.map(function(file, idx) {
        var fallbackName = 'file-' + (idx + 1) + '.js';
        return {
          name: (file && file.name ? String(file.name).trim() : '') || fallbackName,
          content: file && typeof file.content === 'string' ? file.content : ''
        };
      });

      function applyImportToProjectName(finalName) {
        currentProject = finalName;
        apiProjectId = null;
        localStorage.setItem('elcode-lastProject', currentProject);
        connector.projectName.textContent = currentProject;

        currentFile = null;
        fileSessions = {};
        isLoadingFile = true;
        editor.setValue('', -1);

        var saveOps = filePayload.map(function(file) {
          return saveFile(file.name, file.content);
        });

        return Promise.all(saveOps).then(function() {
          return saveProject();
        }).then(function() {
          refreshFileList();
          var target = 'main.js';
          var hasMain = filePayload.some(function(f) { return f.name === 'main.js'; });
          if (!hasMain) target = filePayload[0].name;
          openFile(target);
          setTimeout(function() { runPreview(); }, 350);
          if (fromMyPublish) {
            appendLog('info', ['Publish dibuka di editor (nama project disamakan; project lokal lama diganti jika ada): "' + currentProject + '".']);
          } else {
            appendLog('info', ['Project store berhasil dibuka di editor: "' + currentProject + '".']);
          }
          return true;
        });
      }

      return listProjects().then(function(projects) {
        var projectsArr = projects || [];

        if (fromMyPublish) {
          var publishName = rawName;
          var exists = projectsArr.some(function(p) { return p && p.name === publishName; });
          var chain = Promise.resolve();
          if (exists) {
            chain = deleteProject(publishName);
          }
          return chain.then(function() {
            return applyImportToProjectName(publishName);
          });
        }

        var importBaseName = rawName + ' (Store)';
        var used = {};
        projectsArr.forEach(function(p) {
          if (p && p.name) used[p.name] = true;
        });
        var finalName = importBaseName;
        var index = 2;
        while (used[finalName]) {
          finalName = importBaseName + ' ' + index;
          index++;
        }
        return applyImportToProjectName(finalName);
      });
    }).catch(function(err) {
      appendLog('error', ['Gagal membuka project store: ' + (err && err.message ? err.message : err)]);
      return false;
    });
  }

  /**
   * Dialog publish: slug + deskripsi (deskripsi disimpan lewat PUT project, lalu POST publish — sesuai api.md).
   */
  function showPublishDialog(slugDefault, initialDescription) {
    var overlayNode;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }

    var slugInput = el('input').attr('type', 'text').attr('placeholder', 'slug-url').css({
      width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
    }).get();
    slugInput.value = slugDefault || 'my-project';

    var descInput = el('textarea').attr('placeholder', 'Deskripsi singkat untuk halaman Store (opsional)').css({
      width: '100%', minHeight: '88px', resize: 'vertical', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
      fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box',
      fontFamily: 'sans-serif'
    }).get();
    descInput.value = initialDescription || '';

    var overlay = el('div').css({
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', fontFamily: 'sans-serif'
    });
    var box = el('div').css({
      background: '#2d2d2d', borderRadius: '8px', padding: '20px', width: '420px', maxWidth: 'calc(100vw - 32px)',
      boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
    }).child([
      el('div').css({ fontSize: '16px', fontWeight: 'bold', color: '#eee', marginBottom: '10px' }).text('Publish project'),
      el('div').css({ fontSize: '11px', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.45' }).text(
        'Slug untuk URL publik. Deskripsi disimpan di metadata project dan tampil di Store (bukan di body request publish).'
      ),
      el('div').css({ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }).text('Slug'),
      el('div').css({ marginBottom: '10px' }).child([el(slugInput)]),
      el('div').css({ fontSize: '12px', color: '#cbd5e1', marginBottom: '4px' }).text('Deskripsi'),
      el('div').css({ marginBottom: '14px' }).child([el(descInput)]),
      el('div').css({ display: 'flex', justifyContent: 'flex-end', gap: '8px' }).child([
        el('button').text('Batal').css({
          padding: '6px 12px', background: '#555', color: '#eee', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() { closeDialog(); }),
        el('button').text('Publish').css({
          padding: '6px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() {
          var slug = String(slugInput.value || '').trim();
          if (!slug) {
            appendLog('warn', ['Slug publish tidak boleh kosong.']);
            return;
          }
          var description = String(descInput.value || '').trim();
          closeDialog();
          setPublishLoadingState(true);
          updateRemoteProjectMeta(currentProject, description)
            .then(function() { return syncProjectToApi(); })
            .then(function() { return getThumbnailPayloadForPublish(); })
            .then(function(thumbnail) {
              return apiRequest('/api/editor/projects/' + apiProjectId + '/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visibility: 'public', slug: slug, thumbnail: thumbnail })
              });
            })
            .then(function(resp) {
              var url = resp.data && resp.data.published_url ? resp.data.published_url : '';
              appendLog('info', ['Publish berhasil' + (url ? ': ' + url : '.')]);
            })
            .catch(function(err) {
              appendLog('error', ['Publish gagal: ' + (err.message || err)]);
            })
            .finally(function() {
              setPublishLoadingState(false);
            });
        })
      ])
    ]);
    overlay.child([box]);
    overlayNode = overlay.get();
    document.body.appendChild(overlayNode);
    setTimeout(function() { try { slugInput.focus(); slugInput.select(); } catch (e) {} }, 50);
  }

  function publishProjectToApi() {
    if (!authUser) {
      appendLog('warn', ['Silakan login dulu sebelum publish.']);
      showLoginDialog();
      return;
    }
    var slugDefault = currentProject.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    ensureRemoteProject()
      .then(function() { return fetchRemoteProjectDescription(); })
      .then(function(desc) {
        showPublishDialog(slugDefault || 'my-project', desc);
      })
      .catch(function(err) {
        appendLog('error', ['Gagal menyiapkan publish: ' + (err.message || err)]);
      });
  }

  function showProjectLoadDialog() {
    var overlayNode;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }
    listProjects().then(function(projects) {
      var overlay = el('div').css({
        position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: '99999', fontFamily: 'sans-serif'
      });
      var box = el('div').css({
        background: '#2d2d2d', borderRadius: '8px', padding: '20px', minWidth: '320px',
        maxWidth: '450px', maxHeight: '400px', overflow: 'auto', boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
      });
      box.child([
        el('div').css({ fontSize: '14px', fontWeight: 'bold', color: '#eee', marginBottom: '12px' }).text('Load Project'),
        projects.length === 0
          ? el('div').css({ color: '#888', fontSize: '13px' }).text('No saved projects.')
          : el('div').child(
              projects.map(function(p) {
                var isActive = p.name === currentProject;
                return el('div').css({
                  padding: '8px 12px', cursor: 'pointer', color: isActive ? '#fff' : '#ccc', fontSize: '13px',
                  borderBottom: '1px solid #444', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  background: isActive ? '#3a6b9f' : 'transparent', borderRadius: isActive ? '4px' : '0'
                }).hover(
                  function() { if (!isActive) this.style.backgroundColor = '#444'; },
                  function() { if (!isActive) this.style.backgroundColor = 'transparent'; }
                ).click(function() {
                  closeDialog();
                  if (!isActive) loadProject(p.name);
                }).child([
                  el('span').text(p.name + (isActive ? ' (active)' : '')).css(
                    isActive ? { fontSize: '13px' } : { fontSize: '13px' }
                  ),
                  el('span').text('x').css({ color: '#888', cursor: 'pointer', padding: '2px 6px', fontSize: '11px' }).hover(
                    function() { this.style.color = '#f66'; },
                    function() { this.style.color = '#888'; }
                  ).click(function(e) {
                    e.stopPropagation();
                    if (confirm('Delete project "' + p.name + '" and all its files?')) {
                      deleteProject(p.name).then(function() {
                        closeDialog();
                        showProjectLoadDialog();
                      });
                    }
                  })
                ]);
              })
            ),
        el('div').css({ marginTop: '12px', textAlign: 'right' }).child([
          el('button').text('Cancel').css({
            padding: '6px 14px', background: '#555', color: '#eee', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
          }).click(function() {
            closeDialog();
          })
        ])
      ]);
      overlay.child([box]);
      overlayNode = overlay.get();
      document.body.appendChild(overlayNode);
    });
  }

  // ===== Settings =====
  function showSettingsDialog() {
    var overlayNode;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }

    // Load all settings in parallel
    Promise.all([
      loadSetting('groqToken'),
      loadSetting('groqModel'),
      loadSetting('groqMaxTokens'),
      loadSetting('aiProvider'),
      loadSetting('ollamaUrl'),
      loadSetting('ollamaModel'),
      loadSetting('autoSaveEnabled'),
      loadSetting('editorFontSize')
    ]).then(function(results) {
      var groqToken = results[0] || '';
      var groqModel = results[1] || 'llama-3.3-70b-versatile';
      var groqMaxTokens = results[2] || 1500;
      var aiProvider = results[3] || 'groq';
      var ollamaUrl = results[4] || 'http://localhost:11434';
      var ollamaModel = results[5] || 'llama3.2';
      var settingAutoSave = results[6];
      var settingEditorFontSize = parseInt(results[7], 10);
      if (settingAutoSave === null || settingAutoSave === undefined) {
        settingAutoSave = true;
      }
      if (isNaN(settingEditorFontSize)) settingEditorFontSize = editorFontSize;

        // Function to fetch Ollama models
        function fetchOllamaModels(url) {
          console.log('[Ollama] Fetching models from:', url);
          fetch(url.replace(/\/$/, '') + '/api/tags')
          .then(function(res) {
            console.log('[Ollama] Response status:', res.status);
            if (!res.ok) throw new Error('Failed to connect to Ollama: ' + res.status);
            return res.json();
          })
          .then(function(data) {
            console.log('[Ollama] Models received:', data);
            var models = data.models || [];
            if (models.length > 0) {
              var modelSelect = document.getElementById('elcode-ollama-model-select');
              console.log('[Ollama] Model select element:', modelSelect);
              if (modelSelect) {
                // Clear existing options
                modelSelect.innerHTML = '';
                // Add models to dropdown
                models.forEach(function(m) {
                  var option = document.createElement('option');
                  option.value = m.name;
                  option.textContent = m.name + (m.details && m.details.parameter_size ? ' (' + m.details.parameter_size + ')' : '');
                  if (m.name === ollamaModel || m.name.startsWith(ollamaModel.split(':')[0])) option.selected = true;
                  modelSelect.appendChild(option);
                });
                console.log('[Ollama] Populated', models.length, 'models');
              }
            } else {
              console.log('[Ollama] No models found');
            }
          })
          .catch(function(err) {
            console.error('[Ollama] Error fetching models:', err.message);
          });
        }

        // Default models as fallback
        var defaultModels = [
          { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (Versatile)' },
          { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (Instant)' },
          { value: 'llama-3.2-90b-vision-preview', label: 'Llama 3.2 90B Vision Preview' },
          { value: 'llama-3.2-11b-vision-preview', label: 'Llama 3.2 11B Vision Preview' },
          { value: 'llama-guard-3-8b', label: 'Llama Guard 3 8B' },
          { value: 'llama3-70b-8192', label: 'Llama 3 70B (8192)' },
          { value: 'llama3-8b-8192', label: 'Llama 3 8B (8192)' },
          { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B (32768)' }
        ];

        function buildSettingsUI(modelsList) {
          var modelOptions = modelsList.map(function(m) {
            return el('option').attr('value', m.value).text(m.label);
          });

          var overlay = el('div').css({
            position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
            background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: '99999', fontFamily: 'sans-serif'
          });
          var box = el('div').css({
            background: '#2d2d2d', borderRadius: '8px', padding: '24px', minWidth: '360px',
            maxWidth: '480px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)'
          }).child([
            el('div').css({ fontSize: '16px', fontWeight: 'bold', color: '#eee', marginBottom: '16px' }).text('Settings'),
            el('div').css({ marginBottom: '16px' }).child([
              el('label').text('AI Provider').css({
                display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
              }),
              el('select').id('elcode-ai-provider-select').css({
                width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                boxSizing: 'border-box', cursor: 'pointer'
              }).child([
                el('option').attr('value', 'groq').text('Groq Cloud API'),
                el('option').attr('value', 'ollama').text('Ollama (Local)')
              ])
            ]),
            el('div').css({ marginBottom: '16px' }).child([
              el('label').css({
                display: 'flex', alignItems: 'center', gap: '8px', color: '#ddd', fontSize: '13px', cursor: 'pointer'
              }).child([
                el('input').attr('type', 'checkbox').id('elcode-autosave-checkbox').css({
                  width: '14px', height: '14px', cursor: 'pointer'
                }),
                el('span').text('Enable Auto Save')
              ]),
              el('div').css({ fontSize: '11px', color: '#777', marginTop: '6px', marginLeft: '22px' }).text('Auto save file after typing delay.')
            ]),
            el('div').css({ marginBottom: '16px' }).child([
              el('label').text('Editor Font Size').css({
                display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
              }),
              el('input').id('elcode-editor-fontsize-input').attr('type', 'number').attr('min', '10').attr('max', '32').attr('step', '1').attr('value', settingEditorFontSize).css({
                width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                boxSizing: 'border-box', fontFamily: 'monospace'
              }),
              el('div').css({ fontSize: '11px', color: '#777', marginTop: '6px' }).text('Range: 10 - 32 px')
            ]),
            el('div').id('elcode-groq-settings').css({ display: aiProvider === 'groq' ? 'block' : 'none' }).child([
              el('div').css({ marginBottom: '16px' }).child([
                el('label').text('Groq API Token').css({
                  display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
                }),
                el('input').attr('type', 'password').attr('placeholder', 'gsk_xxxx...').attr('value', groqToken).id('elcode-groq-token-input').css({
                  width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                  fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                  fontFamily: 'monospace', boxSizing: 'border-box'
                })
              ]),
              el('div').css({ marginBottom: '16px' }).child([
                el('label').text('AI Model').css({
                  display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
                }),
                el('select').id('elcode-groq-model-select').css({
                  width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                  fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                  boxSizing: 'border-box', cursor: 'pointer'
                }).child(modelOptions)
              ]),
              el('div').css({ marginBottom: '16px' }).child([
                el('label').text('Max Response Tokens').css({
                  display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
                }),
                el('input').attr('type', 'number').attr('min', '500').attr('max', '4096').attr('step', '100').attr('value', groqMaxTokens).id('elcode-groq-tokens-input').css({
                  width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                  fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                  boxSizing: 'border-box', fontFamily: 'monospace'
                })
              ]),
              el('div').css({ fontSize: '11px', color: '#666', marginBottom: '16px', lineHeight: '1.5' }).html(
                'Get your API token from <a href="https://console.groq.com/keys" target="_blank" style="color: #6cf;">console.groq.com/keys</a>. ' +
                'Max tokens controls AI response length (500-4096). Lower values save tokens and avoid rate limits.'
              )
            ]),
            el('div').id('elcode-ollama-settings').css({ display: aiProvider === 'ollama' ? 'block' : 'none' }).child([
              el('div').css({ marginBottom: '16px' }).child([
                el('label').text('Ollama Server URL').css({
                  display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
                }),
                el('input').attr('type', 'text').attr('placeholder', 'http://localhost:11434').attr('value', ollamaUrl).id('elcode-ollama-url-input').css({
                  width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                  fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                  fontFamily: 'monospace', boxSizing: 'border-box'
                })
              ]),
              el('div').css({ marginBottom: '16px' }).child([
                el('label').text('Ollama Model').css({
                  display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px'
                }),
                el('div').css({ display: 'flex', gap: '8px' }).child([
                  el('select').id('elcode-ollama-model-select').css({
                    flex: '1', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
                    fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none',
                    boxSizing: 'border-box', cursor: 'pointer'
                  }).child([
                    el('option').attr('value', ollamaModel).text(ollamaModel + ' (loading...)')
                  ]),
                  el('button').text('↻').css({
                    padding: '8px 12px', background: '#5a5', color: '#fff', border: 'none',
                    borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold'
                  }).hover(
                    function() { this.style.background = '#6b6'; },
                    function() { this.style.background = '#5a5'; }
                  ).click(function() {
                    var url = document.getElementById('elcode-ollama-url-input').value.trim();
                    fetchOllamaModels(url);
                  }).attr('title', 'Refresh models list')
                ])
              ]),
              el('div').css({ fontSize: '11px', color: '#666', marginBottom: '16px', lineHeight: '1.5' }).html(
                'Run Ollama locally: <code style="background:#444;padding:2px 4px;border-radius:3px;">ollama pull llama3.2</code>. ' +
                'Models will be auto-detected from Ollama server. No API key required for local inference.'
              )
            ]),
            el('div').css({ display: 'flex', justifyContent: 'flex-end', gap: '8px' }).child([
              el('button').text('Cancel').css({
                padding: '6px 14px', background: '#555', color: '#eee', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
              }).click(function() {
                closeDialog();
              }),
              el('button').text('Save').css({
                padding: '6px 14px', background: '#4a90d9', color: '#fff', border: 'none',
                borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
              }).hover(
                function() { this.style.background = '#5aa0e9'; },
                function() { this.style.background = '#4a90d9'; }
              ).click(function() {
                var provider = document.getElementById('elcode-ai-provider-select').value;
                var token = document.getElementById('elcode-groq-token-input').value.trim();
                var model = document.getElementById('elcode-groq-model-select').value;
                var maxTokens = parseInt(document.getElementById('elcode-groq-tokens-input').value) || 1500;
                var ollamaUrl = document.getElementById('elcode-ollama-url-input').value.trim() || 'http://localhost:11434';
                var ollamaModelSelect = document.getElementById('elcode-ollama-model-select');
                var ollamaModel = ollamaModelSelect ? ollamaModelSelect.value : 'llama3.2';
                var autosaveEl = document.getElementById('elcode-autosave-checkbox');
                var newAutoSaveEnabled = autosaveEl ? autosaveEl.checked : true;
                var fontSizeEl = document.getElementById('elcode-editor-fontsize-input');
                var newEditorFontSize = parseInt(fontSizeEl ? fontSizeEl.value : editorFontSize, 10);
                
                // Validate max tokens range
                if (maxTokens < 500) maxTokens = 500;
                if (maxTokens > 4096) maxTokens = 4096;
                if (isNaN(newEditorFontSize)) newEditorFontSize = editorFontSize;
                if (newEditorFontSize < 10) newEditorFontSize = 10;
                if (newEditorFontSize > 32) newEditorFontSize = 32;
                
                var promises = [];
                promises.push(saveSetting('aiProvider', provider));
                promises.push(saveSetting('autoSaveEnabled', newAutoSaveEnabled));
                promises.push(saveSetting('editorFontSize', newEditorFontSize));
                
                if (provider === 'groq') {
                  if (token) {
                    promises.push(saveSetting('groqToken', token));
                  } else {
                    promises.push(deleteSetting('groqToken'));
                  }
                  promises.push(saveSetting('groqModel', model));
                  promises.push(saveSetting('groqMaxTokens', maxTokens));
                } else {
                  promises.push(saveSetting('ollamaUrl', ollamaUrl));
                  promises.push(saveSetting('ollamaModel', ollamaModel));
                }
                
                Promise.all(promises).then(function() {
                  autoSaveEnabled = newAutoSaveEnabled;
                  editorFontSize = newEditorFontSize;
                  if (editor) editor.setFontSize(editorFontSize);
                  if (provider === 'groq') {
                    appendLog('info', ['Settings saved. Provider: Groq, Model: ' + model + ', Max tokens: ' + maxTokens + ', Font: ' + editorFontSize + 'px']);
                  } else {
                    appendLog('info', ['Settings saved. Provider: Ollama, URL: ' + ollamaUrl + ', Model: ' + ollamaModel + ', Font: ' + editorFontSize + 'px']);
                  }
                });
                closeDialog();
              })
            ])
          ]);
          overlay.child([box]);
          overlayNode = overlay.get();
          document.body.appendChild(overlayNode);

          // Set selected model
          document.getElementById('elcode-groq-model-select').value = groqModel;
          
          // Set max tokens value
          document.getElementById('elcode-groq-tokens-input').value = groqMaxTokens;
          
          // Set AI provider
          document.getElementById('elcode-ai-provider-select').value = aiProvider;
          var autoSaveCheckboxEl = document.getElementById('elcode-autosave-checkbox');
          if (autoSaveCheckboxEl) {
            autoSaveCheckboxEl.checked = !!settingAutoSave;
          }
          
          // Toggle settings visibility based on provider
          document.getElementById('elcode-ai-provider-select').addEventListener('change', function() {
            var provider = this.value;
            document.getElementById('elcode-groq-settings').style.display = provider === 'groq' ? 'block' : 'none';
            document.getElementById('elcode-ollama-settings').style.display = provider === 'ollama' ? 'block' : 'none';
            
            // Fetch Ollama models when switching to Ollama
            if (provider === 'ollama') {
              var url = document.getElementById('elcode-ollama-url-input').value.trim() || 'http://localhost:11434';
              fetchOllamaModels(url);
            }
          });
          
          // Fetch Ollama models when URL changes
          document.getElementById('elcode-ollama-url-input').addEventListener('change', function() {
            fetchOllamaModels(this.value.trim());
          });
          
          // Fetch Ollama models if provider is ollama on load
          if (aiProvider === 'ollama' && ollamaUrl) {
            fetchOllamaModels(ollamaUrl);
          }
        }

        // Try to fetch models from Groq API if token exists
        if (groqToken) {
          fetch('https://api.groq.com/openai/v1/models', {
            headers: {
              'Authorization': 'Bearer ' + groqToken
            }
          })
          .then(function(res) {
            if (!res.ok) throw new Error('Failed to fetch models');
            return res.json();
          })
          .then(function(data) {
            // Filter only active models and sort by name
            var activeModels = data.data
              .filter(function(m) { return m.active !== false; })
              .sort(function(a, b) { return a.id.localeCompare(b.id); })
              .map(function(m) {
                return {
                  value: m.id,
                  label: m.id + (m.context_window ? ' (' + m.context_window + ' ctx)' : '')
                };
              });
            
            if (activeModels.length > 0) {
              buildSettingsUI(activeModels);
            } else {
              buildSettingsUI(defaultModels);
            }
          })
          .catch(function(err) {
            // Fallback to default models if API fails
            buildSettingsUI(defaultModels);
          });
        } else {
          // No token, show default models
          buildSettingsUI(defaultModels);
        }
  });
  }

  // ===== Chat Dialog (AI Agent) =====
  function showChatDialog() {
    var overlayNode;
    var messages = [];
    var isLoading = false;
    var chatMessagesEl;
    var inputEl;
    var eljsCheatsheet = '';

    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }

    function addMessage(role, content, editInfo) {
      messages.push({ role: role, content: content, editInfo: editInfo || null });
      renderMessages();
    }

    function renderMessages() {
      if (!chatMessagesEl) return;
      el(chatMessagesEl).clear(true);
      messages.forEach(function(msg) {
        var isUser = msg.role === 'user';
        var msgDiv = el('div').css({
          marginBottom: '12px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: isUser ? 'flex-end' : 'flex-start'
        });

        var bubble = el('div').css({
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: '12px',
          background: isUser ? '#4a90d9' : '#3a3a3a',
          color: '#eee',
          fontSize: '13px',
          lineHeight: '1.5',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word'
        }).text(msg.content);

        msgDiv.child([bubble]);

        // Add action buttons if AI response has edit info
        if (msg.role === 'assistant' && msg.editInfo) {
          var info = msg.editInfo;
          var btnDiv = el('div').css({
            marginTop: '6px',
            display: 'flex',
            gap: '8px'
          });

          // Apply button
          var applyBtn = el('button').text('✓ Apply: ' + info.typeLabel).css({
            padding: '6px 12px',
            background: '#5a5',
            color: '#fff',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: 'bold'
          }).hover(
            function() { this.style.background = '#6b6'; },
            function() { this.style.background = '#5a5'; }
          ).click(function() {
            applyCodeToEditor(msg.editInfo);
          });
          btnDiv.child([applyBtn]);

          msgDiv.child([btnDiv]);
        }

        el(chatMessagesEl).child([msgDiv]).get();
      });
      chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    }

    function sanitizeAiCodeBlock(code) {
      if (!code) return '';
      return code
        .split('\n')
        .map(function(line) {
          // Strip accidental line-number prefixes like "12: code..."
          return line.replace(/^\s*\d+\s*:\s?/, '');
        })
        .join('\n');
    }

    function parseCodeBlock(text) {
      // Match: ```[js|javascript] [type:startLine:endLine]
      var regex = /```(?:js|javascript)?\s*(replace-full|replace-lines|insert-at)(?::(\d+))?(?::(\d+))?\n([\s\S]*?)```/;
      var match = text.match(regex);
      if (!match) return null;

      var type = match[1];
      var startLine = match[2] ? parseInt(match[2]) : null;
      var endLine = match[3] ? parseInt(match[3]) : null;
      var code = sanitizeAiCodeBlock(match[4]);

      var typeLabel = '';
      if (type === 'replace-full') typeLabel = 'Replace All';
      else if (type === 'replace-lines') typeLabel = 'Replace Lines ' + startLine + '-' + endLine;
      else if (type === 'insert-at') typeLabel = 'Insert at Line ' + startLine;

      return {
        type: type,
        startLine: startLine,
        endLine: endLine,
        code: code,
        typeLabel: typeLabel
      };
    }

    function hasBalancedBrackets(code) {
      var stack = [];
      var pairs = { ')': '(', ']': '[', '}': '{' };
      var opening = { '(': true, '[': true, '{': true };
      var inSingle = false, inDouble = false, inTemplate = false;
      var inLineComment = false, inBlockComment = false;
      var escaped = false;

      for (var i = 0; i < code.length; i++) {
        var ch = code[i];
        var next = code[i + 1];

        if (inLineComment) {
          if (ch === '\n') inLineComment = false;
          continue;
        }
        if (inBlockComment) {
          if (ch === '*' && next === '/') { inBlockComment = false; i++; }
          continue;
        }
        if (!inSingle && !inDouble && !inTemplate) {
          if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
          if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
        }

        if (inSingle || inDouble || inTemplate) {
          if (escaped) { escaped = false; continue; }
          if (ch === '\\') { escaped = true; continue; }
          if (inSingle && ch === '\'') inSingle = false;
          else if (inDouble && ch === '"') inDouble = false;
          else if (inTemplate && ch === '`') inTemplate = false;
          continue;
        }

        if (ch === '\'') { inSingle = true; continue; }
        if (ch === '"') { inDouble = true; continue; }
        if (ch === '`') { inTemplate = true; continue; }

        if (opening[ch]) {
          stack.push(ch);
          continue;
        }
        if (pairs[ch]) {
          if (stack.length === 0 || stack[stack.length - 1] !== pairs[ch]) return false;
          stack.pop();
        }
      }

      return !inSingle && !inDouble && !inTemplate && !inBlockComment && stack.length === 0;
    }

    function applyCodeToEditor(editInfo) {
      if (!editor || !editInfo) return;

      var currentCode = editor.getValue();
      var lines = currentCode.split('\n');
      var newCode;

      if (editInfo.type === 'replace-full') {
        // Replace entire file
        newCode = editInfo.code;
      } else if (editInfo.type === 'replace-lines') {
        // Replace specific lines (1-indexed)
        var start = editInfo.startLine - 1;
        var end = editInfo.endLine - 1;
        if (start < 0 || end >= lines.length || start > end) {
          appendLog('error', ['Invalid line range: ' + editInfo.startLine + '-' + editInfo.endLine]);
          return;
        }
        // Build new code: before + replacement + after
        var beforeLines = lines.slice(0, start);
        var afterLines = lines.slice(end + 1);
        var codeLines = editInfo.code.split('\n');
        var allLines = beforeLines.concat(codeLines, afterLines);
        newCode = allLines.join('\n');
        
        // Debug: log what we're replacing
        console.log('[AI Replace] Lines ' + editInfo.startLine + '-' + editInfo.endLine);
        console.log('[AI Replace] Before lines:', beforeLines.length);
        console.log('[AI Replace] After lines:', afterLines.length);
        console.log('[AI Replace] New code lines:', codeLines.length);
        console.log('[AI Replace] Total new lines:', allLines.length);
      } else if (editInfo.type === 'insert-at') {
        // Insert at specific line (1-indexed)
        var pos = editInfo.startLine - 1;
        if (pos < 0 || pos > lines.length) {
          appendLog('error', ['Invalid line number: ' + editInfo.startLine]);
          return;
        }
        // Build new code: before + insertion + after
        var beforeLines = lines.slice(0, pos);
        var afterLines = lines.slice(pos);
        var codeLines = editInfo.code.split('\n');
        var allLines = beforeLines.concat(codeLines, afterLines);
        newCode = allLines.join('\n');
        
        console.log('[AI Insert] At line ' + editInfo.startLine);
      }

      if (newCode !== undefined) {
        if (!hasBalancedBrackets(newCode)) {
          appendLog('error', ['AI output rejected: unbalanced brackets or unfinished string/comment detected.']);
          return;
        }
        // Replace via document range so change stays undoable
        var Range = ace.require('ace/range').Range;
        var doc = editor.session.getDocument();
        var lastRow = Math.max(0, doc.getLength() - 1);
        var lastCol = (doc.getLine(lastRow) || '').length;
        doc.replace(new Range(0, 0, lastRow, lastCol), newCode);
        
        // Move cursor to beginning to confirm replace worked
        editor.moveCursorTo(0, 0);
        
        if (currentFile) {
          saveFile(currentFile, editor.getValue()).then(function() {
            runPreview();
            appendLog('info', ['AI agent applied: ' + editInfo.typeLabel]);
          });
        }
      }
    }

    function sendMessage() {
      if (isLoading) return;
      var text = inputEl.value.trim();
      if (!text) return;

      addMessage('user', text);
      inputEl.value = '';

      // Check for AI provider settings
      Promise.all([
        loadSetting('groqToken'),
        loadSetting('groqModel'),
        loadSetting('groqMaxTokens'),
        loadSetting('aiProvider'),
        loadSetting('ollamaUrl'),
        loadSetting('ollamaModel')
      ]).then(function(results) {
        var token = results[0];
        var groqModel = results[1] || 'llama-3.3-70b-versatile';
        var maxTokens = results[2] || 1500;
        var aiProvider = results[3] || 'groq';
        var ollamaUrl = results[4] || 'http://localhost:11434';
        var ollamaModel = results[5] || 'llama3.2';
        
        // Determine which model and endpoint to use
        var model = aiProvider === 'ollama' ? ollamaModel : groqModel;
        var ollamaBaseUrl = ollamaUrl.replace(/\/$/, '');
        var apiUrl = aiProvider === 'ollama'
          ? ollamaBaseUrl + '/v1/chat/completions'
          : 'https://api.groq.com/openai/v1/chat/completions';
        var headers = {
          'Content-Type': 'application/json'
        };
        if (aiProvider === 'groq') {
          headers['Authorization'] = 'Bearer ' + token;
        }
      
        if (aiProvider === 'groq' && !token) {
          addMessage('assistant', '⚠ Please set your Groq API token in Settings first.');
          return;
        }

        isLoading = true;
        addMessage('assistant', 'Thinking...');
        function removeThinkingMessage() {
          var last = messages[messages.length - 1];
          if (last && last.role === 'assistant' && last.content === 'Thinking...') {
            messages.pop();
            renderMessages();
          }
        }

        // Build messages with system prompt
        var systemPrompt = 'You are an AI coding assistant for el.js, a lightweight DOM manipulation library. ' +
          'You can READ and WRITE code in the editor with precise control.\n\n' +
          '## Code Output Format\n' +
          'When providing code, use ONE of these formats:\n\n' +
          '1. **Replace entire file:**\n' +
          '```replace-full\n' +
          '// complete code here\n' +
          '```\n\n' +
          '2. **Replace specific lines (1-indexed):**\n' +
          '```replace-lines:5:10\n' +
          '// new code for lines 5-10\n' +
          '```\n\n' +
          '3. **Insert at specific line (1-indexed):**\n' +
          '```insert-at:15\n' +
          '// code to insert at line 15\n' +
          '```\n\n' +
          '## el.js Cheatsheet Reference (MUST FOLLOW THESE RULES)\n\n' +
          '### What it is\n' +
          '- `el.js` is a lightweight DOM wrapper library.\n' +
          '- `el(tag)` returns a chainable wrapper object.\n' +
          '- Wrapper object fields:\n' +
          '  - `.el` = actual DOM node\n' +
          '  - `.ch` = queued child elements\n' +
          '- Use it to build HTML/SVG elements and attach behavior.\n\n' +
          '### Core pattern\n' +
          '```js\n' +
          'const box = el(\'div\')\n' +
          '  .css({ padding: \'10px\', background: \'#fff\' })\n' +
          '  .text(\'Hello\');\n\n' +
          'const root = el(\'div\')\n' +
          '  .child(box)\n' +
          '  .get();\n\n' +
          'document.body.appendChild(root);\n' +
          '```\n\n' +
          '### Using Tailwind CSS with el.js\n' +
          '- Tailwind CSS is ALREADY LOADED in the preview via CDN.\n' +
          '- Use `.class(\'tailwind-classes\')` to apply Tailwind utility classes.\n' +
          '- You can mix Tailwind classes with `.css()` for custom styles.\n\n' +
          'Example with Tailwind:\n' +
          '```js\n' +
          'const card = el(\'div\')\n' +
          '  .class(\'p-6 bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow\')\n' +
          '  .child([\n' +
          '    el(\'h2\')\n' +
          '      .class(\'text-2xl font-bold text-gray-800 mb-2\')\n' +
          '      .text(\'Card Title\'),\n' +
          '    el(\'p\')\n' +
          '      .class(\'text-gray-600 mb-4\')\n' +
          '      .text(\'Card description text here\'),\n' +
          '    el(\'button\')\n' +
          '      .class(\'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors\')\n' +
          '      .text(\'Click Me\')\n' +
          '      .click(function() {\n' +
          '        alert(\'Button clicked!\');\n' +
          '      })\n' +
          '  ]);\n\n' +
          'app.appendChild(card.get());\n' +
          '```\n\n' +
          'Tailwind Tips:\n' +
          '- Use responsive prefixes: `sm:`, `md:`, `lg:`, `xl:` (e.g., `md:flex lg:grid`)\n' +
          '- Use state variants: `hover:`, `focus:`, `active:` (e.g., `hover:bg-blue-700`)\n' +
          '- Common patterns:\n' +
          '  - Flex layout: `flex items-center justify-between gap-4`\n' +
          '  - Grid layout: `grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6`\n' +
          '  - Spacing: `p-4` (padding), `m-4` (margin), `space-x-2` (gap between children)\n' +
          '  - Typography: `text-xl`, `font-bold`, `text-center`, `text-gray-700`\n' +
          '  - Colors: `bg-blue-600`, `text-white`, `border-gray-300`\n' +
          '  - Sizing: `w-full`, `h-64`, `max-w-md`, `min-h-screen`\n\n' +

          '### Important methods\n' +
          '- `el(\'div\')` — create a new element\n' +
          '- `el(node)` — wrap an existing DOM node\n' +
          '- `.text(\'text\')` — set element text\n' +
          '- `.textContent(\'text\')` — set raw text content\n' +
          '- `.html(\'<b>hi</b>\')` — set inner HTML\n' +
          '- `.css({ prop: value })` — apply styles\n' +
          '- `.style({...})` — alias for `.css()`\n' +
          '- `.attr(name, value)` — set an attribute\n' +
          '- `.attrRemove(name)` — remove an attribute\n' +
          '- `.data(name, value)` — set a `data-*` attribute\n' +
          '- `.aria(name, value)` — set an `aria-*` attribute\n' +
          '- `.class(\'a b\')` — add classes\n' +
          '- `.clearClass()` — remove all classes\n' +
          '- `.removeClass(\'a\')`\n' +
          '- `.toggleClass(\'a\')`\n' +
          '- `.hasClass(\'a\')`\n' +
          '- `.on(event, fn)` — attach a generic event listener\n' +
          '- `.click(fn)` — attach a click handler\n' +
          '- `.hover(enterFn, leaveFn)` — attach mouse enter/leave callbacks\n' +
          '- `.focus(fn)` / `.blur(fn)` — focus/blur event handlers\n' +
          '- `.change(fn)` — attach a change listener\n' +
          '- `.keydown(fn)`, `.keyup(fn)`, `.keypress(fn)`, `.input(fn)` — keyboard/input events\n' +
          '- `.paste(fn)` — paste event\n' +
          '- `.mouseover(fn)`, `.mouseout(fn)`, `.mousedown(fn)`, `.mouseup(fn)` — mouse events\n' +
          '- `.touchstart(fn)`, `.touchend(fn)`, `.touchmove(fn)` — touch events\n' +
          '- `.dblclick(fn)` — double click\n' +
          '- `.contextmenu(fn)` — right-click menu\n' +
          '- `.wheel(fn)` — wheel event\n' +
          '- `.scroll(fn)` — scroll event\n' +
          '- `.resize(fn)` — window resize helper\n' +
          '- `.load(fn)` — run callback after initial load\n' +
          '- `.submit(fn)` — form submit helper\n' +
          '- `.find(selector)` — query inside the wrapper\n' +
          '- `.findAll(selector)` — query all descendants\n' +
          '- `.closest(selector)` — ancestor lookup\n' +
          '- `.next()`, `.prev()` — sibling traversal\n' +
          '- `.first()`, `.last()`, `.eq(index)` — child access\n' +
          '- `.getParent()`, `.getChildren()`, `.getSiblings()` — DOM traversal helpers\n' +
          '- `.getIndex()` — index among siblings\n' +
          '- `.getWidth()`, `.getHeight()` — element dimensions\n\n' +
          '### Child handling\n' +
          '- `.child(elObject)` accepts:\n' +
          '  - wrapper objects created by `el(..)`\n' +
          '  - native `HTMLElement`\n' +
          '  - arrays of wrappers/elements\n' +
          '  - `Promise` values that resolve to wrappers/elements\n' +
          '- Child nodes are queued in `.ch`.\n' +
          '- Use `.get()` to attach queued children to `.el`.\n\n' +
          '### `.get()` behavior\n' +
          '- `.get()` appends all queued children in `.ch` to `.el`.\n' +
          '- Returns the actual DOM node.\n' +
          '- Call `.get()` on the root wrapper before appending it into the page.\n' +
          '- If a wrapper is already attached to DOM and you later add children with `.child()`, call `.get()` again to render the new children.\n\n' +
          '### `.link()` helper - Store DOM references\n' +
          '- `.link(obj, name)` stores real DOM node in `obj[name]`\n' +
          '- Chain methods after `.link()` normally\n' +
          '- Access later: `el(ref.el)` to use el.js methods\n' +
          '- Example: `const ref = {}; el(\'input\').link(ref, \'el\'); console.log(ref.el);`\n' +
          '- For updates: `el(cardRef.card).child([...]).get()` - must call `.get()` again\n' +
          '- ❌ WRONG: `const card = el(\'div\').link(card, \'el\')` - link to pre-created object\n' +
          '- ❌ WRONG: `cardRef.card.text(\'new\')` - wrap with el() first\n\n' +
          '### Shortcut style methods\n' +
          '- `.width(value)`, `.height(value)`\n' +
          '- `.margin(value)`, `.padding(value)`\n' +
          '- `.border(value)`, `.borderTop(value)`, `.borderBottom(value)`, `.borderLeft(value)`, `.borderRight(value)`\n' +
          '- `.radius(value)` — border-radius\n' +
          '- `.background(value)`, `.backgroundImage(url)`, `.backgroundSize(value)`, `.backgroundRepeat(value)`, `.backgroundPosition(value)`\n' +
          '- `.color(value)`\n' +
          '- `.font(value)`, `.fontWeight(value)`\n' +
          '- `.align(value)`, `.size(value)`\n' +
          '- `.display(value)`, `.flex(direction)`, `.grid(columns)`\n' +
          '- `.justify(value)`, `.items(value)`, `.self(value)`, `.gap(value)`, `.wrap(value)`\n' +
          '- `.cursor(value)`, `.opacity(value)`, `.zIndex(value)`, `.overflow(value)`, `.transform(value)`, `.transition(value)`\n\n' +
          '### Other DOM helpers\n' +
          '- `.prepend(child)` — insert before existing content\n' +
          '- `.remove()` — remove element from DOM\n' +
          '- `.off(event, fn)` — remove event listener\n' +
          '- `.selectAll()` — select text inside input\n' +
          '- `.scrollTo(x, y)` — scroll element\n' +
          '- `.scrollIntoView(options)` — bring element into view\n' +
          '- `.styleRemove(name)` — remove inline style property\n' +
          '- `.cssText(text)` — set full inline CSS text\n\n' +
          '### Value and property getters\n' +
          '- `.getValue()` / `.getVal()` — read input value\n' +
          '- `.getText()` — read inner text\n' +
          '- `.getHtml()` — read innerHTML\n' +
          '- `.getAttr(name)` — read attribute\n' +
          '- `.getData(name)` — read data-* value\n' +
          '- `.getStyle(name)` — read computed style\n\n' +
          '### Useful helpers\n' +
          '- `.clear()` — clears inner HTML\n' +
          '- `.empty()` — clears content and resets child queue\n' +
          '- `.replace(child)` — replace wrapper content\n' +
          '- `.show()`, `.hide()`, `.toggle()`\n' +
          '- `.disabled(bool)`\n' +
          '- `.required(bool)`\n' +
          '- `.checked(bool)`\n\n' +
          '### Best practices\n' +
          '- Build children first.\n' +
          '- Call `.get()` once at the end.\n' +
          '- If the wrapper is already mounted and you add children later, call `.get()` again.\n' +
          '- Avoid mixing raw DOM and wrapper logic without using `.link()`.\n' +
          '- Use `.child([a, b])` for grouped children.\n' +
          '- Keep event callbacks using native `this`.\n\n' +
          '### Summary\n' +
          '`el.js` is not a virtual DOM library. It is a small builder around real DOM nodes with a queued child tree and fluent API. `.child()` collects children, `.get()` materializes them, and `.link()` gives outside access to the actual DOM element.\n\n' +
          '## Response Guidelines (CRITICAL - MAX 200 WORDS)\n' +
          '- EXTREMELY concise - max 200 words total\n' +
          '- Do NOT include inline line-number prefixes inside code block (no "12: ...")\n' +
          '- Add at most one short explanation sentence before code\n' +
          '- Use replace-lines not replace-full\n\n' +
          '## IMPORTANT: ALWAYS READ CURRENT CODE FIRST\n' +
          '- Before responding to ANY user request, READ the current code shown below\n' +
          '- The code below is the LIVE, UP-TO-DATE code from the editor\n' +
          '- Analyze the current code structure before suggesting modifications\n' +
          '- Identify existing variables, functions, and el.js chains\n' +
          '- Understand the current code flow before making changes\n' +
          '- Your modifications must work WITH the existing code, not against it\n\n' +
          '## Current Context\n' +
          'File: ' + (currentFile || 'none') + '\n' +
          'Total lines: ' + (editor ? editor.session.getLength() : 0) + '\n' +
          'Last modified: ' + new Date().toLocaleTimeString() + '\n\n' +
          '## CURRENT CODE WITH LINE NUMBERS (READ CAREFULLY)\n' +
          '- The numbers on the left are LINE NUMBERS\n' +
          '- Use these EXACT line numbers when using replace-lines\n' +
          '- Count from 1 (first line = 1)\n\n' +
          '```js\n' + (editor ? editor.getValue().split('\n').map(function(line, i) { return (i + 1).toString().padStart(4, ' ') + ': ' + line; }).join('\n') : '') + '\n```\n\n' +
          '## CRITICAL RULES FOR CODE MODIFICATION\n' +
          '### Step-by-Step Process Before Using replace-lines:\n' +
          '1. READ the ENTIRE code from top to bottom\n' +
          '2. IDENTIFY the exact lines you need to modify (count line numbers carefully)\n' +
          '3. EXPAND the selection to include COMPLETE code blocks:\n' +
          '   - If modifying an element in `.child([...])`, include from the element START to END\n' +
          '   - Include the closing `)` or `]` of the parent if needed\n' +
          '   - Do NOT cut through the middle of any el() chain\n' +
          '4. VERIFY line numbers match the actual code shown\n' +
          '5. COUNT opening and closing brackets: `{}`, `[]`, `()`\n' +
          '6. ENSURE all brackets are properly closed\n' +
          '7. CHECK indentation matches the surrounding code\n\n' +
          '### How to Count Lines Correctly:\n' +
          '- Line 1 is the FIRST line of the code shown\n' +
          '- Count EVERY line including blank lines\n' +
          '- Count indentation lines as separate lines\n' +
          '- Double-check by reading the code at those line numbers\n\n' +
          '### Example of Correct Line Selection:\n' +
          'Given this code (line numbers shown):\n' +
          '```\n' +
          '1:  el(\'div\').child([\n' +
          '2:    el(\'h2\').text(\'Title\'),\n' +
          '3:    el(\'p\').text(\'Content\'),\n' +
          '4:    el(\'button\')\n' +
          '5:      .text(\'Click\')\n' +
          '6:      .click(function() {\n' +
          '7:        alert(\'Hi\');\n' +
          '8:      })\n' +
          '9:  ])\n' +
          '```\n\n' +
          '✅ CORRECT: To modify button, use `replace-lines:4:8` (complete button chain)\n' +
          '✅ CORRECT: To modify all children, use `replace-lines:1:9` (entire structure)\n' +
          '❌ WRONG: Using `replace-lines:4:5` (cuts through button chain, leaves .click() orphaned)\n' +
          '❌ WRONG: Using `replace-lines:6:8` (cuts from middle of chain, breaks .text())\n\n' +
          '### Syntax Rules:\n' +
          '- Every `el()` chain must be complete: `el(\'div\').css({}).child([]).get()`\n' +
          '- Arrays in `.child([...])` must have matching `[]`\n' +
          '- Objects in `.css({...})` must have matching `{}`\n' +
          '- Function callbacks must have closing `}` and `)`\n' +
          '- NEVER duplicate existing code - REPLACE, don\'t ADD\n' +
          '- NEVER remove unrelated code - only modify what user asked for\n' +
          '- When replacing part of a `.child([...])` array, include ALL siblings that should remain\n' +
          '- Preserve the ORIGINAL structure unless explicitly asked to change it\n\n' +
          '### Common Errors to Avoid:\n' +
          '❌ WRONG: Replacing lines that cut through the middle of a `.child([...])` array\n' +
          '✅ CORRECT: Include the ENTIRE `.child([...])` block from `[` to `]`\n\n' +
          '❌ WRONG: Replacing lines that cut through a `.click(function() { ... })` callback\n' +
          '✅ CORRECT: Include the ENTIRE callback from `function() {` to `})`\n\n' +
          '❌ WRONG: Replacing `.css({` without including the closing `})`\n' +
          '✅ CORRECT: Include the complete `.css({...})` block\n\n' +
          '❌ WRONG: Adding new elements WITHOUT removing the old ones (creating duplicates)\n' +
          '✅ CORRECT: Replace old elements completely, don\'t leave duplicates\n\n' +
          '❌ WRONG: Removing sibling elements that were not mentioned\n' +
          '✅ CORRECT: Keep all unrelated code exactly as it was\n\n' +
          '### Example of WRONG replacement:\n' +
          'Original:\n' +
          '```js\n' +
          '.child([\n' +
          '  el(\'input\').type(\'text\'),\n' +
          '  el(\'textarea\').placeholder(\'Message\'),\n' +
          '  el(\'button\').text(\'Save\')\n' +
          '])\n' +
          '```\n\n' +
          'User request: "Add placeholder to input"\n\n' +
          '❌ WRONG result (duplicates input & textarea, removes button):\n' +
          '```js\n' +
          '.child([\n' +
          '  el(\'input\').type(\'text\').placeholder(\'Name\'),\n' +
          '  el(\'textarea\').placeholder(\'Message\'),\n' +
          '  el(\'input\').type(\'text\').placeholder(\'Name\'),  // DUPLICATE!\n' +
          '  el(\'textarea\').placeholder(\'Message\')  // DUPLICATE!\n' +
          '  // button removed!\n' +
          '])\n' +
          '```\n\n' +
          '✅ CORRECT result (only modifies input, keeps everything else):\n' +
          '```js\n' +
          '.child([\n' +
          '  el(\'input\').type(\'text\').placeholder(\'Name\'),\n' +
          '  el(\'textarea\').placeholder(\'Message\'),\n' +
          '  el(\'button\').text(\'Save\')\n' +
          '])\n' +
          '```\n\n' +
          '### When in doubt, use replace-full:\n' +
          '- If the modification is complex or spans multiple code blocks\n' +
          '- If you are unsure about line boundaries\n' +
          '- It is SAFER to replace the full file than to break syntax\n' +
          '- ALWAYS prefer replace-full for nested .child() structures\n\n' +
          '## General Rules\n' +
          '- Use replace-full when creating new files or rewriting everything\n' +
          '- Use replace-lines to modify existing code sections\n' +
          '- Use insert-at to add new code at a specific position\n' +
          '- Keep explanation to one short sentence\n' +
          '- Line numbers are 1-indexed (first line = 1)\n' +
          '- ALWAYS use el.js syntax as described above, NEVER use vanilla DOM methods directly\n' +
          '- NEVER use document.createElement, use el() instead\n' +
          '- NEVER use element.appendChild, use .child() and .get() instead\n\n' +
          '## EL.JS CHEATSHEET\n' +
          (eljsCheatsheet || 'No cheatsheet loaded');

        var apiMessages = [{ role: 'system', content: systemPrompt }];
        messages.forEach(function(m) {
          if (m.role !== 'assistant' || !m.editInfo) {
            apiMessages.push({ role: m.role, content: m.content });
          }
        });
        
        // CRITICAL: Ensure last message is from user (Groq API requirement)
        if (apiMessages.length > 1 && apiMessages[apiMessages.length - 1].role !== 'user') {
          // Remove last assistant message if it's not followed by user message
          apiMessages.pop();
        }

        var basePayload = {
          model: model,
          messages: apiMessages,
          max_tokens: maxTokens,
          temperature: 0.7
        };

        function postJson(url, payload) {
          return fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
          }).then(function(res) {
            if (!res.ok) throw new Error('API error: ' + res.status);
            return res.json();
          });
        }

        function extractReply(data) {
          if (data && data.choices && data.choices[0] && data.choices[0].message) {
            return data.choices[0].message.content || '';
          }
          if (data && data.message && data.message.content) {
            return data.message.content;
          }
          return '';
        }

        var requestPromise;
        if (aiProvider === 'ollama') {
          requestPromise = postJson(apiUrl, basePayload).catch(function() {
            return postJson(ollamaBaseUrl + '/api/chat', {
              model: model,
              messages: apiMessages,
              stream: false
            });
          });
        } else {
          requestPromise = postJson(apiUrl, basePayload);
        }

        requestPromise
        .then(function(data) {
          removeThinkingMessage();
          var reply = extractReply(data);
          if (!reply) {
            addMessage('assistant', '❌ Empty response from AI provider.');
            return;
          }
          var editInfo = parseCodeBlock(reply);
          addMessage('assistant', reply, editInfo);
        })
        .catch(function(err) {
          removeThinkingMessage();
          addMessage('assistant', '❌ Error: ' + err.message);
        })
        .finally(function() {
          isLoading = false;
        });
      });
    }

    // Load cheatsheet
    fetch(window.location.origin + '/eljs-cheatsheet.md')
      .then(function(res) { return res.text(); })
      .then(function(text) {
        eljsCheatsheet = text;
      })
      .catch(function() {
        eljsCheatsheet = 'el.js is a DOM wrapper library. Use el(tag) to create elements, chain methods like .text(), .css(), .child(), .click(), and call .get() to get the DOM node.';
      });

    var overlay = el('div').css({
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', fontFamily: 'sans-serif'
    });

    var box = el('div').css({
      background: '#2d2d2d', borderRadius: '12px', width: '600px', height: '500px',
      display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
      overflow: 'hidden'
    }).child([
      // Header
      el('div').css({
        padding: '16px 20px',
        borderBottom: '1px solid #444',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }).child([
        el('div').css({ fontSize: '16px', fontWeight: 'bold', color: '#eee' }).text('🤖 AI Agent'),
        el('button').text('✕').css({
          background: 'transparent', border: 'none', color: '#888',
          cursor: 'pointer', fontSize: '18px', padding: '4px 8px'
        }).hover(
          function() { this.style.color = '#fff'; },
          function() { this.style.color = '#888'; }
        ).click(function() {
          closeDialog();
        })
      ]),
      // Messages area
      el('div').css({
        flex: '1', overflow: 'auto', padding: '16px 20px',
        backgroundColor: '#1e1e1e'
      }).link({}, 'chatMessages'),
      // Input area
      el('div').css({
        padding: '16px 20px',
        borderTop: '1px solid #444',
        display: 'flex',
        gap: '8px',
        backgroundColor: '#2d2d2d'
      }).child([
        el('textarea').attr('placeholder', 'Ask me to create or modify code...').attr('rows', '1').css({
          flex: '1', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
          fontSize: '13px', padding: '10px 12px', borderRadius: '6px', outline: 'none',
          resize: 'none', fontFamily: 'sans-serif', lineHeight: '1.5'
        }).on('keydown', function(e) {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }).on('input', function() {
          this.style.height = 'auto';
          this.style.height = Math.min(this.scrollHeight, 120) + 'px';
        }),
        el('button').text('Send').css({
          padding: '10px 20px', background: '#4a90d9', color: '#fff', border: 'none',
          borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: 'bold'
        }).hover(
          function() { this.style.background = '#5aa0e9'; },
          function() { this.style.background = '#4a90d9'; }
        ).click(function() {
          sendMessage();
        })
      ])
    ]);

    overlay.child([box]);
    overlayNode = overlay.get();
    document.body.appendChild(overlayNode);

    // Store references
    chatMessagesEl = overlayNode.querySelector('[style*="flex: 1"]');
    inputEl = overlayNode.querySelector('textarea');
    if (inputEl) inputEl.focus();
  }

  // ===== Snippets =====
  function registerCustomSnippets() {
    if (!aceSnippetManager || !customSnippets.length) return;
    aceSnippetManager.register(customSnippets, 'javascript');
  }

  function unregisterCustomSnippets() {
    if (!aceSnippetManager || !customSnippets.length) return;
    if (typeof aceSnippetManager.unregister === 'function') {
      aceSnippetManager.unregister(customSnippets, 'javascript');
    }
  }

  function showSnippetDialog() {
    var overlayNode;
    var editingTrigger = null;
    function closeDialog() {
      if (overlayNode && overlayNode.parentNode) overlayNode.parentNode.removeChild(overlayNode);
    }
    function resetSnippetForm() {
      editingTrigger = null;
      var nameEl = document.getElementById('elcode-snippet-name');
      var triggerEl = document.getElementById('elcode-snippet-trigger');
      var contentEl = document.getElementById('elcode-snippet-content');
      var actionEl = document.getElementById('elcode-snippet-save-btn');
      if (nameEl) nameEl.value = '';
      if (triggerEl) triggerEl.value = '';
      if (contentEl) contentEl.value = '';
      if (actionEl) actionEl.textContent = 'Tambah snippet';
    }
    function renderCustomSnippetList() {
      if (!overlayNode) return;
      var listEl = overlayNode.querySelector('#elcode-custom-snippet-list');
      if (!listEl) return;
      listEl.innerHTML = '';

      if (!customSnippets.length) {
        listEl.appendChild(
          el('div').css({ color: '#777', fontSize: '12px', padding: '12px 6px', lineHeight: '1.5' }).text('Belum ada snippet. Tambahkan di kolom kanan.').get()
        );
        return;
      }

      customSnippets.forEach(function(item) {
        var isEditing = editingTrigger === item.tabTrigger;
        var row = el('div').css({
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          gap: '8px', padding: '8px 10px', background: isEditing ? '#243548' : '#1f1f1f', borderRadius: '4px',
          border: '1px solid ' + (isEditing ? '#4a6fa0' : '#3a3a3a'), marginBottom: '8px'
        }).child([
          el('div').css({ minWidth: '0', flex: '1' }).child([
            el('div').css({ color: '#ddd', fontSize: '12px', fontWeight: 'bold' }).text(item.name),
            el('div').css({ color: '#8fb7ff', fontSize: '11px', fontFamily: 'monospace' }).text('trigger: ' + item.tabTrigger)
          ]),
          el('button').text('Edit').css({
            padding: '4px 8px', background: '#3b5f8a', color: '#fff', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontSize: '11px'
          }).hover(
            function() { this.style.background = '#4b6f9a'; },
            function() { this.style.background = '#3b5f8a'; }
          ).click(function() {
            editingTrigger = item.tabTrigger;
            var nameEl = document.getElementById('elcode-snippet-name');
            var triggerEl = document.getElementById('elcode-snippet-trigger');
            var contentEl = document.getElementById('elcode-snippet-content');
            var actionEl = document.getElementById('elcode-snippet-save-btn');
            if (nameEl) nameEl.value = item.name || '';
            if (triggerEl) triggerEl.value = item.tabTrigger || '';
            if (contentEl) contentEl.value = item.content || '';
            if (actionEl) actionEl.textContent = 'Simpan perubahan';
          }),
          el('button').text('Delete').css({
            padding: '4px 8px', background: '#7a3a3a', color: '#fff', border: 'none',
            borderRadius: '4px', cursor: 'pointer', fontSize: '11px'
          }).hover(
            function() { this.style.background = '#8a4a4a'; },
            function() { this.style.background = '#7a3a3a'; }
          ).click(function() {
            customSnippets = customSnippets.filter(function(s) { return s.tabTrigger !== item.tabTrigger; });
            unregisterCustomSnippets();
            registerCustomSnippets();
            saveSetting('customSnippets', customSnippets).then(function() {
              appendLog('info', ['Snippet "' + item.tabTrigger + '" deleted.']);
              if (editingTrigger === item.tabTrigger) {
                resetSnippetForm();
              }
              renderCustomSnippetList();
            }).catch(function(err) {
              appendLog('error', ['Failed to delete snippet: ' + (err && err.message ? err.message : err)]);
            });
          })
        ]).get();
        listEl.appendChild(row);
      });
    }

    var overlay = el('div').css({
      position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: '99999', fontFamily: 'sans-serif', padding: '16px', boxSizing: 'border-box'
    });
    // Modal lebar untuk desktop; kolom kiri = daftar, kanan = form
    var snippetSaveClick = function() {
      var name = (document.getElementById('elcode-snippet-name').value || '').trim();
      var trigger = (document.getElementById('elcode-snippet-trigger').value || '').trim();
      var content = document.getElementById('elcode-snippet-content').value || '';

      if (!name || !trigger || !content.trim()) {
        appendLog('error', ['Snippet fields cannot be empty.']);
        return;
      }

      var triggerExistsBuiltIn = builtInSnippets.some(function(s) { return s.tabTrigger === trigger; });
      var triggerExistsCustom = customSnippets.some(function(s) {
        if (editingTrigger && s.tabTrigger === editingTrigger) return false;
        return s.tabTrigger === trigger;
      });
      if (triggerExistsBuiltIn || triggerExistsCustom) {
        appendLog('error', ['Snippet trigger "' + trigger + '" already exists.']);
        return;
      }

      if (editingTrigger) {
        customSnippets = customSnippets.map(function(s) {
          if (s.tabTrigger === editingTrigger) {
            return { name: name, tabTrigger: trigger, content: content };
          }
          return s;
        });
      } else {
        customSnippets.push({ name: name, tabTrigger: trigger, content: content });
      }
      unregisterCustomSnippets();
      registerCustomSnippets();
      saveSetting('customSnippets', customSnippets).then(function() {
        appendLog('info', ['Snippet "' + trigger + '" saved.']);
        renderCustomSnippetList();
        resetSnippetForm();
      }).catch(function(err) {
        appendLog('error', ['Failed to save snippet: ' + (err && err.message ? err.message : err)]);
      });
    };

    var leftCol = el('div').css({
      flex: '1 1 300px',
      minWidth: '0',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '0'
    }).child([
      el('div').css({ color: '#bbb', fontSize: '12px', marginBottom: '8px', fontWeight: '600' }).text('Daftar snippet'),
      el('div').id('elcode-custom-snippet-list').css({
        flex: '1',
        minHeight: '200px',
        maxHeight: 'min(48vh, 400px)',
        overflowY: 'auto',
        padding: '10px',
        background: '#151515',
        border: '1px solid #333',
        borderRadius: '6px'
      })
    ]);

    // Area form bisa di-scroll; tombol Batal/Simpan di footer tidak ikut terpotong (flexShrink: 0)
    var rightBody = el('div').css({
      flex: '1',
      minHeight: '0',
      overflowY: 'auto',
      overflowX: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      paddingRight: '4px'
    }).child([
      el('div').css({ color: '#bbb', fontSize: '12px', fontWeight: '600' }).text('Form snippet'),
      el('div').css({ marginBottom: '0' }).child([
        el('label').text('Nama').css({ display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px' }),
        el('input').id('elcode-snippet-name').attr('type', 'text').attr('placeholder', 'mySnippet').css({
          width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
          fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
        })
      ]),
      el('div').css({ marginBottom: '0' }).child([
        el('label').text('Trigger').css({ display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px' }),
        el('input').id('elcode-snippet-trigger').attr('type', 'text').attr('placeholder', 'mytrg').css({
          width: '100%', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
          fontSize: '13px', padding: '8px 10px', borderRadius: '4px', outline: 'none', boxSizing: 'border-box'
        })
      ]),
      el('div').css({ display: 'flex', flexDirection: 'column', minHeight: '160px' }).child([
        el('label').text('Isi snippet').css({ display: 'block', color: '#aaa', fontSize: '12px', marginBottom: '6px' }),
        el('textarea').id('elcode-snippet-content').attr('rows', '12').attr('placeholder', "el('div').text('${1:Hello}')").css({
          width: '100%', minHeight: '180px', maxHeight: 'min(45vh, 360px)', background: '#1a1a1a', border: '1px solid #444', color: '#fff',
          fontSize: '12px', padding: '10px 12px', borderRadius: '4px', outline: 'none',
          boxSizing: 'border-box', fontFamily: "'Fira Code', 'Consolas', monospace", resize: 'vertical'
        })
      ])
    ]);

    var rightFooter = el('div').css({
      flexShrink: '0',
      flexGrow: '0',
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '10px',
      paddingTop: '14px',
      marginTop: '4px',
      borderTop: '1px solid #404040',
      background: '#2d2d2d'
    }).child([
      el('div').css({ fontSize: '11px', color: '#777', flex: '1 1 180px', minWidth: '0' }).text('Placeholder ACE, contoh ${1:name}.'),
      el('div').css({ display: 'flex', gap: '8px', flexShrink: '0', flexWrap: 'wrap', justifyContent: 'flex-end' }).child([
        el('button').text('Batal').css({
          padding: '8px 14px', background: '#555', color: '#eee', border: 'none',
          borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).click(function() { closeDialog(); }),
        el('button').id('elcode-snippet-save-btn').text('Tambah snippet').css({
          padding: '8px 14px', background: '#4a90d9', color: '#fff', border: 'none',
          borderRadius: '4px', cursor: 'pointer', fontSize: '12px'
        }).hover(
          function() { this.style.background = '#5aa0e9'; },
          function() { this.style.background = '#4a90d9'; }
        ).click(snippetSaveClick)
      ])
    ]);

    var rightCol = el('div').css({
      flex: '1.35 1 380px',
      minWidth: '0',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '0',
      maxHeight: '100%'
    }).child([rightBody, rightFooter]);

    var mainRow = el('div').css({
      display: 'flex',
      flex: '1',
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: '24px',
      alignItems: 'stretch',
      minHeight: '0',
      overflow: 'visible'
    }).child([leftCol, rightCol]);

    var box = el('div').css({
      background: '#2d2d2d',
      borderRadius: '10px',
      padding: '24px',
      width: 'min(960px, calc(100vw - 32px))',
      maxWidth: '960px',
      minHeight: 'min(480px, 85vh)',
      maxHeight: 'min(92vh, 880px)',
      boxShadow: '0 8px 40px rgba(0,0,0,0.55)',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box',
      overflow: 'hidden'
    }).child([
      el('div').css({
        fontSize: '18px', fontWeight: 'bold', color: '#eee', marginBottom: '18px', flexShrink: '0',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px'
      }).child([
        el('span').text('Snippets'),
        el('button').attr('type', 'button').attr('aria-label', 'Tutup').text('\u00d7').css({
          flexShrink: '0',
          width: '36px',
          height: '36px',
          padding: '0',
          lineHeight: '36px',
          background: '#444',
          color: '#eee',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '22px'
        }).hover(
          function() { this.style.background = '#555'; },
          function() { this.style.background = '#444'; }
        ).click(function() { closeDialog(); })
      ]),
      mainRow
    ]);

    overlay.child([box]);
    overlayNode = overlay.get();
    document.body.appendChild(overlayNode);
    renderCustomSnippetList();
  }

  // ===== File List UI =====
  function renderFileList(files) {
    // Ensure main.js is always first
    files.sort(function(a, b) {
      if (a === 'main.js') return -1;
      if (b === 'main.js') return 1;
      return a.localeCompare(b);
    });

    var fl = connector.filelist;
    el(fl).clear();
    el(fl).child([
      el('div').css({
        padding: '8px',
        borderBottom: '1px solid #555',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }).child([
        el('span').text('Files').css({ fontWeight: 'bold', color: '#ccc', fontSize: '12px', fontFamily: 'sans-serif' }),
        el('button').text('+').css({
          background: '#5a5',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          fontSize: '14px',
          padding: '2px 8px',
          borderRadius: '3px',
          fontWeight: 'bold'
        }).hover(
          function() { this.style.background = '#6b6'; },
          function() { this.style.background = '#5a5'; }
        ).click(function() {
          showNewFileInput();
        })
      ])
    ].concat(
      files.map(function(name) {
        var actionButtons = name !== 'main.js'
          ? el('div').css({ display: 'flex', alignItems: 'center', gap: '2px' }).child([
              el('span').text('✎').class('elcode-rename-btn').css({
                color: '#888',
                cursor: 'pointer',
                fontSize: '10px',
                padding: '2px 4px',
                visibility: 'hidden'
              }).hover(
                function() { this.style.color = '#6cf'; },
                function() { this.style.color = '#888'; }
              ).click(function(e) {
                e.stopPropagation();
                showRenameFileInput(name);
              }),
              el('span').text('x').class('elcode-delete-btn').css({
                color: '#888',
                cursor: 'pointer',
                fontSize: '10px',
                padding: '2px 4px'
              }).hover(
                function() { this.style.color = '#f66'; },
                function() { this.style.color = '#888'; }
              ).click(function(e) {
                e.stopPropagation();
                if (confirm('Delete "' + name + '"?')) {
                  deleteFile(name).then(function() {
                    if (currentFile === name) { currentFile = 'main.js'; openFile('main.js'); }
                    refreshFileList();
                  });
                }
              })
            ])
          : el('span');

        return el('div').css({
          padding: '6px 10px',
          cursor: 'pointer',
          fontSize: '12px',
          color: currentFile === name ? '#fff' : '#aaa',
          backgroundColor: currentFile === name ? '#555' : 'transparent',
          fontFamily: 'sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }).hover(
          function() {
            if (currentFile !== name) this.style.backgroundColor = '#4a4a4a';
            var renameBtn = this.querySelector('.elcode-rename-btn');
            if (renameBtn) renameBtn.style.visibility = 'visible';
          },
          function() {
            if (currentFile !== name) this.style.backgroundColor = 'transparent';
            var renameBtn = this.querySelector('.elcode-rename-btn');
            if (renameBtn) renameBtn.style.visibility = 'hidden';
          }
        ).click(function(e) {
          if (e.target.classList.contains('elcode-delete-btn')) return;
          if (e.target.classList.contains('elcode-rename-btn')) return;
          openFile(name);
        }).child([
          el('span').text(name).css({ flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          actionButtons
        ]);
      })
    )).get();
  }

  function showNewFileInput() {
    var fl = connector.filelist;
    var inputRow = el('div').css({
      padding: '4px 10px',
      display: 'flex',
      alignItems: 'center'
    }).child([
      el('input').attr('type', 'text').attr('placeholder', 'filename.js').css({
        flex: '1',
        background: '#333',
        border: '1px solid #666',
        color: '#fff',
        fontSize: '12px',
        padding: '3px 6px',
        borderRadius: '3px',
        outline: 'none',
        fontFamily: 'sans-serif'
      }).on('keydown', function(e) {
        if (e.key === 'Enter') {
          var name = this.value.trim();
          if (name) {
            saveFile(name, '').then(function() {
              refreshFileList();
              openFile(name);
            });
          }
        } else if (e.key === 'Escape') {
          refreshFileList();
        }
      }).on('blur', function() {
        var name = this.value.trim();
        if (name) {
          saveFile(name, '').then(function() {
            refreshFileList();
            openFile(name);
          });
        } else {
          refreshFileList();
        }
      })
    ]).get();
    fl.appendChild(inputRow);
    inputRow.querySelector('input').focus();
  }

  function showRenameFileInput(oldName) {
    var fl = connector.filelist;
    var inputRow = el('div').css({
      padding: '4px 10px',
      display: 'flex',
      alignItems: 'center'
    }).child([
      el('input').attr('type', 'text').attr('value', oldName).css({
        flex: '1',
        background: '#333',
        border: '1px solid #666',
        color: '#fff',
        fontSize: '12px',
        padding: '3px 6px',
        borderRadius: '3px',
        outline: 'none',
        fontFamily: 'sans-serif'
      }).on('keydown', function(e) {
        if (e.key === 'Enter') {
          var newName = this.value.trim();
          if (newName && newName !== oldName) {
            renameFile(oldName, newName).then(function() {
              if (currentFile === oldName) currentFile = newName;
              refreshFileList();
              openFile(newName);
            });
          } else {
            refreshFileList();
          }
        } else if (e.key === 'Escape') {
          refreshFileList();
        }
      }).on('blur', function() {
        var newName = this.value.trim();
        if (newName && newName !== oldName) {
          renameFile(oldName, newName).then(function() {
            if (currentFile === oldName) currentFile = newName;
            refreshFileList();
            openFile(newName);
          });
        } else {
          refreshFileList();
        }
      })
    ]).get();
    fl.appendChild(inputRow);
    var inputEl = inputRow.querySelector('input');
    inputEl.focus();
    inputEl.select();
  }

  function refreshFileList() {
    listFiles().then(function(files) { renderFileList(files); });
  }

  function openFile(name) {
    currentFile = name;
    isLoadingFile = true;
    
    loadFile(name).then(function(content) {
      console.log('[openFile] Loading file:', name, 'Content length:', content ? content.length : 0);
      
      // Check if we have an existing session for this file
      if (fileSessions[name]) {
        // Switch to existing session (preserves undo/redo history)
        console.log('[openFile] Using cached session for:', name);
        editor.setSession(fileSessions[name]);
      } else {
        // Create new session for this file
        var ext = name.split('.').pop();
        var modeMap = { js: 'ace/mode/javascript', html: 'ace/mode/html', css: 'ace/mode/css', json: 'ace/mode/json', ts: 'ace/mode/typescript' };
        var AceSession = ace.require('ace/edit_session').EditSession;
        var UndoManager = ace.require('ace/undomanager').UndoManager;
        var session = new AceSession(content || '', modeMap[ext] || 'ace/mode/javascript');
        session.setUndoManager(new UndoManager());
        
        // Set tab size and other session settings
        session.setTabSize(2);
        session.setUseSoftTabs(true);
        
        fileSessions[name] = session;
        editor.setSession(session);
        console.log('[openFile] Created new session for:', name);
      }
      
      editor.moveCursorTo(0, 0);
      isLoadingFile = false;
      console.log('[openFile] File loaded successfully:', name);
      refreshFileList();
    }).catch(function(err) {
      console.error('[openFile] Failed to load file:', name, err);
      isLoadingFile = false;
    });
  }

  // ===== Custom Dialog for iframe preview =====
  function showIframeDialog(doc, type, msg, def) {
    // Remove existing dialog if any
    var existing = doc.getElementById('elcode-dialog-overlay');
    if (existing) existing.remove();

    var overlay = doc.createElement('div');
    overlay.id = 'elcode-dialog-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;font-family:sans-serif;';

    var box = doc.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:8px;padding:20px 24px;min-width:280px;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,0.3);';

    var titleEl = doc.createElement('div');
    titleEl.style.cssText = 'font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;';
    titleEl.textContent = type;
    box.appendChild(titleEl);

    var msgEl = doc.createElement('div');
    msgEl.style.cssText = 'font-size:14px;color:#333;margin-bottom:16px;word-break:break-word;';
    msgEl.textContent = msg;
    box.appendChild(msgEl);

    if (type === 'prompt') {
      var input = doc.createElement('input');
      input.type = 'text';
      input.value = def || '';
      input.style.cssText = 'width:100%;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px;margin-bottom:12px;box-sizing:border-box;outline:none;';
      box.appendChild(input);
    }

    var btnRow = doc.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    var okBtn = doc.createElement('button');
    okBtn.textContent = 'OK';
    okBtn.style.cssText = 'padding:6px 16px;background:#4a90d9;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;';
    okBtn.onclick = function() { overlay.remove(); };
    btnRow.appendChild(okBtn);

    box.appendChild(btnRow);
    overlay.appendChild(box);
    doc.body.appendChild(overlay);

    // Auto-dismiss after 5 seconds
    setTimeout(function() {
      if (overlay.parentNode) overlay.remove();
    }, 5000);
  }

  // ===== Loop Protection =====
  var LOOP_MAX_ITERATIONS = 10000;

  function addLoopProtection(code) {
    var id = 0;
    // Only instrument while/do loops (prone to infinite loops)
    // for loops have explicit bounds and are left alone
    code = code.replace(/(while\s*\([^)]*\)\s*\{|do\s*\{)/g, function(match) {
      id++;
      return 'var __lp' + id + '=0;' + match + 'if(++__lp' + id + '>' + LOOP_MAX_ITERATIONS + '){throw new Error("Loop limit: max ' + LOOP_MAX_ITERATIONS + ' iterations on while/do loop. Possible infinite loop.");}';
    });
    return code;
  }

  // ===== Preview Runner =====

  var previewTimeout = null;
  var PREVIEW_TIMEOUT_MS = 3000; // 3 seconds max execution time
  /** Tanpa allow-same-origin, iframe sandbox punya origin opaque → canvas.toDataURL() sering SecurityError; thumbnail publish jatuh ke fallback. */
  var PREVIEW_IFRAME_SANDBOX = 'allow-scripts allow-same-origin';
  var THUMBNAIL_CAPTURE_TIMEOUT_MS = 8000;

  function setPreviewIframeSandbox(ifr) {
    if (!ifr) return;
    ifr.setAttribute('sandbox', PREVIEW_IFRAME_SANDBOX);
  }

  var livePreviewModalOverlay = null;
  var livePreviewModalCanvas = null;
  var livePreviewModalCanvasWrap = null;
  var livePreviewCanvasHasFrame = false;
  var livePreviewIntervalId = null;
  var livePreviewTickPending = false;
  var livePreviewRequestSafetyTimer = null;
  var LIVE_PREVIEW_POLL_MS = 380;
  var LIVE_PREVIEW_CAPTURE_MAX = 1280;

  function sizeLivePreviewCanvas() {
    if (!livePreviewModalCanvas || !livePreviewModalCanvasWrap) return;
    var rect = livePreviewModalCanvasWrap.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.floor(rect.width * dpr);
    var h = Math.floor(rect.height * dpr);
    if (w < 2 || h < 2) return;
    livePreviewModalCanvas.width = w;
    livePreviewModalCanvas.height = h;
  }

  function drawLivePreviewSnapshot(thumbnail) {
    var canvas = livePreviewModalCanvas;
    if (!canvas || !thumbnail || !thumbnail.data_base64) {
      livePreviewTickPending = false;
      if (livePreviewRequestSafetyTimer) {
        clearTimeout(livePreviewRequestSafetyTimer);
        livePreviewRequestSafetyTimer = null;
      }
      return;
    }
    var ctx = canvas.getContext('2d');
    var img = new Image();
    img.onload = function() {
      var cw = canvas.width;
      var ch = canvas.height;
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, cw, ch);
      var scale = Math.min(cw / img.width, ch / img.height);
      var w = img.width * scale;
      var h = img.height * scale;
      var x = (cw - w) / 2;
      var y = (ch - h) / 2;
      ctx.drawImage(img, x, y, w, h);
      livePreviewCanvasHasFrame = true;
      livePreviewTickPending = false;
      if (livePreviewRequestSafetyTimer) {
        clearTimeout(livePreviewRequestSafetyTimer);
        livePreviewRequestSafetyTimer = null;
      }
    };
    img.onerror = function() {
      livePreviewTickPending = false;
      if (livePreviewRequestSafetyTimer) {
        clearTimeout(livePreviewRequestSafetyTimer);
        livePreviewRequestSafetyTimer = null;
      }
    };
    img.src = 'data:image/jpeg;base64,' + thumbnail.data_base64;
  }

  function requestLivePreviewCanvasFrame() {
    if (!livePreviewModalCanvas || !livePreviewModalCanvas.isConnected) return;
    if (livePreviewTickPending) return;
    var iframeEl = connector.preview;
    if (!iframeEl || !iframeEl.contentWindow) return;
    livePreviewTickPending = true;
    if (livePreviewRequestSafetyTimer) clearTimeout(livePreviewRequestSafetyTimer);
    livePreviewRequestSafetyTimer = setTimeout(function() {
      livePreviewRequestSafetyTimer = null;
      livePreviewTickPending = false;
    }, 6000);
    iframeEl.contentWindow.postMessage({
      type: '__elcode_live_canvas__',
      maxWidth: LIVE_PREVIEW_CAPTURE_MAX,
      maxHeight: 720
    }, '*');
  }

  function livePreviewWindowResizeHandler() {
    sizeLivePreviewCanvas();
  }

  function closeLivePreviewModal() {
    if (livePreviewIntervalId !== null) {
      clearInterval(livePreviewIntervalId);
      livePreviewIntervalId = null;
    }
    if (livePreviewRequestSafetyTimer) {
      clearTimeout(livePreviewRequestSafetyTimer);
      livePreviewRequestSafetyTimer = null;
    }
    window.removeEventListener('resize', livePreviewWindowResizeHandler);
    livePreviewTickPending = false;
    livePreviewCanvasHasFrame = false;
    livePreviewModalCanvas = null;
    livePreviewModalCanvasWrap = null;
    if (livePreviewModalOverlay && livePreviewModalOverlay.parentNode) {
      livePreviewModalOverlay.parentNode.removeChild(livePreviewModalOverlay);
    }
    livePreviewModalOverlay = null;
    document.removeEventListener('keydown', livePreviewModalEscHandler);
  }

  function livePreviewModalEscHandler(e) {
    if (e.key === 'Escape') closeLivePreviewModal();
  }

  function showLivePreviewModal() {
    closeLivePreviewModal();
    var canvasRefs = {};
    var wrapRefs = {};
    var inner = el('div').css({
      width: 'min(960px, 96vw)',
      height: 'min(85vh, 900px)',
      maxWidth: '100%',
      maxHeight: '100%',
      background: '#1e1e1e',
      borderRadius: '10px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      boxShadow: '0 24px 48px rgba(0,0,0,0.45)'
    }).child([
      el('div').css({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: '#2d2d2d',
        borderBottom: '1px solid #444',
        flexShrink: '0'
      }).child([
        el('div').text('Preview (capture iframe → canvas)').css({ color: '#eee', fontWeight: '700', fontSize: '14px' }),
        el('button').text('Tutup').css({
          padding: '6px 12px', background: '#444', color: '#eee', border: 'none',
          borderRadius: '6px', cursor: 'pointer', fontSize: '12px'
        }).click(function() { closeLivePreviewModal(); })
      ]),
      el('div').link(wrapRefs, 'wrap').css({
        flex: '1',
        minHeight: '0',
        background: '#111',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }).child(
        el('canvas').link(canvasRefs, 'cv').css({
          maxWidth: '100%',
          maxHeight: '100%',
          width: 'auto',
          height: 'auto',
          display: 'block'
        })
      )
    ]);

    var overlayEl = el('div').css({
      position: 'fixed',
      left: '0',
      top: '0',
      right: '0',
      bottom: '0',
      background: 'rgba(0,0,0,0.72)',
      zIndex: '100000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 'clamp(12px, 3vw, 28px)',
      boxSizing: 'border-box'
    }).child([inner]).get();

    overlayEl.addEventListener('click', function(ev) {
      if (ev.target === overlayEl) closeLivePreviewModal();
    });

    livePreviewModalOverlay = overlayEl;
    livePreviewModalCanvas = canvasRefs.cv;
    livePreviewModalCanvasWrap = wrapRefs.wrap;
    document.body.appendChild(overlayEl);
    document.addEventListener('keydown', livePreviewModalEscHandler);
    window.addEventListener('resize', livePreviewWindowResizeHandler);
    requestAnimationFrame(function() {
      sizeLivePreviewCanvas();
      requestLivePreviewCanvasFrame();
      livePreviewIntervalId = setInterval(requestLivePreviewCanvasFrame, LIVE_PREVIEW_POLL_MS);
    });
  }

  function killAndRecreateIframe() {
    var iframeEl = connector.preview;
    var parent = iframeEl.parentElement;
    var newIframe = document.createElement('iframe');
    newIframe.style.cssText = iframeEl.style.cssText;
    newIframe.className = iframeEl.className;
    newIframe.width = iframeEl.width;
    setPreviewIframeSandbox(newIframe);
    parent.replaceChild(newIframe, iframeEl);
    connector.preview = newIframe;
    console.log('[Preview] Iframe recreated');
  }
  
  // Check if code has potentially dangerous loops before preview
  function detectHeavyLoops(code) {
    // Match for loops with large iteration counts: for(...; i < 10000; ...)
    var forMatch = code.match(/for\s*\([^;]*;[^;]*[<>]=?\s*(\d+)/g);
    if (forMatch) {
      for (var i = 0; i < forMatch.length; i++) {
        var numMatch = forMatch[i].match(/(\d+)/);
        if (numMatch && parseInt(numMatch[1]) > 10000) {
          return { blocked: true, reason: 'for loop with ' + numMatch[1] + ' iterations detected. Max allowed: 10000. Use .html() for large lists.' };
        }
      }
    }
    // Match while(true) or while(1) patterns
    if (/while\s*\(\s*(true|1)\s*\)/.test(code)) {
      return { blocked: true, reason: 'while(true) detected. Infinite loops are not allowed in preview.' };
    }
    return { blocked: false };
  }

  function runPreview() {
    console.log('***** runPreview() EXECUTING *****');
    // Clear any existing timeout watchdog
    if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
    connector.logs.innerHTML = '';
    console.log('Console cleared, loading files...');

    // Build user code then inject into sandboxed iframe
    listFiles().then(function(files) {
      var loadPromises = files.map(function(name) { return loadFile(name).then(function(c) { return { name: name, content: c }; }); });
      return Promise.all(loadPromises);
    }).then(function(allFiles) {
      // Use live editor content for active file so preview updates while typing
      if (currentFile && editor && !isLoadingFile) {
        var activeFileFound = false;
        for (var idx = 0; idx < allFiles.length; idx++) {
          if (allFiles[idx].name === currentFile) {
            allFiles[idx].content = editor.getValue();
            activeFileFound = true;
            break;
          }
        }
        if (!activeFileFound) {
          allFiles.push({ name: currentFile, content: editor.getValue() });
        }
      }

      var mainCode = allFiles.find(function(f) { return f.name === 'main.js'; });
      if (!mainCode) {
        return;
      }

      // Pre-check all files for dangerous loops
      for (var i = 0; i < allFiles.length; i++) {
        var check = detectHeavyLoops(allFiles[i].content || '');
        if (check.blocked) {
          appendLog('error', ['\u26a0 Preview blocked (' + allFiles[i].name + '): ' + check.reason]);
          return;
        }
      }

      // For sandboxed iframe, inline all code directly with loop protection
      var resolvedFiles = {};
      allFiles.forEach(function(f) {
        resolvedFiles[f.name] = addLoopProtection(f.content || '');
      });

      // Build main code with resolved imports
      var mainContent = resolvedFiles['main.js'];
  
      // Build the complete HTML for srcdoc
      var htmlContent = '<!DOCTYPE html><html><head>'
        + '<script src="https://cdn.tailwindcss.com"></' + 'script>'
        + '<script src="https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js"></' + 'script>'
        + '<script>' + window.__elcode_eljs_raw__ + '</' + 'script>'
        + '</head><body><div id="app"></div>'
        + '<script>\n'
        + '// Console override - send logs to parent\n'
        + 'var _origConsole = window.console;\n'
        + 'window.console = {\n'
        + '  log: function() { window.parent.postMessage({type:"__elcode_log__",level:"log",args:Array.from(arguments).map(String)}, "*"); },\n'
        + '  error: function() { window.parent.postMessage({type:"__elcode_log__",level:"error",args:Array.from(arguments).map(String)}, "*"); },\n'
        + '  warn: function() { window.parent.postMessage({type:"__elcode_log__",level:"warn",args:Array.from(arguments).map(String)}, "*"); },\n'
        + '  info: function() { window.parent.postMessage({type:"__elcode_log__",level:"info",args:Array.from(arguments).map(String)}, "*"); },\n'
        + '  clear: function() { window.parent.postMessage({type:"__elcode_clear__"}, "*"); }\n'
        + '};\n'
        + '// Error handlers\n'
        + 'window.onerror = function(msg, url, line) {\n'
        + '  window.parent.postMessage({type:"__elcode_log__",level:"error",args:[msg + (line ? " (line "+line+")" : "")]}, "*");\n'
        + '  window.parent.postMessage({type:"__elcode_error__"}, "*");\n'
        + '};\n'
        + 'window.onunhandledrejection = function(e) {\n'
        + '  window.parent.postMessage({type:"__elcode_log__",level:"error",args:["Unhandled rejection: "+(e.reason&&e.reason.message?e.reason.message:e.reason)]}, "*");\n'
        + '  window.parent.postMessage({type:"__elcode_error__"}, "*");\n'
        + '};\n'
        + '// Custom alert\n'
        + 'window.alert = function(msg) {\n'
        + '  var o=document.createElement("div");o.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:99999;";\n'
        + '  var b=document.createElement("div");b.style.cssText="background:#2d2d2d;border-radius:8px;padding:20px;min-width:280px;max-width:400px;color:#eee;font:14px/1.5 sans-serif;display:flex;flex-direction:column;gap:16px;";\n'
        + '  var t=document.createElement("div");t.textContent=String(msg);\n'
        + '  var btnWrap=document.createElement("div");btnWrap.style.cssText="display:flex;justify-content:flex-end;";\n'
        + '  var btn=document.createElement("button");btn.textContent="OK";btn.style.cssText="padding:6px 18px;background:#4a90d9;color:#fff;border:none;border-radius:4px;cursor:pointer;font:14px sans-serif;";\n'
        + '  btn.onclick=function(){o.remove();};btnWrap.appendChild(btn);b.appendChild(t);b.appendChild(btnWrap);o.appendChild(b);document.body.appendChild(o);setTimeout(function(){if(o.parentNode)o.remove();},5000);\n'
        + '};\n'
        + 'async function __elcode_make_thumbnail__(maxWidth, maxHeight) {\n'
        + '  maxWidth = maxWidth || 1280;\n'
        + '  maxHeight = maxHeight || 720;\n'
        + '  try { await document.fonts.ready; } catch (_fonts) {}\n'
        + '  await new Promise(function(r) { setTimeout(r, 280); });\n'
        + '  await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });\n'
        + '  var __dead = Date.now() + 2200;\n'
        + '  while (Date.now() < __dead) {\n'
        + '    var __ax = document.getElementById("app");\n'
        + '    var __ready = !__ax || __ax.childElementCount > 0 || (__ax.textContent && __ax.textContent.trim().length > 0);\n'
        + '    if (__ready) break;\n'
        + '    await new Promise(function(r) { setTimeout(r, 55); });\n'
        + '  }\n'
        + '  await new Promise(function(r) { requestAnimationFrame(function() { requestAnimationFrame(r); }); });\n'
        + '  var __h2i = 0;\n'
        + '  while (typeof html2canvas !== "function" && __h2i < 80) {\n'
        + '    await new Promise(function(r) { setTimeout(r, 40); });\n'
        + '    __h2i++;\n'
        + '  }\n'
        + '  if (typeof html2canvas === "function") {\n'
        + '    try {\n'
        + '      var __vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);\n'
        + '      var __vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);\n'
        + '      var __cap = await html2canvas(document.body, {\n'
        + '        useCORS: true,\n'
        + '        allowTaint: true,\n'
        + '        logging: false,\n'
        + '        backgroundColor: "#ffffff",\n'
        + '        scale: 1,\n'
        + '        width: __vw,\n'
        + '        height: __vh,\n'
        + '        windowWidth: __vw,\n'
        + '        windowHeight: __vh,\n'
        + '        scrollX: 0,\n'
        + '        scrollY: 0,\n'
        + '        onclone: function(clonedDoc) {\n'
        + '          try {\n'
        + '            var s = clonedDoc.createElement("style");\n'
        + '            s.textContent = "html,body{margin:0!important;overflow-x:hidden!important;}ul{list-style-type:disc!important;list-style-position:outside!important;padding-left:1.25rem!important;}ol{list-style-position:outside!important;padding-left:1.25rem!important;}li{display:list-item!important;}*{box-sizing:border-box!important;-webkit-font-smoothing:antialiased;}";\n'
        + '            clonedDoc.head.appendChild(s);\n'
        + '          } catch (_oc) {}\n'
        + '        }\n'
        + '      });\n'
        + '      var __sc2 = Math.min(maxWidth / __cap.width, maxHeight / __cap.height, 1);\n'
        + '      var __tw2 = Math.max(1, Math.floor(__cap.width * __sc2));\n'
        + '      var __th2 = Math.max(1, Math.floor(__cap.height * __sc2));\n'
        + '      var __out2 = document.createElement("canvas");\n'
        + '      __out2.width = __tw2;\n'
        + '      __out2.height = __th2;\n'
        + '      var __ctx2 = __out2.getContext("2d");\n'
        + '      __ctx2.fillStyle = "#ffffff";\n'
        + '      __ctx2.fillRect(0, 0, __tw2, __th2);\n'
        + '      __ctx2.drawImage(__cap, 0, 0, __tw2, __th2);\n'
        + '      var __du2 = __out2.toDataURL("image/jpeg", 0.9);\n'
        + '      return { mime_type: "image/jpeg", data_base64: __du2.split(",")[1] || "", width: __tw2, height: __th2 };\n'
        + '    } catch (_h2e) {}\n'
        + '  }\n'
        + '  var sourceW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);\n'
        + '  var sourceH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);\n'
        + '  var scale = Math.min(maxWidth / sourceW, maxHeight / sourceH, 1);\n'
        + '  var targetW = Math.max(1, Math.floor(sourceW * scale));\n'
        + '  var targetH = Math.max(1, Math.floor(sourceH * scale));\n'
        + '  var html = new XMLSerializer().serializeToString(document.documentElement);\n'
        + '  var escaped = html.replace(/#/g, "%23").replace(/\\n/g, "%0A");\n'
        + '  var svg = "<svg xmlns=\\"http://www.w3.org/2000/svg\\" width=\\"" + sourceW + "\\" height=\\"" + sourceH + "\\"><foreignObject width=\\"100%\\" height=\\"100%\\">" + escaped + "</foreignObject></svg>";\n'
        + '  var img = new Image();\n'
        + '  await new Promise(function(resolve, reject) {\n'
        + '    img.onload = resolve;\n'
        + '    img.onerror = reject;\n'
        + '    img.src = "data:image/svg+xml;charset=utf-8," + svg;\n'
        + '  });\n'
        + '  var canvas = document.createElement("canvas");\n'
        + '  canvas.width = targetW;\n'
        + '  canvas.height = targetH;\n'
        + '  var ctx = canvas.getContext("2d");\n'
        + '  ctx.fillStyle = "#ffffff";\n'
        + '  ctx.fillRect(0, 0, targetW, targetH);\n'
        + '  ctx.drawImage(img, 0, 0, targetW, targetH);\n'
        + '  var dataUrl = canvas.toDataURL("image/jpeg", 0.9);\n'
        + '  return { mime_type: "image/jpeg", data_base64: dataUrl.split(",")[1] || "", width: targetW, height: targetH };\n'
        + '}\n'
        + 'window.addEventListener("message", function(evt) {\n'
        + '  if (!evt || !evt.data) return;\n'
        + '  var t = evt.data.type;\n'
        + '  if (t !== "__elcode_capture_thumbnail__" && t !== "__elcode_live_canvas__") return;\n'
        + '  __elcode_make_thumbnail__(evt.data.maxWidth, evt.data.maxHeight)\n'
        + '    .then(function(thumbnail) {\n'
        + '      if (t === "__elcode_live_canvas__") {\n'
        + '        window.parent.postMessage({ type: "__elcode_live_canvas_done__", ok: true, thumbnail: thumbnail }, "*");\n'
        + '      } else {\n'
        + '        window.parent.postMessage({ type: "__elcode_thumbnail__", ok: true, thumbnail: thumbnail }, "*");\n'
        + '      }\n'
        + '    })\n'
        + '    .catch(function(err) {\n'
        + '      var errStr = String(err && err.message ? err.message : err);\n'
        + '      if (t === "__elcode_live_canvas__") {\n'
        + '        window.parent.postMessage({ type: "__elcode_live_canvas_done__", ok: false, error: errStr }, "*");\n'
        + '      } else {\n'
        + '        window.parent.postMessage({ type: "__elcode_thumbnail__", ok: false, error: errStr }, "*");\n'
        + '      }\n'
        + '    });\n'
        + '});\n'
        + '</' + 'script>\n';
  
      // Resolve imports in main.js by inlining dependent code as data URLs
      var fileEntries = allFiles.filter(function(f) { return f.name !== 'main.js'; });
      var finalMain = mainContent;
      fileEntries.forEach(function(f) {
        var escaped = f.name.replace(/\./g, '\\.');
        var inlineUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(resolvedFiles[f.name]).replace(/'/g, '%27');
        // Replace all import patterns
        finalMain = finalMain.replace(new RegExp("from\\s*['\"]\\./" + escaped + "['\"]", 'g'), "from '" + inlineUrl + "'");
        finalMain = finalMain.replace(new RegExp("from\\s*['\"]" + escaped + "['\"]", 'g'), "from '" + inlineUrl + "'");
        finalMain = finalMain.replace(new RegExp("import\\s*['\"]\\./" + escaped + "['\"]", 'g'), "import '" + inlineUrl + "'");
        finalMain = finalMain.replace(new RegExp("import\\s*['\"]" + escaped + "['\"]", 'g'), "import '" + inlineUrl + "'");
        finalMain = finalMain.replace(new RegExp("import\\(\\s*['\"]\\./" + escaped + "['\"]\\s*\\)", 'g'), "import('" + inlineUrl + "')");
        finalMain = finalMain.replace(new RegExp("import\\(\\s*['\"]" + escaped + "['\"]\\s*\\)", 'g'), "import('" + inlineUrl + "')");
      });
  
      // el.js is already loaded globally via <script> tag
      // Escape </script> in user code to prevent HTML parser breaking
      finalMain = finalMain.replace(/<\/script>/gi, '<\/scr" + "ipt>');
      htmlContent += '<script type="module">\n'
        + finalMain + '\n'
        + ';window.parent.postMessage({type:"__elcode_done__"}, "*");\n'
        + '</' + 'script>\n'
        + '</body></html>';
  
      // Load into sandboxed iframe - kill and recreate to force reload
      killAndRecreateIframe();
      var iframeEl = connector.preview;
      setPreviewIframeSandbox(iframeEl);
      iframeEl.style.background = '#fff';
      iframeEl.style.opacity = '1';
      
      // Small delay to ensure iframe is ready
      setTimeout(function() {
        iframeEl.srcdoc = htmlContent;
      }, 50);
  
      // Start watchdog
      previewTimeout = setTimeout(function() {
        appendLog('error', ['\u26a0 Script execution timed out (' + (PREVIEW_TIMEOUT_MS/1000) + 's). Possible infinite loop detected. Preview killed.']);
        killAndRecreateIframe();
      }, PREVIEW_TIMEOUT_MS);
    });
  }
  
  // Listen for messages from sandboxed iframe
  window.addEventListener('message', function(e) {
    if (!e.data || !e.data.type) {
      if (e.data === '__elcode_done__') {
        if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
      }
      return;
    }
    if (e.data.type === '__elcode_done__') {
      if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
    } else if (e.data.type === '__elcode_log__') {
      appendLog(e.data.level, e.data.args);
    } else if (e.data.type === '__elcode_clear__') {
      connector.logs.innerHTML = '';
    } else if (e.data.type === '__elcode_error__') {
      if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
    } else if (e.data.type === '__elcode_thumbnail__') {
      if (pendingThumbnailRequest) {
        clearTimeout(pendingThumbnailRequest.timeoutId);
        var resolveThumbnail = pendingThumbnailRequest.resolve;
        pendingThumbnailRequest = null;
        if (e.data.ok && e.data.thumbnail && e.data.thumbnail.data_base64) {
          resolveThumbnail(e.data.thumbnail);
        } else {
          resolveThumbnail(buildFallbackThumbnail());
        }
      }
    } else if (e.data.type === '__elcode_live_canvas_done__') {
      if (!livePreviewModalCanvas || !livePreviewModalCanvas.isConnected) {
        livePreviewTickPending = false;
        if (livePreviewRequestSafetyTimer) {
          clearTimeout(livePreviewRequestSafetyTimer);
          livePreviewRequestSafetyTimer = null;
        }
        return;
      }
      if (e.data.ok && e.data.thumbnail && e.data.thumbnail.data_base64) {
        drawLivePreviewSnapshot(e.data.thumbnail);
      } else {
        livePreviewTickPending = false;
        if (livePreviewRequestSafetyTimer) {
          clearTimeout(livePreviewRequestSafetyTimer);
          livePreviewRequestSafetyTimer = null;
        }
      }
    }
  });

  function exportProject() {
    listFiles().then(function(files) {
      var loadPromises = files.map(function(name) {
        return loadFile(name).then(function(c) { return { name: name, content: c }; });
      });
      return Promise.all(loadPromises);
    }).then(function(allFiles) {
      var mainCode = allFiles.find(function(f) { return f.name === 'main.js'; });
      if (!mainCode) {
        appendLog('error', ['No main.js found. Cannot export.']);
        return;
      }

      var htmlContent = '<!DOCTYPE html>\n'
        + '<html lang="en">\n'
        + '<head>\n'
        + '    <meta charset="UTF-8">\n'
        + '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n'
        + '    <title>el.js</title>\n'
        + '    <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></' + 'script>\n'
        + '</head>\n'
        + '<body>\n'
        + '    <div id="app"></div>\n'
        + '    <script src="./el.js"></' + 'script>\n'
        + '    <script type="module" src="./main.js"></' + 'script>\n'
        + '</body>\n'
        + '</html>';

      var serverJsContent = "const http = require('http');\n"
        + "const fs = require('fs');\n"
        + "const path = require('path');\n\n"
        + "const PORT = 3004;\n\n"
        + "const mimeTypes = {\n"
        + "  '.html': 'text/html',\n"
        + "  '.js': 'application/javascript',\n"
        + "  '.css': 'text/css',\n"
        + "  '.json': 'application/json',\n"
        + "  '.png': 'image/png',\n"
        + "  '.jpg': 'image/jpeg',\n"
        + "  '.gif': 'image/gif',\n"
        + "  '.svg': 'image/svg+xml',\n"
        + "  '.ico': 'image/x-icon'\n"
        + "};\n\n"
        + "const server = http.createServer((req, res) => {\n"
        + "  console.log(`${req.method} ${req.url}`);\n\n"
        + "  let filePath = req.url === '/' ? '/index.html' : req.url;\n"
        + "  filePath = filePath.split('?')[0];\n"
        + "  filePath = path.join(__dirname, filePath);\n\n"
        + "  const ext = path.extname(filePath).toLowerCase();\n"
        + "  const contentType = mimeTypes[ext] || 'application/octet-stream';\n\n"
        + "  fs.readFile(filePath, (err, content) => {\n"
        + "    if (err) {\n"
        + "      if (err.code === 'ENOENT') {\n"
        + "        res.writeHead(404, { 'Content-Type': 'text/html' });\n"
        + "        res.end('<h1>404 Not Found</h1>');\n"
        + "      } else {\n"
        + "        res.writeHead(500, { 'Content-Type': 'text/html' });\n"
        + "        res.end('<h1>500 Server Error</h1>');\n"
        + "      }\n"
        + "    } else {\n"
        + "      res.writeHead(200, { 'Content-Type': contentType });\n"
        + "      res.end(content);\n"
        + "    }\n"
        + "  });\n"
        + "});\n\n"
        + "server.listen(PORT, () => {\n"
        + "  console.log(`Server running at http://localhost:${PORT}`);\n"
        + "});\n";

      if (typeof zip === 'undefined' || !zip.createWriter) {
        appendLog('error', ['zip.js not loaded. Cannot export ZIP.']);
        return;
      }

      zip.useWebWorkers = false;

      zip.createWriter(new zip.BlobWriter('application/zip'), function(writer) {
        var filesToAdd = [{ name: 'index.html', content: htmlContent }]
          .concat(allFiles)
          .concat([{ name: 'el.js', content: window.__elcode_eljs_raw__ }])
          .concat([{ name: 'server.js', content: serverJsContent }]);
        var idx = 0;
        function addNext() {
          if (idx >= filesToAdd.length) {
            writer.close(function(blob) {
              var url = URL.createObjectURL(blob);
              var a = document.createElement('a');
              a.href = url;
              a.download = currentProject.replace(/\s+/g, '_') + '.zip';
              document.body.appendChild(a);
              a.click();
              setTimeout(function() {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }, 100);
              appendLog('info', ['Exported "' + currentProject + '" as ZIP (' + (filesToAdd.length) + ' files).']);
            });
            return;
          }
          var f = filesToAdd[idx++];
          writer.add(f.name, new zip.TextReader(f.content || ''), function() {
            addNext();
          });
        }
        addNext();
      }, function(err) {
        appendLog('error', ['Export failed: ' + (err && err.message ? err.message : err)]);
      }, true);
    });
  }

  function appendLog(type, args) {
    var colors = { log: '#ccc', error: '#f66', warn: '#fa0', info: '#6cf' };
    var text = Array.from(args).map(function(a) {
      if (typeof a === 'object') try { return JSON.stringify(a, null, 2); } catch(e) { return String(a); }
      return String(a);
    }).join(' ');
    el(connector.logs).child([
      el('div').css({
        padding: '2px 0',
        borderBottom: '1px solid #2a2a2a',
        color: colors[type] || '#ccc',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
      }).text(text)
    ]).get();
    connector.logs.scrollTop = connector.logs.scrollHeight;
  }

  function appendSystemLog(text) {
    var timestamp = new Date().toLocaleTimeString();
    appendLog('info', ['[🔄 ' + timestamp + '] ' + text]);
  }


  if(typeof el === 'undefined') throw new Error('el is not defined, need el.js to use code-editor')
  document.addEventListener('click', closeHeaderDropdowns);

  Elcode.container = el('div').id('elcode-container').class('elcode-container')
  .css({
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
  })
  .child([
    el('div').class('elcode-header').css({
      height: '50px',
      backgroundColor: '#333',
      color: '#fff',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 1rem',
    }).child([
      el('div').css({ display: 'flex', alignItems: 'center', gap: '12px' }).child([
        el('div').class('elcode-title').text('el.js Editor').css({ fontSize: '14px', fontWeight: 'bold' }),
        el('span').text('|').css({ color: '#555' }),
        el('span').link(connector, 'projectName').text(currentProject).css({
          fontSize: '13px', color: '#aaa', cursor: 'pointer', padding: '2px 6px',
          borderRadius: '3px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.backgroundColor = '#444'; },
          function() { this.style.backgroundColor = 'transparent'; }
        ).click(function() {
          var name = prompt('Rename project:', currentProject);
          if (name && name.trim() && name.trim() !== currentProject) {
            renameProject(currentProject, name.trim());
          }
        })
      ]),
      el('div').css({ display: 'flex', alignItems: 'center', gap: '8px' }).child([
        el('span').link(connector, 'authStatus').text('Not logged in').css({
          fontSize: '11px', color: '#a3a3a3', fontFamily: 'sans-serif'
        }),
        el('button').link(connector, 'publishBtn').text('Publish').css({
          padding: '4px 12px', background: '#7c3aed', color: '#fff', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#8b5cf6'; },
          function() { this.style.background = '#7c3aed'; }
        ).click(function() {
          publishProjectToApi();
        }),
        createHeaderDropdown('Project', '#5a5', [
          { label: 'New Project', onClick: createNewProject },
          { label: 'Save Project', onClick: function() {
            saveProject().then(function() {
              appendLog('info', ['Project "' + currentProject + '" saved.']);
            });
          }},
          { label: 'Load Project', onClick: function() { showProjectLoadDialog(); } },
          { label: 'Export ZIP', onClick: function() { exportProject(); } },
        ]),
        createHeaderDropdown('Browse', '#6b6b9f', [
          { label: 'Documentation', onClick: function() { window.location.hash = '#/documentation'; } },
          { label: 'Store', onClick: function() { window.location.hash = '#/store'; } },
          { label: 'My Published', onClick: function() { window.location.hash = '/my-publish'; } },
          { label: 'Snippets', onClick: function() { showSnippetDialog(); } },
        ]),
        createHeaderDropdown('Tools', '#555', [
          { label: 'Settings', onClick: function() { showSettingsDialog(); } },
          { label: 'AI Chat', onClick: function() { showChatDialog(); } },
          { label: 'Preview (canvas)', onClick: function() { showLivePreviewModal(); } },
        ]),
        createHeaderDropdown('Account', '#0ea5e9', [
          { label: 'Login', linkName: 'authActionBtn', onClick: function() {
            if (authUser) {
              appendLog('info', ['Session aktif: ' + (authUser.email || authUser.name || 'user')]);
              return;
            }
            showLoginDialog();
          }},
          { label: 'Register', linkName: 'authRegisterBtn', onClick: function() { showRegisterDialog(); } },
          { label: 'Logout', linkName: 'authLogoutBtn', color: '#fca5a5', onClick: function() {
            apiRequest('/api/editor/auth/logout', { method: 'POST' })
              .then(function() {
                authUser = null;
                updateAuthUi();
                appendLog('info', ['Logout berhasil.']);
              })
              .catch(function(err) {
                appendLog('error', ['Logout gagal: ' + (err.message || err)]);
              });
          }},
        ]),
      ])
    ]),
    el('div').class('elcode-content').css({
      flex: 1,
      display: 'flex',
      overflow: 'auto',
      backgroundColor: '#222',
    }).child([
      el('div').width('200px').link(connector, 'filelist').class('elcode-editor').css({
        backgroundColor: '#444',
      }),
      el('div').link(connector, 'flResizer').css({
        width: '6px',
        backgroundColor: '#2d2d2d',
        cursor: 'col-resize',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderLeft: '1px solid #3c3c3c',
        borderRight: '1px solid #3c3c3c'
      }).child([
        el('div').css({
          width: '3px',
          height: '40px',
          backgroundColor: '#555',
          borderRadius: '2px'
        })
      ]),
      el('div').class('elcode-editor').css({
        flex: '1',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#111',
      }).child([
        el('div').css({ flex: '1', width: '100%' }).id('ace-'+uuid()).link(connector, 'editorace'),
        el('div').link(connector, 'resizer').css({
          height: '6px',
          backgroundColor: '#2d2d2d',
          cursor: 'row-resize',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderTop: '1px solid #3c3c3c',
          borderBottom: '1px solid #3c3c3c'
        }).child([
          el('div').css({
            width: '40px',
            height: '3px',
            backgroundColor: '#555',
            borderRadius: '2px'
          })
        ]),
        el('div').link(connector, 'logsPanel').css({ display: 'flex', flexDirection: 'column', height: '200px', width: '100%', backgroundColor: '#1e1e1e', color: '#ccc', borderTop: '1px solid #333' }).child([
          el('div').css({
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            backgroundColor: '#252526',
            borderBottom: '1px solid #333',
            fontSize: '12px',
            userSelect: 'none'
          }).child([
            el('span').text('Console').css({ fontWeight: 'bold', color: '#bbb', fontFamily: 'sans-serif' }),
            el('button').text('Clear').css({
              background: 'transparent',
              border: 'none',
              color: '#888',
              cursor: 'pointer',
              fontSize: '11px',
              padding: '2px 6px'
            }).hover(
              function() { this.style.color = '#fff'; },
              function() { this.style.color = '#888'; }
            ).click(function() {
              connector.logs.innerHTML = '';
            })
          ]),
          el('div').css({ flex: '1', width: '100%', overflow: 'auto', padding: '8px', fontFamily: "'Fira Code', 'Consolas', 'Monaco', monospace", fontSize: '12px', lineHeight: '1.6' }).background('#1e1e1e').color('#ccc').link(connector, 'logs')
        ])
      ]),
      el('div').link(connector, 'hResizer').css({
        width: '6px',
        backgroundColor: '#2d2d2d',
        cursor: 'col-resize',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderLeft: '1px solid #3c3c3c',
        borderRight: '1px solid #3c3c3c'
      }).child([
        el('div').css({
          width: '3px',
          height: '40px',
          backgroundColor: '#555',
          borderRadius: '2px'
        })
      ]),
      el('div').link(connector, 'previewWrap').class('elcode-editor').css({
        display: 'flex',
        flexDirection: 'column',
        width: '450px',
        minWidth: '180px',
        flexShrink: '0',
        height: '100%',
        backgroundColor: '#1a1a1a',
        borderLeft: '1px solid #3c3c3c'
      }).child([
        el('div').css({
          height: '28px',
          flexShrink: '0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          backgroundColor: '#252526',
          borderBottom: '1px solid #333',
          fontSize: '11px',
          userSelect: 'none'
        }).child([
          el('span').text('Preview').css({ fontWeight: 'bold', color: '#bbb', fontFamily: 'sans-serif' }),
          el('button').text('Canvas').css({
            padding: '3px 10px',
            background: '#0ea5e9',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '600',
            fontFamily: 'sans-serif'
          }).hover(
            function() { this.style.background = '#38bdf8'; },
            function() { this.style.background = '#0ea5e9'; }
          ).click(function(e) {
            e.stopPropagation();
            showLivePreviewModal();
          })
        ]),
        el('iframe').link(connector, 'preview').attr('sandbox', PREVIEW_IFRAME_SANDBOX).css({
          flex: '1',
          minHeight: '0',
          width: '100%',
          border: 'none',
          backgroundColor: '#fff'
        })
      ]),
    ]),
  ]).load(async function(){
    // area for initialization code
    await import('./ace/ace.js');
    await import('./ace/ext-language_tools.js');
    // Pre-load snippet files so ACE can find them
    await import('./ace/snippets/javascript.js');
    await import('./ace/snippets/html.js');
    await import('./ace/snippets/css.js');
    await import('./ace/snippets/typescript.js');
    ace.config.set('basePath', '/code-editor/ace');
    editor = ace.edit(connector.editorace.id);
    editor.setTheme("ace/theme/ambiance");
    editor.session.setMode("ace/mode/javascript");
    editor.setOptions({
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
      enableSnippets: true,
      fontSize: 15,
    });

    // Register custom el.js snippets
    aceSnippetManager = ace.require('ace/snippets').snippetManager;
    var eljsSnippets = [
      { name: 'el', tabTrigger: 'el', content: "el('${1:div}')" },
      { name: 'elt', tabTrigger: 'elt', content: "el('${1:div}').text('${2}')" },
      { name: 'elc', tabTrigger: 'elc', content: "el('${1:div}').class('${2}')" },
      { name: 'elcss', tabTrigger: 'elcss', content: "el('${1:div}').css({ ${2} })" },
      { name: 'eldiv', tabTrigger: 'eldiv', content: "el('div').class('${1}').child([\n\t${2}\n])" },
      { name: 'elbtn', tabTrigger: 'elbtn', content: "el('button')\n  .text('${1:Click}')\n  .class('${2:px-4 py-2 bg-blue-600 text-white rounded}')\n  .click(function() {\n\t${3:// handler}\n  });" },
      { name: 'elin', tabTrigger: 'elin', content: "el('input')\n  .attr('type', '${1:text}')\n  .placeholder('${2}')\n  .class('${3}');" },
      { name: 'elflex', tabTrigger: 'elflex', content: "el('div')\n  .flex('${1:row}')\n  .gap('${2:8px}')\n  .justify('${3:center}')\n  .items('${4:center}')\n  .child([\n\t${5}\n  ])" },
      { name: 'child', tabTrigger: 'child', content: ".child([\n\t${1}\n])" },
      { name: 'click', tabTrigger: 'click', content: ".click(function(${1:e}) {\n\t${2:// handler}\n})" },
      { name: 'hover', tabTrigger: 'hover', content: ".hover(\n\tfunction() { ${1:// enter} },\n\tfunction() { ${2:// leave} }\n)" },
      { name: 'elcard', tabTrigger: 'elcard', content: "el('div')\n  .class('bg-white rounded-lg shadow p-4')\n  .child([\n\tel('h3').text('${1:Title}').class('text-lg font-bold mb-2'),\n\tel('p').text('${2:Content}').class('text-gray-600')\n  ])" },
      { name: 'elimp', tabTrigger: 'elimp', content: "import ${1:module} from './${2:file}.js';" },
      { name: 'elexp', tabTrigger: 'elexp', content: 'export default ${1:el};' },
      { name: 'get', tabTrigger: 'get', content: '.get()' },
      { name: 'elumd', tabTrigger: 'elumd', content: "(function (global, factory) {\n  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :\n    typeof define === 'function' && define.amd ? define(factory) :\n      (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.${1:card} = factory());\n})(this, (function () {\n\n    const ${1:card} = {};\n\n    // area code\n\n    return ${1:card};\n\n}));" }
    ];
    builtInSnippets = eljsSnippets.slice();
    aceSnippetManager.register(eljsSnippets, 'javascript');

    // Ensure snippet completer is active for autocomplete popup
    var langTools = ace.require('ace/ext/language_tools');
    var eljsMethods = [
      { caption: "text('...')", snippet: "text('${1:text}')" },
      { caption: "html('...')", snippet: "html('${1:<b>html</b>}')" },
      { caption: "css({...})", snippet: "css({ ${1:key}: '${2:value}' })" },
      { caption: "class('...')", snippet: "class('${1:class-name}')" },
      { caption: "attr(name, value)", snippet: "attr('${1:name}', '${2:value}')" },
      { caption: "data(name, value)", snippet: "data('${1:key}', '${2:value}')" },
      { caption: "aria(name, value)", snippet: "aria('${1:name}', '${2:value}')" },
      { caption: "child([...])", snippet: "child([\n\t${1}\n])" },
      { caption: "get()", snippet: "get()" },
      { caption: "click(fn)", snippet: "click(function(${1:e}) {\n\t${2:// handler}\n})" },
      { caption: "on(event, fn)", snippet: "on('${1:event}', function(${2:e}) {\n\t${3}// handler\n})" },
      { caption: "hover(enter, leave)", snippet: "hover(function() { ${1:// enter} }, function() { ${2:// leave} })" },
      { caption: "input(fn)", snippet: "input(function(${1:e}) {\n\t${2}// handler\n})" },
      { caption: "change(fn)", snippet: "change(function(${1:e}) {\n\t${2}// handler\n})" },
      { caption: "find(selector)", snippet: "find('${1:.selector}')" },
      { caption: "findAll(selector)", snippet: "findAll('${1:.selector}')" },
      { caption: "replace(child)", snippet: "replace(${1:el('div').text('new')})" },
      { caption: "clear()", snippet: "clear()" },
      { caption: "empty()", snippet: "empty()" },
      { caption: "remove()", snippet: "remove()" },
      { caption: "show()", snippet: "show()" },
      { caption: "hide()", snippet: "hide()" },
      { caption: "toggle()", snippet: "toggle()" },
      { caption: "value(val)", snippet: "value('${1:value}')" },
      { caption: "getValue()", snippet: "getValue()" },
      { caption: "placeholder('...')", snippet: "placeholder('${1:placeholder}')" },
      { caption: "id('...')", snippet: "id('${1:id}')" },
      { caption: "type('...')", snippet: "type('${1:text}')" },
      { caption: "width('...')", snippet: "width('${1:100%}')" },
      { caption: "height('...')", snippet: "height('${1:auto}')" },
      { caption: "padding('...')", snippet: "padding('${1:8px}')" },
      { caption: "margin('...')", snippet: "margin('${1:8px}')" },
      { caption: "flex(direction)", snippet: "flex('${1:row}')" },
      { caption: "grid(columns)", snippet: "grid('${1:1fr 1fr}')" },
      { caption: "justify(value)", snippet: "justify('${1:center}')" },
      { caption: "items(value)", snippet: "items('${1:center}')" },
      { caption: "gap(value)", snippet: "gap('${1:8px}')" },
      { caption: "link(obj, name)", snippet: "link(${1:refs}, '${2:name}')" }
    ];
    var eljsCompleter = {
      getCompletions: function(editor, session, pos, prefix, callback) {
        var line = session.getLine(pos.row).slice(0, pos.column);
        var isChainContext = /el\s*\([^)]*\)(?:\s*\.\s*[a-zA-Z_$][\w$]*)*\.?\s*$/.test(line) || /\.\s*[a-zA-Z_$]*$/.test(line);
        if (!isChainContext) return callback(null, []);

        var completions = eljsMethods.map(function(method) {
          return {
            caption: method.caption,
            snippet: method.snippet,
            value: method.snippet,
            meta: 'el.js',
            score: 1000
          };
        });

        if (/^\s*$/.test(prefix) || /^(e|el)$/.test(prefix)) {
          completions.push({
            caption: "el('div')",
            value: "el('div')",
            meta: 'el.js',
            score: 1100
          });
        }

        callback(null, completions);
      }
    };
    editor.completers = [eljsCompleter, langTools.snippetCompleter, langTools.textCompleter, langTools.keyWordCompleter];

    // Ctrl+S / Cmd+S to save
    editor.commands.addCommand({
      name: 'saveFile',
      bindKey: { win: 'Ctrl-S', mac: 'Command-S' },
      exec: function(editor) {
        if (currentFile) {
          saveFile(currentFile, editor.getValue()).then(function() {
            return saveProject();
          }).then(function() {
            appendLog('info', ['Saved "' + currentFile + '" in "' + currentProject + '".']);
            runPreview();
          });
        }
      },
      readOnly: false
    });

    // Auto-save on editor change, preview updates after save completes
    editor.on('change', function() {
      console.log('===== EDITOR CHANGE EVENT FIRED =====');
      console.log('currentFile:', currentFile);
      console.log('isLoadingFile:', isLoadingFile);
      
      // Skip if loading file or no current file
      if (!currentFile || isLoadingFile) {
        console.log('SKIPPING - no file or loading');
        return;
      }
      if (!autoSaveEnabled) {
        return;
      }
      
      console.log('Clearing timers and scheduling preview refresh...');
      
      // Clear save debounce timer
      clearTimeout(debounceTimer);
      
      // Save to IndexedDB after 800ms (to avoid too many writes)
      debounceTimer = setTimeout(function() {
        console.log('[Auto-save] Saving to IndexedDB...');
        saveFile(currentFile, editor.getValue()).then(function() {
          console.log('[Auto-save] File saved to IndexedDB');
          runPreview();
        }).catch(function(err) {
          console.error('[Auto-save] Save failed:', err);
        });
      }, 800);
    });
    
    console.log('[✓] Auto-save and auto-preview event listeners attached');

    // Initialize IndexedDB and file list
    await openDB();
    var savedAutoSaveEnabled = await loadSetting('autoSaveEnabled');
    if (savedAutoSaveEnabled !== null && savedAutoSaveEnabled !== undefined) {
      autoSaveEnabled = !!savedAutoSaveEnabled;
    }
    var savedEditorFontSize = parseInt(await loadSetting('editorFontSize'), 10);
    if (!isNaN(savedEditorFontSize)) {
      editorFontSize = Math.min(32, Math.max(10, savedEditorFontSize));
      if (editor) editor.setFontSize(editorFontSize);
    }
    var savedCustomSnippets = await loadSetting('customSnippets');
    if (Array.isArray(savedCustomSnippets)) {
      customSnippets = savedCustomSnippets.filter(function(item) {
        return item && item.name && item.tabTrigger && item.content;
      });
      registerCustomSnippets();
    }
    await refreshAuthState();

    // Pre-fetch el.js and cache for sandboxed iframe
    var elJsResponse = await fetch(window.location.origin + '/el.js');
    var elJsText = await elJsResponse.text();
    window.__elcode_eljs_raw__ = elJsText;

    // Restore last project from localStorage
    var lastProject = localStorage.getItem('elcode-lastProject');
    if (lastProject) {
      currentProject = lastProject;
      connector.projectName.textContent = currentProject;
    }

    var files = await listFiles();
    if (files.length === 0) {
      await saveFile('main.js', "// ============================================\n"
        + "// el.js Editor - Getting Started\n"
        + "// ============================================\n"
        + "// el.js is a lightweight DOM builder. Create elements with `el(tag)`,\n"
        + "// chain methods to style/structure them, then call `.get()` to get\n"
        + "// the real DOM node for appending.\n\n"
        + "let app = document.getElementById('app');\n\n"
        + "// --- Basic element with text ---\n"
        + "let title = el('h1')\n"
        + "  .text('Welcome to el.js!')\n"
        + "  .class('text-2xl font-bold mb-4 text-gray-600');\n\n"
        + "// --- HTML content (great for large lists) ---\n"
        + "let subtitle = el('p')\n"
        + "  .html('<span class=\\\"text-gray-400\\\">Build UI with simple method chaining</span>');\n\n"
        + "// --- Nested children with .child() ---\n"
        + "let card = el('div')\n"
        + "  .class('bg-gray-800 p-4 rounded-lg mb-4')\n"
        + "  .child([\n"
        + "    el('h2').text('Features').class('text-lg font-semibold mb-2 text-white'),\n"
        + "    el('ul').class('list-disc pl-5 space-y-1 text-gray-300').child([\n"
        + "      el('li').text('.text()  - set text content'),\n"
        + "      el('li').text('.html() - set innerHTML (fast for bulk)'),\n"
        + "      el('li').text('.child() - nest other el() elements'),\n"
        + "      el('li').text('.class() - add Tailwind / CSS classes'),\n"
        + "      el('li').text('.css()  - inline styles'),\n"
        + "      el('li').text('.click() - attach event handlers'),\n"
        + "    ])\n"
        + "  ]);\n\n"
        + "// --- Event handling ---\n"
        + "let btn = el('button')\n"
        + "  .text('Click Me')\n"
        + "  .class('px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white cursor-pointer')\n"
        + "  .click(function() {\n"
        + "    alert('Hello from el.js!');\n"
        + "  });\n\n"
        + "// --- Import another file ---\n"
        + "// 1. Create a new file (e.g., card.js) in the file list.\n"
        + "// 2. Export your element: export default el('div').text('My Card');\n"
        + "// 3. Import it here: import myCard from './card.js';\n"
        + "// 4. Append it: app.appendChild(myCard.get());\n\n"
        + "// --- Render everything ---\n"
        + "let container = el('div').padding('10px').child([title, subtitle, card]);\n"
        + "app.appendChild(container.get());\n"
      );
      await saveProject();
    }
    refreshFileList();
    openFile('main.js');
    setTimeout(function() { runPreview(); }, 500);

    var importIntent = consumeEditorStoreImportIntent();
    if (importIntent.slug) {
      await importStoreProjectFromSlug(importIntent.slug, { fromMyPublish: importIntent.fromMyPublish });
      try {
        var cleanUrl = window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);
      } catch (e) {}
    }

    // Resizable logs panel
    var resizer = connector.resizer;
    var logsPanel = connector.logsPanel;
    var parent = logsPanel.parentElement;

    resizer.addEventListener('mousedown', function(e) {
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', doDrag);
      document.addEventListener('mouseup', stopDrag);
      e.preventDefault();
    });

    function doDrag(e) {
      var rect = parent.getBoundingClientRect();
      var newHeight = rect.bottom - e.clientY - 3;
      if (newHeight < 60) newHeight = 60;
      if (newHeight > rect.height - 66) newHeight = rect.height - 66;
      logsPanel.style.height = newHeight + 'px';
    }

    function stopDrag() {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', doDrag);
      document.removeEventListener('mouseup', stopDrag);
    }

    // Resizable file list
    var flResizer = connector.flResizer;
    var filelist = connector.filelist;
    var flParent = filelist.parentElement;

    flResizer.addEventListener('mousedown', function(e) {
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', doFLDrag);
      document.addEventListener('mouseup', stopFLDrag);
      e.preventDefault();
    });

    function doFLDrag(e) {
      var rect = flParent.getBoundingClientRect();
      var newWidth = e.clientX - rect.left - 3;
      if (newWidth < 100) newWidth = 100;
      if (newWidth > rect.width - 512) newWidth = rect.width - 512;
      filelist.style.width = newWidth + 'px';
    }

    function stopFLDrag() {
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', doFLDrag);
      document.removeEventListener('mouseup', stopFLDrag);
    }

    // Resizable preview iframe
    var hResizer = connector.hResizer;
    var hParent = connector.hResizer.parentElement;

    hResizer.addEventListener('mousedown', function(e) {
      document.body.style.userSelect = 'none';
      if (connector.preview) connector.preview.style.pointerEvents = 'none';
      document.addEventListener('mousemove', doHDrag);
      document.addEventListener('mouseup', stopHDrag);
      e.preventDefault();
    });

    function doHDrag(e) {
      var rect = hParent.getBoundingClientRect();
      var newWidth = rect.right - e.clientX - 3;
      if (newWidth < 200) newWidth = 200;
      var maxWidth = rect.width - 506;
      if (maxWidth < 200) maxWidth = 200;
      if (newWidth > maxWidth) newWidth = maxWidth;
      if (connector.previewWrap) connector.previewWrap.style.width = newWidth + 'px';
    }

    function stopHDrag() {
      document.body.style.userSelect = '';
      if (connector.preview) connector.preview.style.pointerEvents = '';
      document.removeEventListener('mousemove', doHDrag);
      document.removeEventListener('mouseup', stopHDrag);
    }

  });

  Elcode.api = function (Vue) {
  }

  return Elcode;

}))