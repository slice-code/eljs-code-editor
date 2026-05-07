# el.js

A lightweight DOM manipulation library with a fluent chaining API, paired with a layouting system for building single-page applications.

## Overview

This project provides two core libraries:

- **el.js** — A minimal DOM wrapper for creating elements, applying styles, handling events, and managing children with a chainable API.
- **layouting/layout.js** — A routing and layout system built on top of el.js, providing navbar, sidebar, page routing, themes, toasts, modals, and more.

## Quick Start

Open `index.html` directly in a browser, or run the local server:

```bash
node index.js
```

Then visit `http://localhost:3000`.

## el.js

### Creating Elements

```js
const box = el('div')
  .css({ padding: '20px', background: '#fff', borderRadius: '8px' })
  .child([
    el('h2').text('Hello'),
    el('p').text('World')
  ]);

document.getElementById('app').appendChild(box.get());
```

### Wrapping Existing DOM Nodes

```js
const node = document.getElementById('app');
el(node).css({ color: 'red' });
```

### SVG Support

```js
const circle = el('circle')
  .attr('cx', 50)
  .attr('cy', 50)
  .attr('r', 40)
  .attr('fill', 'blue');
```

### Key Methods

| Method | Description |
|--------|-------------|
| `.text(str)` | Set innerText |
| `.html(str)` | Set innerHTML |
| `.css({ key: value })` | Apply inline styles |
| `.class('a b')` | Add CSS classes |
| `.attr(name, value)` | Set any attribute |
| `.data(name, value)` | Set data-* attribute |
| `.click(fn)` | Attach click handler |
| `.on(event, fn)` | Attach any event listener |
| `.child(el)` / `.child([a, b])` | Add children |
| `.get()` | Materialize and return the real DOM node |
| `.link(obj, name)` | Store DOM reference for later use |

See [eljs-cheatsheet.md](eljs-cheatsheet.md) for the full API reference.

## Layout System

The layout system provides a complete app shell with routing, navigation, and UI components.

### Setup

```js
layout.addPage({
  path: '/',
  component: () => {
    return el('div').text('Home Page');
  }
});

layout.addPage({
  path: '/about',
  component: () => {
    return el('div').text('About Page');
  }
});

layout.addSideMenu([
  { name: 'Home', page: '/', icon: 'fas fa-home' },
  { name: 'About', page: '/about', icon: 'fas fa-info' }
]);

layout.addNavbar([
  { name: 'Home', page: '/' },
  { name: 'About', page: '/about' }
]);

layout.render();
```

### Navigation

```js
layout.navigate('/about');
```

### Themes

```js
setLayoutTheme('blue');   // default, blue, dark, light, purple, green, red, orange, teal, pink, gray
```

### Notifications

```js
layout.toast('Hello world', { type: 'success', duration: 3000 });
layout.notify({ message: 'Info message', type: 'info' });
```

### Confirm Dialog

```js
layout.confirm({
  title: 'Delete?',
  message: 'Are you sure?',
  onConfirm: () => { /* ... */ },
  onCancel: () => { /* ... */ }
});
```

### Custom Modal

```js
layout.modal({
  title: 'Modal Title',
  content: el('div').text('Custom content'),
  size: 'medium' // small, medium, large, full
});
```

### RBAC (Role-Based Access Control)

```js
layout.setRole('admin');

layout.addPage({
  path: '/admin',
  roles: ['admin'],
  component: () => el('div').text('Admin only')
});
```

### Middleware

```js
layout.middleware(async (path, pageConfig) => {
  if (path === '/protected' && !isLoggedIn()) {
    return { allowed: false, redirect: '/login' };
  }
  return { allowed: true };
});
```

## Project Structure

```
.
├── el.js                    # Core DOM manipulation library
├── layouting/layout.js      # Layout and routing system
├── code-editor/             # ACE-based code editor component
│   ├── code.js
│   ├── zip.js
│   ├── ace/
│   └── css/
├── index.html               # Main application entry point
├── index.js                 # Local development server
├── practice.html            # Practice/playground page
├── eljs-cheatsheet.md       # API cheat sheet
└── README.md                # This file
```

## Browser Support

el.js works in all modern browsers. It uses standard DOM APIs and does not require any build step or bundler.

## License

Supported by slice-code.com
