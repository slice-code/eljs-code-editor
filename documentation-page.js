export function createDocumentationPage() {
  function createDocSection(title, items) {
    return el('div').css({ marginBottom: '2rem' }).child([
      el('h2').text(title).css({ fontSize: '1.5rem', fontWeight: '700', color: '#1f2937', marginBottom: '1rem', borderBottom: '2px solid #e5e7eb', paddingBottom: '0.5rem' }),
      el('div').css({ display: 'grid', gap: '0.75rem' }).child(
        items.map(function(item) {
          return el('div').css({ background: '#f9fafb', borderRadius: '0.5rem', padding: '1rem', border: '1px solid #e5e7eb' }).child([
            el('code').text(item.method).css({ fontSize: '0.9rem', fontWeight: '600', color: '#2563eb', background: '#eff6ff', padding: '0.2rem 0.4rem', borderRadius: '0.25rem' }),
            el('p').text(item.desc).css({ fontSize: '0.9rem', color: '#4b5563', marginTop: '0.5rem', lineHeight: '1.5' }),
            item.example
              ? el('pre').text(item.example).css({ marginTop: '0.5rem', background: '#1f2937', color: '#e5e7eb', padding: '0.75rem', borderRadius: '0.375rem', fontSize: '0.8rem', overflowX: 'auto', fontFamily: "'Fira Code', 'Consolas', monospace" })
              : el('span')
          ]);
        })
      )
    ]);
  }

  return el('div').css({ maxWidth: '900px', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }).child([
    el('div').css({ marginBottom: '2.5rem', textAlign: 'center' }).child([
      el('h1').text('el.js Documentation').css({ fontSize: '2.25rem', fontWeight: '800', color: '#111827', marginBottom: '0.5rem' }),
      el('p').text('A lightweight DOM manipulation library with fluent chaining API.').css({ fontSize: '1rem', color: '#6b7280' })
    ]),

    el('div').css({ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '0.75rem', padding: '1.25rem', marginBottom: '2rem' }).child([
      el('h3').text('Core Pattern').css({ fontSize: '1.1rem', fontWeight: '700', color: '#1e40af', marginBottom: '0.75rem' }),
      el('pre').text("let app = document.getElementById('app');\n\nlet card = el('div')\n  .css({ padding: '20px', background: '#fff', borderRadius: '8px' })\n  .child([\n    el('h2').text('Hello'),\n    el('p').text('World')\n  ]);\n\napp.appendChild(card.get());").css({ background: '#1f2937', color: '#e5e7eb', padding: '1rem', borderRadius: '0.5rem', fontSize: '0.85rem', overflowX: 'auto', fontFamily: "'Fira Code', 'Consolas', monospace" })
    ]),

    createDocSection('Creating & Wrapping Elements', [
      { method: "el('tag')", desc: "Create a new HTML element. Supports SVG tags like svg, circle, rect, path, etc.", example: "el('div')\nel('button')\nel('svg')" },
      { method: 'el(domNode)', desc: 'Wrap an existing DOM node to use el.js methods on it.', example: "let node = document.getElementById('app');\nel(node).css({ color: 'red' });" },
      { method: '.get()', desc: 'Append all queued children and return the real DOM node. Call this at the end of your chain.', example: "let box = el('div').text('Hi').get();\ndocument.body.appendChild(box);" }
    ]),

    createDocSection('Content', [
      { method: ".text('str')", desc: 'Set innerText. For SVG elements, uses textContent.', example: "el('h1').text('Title')" },
      { method: ".textContent('str')", desc: 'Set raw textContent directly.', example: "el('span').textContent('raw')" },
      { method: ".html('<b>hi</b>')", desc: 'Set innerHTML. Fast for bulk content.', example: "el('div').html('<p>Paragraph</p>')" },
      { method: '.clear()', desc: 'Clear innerHTML. Pass true to also reset scroll positions.', example: 'el(container).clear(true)' },
      { method: '.empty()', desc: 'Clear innerHTML and reset the child queue.', example: 'el(container).empty()' },
      { method: '.replace(child)', desc: 'Replace content with a new child element.', example: "el(container).replace(el('p').text('New'))" }
    ]),

    createDocSection('Styling', [
      { method: '.css({ key: value })', desc: 'Apply multiple inline styles at once. Supports kebab-case and CSS variables.', example: "el('div').css({ padding: '10px', 'background-color': '#fff' })" },
      { method: ".css('key', 'value')", desc: 'Apply a single inline style.', example: "el('div').css('color', 'red')" },
      { method: '.style(...)', desc: 'Alias for .css()', example: "el('div').style({ color: 'blue' })" },
      { method: '.width(v), .height(v)', desc: 'Set element dimensions.', example: "el('div').width('100%').height('200px')" },
      { method: '.margin(v), .padding(v)', desc: 'Set margin or padding.', example: "el('div').margin('10px').padding('20px')" },
      { method: '.border(v), .borderTop(v), .borderBottom(v), .borderLeft(v), .borderRight(v)', desc: 'Set border properties.', example: "el('div').border('1px solid #ccc')" },
      { method: '.radius(v)', desc: 'Set borderRadius.', example: "el('div').radius('8px')" },
      { method: '.background(v), .backgroundImage(url)', desc: 'Set background color or image.', example: "el('div').background('#f3f4f6')" },
      { method: '.color(v), .font(v), .fontWeight(v), .size(v), .align(v)', desc: 'Text styling shortcuts.', example: "el('p').color('#333').size('14px').align('center')" },
      { method: '.display(v), .opacity(v), .zIndex(v), .cursor(v)', desc: 'Common display and interaction styles.', example: "el('div').display('flex').opacity('0.9')" },
      { method: '.overflow(v), .overflowX(v), .overflowY(v)', desc: 'Control content overflow.', example: "el('div').overflow('auto')" },
      { method: '.boxShadow(v), .transform(v), .transition(v)', desc: 'Visual effects.', example: "el('div').boxShadow('0 4px 6px rgba(0,0,0,0.1)')" },
      { method: '.maxWidth(v), .maxHeight(v), .minWidth(v), .minHeight(v)', desc: 'Size constraints.', example: "el('img').maxWidth('100%')" },
      { method: '.lineHeight(v), .gap(v)', desc: 'Typography and flex/grid gap.', example: "el('p').lineHeight('1.6')" },
      { method: '.fixed(), .top(v), .right(v), .bottom(v), .left(v)', desc: 'Positioning helpers.', example: "el('div').fixed().top('0').left('0')" },
      { method: '.float(v)', desc: 'Set CSS float.', example: "el('img').float('left')" },
      { method: '.outline(v)', desc: 'Set CSS outline.', example: "el('input').outline('none')" },
      { method: '.cssText(v)', desc: 'Set the full inline style string.', example: "el('div').cssText('color:red;padding:10px')" },
      { method: '.styleRemove(name)', desc: 'Remove an inline style property.', example: "el('div').styleRemove('color')" }
    ]),

    createDocSection('Classes', [
      { method: ".class('a b')", desc: 'Add CSS classes. Pass true as second arg to replace all existing classes.', example: "el('div').class('card shadow-lg')" },
      { method: '.clearClass()', desc: 'Remove all classes.', example: "el('div').clearClass()" },
      { method: ".removeClass('a')", desc: 'Remove a specific class.', example: "el('div').removeClass('hidden')" },
      { method: ".toggleClass('a')", desc: 'Toggle a class on/off.', example: "el('div').toggleClass('active')" },
      { method: ".hasClass('a')", desc: 'Check if element has a class. Returns boolean.', example: "if (el(div).hasClass('active')) { ... }" }
    ]),

    createDocSection('Attributes & Data', [
      { method: '.attr(name, value)', desc: 'Set any attribute.', example: "el('img').attr('alt', 'Photo')" },
      { method: '.attrRemove(name)', desc: 'Remove an attribute.', example: "el('input').attrRemove('disabled')" },
      { method: '.data(name, value)', desc: 'Set a data-* attribute.', example: "el('div').data('id', '123')" },
      { method: '.aria(name, value)', desc: 'Set an aria-* attribute.', example: "el('button').aria('label', 'Close')" },
      { method: ".id('myId')", desc: 'Set element id.', example: "el('div').id('header')" },
      { method: ".name('str'), .href('url'), .rel('str'), .src('url')", desc: 'Common attribute shortcuts.', example: "el('a').href('#/home').text('Home')" },
      { method: ".type('text'), .placeholder('str')", desc: 'Input attribute helpers.', example: "el('input').type('email').placeholder('Enter email')" },
      { method: '.required(), .disabled(bool), .checked(bool)', desc: 'Form state helpers.', example: "el('input').type('checkbox').checked(true)" },
      { method: '.draggable(bool)', desc: 'Set draggable attribute.', example: "el('div').draggable(true)" },
      { method: '.design(bool)', desc: 'Set contenteditable attribute.', example: "el('div').design(true)" },
      { method: '.index(n)', desc: 'Set tabIndex. Default is 0.', example: "el('button').index(1)" }
    ]),

    createDocSection('Events', [
      { method: '.click(fn)', desc: 'Attach a click handler.', example: "el('button').click(function() { alert('Hi'); })" },
      { method: '.on(event, fn)', desc: 'Attach any event listener.', example: "el('div').on('mouseenter', function() { ... })" },
      { method: '.hover(enterFn, leaveFn)', desc: 'Attach mouseenter and mouseleave handlers.', example: "el('div').hover(onEnter, onLeave)" },
      { method: '.focus(fn), .blur(fn)', desc: 'Attach focus/blur events, or trigger them if no function passed.', example: "el('input').focus(function() { ... })" },
      { method: '.change(fn), .input(fn)', desc: 'Input value change events.', example: "el('input').input(function() { console.log(this.value); })" },
      { method: '.keydown(fn), .keyup(fn), .keypress(fn)', desc: 'Keyboard events.', example: "el('input').keydown(function(e) { ... })" },
      { method: '.paste(fn)', desc: 'Paste event.', example: "el('input').paste(function(e) { ... })" },
      { method: '.mouseover(fn), .mouseout(fn), .mousedown(fn), .mouseup(fn)', desc: 'Mouse events.', example: "el('div').mousedown(function() { ... })" },
      { method: '.touchstart(fn), .touchend(fn), .touchmove(fn)', desc: 'Touch events.', example: "el('button').touchstart(function() { ... })" },
      { method: '.dblclick(fn), .contextmenu(fn), .wheel(fn), .scroll(fn)', desc: 'Advanced mouse and scroll events.', example: "el('div').scroll(function() { ... })" },
      { method: '.resize(fn)', desc: 'Window resize helper. Receives { el, width, height }.', example: "el('div').resize(function(info) { console.log(info.width); })" },
      { method: '.load(fn)', desc: 'Run callback after initial load with element info.', example: "el('div').load(function(info) { console.log(info.width); })" },
      { method: '.submit(fn)', desc: 'Form submit helper. Receives FormData as JSON object. Prevents default.', example: "el('form').submit(function(data) { console.log(data); })" },
      { method: '.off(event, fn)', desc: 'Remove an event listener.', example: "el('button').off('click', handler)" },
      { method: '.dragStart(fn), .dragEnd(fn), .dragEnter(fn)', desc: 'Drag and drop events.', example: "el('div').dragStart(function(e) { ... })" }
    ]),

    createDocSection('Child Handling', [
      { method: '.child(el)', desc: 'Add a single child element. Accepts wrapper objects, HTMLElements, or Promises.', example: "el('ul').child(el('li').text('Item'))" },
      { method: '.child([a, b, c])', desc: 'Add multiple children from an array. Max 1000 items.', example: "el('div').child([el('h1'), el('p')])" },
      { method: '.prepend(child)', desc: 'Insert a child before existing content.', example: "el('div').prepend(el('span').text('First'))" },
      { method: '.get()', desc: 'Materialize queued children into the DOM node. Must be called before appending.', example: "let node = el('div').child(el('span')).get();" },
      { method: '.link(obj, name)', desc: 'Store the real DOM node in obj[name] for later reference.', example: "let ref = {};\nel('input').link(ref, 'myInput').get();" }
    ]),

    createDocSection('Layout & Flexbox', [
      { method: '.flex(direction)', desc: 'Set display: flex. Optionally set flex-direction.', example: "el('div').flex('column')" },
      { method: '.grid(columns)', desc: 'Set display: grid. Optionally set grid-template-columns.', example: "el('div').grid('1fr 1fr')" },
      { method: '.justify(value)', desc: 'Set justify-content.', example: "el('div').justify('space-between')" },
      { method: '.items(value)', desc: 'Set align-items.', example: "el('div').items('center')" },
      { method: '.self(value)', desc: 'Set align-self.', example: "el('div').self('flex-end')" },
      { method: '.wrap(value)', desc: 'Set flex-wrap.', example: "el('div').wrap('wrap')" },
      { method: '.show(), .hide(), .toggle()', desc: 'Control element visibility via display property.', example: "el('div').hide() // display: none" }
    ]),

    createDocSection('DOM Traversal', [
      { method: '.find(selector)', desc: 'Query a single descendant. Returns an el wrapper or null.', example: "el(container).find('.item')" },
      { method: '.findAll(selector)', desc: 'Query all descendants. Returns array of el wrappers.', example: "el(container).findAll('li')" },
      { method: '.closest(selector)', desc: 'Find closest ancestor matching selector.', example: "el(node).closest('.card')" },
      { method: '.next(), .prev()', desc: 'Get next or previous sibling as el wrapper.', example: "el(item).next()" },
      { method: '.first(), .last(), .eq(index)', desc: 'Access child elements by position.', example: "el(list).first()" },
      { method: '.getParent()', desc: 'Return the parent element.', example: "el(node).getParent()" },
      { method: '.getChildren()', desc: 'Return the children HTMLCollection.', example: "el(node).getChildren()" },
      { method: '.getSiblings()', desc: 'Return all sibling elements.', example: "el(node).getSiblings()" },
      { method: '.getIndex()', desc: 'Return index among siblings.', example: "el(node).getIndex()" },
      { method: '.remove()', desc: 'Remove element from DOM.', example: "el(node).remove()" }
    ]),

    createDocSection('Getters', [
      { method: '.getValue() / .getVal()', desc: 'Read input value.', example: 'let v = el(input).getValue()' },
      { method: '.getText()', desc: 'Read innerText.', example: 'let t = el(div).getText()' },
      { method: '.getHtml()', desc: 'Read innerHTML.', example: 'let h = el(div).getHtml()' },
      { method: '.getAttr(name)', desc: 'Read an attribute value.', example: "let src = el(img).getAttr('src')" },
      { method: '.getData(name)', desc: 'Read a data-* value.', example: "let id = el(div).getData('id')" },
      { method: '.getStyle(name)', desc: 'Read computed style.', example: "let c = el(div).getStyle('color')" },
      { method: '.getWidth(), .getHeight()', desc: 'Read element dimensions (offsetWidth/Height).', example: 'let w = el(div).getWidth()' }
    ]),

    createDocSection('Utilities', [
      { method: '.loopFunc(callback, time)', desc: 'Run a callback repeatedly while element exists in DOM. Auto-stops on removal.', example: "el('div').loopFunc(function() { console.log('tick'); }, 1000)" },
      { method: '.addModule(name, func)', desc: 'Attach a custom function directly to the DOM node.', example: "el('div').addModule('greet', function() { ... })" },
      { method: '.selectAll()', desc: 'Select all text inside an input.', example: "el('input').selectAll()" },
      { method: '.scrollTo(x, y)', desc: 'Scroll element to position.', example: "el('div').scrollTo(0, 0)" },
      { method: '.scrollIntoView(options)', desc: 'Bring element into view.', example: "el('div').scrollIntoView({ behavior: 'smooth' })" },
      { method: '.roboto()', desc: 'Set font-family to Roboto.', example: "el('div').roboto()" },
      { method: '.getChild(index)', desc: 'Access a child by index with a helper object.', example: "el(parent).getChild(0).child(el('span'))" }
    ]),

    el('div').css({ background: '#f3f4f6', borderRadius: '0.75rem', padding: '1.25rem', marginTop: '2rem', marginBottom: '2rem' }).child([
      el('h3').text('Best Practices').css({ fontSize: '1.1rem', fontWeight: '700', color: '#374151', marginBottom: '0.75rem' }),
      el('ul').css({ paddingLeft: '1.25rem', color: '#4b5563', fontSize: '0.9rem', lineHeight: '1.75' }).child([
        el('li').text('Build children first, then call .get() once at the end.'),
        el('li').text('If a wrapper is already mounted and you add children later, call .get() again.'),
        el('li').text('Use .link() to store DOM references for later updates.'),
        el('li').text('Use .child([a, b]) for grouped children.'),
        el('li').text('Avoid mixing raw DOM and wrapper logic without using .link().'),
        el('li').text('Use .html() for large static content instead of many .child() calls.'),
        el('li').text('el.js is not a virtual DOM library — it works directly with real DOM nodes.')
      ])
    ]),

    el('div').css({ textAlign: 'center', paddingTop: '2rem', borderTop: '1px solid #e5e7eb', color: '#9ca3af', fontSize: '0.85rem' }).child([
      el('p').text('el.js v1.0.6 — slice-code.com')
    ])
  ]);
}

