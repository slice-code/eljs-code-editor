# el.js Cheat Sheet

## What it is
- `el.js` is a lightweight DOM wrapper library.
- `el(tag)` returns a chainable wrapper object.
- Wrapper object fields:
  - `.el` = actual DOM node
  - `.ch` = queued child elements
- Use it to build HTML/SVG elements and attach behavior.

## Core pattern
```js
const box = el('div')
  .css({ padding: '10px', background: '#fff' })
  .text('Hello');

const root = el('div')
  .child(box)
  .get();

document.body.appendChild(root);
```

## Important methods
- `el('div')` — create a new element
- `el(node)` — wrap an existing DOM node
- `.text('text')` — set element text
- `.textContent('text')` — set raw text content
- `.html('<b>hi</b>')` — set inner HTML
- `.css({ prop: value })` — apply styles
- `.style({...})` — alias for `.css()`
- `.attr(name, value)` — set an attribute
- `.attrRemove(name)` — remove an attribute
- `.data(name, value)` — set a `data-*` attribute
- `.aria(name, value)` — set an `aria-*` attribute
- `.class('a b')` — add classes
- `.clearClass()` — remove all classes
- `.removeClass('a')`
- `.toggleClass('a')`
- `.hasClass('a')`
- `.on(event, fn)` — attach a generic event listener
- `.click(fn)` — attach a click handler
- `.hover(enterFn, leaveFn)` — attach mouse enter/leave callbacks
- `.focus(fn)` / `.blur(fn)` — focus/blur event handlers
- `.change(fn)` — attach a change listener
- `.keydown(fn)`, `.keyup(fn)`, `.keypress(fn)`, `.input(fn)` — keyboard/input events
- `.paste(fn)` — paste event
- `.mouseover(fn)`, `.mouseout(fn)`, `.mousedown(fn)`, `.mouseup(fn)` — mouse events
- `.touchstart(fn)`, `.touchend(fn)`, `.touchmove(fn)` — touch events
- `.dblclick(fn)` — double click
- `.contextmenu(fn)` — right-click menu
- `.wheel(fn)` — wheel event
- `.scroll(fn)` — scroll event
- `.resize(fn)` — window resize helper
- `.load(fn)` — run callback after initial load
- `.submit(fn)` — form submit helper
- `.find(selector)` — query inside the wrapper
- `.findAll(selector)` — query all descendants
- `.closest(selector)` — ancestor lookup
- `.next()`, `.prev()` — sibling traversal
- `.first()`, `.last()`, `.eq(index)` — child access
- `.getParent()`, `.getChildren()`, `.getSiblings()` — DOM traversal helpers
- `.getIndex()` — index among siblings
- `.getWidth()`, `.getHeight()` — element dimensions

## Child handling
- `.child(elObject)` accepts:
  - wrapper objects created by `el(..)`
  - native `HTMLElement`
  - arrays of wrappers/elements
  - `Promise` values that resolve to wrappers/elements
- Child nodes are queued in `.ch`.
- Use `.get()` to attach queued children to `.el`.

## `.get()` behavior
- `.get()` appends all queued children in `.ch` to `.el`.
- Returns the actual DOM node.
- Call `.get()` on the root wrapper before appending it into the page.
- If a wrapper is already attached to DOM and you later add children with `.child()`, call `.get()` again to render the new children.

## `.link()` helper
- `.link(obj, name)` stores the wrapper's real DOM node in `obj[name]`.
- It does not change the wrapper return value, so you can still chain methods after `.link()`.
- Use it when you want an external reference to the actual DOM element for later DOM manipulation.
- This is especially useful if you need to update the element after it has already been attached to the page.

Example:
```js
const ref = {};
el('input')
  .type('checkbox')
  .link(ref, 'el')
  .text('Toggle');

console.log(ref.el); // actual <input> DOM node
```

### Using `.link()` for DOM manipulation
```js
const connectorLink = {};
const listHtml = el('ul')
  .link(connectorLink, 'list')
  .child(
    data.map(item => el('li').text(item.name))
  );

app.appendChild(listHtml.get());

const thisListHtml = connectorLink.list;
el(thisListHtml).clear();
```

- `connectorLink.list` is the real `<ul>` DOM node stored by `.link()`.
- `el(thisListHtml)` wraps that DOM node again so you can use el.js helper methods like `.clear()`.
- This pattern is useful when you need a persistent DOM reference across later updates.

## Shortcut style methods
- `.width(value)`, `.height(value)`
- `.margin(value)`, `.padding(value)`
- `.border(value)`, `.borderTop(value)`, `.borderBottom(value)`, `.borderLeft(value)`, `.borderRight(value)`
- `.radius(value)` — border-radius
- `.background(value)`, `.backgroundImage(url)`, `.backgroundSize(value)`, `.backgroundRepeat(value)`, `.backgroundPosition(value)`
- `.color(value)`
- `.font(value)`, `.fontWeight(value)`
- `.align(value)`, `.size(value)`
- `.display(value)`, `.flex(direction)`, `.grid(columns)`
- `.justify(value)`, `.items(value)`, `.self(value)`, `.gap(value)`, `.wrap(value)`
- `.cursor(value)`, `.opacity(value)`, `.zIndex(value)`, `.overflow(value)`, `.transform(value)`, `.transition(value)`

## Other DOM helpers
- `.prepend(child)` — insert before existing content
- `.remove()` — remove element from DOM
- `.off(event, fn)` — remove event listener
- `.selectAll()` — select text inside input
- `.scrollTo(x, y)` — scroll element
- `.scrollIntoView(options)` — bring element into view
- `.styleRemove(name)` — remove inline style property
- `.cssText(text)` — set full inline CSS text

## Value and property getters
- `.getValue()` / `.getVal()` — read input value
- `.getText()` — read inner text
- `.getHtml()` — read innerHTML
- `.getAttr(name)` — read attribute
- `.getData(name)` — read data-* value
- `.getStyle(name)` — read computed style

## Useful helpers
- `.clear()` — clears inner HTML
- `.empty()` — clears content and resets child queue
- `.replace(child)` — replace wrapper content
- `.show()`, `.hide()`, `.toggle()`
- `.disabled(bool)`
- `.required(bool)`
- `.checked(bool)`

## Best practices
- Build children first.
- Call `.get()` once at the end.
- If the wrapper is already mounted and you add children later, call `.get()` again.
- Avoid mixing raw DOM and wrapper logic without using `.link()`.
- Use `.child([a, b])` for grouped children.
- Keep event callbacks using native `this`.

## Quick example
```js
const card = el('div')
  .css({ padding: '20px', border: '1px solid #ddd' });

const title = el('h2').text('Title');
const button = el('button')
  .text('Click')
  .click(() => alert('ok'));

card.child([title, button]);
document.body.appendChild(card.get());
```

## Summary
`el.js` is not a virtual DOM library. It is a small builder around real DOM nodes with a queued child tree and fluent API. `.child()` collects children, `.get()` materializes them, and `.link()` gives outside access to the actual DOM element.
