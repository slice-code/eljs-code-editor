/** Elemen status preview aktif (satu listener global, hindari leak saat buka detail berulang). */
var storeDetailPreviewStatusEl = null;

function storeDetailOnPreviewMessage(ev) {
  const d = ev.data;
  if (!d || typeof d !== 'object' || !storeDetailPreviewStatusEl) return;
  if (d.type === '__store_preview_log__') {
    const args = Array.isArray(d.args) ? d.args.join(' ') : '';
    storeDetailPreviewStatusEl.textContent = (d.level === 'error' ? 'Error: ' : '') + args;
  }
}

if (typeof window !== 'undefined' && !window.__storeDetailPreviewMsgHook) {
  window.__storeDetailPreviewMsgHook = true;
  window.addEventListener('message', storeDetailOnPreviewMessage);
}

export function createStoreDetailPage() {
  const refs = {};

  var LOOP_MAX_ITERATIONS = 10000;

  function addLoopProtection(code) {
    var id = 0;
    code = code.replace(/(while\s*\([^)]*\)\s*\{|do\s*\{)/g, function(match) {
      id++;
      return 'var __lp' + id + '=0;' + match + 'if(++__lp' + id + '>' + LOOP_MAX_ITERATIONS + '){throw new Error("Loop limit: max ' + LOOP_MAX_ITERATIONS + ' iterations on while/do loop. Possible infinite loop.");}';
    });
    return code;
  }

  function detectHeavyLoops(code) {
    var forMatch = code.match(/for\s*\([^;]*;[^;]*[<>]=?\s*(\d+)/g);
    if (forMatch) {
      for (var i = 0; i < forMatch.length; i++) {
        var numMatch = forMatch[i].match(/(\d+)/);
        if (numMatch && parseInt(numMatch[1], 10) > 10000) {
          return { blocked: true, reason: 'for loop with ' + numMatch[1] + ' iterations detected. Max allowed: 10000.' };
        }
      }
    }
    if (/while\s*\(\s*(true|1)\s*\)/.test(code)) {
      return { blocked: true, reason: 'while(true) detected. Infinite loops are not allowed in preview.' };
    }
    return { blocked: false };
  }

  /** Sama konsep dengan preview di code-editor: bundle main.js + import inline + el.js + tailwind. */
  function buildPreviewSrcdoc(allFiles, elJsRaw) {
    var mainEntry = allFiles.find(function(f) { return f.name === 'main.js'; });
    if (!mainEntry) {
      return { error: 'Project ini tidak punya main.js untuk preview.' };
    }

    for (var i = 0; i < allFiles.length; i++) {
      var check = detectHeavyLoops(allFiles[i].content || '');
      if (check.blocked) {
        return { error: 'Preview diblokir (' + allFiles[i].name + '): ' + check.reason };
      }
    }

    var resolvedFiles = {};
    allFiles.forEach(function(f) {
      resolvedFiles[f.name] = addLoopProtection(f.content || '');
    });

    var mainContent = resolvedFiles['main.js'];

    var htmlContent = '<!DOCTYPE html><html><head>'
      + '<script src="https://cdn.tailwindcss.com"></' + 'script>'
      + '<script>' + elJsRaw + '</' + 'script>'
      + '</head><body><div id="app"></div>'
      + '<script>\n'
      + 'window.console = {\n'
      + '  log: function() {}, error: function() {}, warn: function() {}, info: function() {}, clear: function() {}\n'
      + '};\n'
      + 'window.onerror = function(msg, url, line) {\n'
      + '  window.parent.postMessage({type:"__store_preview_log__", level:"error", args:[msg + (line ? " (line "+line+")" : "")]}, "*");\n'
      + '};\n'
      + 'window.onunhandledrejection = function(e) {\n'
      + '  window.parent.postMessage({type:"__store_preview_log__", level:"error", args:["Unhandled rejection: "+(e.reason&&e.reason.message?e.reason.message:e.reason)]}, "*");\n'
      + '};\n'
      + '</' + 'script>\n';

    var fileEntries = allFiles.filter(function(f) { return f.name !== 'main.js'; });
    var finalMain = mainContent;
    fileEntries.forEach(function(f) {
      var escaped = f.name.replace(/\./g, '\\.');
      var inlineUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(resolvedFiles[f.name]).replace(/'/g, '%27');
      finalMain = finalMain.replace(new RegExp('from\\s*[\'"]\\./' + escaped + '[\'"]', 'g'), "from '" + inlineUrl + "'");
      finalMain = finalMain.replace(new RegExp('from\\s*[\'"]' + escaped + '[\'"]', 'g'), "from '" + inlineUrl + "'");
      finalMain = finalMain.replace(new RegExp('import\\s*[\'"]\\./' + escaped + '[\'"]', 'g'), "import '" + inlineUrl + "'");
      finalMain = finalMain.replace(new RegExp('import\\s*[\'"]' + escaped + '[\'"]', 'g'), "import '" + inlineUrl + "'");
      finalMain = finalMain.replace(new RegExp('import\\(\\s*[\'"]\\./' + escaped + '[\'"]\\s*\\)', 'g'), "import('" + inlineUrl + "')");
      finalMain = finalMain.replace(new RegExp('import\\(\\s*[\'"]' + escaped + '[\'"]\\s*\\)', 'g'), "import('" + inlineUrl + "')");
    });

    finalMain = finalMain.replace(/<\/script>/gi, '<\/scr" + "ipt>');
    htmlContent += '<script type="module">\n'
      + finalMain + '\n'
      + ';window.parent.postMessage({type:"__store_preview_done__"}, "*");\n'
      + '</' + 'script>\n'
      + '</body></html>';

    return { html: htmlContent };
  }

  var elJsFetchPromise = null;
  function getElJsRaw() {
    if (window.__elcode_eljs_raw__) {
      return Promise.resolve(window.__elcode_eljs_raw__);
    }
    if (!elJsFetchPromise) {
      elJsFetchPromise = fetch(new URL('el.js', window.location.href).toString(), { cache: 'force-cache' })
        .then(function(r) { return r.text(); })
        .then(function(t) {
          try { window.__elcode_eljs_raw__ = t; } catch (e) {}
          return t;
        });
    }
    return elJsFetchPromise;
  }

  function getStoreSlugFromLocation() {
    const hash = window.location.hash || '';
    const qIndex = hash.indexOf('?');
    if (qIndex === -1) return '';
    const params = new URLSearchParams(hash.slice(qIndex + 1));
    return (params.get('slug') || '').trim();
  }

  function formatDate(isoString) {
    try {
      return new Date(isoString).toLocaleString();
    } catch (e) {
      return isoString || '-';
    }
  }

  function getSafeText(text, fallback = '-') {
    const raw = (text || '').trim();
    return raw || fallback;
  }

  function normalizeFilesFromApi(data) {
    const raw = Array.isArray(data.files) ? data.files : [];
    return raw
      .map(function(f) {
        return {
          name: getSafeText(f && f.name, ''),
          content: f && f.content != null ? String(f.content) : ''
        };
      })
      .filter(function(f) { return f.name; });
  }

  function renderCodeAndPreview(allFiles) {
    if (!refs.codePre || !refs.fileTabs || !refs.previewFrame || !refs.previewStatus) return;

    const pickDefault = function() {
      if (allFiles.some(function(f) { return f.name === 'main.js'; })) return 'main.js';
      return allFiles.length ? allFiles[0].name : '';
    };
    let selected = pickDefault();

    const fileMap = {};
    allFiles.forEach(function(f) { fileMap[f.name] = f.content; });

    function updatePre() {
      const body = fileMap[selected] != null ? fileMap[selected] : '';
      refs.codePre.textContent = body;
    }

    function renderTabs() {
      el(refs.fileTabs).empty().child(
        allFiles.map(function(f) {
          const name = f.name;
          const isSel = name === selected;
          return el('button')
            .attr('type', 'button')
            .text(name)
            .css({
              border: '1px solid #cbd5e1',
              borderRadius: '0.45rem',
              padding: '0.35rem 0.65rem',
              fontSize: '0.78rem',
              cursor: 'pointer',
              background: isSel ? '#0ea5e9' : '#f8fafc',
              color: isSel ? '#fff' : '#0f172a',
              fontWeight: '600'
            })
            .click(function() {
              selected = name;
              renderTabs();
              updatePre();
            });
        })
      ).get();
    }

    renderTabs();
    updatePre();

    refs.previewStatus.textContent = 'Memuat preview...';
    getElJsRaw().then(function(elRaw) {
      const built = buildPreviewSrcdoc(allFiles, elRaw);
      if (built.error) {
        refs.previewStatus.textContent = built.error;
        refs.previewFrame.removeAttribute('srcdoc');
        return;
      }
      refs.previewStatus.textContent = '';
      refs.previewFrame.sandbox = 'allow-scripts';
      refs.previewFrame.srcdoc = built.html;
    }).catch(function() {
      refs.previewStatus.textContent = 'Gagal memuat el.js untuk preview.';
    });
  }

  async function loadStoreDetail(slug) {
    if (!slug || !refs.detailPanel) return;
    el(refs.detailPanel).empty().child(
      el('div').text('Loading detail...').css({ color: '#64748b' })
    ).get();

    try {
      const res = await fetch(`https://slice-code.com/api/editor/store/${encodeURIComponent(slug)}`, { credentials: 'include' });
      const body = await res.json();
      if (!res.ok || body.success === false) {
        throw new Error((body && body.error && body.error.message) || body.message || 'Detail request failed');
      }

      const data = body.data || {};
      const allFiles = normalizeFilesFromApi(data);

      const targetSlug = getSafeText(data.slug || slug, '');

      refs.codePre = null;
      refs.fileTabs = null;
      refs.previewFrame = null;
      refs.previewStatus = null;

      el(refs.detailPanel).empty().child([
        el('div').css({
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1.1rem',
          alignItems: 'flex-start'
        }).child([
          el('div').css({ flex: '1 1 220px', minWidth: '200px' }).child(
            el('img').attr('src', data.thumbnail_url || './images/todolist.png').attr('alt', data.name || 'thumbnail').css({
              width: '100%',
              maxHeight: '260px',
              objectFit: 'cover',
              borderRadius: '0.7rem',
              background: '#f1f5f9'
            })
          ),
          el('div').css({ flex: '2 1 320px', minWidth: '240px' }).child([
            el('h3').text(getSafeText(data.name, 'Untitled')).css({ fontSize: '1.35rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.5rem', lineHeight: '1.3' }),
            el('div').text(getSafeText(data.description)).css({ color: '#334155', marginBottom: '0.75rem', lineHeight: '1.6' }),
            el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.2rem' }).text('Author: ' + getSafeText(data.author && data.author.name, 'Unknown')),
            el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.2rem' }).text('Published: ' + formatDate(data.published_at)),
            el('div').css({ fontSize: '0.9rem', color: '#64748b', marginBottom: '0.85rem' }).text('Views: ' + ((data.stats && data.stats.views) || 0) + ' | Likes: ' + ((data.stats && data.stats.likes) || 0)),
            el('div').css({ display: 'flex', gap: '8px', flexWrap: 'wrap' }).child([
              el('button').text('Back to Store').css({
                display: 'inline-flex',
                background: '#475569',
                color: '#fff',
                padding: '0.55rem 0.95rem',
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: '600'
              }).click(function() {
                window.location.hash = '/store';
              }),
              el('button').text('Open in Editor').css({
                display: 'inline-flex',
                background: '#2563eb',
                color: '#fff',
                padding: '0.55rem 0.95rem',
                borderRadius: '0.5rem',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: '600'
              }).click(function() {
                if (!targetSlug) return;
                try { sessionStorage.setItem('editor:storeSlug', targetSlug); } catch (e) {}
                window.location.hash = '/editor';
              })
            ])
          ])
        ]),
        el('div').css({
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'stretch'
        }).child([
          el('div').css({
            flex: '1 1 420px',
            minWidth: 0,
            border: '1px solid #e2e8f0',
            borderRadius: '0.85rem',
            overflow: 'hidden',
            background: '#0f172a'
          }).child([
            el('div').text('Kode').css({
              padding: '0.5rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: '700',
              color: '#e2e8f0',
              background: '#1e293b',
              borderBottom: '1px solid #334155'
            }),
            el('div').link(refs, 'fileTabs').css({
              padding: '0.5rem 0.75rem',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.45rem',
              background: '#1e293b',
              borderBottom: '1px solid #334155'
            }),
            el('pre').link(refs, 'codePre').css({
              margin: 0,
              padding: '0.85rem',
              maxHeight: 'min(55vh, 520px)',
              overflow: 'auto',
              fontSize: '0.8rem',
              lineHeight: 1.45,
              color: '#e2e8f0',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              whiteSpace: 'pre',
              minHeight: '200px'
            })
          ]),
          el('div').css({
            flex: '1 1 420px',
            minWidth: 0,
            border: '1px solid #e2e8f0',
            borderRadius: '0.85rem',
            overflow: 'hidden',
            background: '#fff',
            display: 'flex',
            flexDirection: 'column'
          }).child([
            el('div').text('Preview (iframe)').css({
              padding: '0.5rem 0.75rem',
              fontSize: '0.8rem',
              fontWeight: '700',
              color: '#0f172a',
              background: '#f1f5f9',
              borderBottom: '1px solid #e2e8f0'
            }),
            el('iframe').link(refs, 'previewFrame').attr('title', 'Preview project').css({
              width: '100%',
              minHeight: 'min(55vh, 480px)',
              flex: '1',
              border: 'none',
              background: '#fff',
              display: 'block'
            }),
            el('div').link(refs, 'previewStatus').css({
              fontSize: '0.78rem',
              color: '#b91c1c',
              padding: '0.4rem 0.75rem',
              background: '#fef2f2',
              borderTop: '1px solid #fecaca',
              minHeight: '1.5rem'
            })
          ])
        ])
      ]).get();

      if (allFiles.length === 0) {
        el(refs.fileTabs).empty().child(
          el('span').text('Tidak ada file di response API.').css({ color: '#94a3b8', fontSize: '0.8rem' })
        ).get();
        refs.previewStatus.textContent = 'Tidak ada file untuk di-preview.';
        storeDetailPreviewStatusEl = refs.previewStatus;
        return;
      }

      renderCodeAndPreview(allFiles);
      storeDetailPreviewStatusEl = refs.previewStatus;
    } catch (error) {
      storeDetailPreviewStatusEl = null;
      el(refs.detailPanel).empty().child(
        el('div').text('Gagal memuat detail: ' + (error.message || error)).css({ color: '#dc2626' })
      ).get();
    }
  }

  const page = el('div').css({
    width: '100%',
    maxWidth: 'none',
    margin: 0,
    boxSizing: 'border-box',
    padding: 'clamp(0.75rem, 2vw, 1.35rem)',
    fontFamily: 'Roboto, sans-serif'
  }).child([
    el('div').css({
      marginBottom: '1rem',
      border: '1px solid #dbeafe',
      borderRadius: '0.95rem',
      background: 'linear-gradient(135deg, #dbeafe 0%, #eff6ff 60%, #f8fafc 100%)',
      padding: '1rem'
    }).child([
      el('div').text('Store Detail').css({ fontSize: '1.25rem', fontWeight: '800', color: '#0f172a', marginBottom: '0.28rem' }),
      el('div').text('Detail project publish: kode sumber dan preview seperti di editor.').css({ color: '#334155', fontSize: '0.92rem' })
    ]),
    el('div').link(refs, 'detailPanel').css({
      background: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '0.95rem',
      padding: 'clamp(0.85rem, 2vw, 1.15rem)',
      minHeight: '300px',
      boxShadow: '0 10px 28px rgba(15,23,42,0.06)',
      width: '100%',
      boxSizing: 'border-box'
    }).child(
      el('div').text('Memuat detail project...').css({ color: '#64748b' })
    )
  ]);

  const slug = getStoreSlugFromLocation();
  if (!slug) {
    el(refs.detailPanel).empty().child(
      el('div').text('Slug detail tidak ditemukan. Buka dari halaman Store.').css({ color: '#dc2626' })
    ).get();
  } else {
    loadStoreDetail(slug);
  }

  return page;
}
