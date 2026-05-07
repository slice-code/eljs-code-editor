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

  const uuid = function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  // ===== IndexedDB Helpers =====
  const DB_NAME = 'elcode-editor';
  const DB_VERSION = 2;
  const FILE_STORE = 'files';
  const PROJECT_STORE = 'projects';
  var db = null;

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
      };
      req.onsuccess = function(e) { db = e.target.result; resolve(db); };
      req.onerror = function(e) { reject(e); };
    });
  }

  function saveFile(name, content) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).put({ project: currentProject, name: name, content: content });
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e); };
    });
  }

  function loadFile(name) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(FILE_STORE, 'readonly');
      var req = tx.objectStore(FILE_STORE).get([currentProject, name]);
      req.onsuccess = function(e) { resolve(e.target.result ? e.target.result.content : null); };
      req.onerror = function(e) { reject(e); };
    });
  }

  function listFiles() {
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
  }

  function deleteFile(name) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(FILE_STORE, 'readwrite');
      tx.objectStore(FILE_STORE).delete([currentProject, name]);
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e); };
    });
  }

  // ===== Project Helpers =====
  function saveProject() {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PROJECT_STORE, 'readwrite');
      tx.objectStore(PROJECT_STORE).put({ name: currentProject, updatedAt: Date.now() });
      tx.oncomplete = function() { resolve(); };
      tx.onerror = function(e) { reject(e); };
    });
  }

  function listProjects() {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PROJECT_STORE, 'readonly');
      var req = tx.objectStore(PROJECT_STORE).getAll();
      req.onsuccess = function(e) { resolve(e.target.result || []); };
      req.onerror = function(e) { reject(e); };
    });
  }

  function deleteProject(name) {
    return new Promise(function(resolve, reject) {
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
    });
  }

  function loadProject(name) {
    currentProject = name;
    localStorage.setItem('elcode-lastProject', name);
    connector.projectName.textContent = name;
    currentFile = null;
    isLoadingFile = true;
    editor.setValue('', -1);
    isLoadingFile = false;
    refreshFileList();
    listFiles().then(function(files) {
      if (files.indexOf('main.js') !== -1) {
        openFile('main.js');
      } else if (files.length > 0) {
        openFile(files[0]);
      }
      setTimeout(function() { runPreview(); }, 300);
    });
  }

  function renameProject(oldName, newName) {
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

  // ===== File List UI =====
  function renderFileList(files) {
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
          function() { if (currentFile !== name) this.style.backgroundColor = '#4a4a4a'; },
          function() { if (currentFile !== name) this.style.backgroundColor = 'transparent'; }
        ).click(function(e) {
          if (e.target.classList.contains('elcode-delete-btn')) return;
          openFile(name);
        }).child([
          el('span').text(name).css({ flex: '1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
          name !== 'main.js' ? el('span').text('x').class('elcode-delete-btn').css({
            color: '#888',
            cursor: 'pointer',
            fontSize: '10px',
            padding: '2px 4px',
            marginLeft: '4px'
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
          }) : el('span')
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

  function refreshFileList() {
    listFiles().then(function(files) { renderFileList(files); });
  }

  function openFile(name) {
    currentFile = name;
    isLoadingFile = true;
    loadFile(name).then(function(content) {
      editor.setValue(content || '', -1);
      isLoadingFile = false;
      var ext = name.split('.').pop();
      var modeMap = { js: 'javascript', html: 'html', css: 'css', json: 'json', ts: 'typescript' };
      editor.session.setMode('ace/mode/' + (modeMap[ext] || 'javascript'));
      refreshFileList();
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
  
  function killAndRecreateIframe() {
    var iframeEl = connector.preview;
    var parent = iframeEl.parentElement;
    var newIframe = document.createElement('iframe');
    newIframe.style.cssText = iframeEl.style.cssText;
    newIframe.className = iframeEl.className;
    newIframe.width = iframeEl.width;
    newIframe.sandbox = 'allow-scripts';
    parent.replaceChild(newIframe, iframeEl);
    connector.preview = newIframe;
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
    // Clear any existing timeout watchdog
    if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
    connector.logs.innerHTML = '';

    // Build user code then inject into sandboxed iframe
    listFiles().then(function(files) {
      var loadPromises = files.map(function(name) { return loadFile(name).then(function(c) { return { name: name, content: c }; }); });
      return Promise.all(loadPromises);
    }).then(function(allFiles) {
      var mainCode = allFiles.find(function(f) { return f.name === 'main.js'; });
      if (!mainCode) return;

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
  
      // Load into sandboxed iframe
      var iframeEl = connector.preview;
      iframeEl.sandbox = 'allow-scripts';
      iframeEl.srcdoc = htmlContent;
  
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


  if(typeof el === 'undefined') throw new Error('el is not defined, need el.js to use code-editor')

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
        el('button').text('Documentation').css({
          padding: '4px 12px', background: '#6b6b9f', color: '#fff', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#7c7cb0'; },
          function() { this.style.background = '#6b6b9f'; }
        ).click(function() {
          window.location.hash = '#/documentation';
        }),
        el('button').text('New').css({
          padding: '4px 12px', background: '#5a5', color: '#fff', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#6b6'; },
          function() { this.style.background = '#5a5'; }
        ).click(function() {
          var name = prompt('New project name:', 'New Project');
          if (name && name.trim()) {
            currentProject = name.trim();
            localStorage.setItem('elcode-lastProject', currentProject);
            connector.projectName.textContent = currentProject;
            currentFile = null;
            editor.setValue('', -1);
            saveFile('main.js', "// ============================================\n"
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
            ).then(function() {
              return saveProject();
            }).then(function() {
              refreshFileList();
              openFile('main.js');
              setTimeout(function() { runPreview(); }, 300);
              appendLog('info', ['New project "' + currentProject + '" created.']);
            });
          }
        }),
        el('button').text('Save').css({
          padding: '4px 12px', background: '#4a90d9', color: '#fff', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#5aa0e9'; },
          function() { this.style.background = '#4a90d9'; }
        ).click(function() {
          saveProject().then(function() {
            appendLog('info', ['Project "' + currentProject + '" saved.']);
          });
        }),
        el('button').text('Load').css({
          padding: '4px 12px', background: '#555', color: '#eee', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#666'; },
          function() { this.style.background = '#555'; }
        ).click(function() {
          showProjectLoadDialog();
        }),
        el('button').text('Export').css({
          padding: '4px 12px', background: '#8a6d3b', color: '#fff', border: 'none',
          borderRadius: '3px', cursor: 'pointer', fontSize: '12px', fontFamily: 'sans-serif'
        }).hover(
          function() { this.style.background = '#a07d4b'; },
          function() { this.style.background = '#8a6d3b'; }
        ).click(function() {
          exportProject();
        })
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
      el('iframe').link(connector, 'preview').attr('sandbox', 'allow-scripts').width('450px').class('elcode-editor').css({
        backgroundColor: '#fff',
      }),
    ]),
  ]).load(async function(){
    // area for initialization code
    await import('./ace/ace.js');
    await import('./ace/ext-language_tools.js');
    ace.config.set('basePath', '/code-editor/ace');
    editor = ace.edit(connector.editorace.id);
    editor.setTheme("ace/theme/ambiance");
    editor.session.setMode("ace/mode/javascript");
    editor.setOptions({
      enableBasicAutocompletion: true,
      enableLiveAutocompletion: true,
      enableSnippets: true,
    });

    // Auto-save and auto-run on editor change
    editor.session.on('change', function() {
      if (!currentFile || isLoadingFile) return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function() {
        saveFile(currentFile, editor.getValue()).then(function() {
          runPreview();
        });
      }, 800);
    });

    // Initialize IndexedDB and file list
    await openDB();

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
    var preview = connector.preview;
    var hParent = preview.parentElement;

    hResizer.addEventListener('mousedown', function(e) {
      document.body.style.userSelect = 'none';
      preview.style.pointerEvents = 'none';
      document.addEventListener('mousemove', doHDrag);
      document.addEventListener('mouseup', stopHDrag);
      e.preventDefault();
    });

    function doHDrag(e) {
      var rect = hParent.getBoundingClientRect();
      var newWidth = rect.right - e.clientX - 3;
      if (newWidth < 200) newWidth = 200;
      if (newWidth > rect.width - 506) newWidth = rect.width - 506;
      preview.style.width = newWidth + 'px';
    }

    function stopHDrag() {
      document.body.style.userSelect = '';
      preview.style.pointerEvents = '';
      document.removeEventListener('mousemove', doHDrag);
      document.removeEventListener('mouseup', stopHDrag);
    }

  });

  Elcode.api = function (Vue) {
  }

  return Elcode;

}))