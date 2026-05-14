/**
 * Layout justified per baris (mirip Google Images): isi lebar penuh kiri→kanan,
 * tinggi baris seragam dalam satu baris, baris berikutnya punya tinggi sendiri.
 */

function buildRows(aspects, containerW, gap, minRowH) {
  const rows = [];
  let start = 0;
  const n = aspects.length;
  while (start < n) {
    const row = [];
    let sumAr = 0;
    let k = start;
    while (k < n) {
      const ar = aspects[k];
      const nextCount = row.length + 1;
      const g = gap * Math.max(0, nextCount - 1);
      const nextRowH = (containerW - g) / (sumAr + ar);
      if (row.length > 0 && nextRowH < minRowH) break;
      row.push(k);
      sumAr += ar;
      k++;
    }
    if (row.length === 0) {
      row.push(start);
      sumAr = aspects[start];
      start++;
    } else {
      start = k;
    }
    rows.push({ indices: row, sumAr });
  }
  return rows;
}

function layoutRows(containerEl, cards, aspects, gap, minRowH, maxRowH) {
  const W = containerEl.clientWidth;
  if (W <= 0 || !cards.length) {
    containerEl.style.height = '';
    return;
  }

  const rows = buildRows(aspects, W, gap, minRowH);
  let y = 0;

  rows.forEach((row) => {
    const n = row.indices.length;
    const g = gap * Math.max(0, n - 1);
    let rowH = (W - g) / row.sumAr;
    rowH = Math.min(rowH, maxRowH);

    const rawSumW = row.sumAr * rowH;
    const scale = rawSumW > 0 ? (W - g) / rawSumW : 1;
    let x = 0;

    row.indices.forEach((cardIdx) => {
      const el = cards[cardIdx];
      const w = aspects[cardIdx] * rowH * scale;
      el.style.position = 'absolute';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${w}px`;
      el.style.height = `${rowH}px`;
      el.style.boxSizing = 'border-box';
      el.style.margin = '0';
      x += w + gap;
    });

    y += rowH + gap;
  });

  containerEl.style.height = `${Math.max(0, y - gap)}px`;
}

/**
 * @param {HTMLElement} containerEl
 * @param {{ gap?: number, minRowHeight?: number, maxRowHeight?: number, baseMeasureWidth?: number }} [options]
 * @returns {() => void} dispose — panggil saat kontainer dikosongkan / unmount
 */
export function attachJustifiedRowsLayout(containerEl, options = {}) {
  if (!containerEl || typeof ResizeObserver === 'undefined') {
    return () => {};
  }

  const gap = options.gap ?? 14;
  const minRowH = options.minRowHeight ?? 110;
  const maxRowH = options.maxRowHeight ?? 320;
  const baseW = options.baseMeasureWidth ?? 280;

  let ro = null;
  let disposed = false;
  let debounceT = null;

  function getCards() {
    return [...containerEl.querySelectorAll('[data-justified-card]')];
  }

  function measureAspects(cards) {
    const prevOp = containerEl.style.opacity;
    containerEl.style.opacity = '0';
    containerEl.style.display = 'block';

    cards.forEach((el) => {
      el.style.position = 'static';
      el.style.left = '';
      el.style.top = '';
      el.style.width = `${baseW}px`;
      el.style.height = 'auto';
      el.style.margin = '0 auto';
    });

    void containerEl.offsetHeight;

    const aspects = cards.map((el) => {
      const h = el.offsetHeight || 1;
      return baseW / h;
    });

    containerEl.style.opacity = prevOp;
    return aspects;
  }

  function runLayout() {
    if (disposed) return;
    const cards = getCards();
    if (!cards.length) {
      containerEl.style.height = '';
      return;
    }

    const aspects = measureAspects(cards);
    layoutRows(containerEl, cards, aspects, gap, minRowH, maxRowH);
    containerEl.style.opacity = '';
  }

  function scheduleLayout() {
    if (debounceT) clearTimeout(debounceT);
    debounceT = setTimeout(() => {
      debounceT = null;
      requestAnimationFrame(runLayout);
    }, 50);
  }

  containerEl.style.position = 'relative';
  containerEl.style.display = 'block';

  requestAnimationFrame(() => {
    requestAnimationFrame(runLayout);
  });

  ro = new ResizeObserver(scheduleLayout);
  ro.observe(containerEl);

  return function dispose() {
    disposed = true;
    if (debounceT) clearTimeout(debounceT);
    if (ro) {
      ro.disconnect();
      ro = null;
    }
    containerEl.style.height = '';
  };
}
