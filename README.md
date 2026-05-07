# layout.js — SPA Layout Engine for el.js

A lightweight SPA layout module built on **el.js**. Provides navbar, sidebar, routing, themes, notifications, modals, and a desktop sidebar hide toggle — all without any framework.

[![Buy me a coffee at Ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/gugusdarmayanto)

---

## 📁 Project Structure

```
.
├── index.html          # Demo page
├── practice.html       # Practice page
├── el.js               # el.js DOM library
├── layouting/
│   └── layout.js       # Layout engine
├── index.js            # Entry script
└── README.md
```

---

## 🚀 Quick Start

```bash
npx http-server .
# or
python3 -m http.server 3000
```

Open `http://localhost:3000/index.html`

---

## 💡 Basic Usage

```html
<div id="app"></div>
<script src="./el.js"></script>
<script src="./layouting/layout.js"></script>
<script>
  window.addEventListener('DOMContentLoaded', () => {
    layout.addPage({ path: '/', component: () => el('div').text('Home') });

    layout.addSideMenu([
      { name: 'Home', page: '/', icon: 'fas fa-home' },
      {
        name: 'Pages',
        icon: 'fas fa-file',
        children: [
          { name: 'About', page: '/about' },
          { name: 'Contact', page: '/contact' },
        ],
      },
    ]);

    addNavbar([
      { name: 'Home', page: '/' },
      { name: 'About', page: '/about' },
    ]);

    setLayoutTheme('default');
    layout.render();
  });
</script>
```

---

## 📖 API Reference

### Pages

```js
layout.addPage({
  path: '/about',
  component: () => el('div').text('About'),
});
```

Support async page components (loader is shown while waiting):

```js
layout.addPage({
  path: '/about',
  component: () => new Promise(resolve => {
    setTimeout(() => resolve(el('div').text('Loaded')), 1000);
  }),
});
```

Page options:

- `fullWidthDesktop: true` — hide sidebar on desktop and show a navbar back button
- `hideLayout: true` — hide navbar and sidebar completely
- `pageContentPadding: '0.5rem'` — override default page padding
- `roles: ['admin', 'editor']` — RBAC access control for page rendering

```js
layout.addPage({
  path: '/admin',
  roles: ['admin'],
  component: () => el('div').text('Admin dashboard'),
});
```

> The navbar title is also clickable and navigates to `/` (home).

Dynamic routes are supported too, for example `/users/:id/profile`.

### CRUD Dynamic Routes

The layout automatically recognizes CRUD-style paths and triggers global hooks:

| Pattern | Example | Window Hook |
|---------|---------|-------------|
| `/resource/create` | `/products/create` | `window.triggerCrudCreate(resource)` |
| `/resource/edit/:id` | `/products/edit/42` | `window.triggerCrudEdit(resource, id)` |

Register handlers in your app:

```js
window.triggerCrudCreate = (resource) => {
  console.log('Create form for', resource);
};

window.triggerCrudEdit = (resource, id) => {
  console.log('Edit', resource, 'ID:', id);
};
```

Check helpers:

```js
layout.isCrudDynamicRoute('/products/create'); // true
layout.isValidRoute('/about');                // true if registered
```

---

### Sidebar

```js
layout.addSideMenu([
  { name: 'Home', page: '/', icon: 'fas fa-home' },
  {
    name: 'Group',
    icon: 'fas fa-folder',
    children: [
      { name: 'Child A', page: '/a' },
      { name: 'Child B', page: '/b' },
    ],
  },
]);
```

Sidebar features:

- Only one dropdown group opens at a time (accordion behavior)
- Active group auto-opens on page load or `hashchange`
- Support `roles` on sidebar items to hide menu entries based on current role
- Support `nameKey` for i18n integration (falls back to `name`)

```js
layout.addSideMenu([
  { name: 'Admin', page: '/admin', roles: ['admin'] },
  { nameKey: 'sidebar.settings', name: 'Settings', page: '/settings', icon: 'fas fa-cog' },
]);
```

> If `window.i18n.t()` is available, the layout uses `nameKey` to resolve menu labels. Otherwise it falls back to `name`.

---

### Navbar

```js
// Direct API
layout.addNavbar([
  { name: 'Home', page: '/' },
  { name: 'About', page: '/about' },
]);

// Global shorthand available after layout.js loads
addNavbar([
  { name: 'Home', page: '/' },
]);
```

The navbar dropdown automatically includes a **Profile** entry (navigates to `/profile`) and a **Logout** entry (POSTs to `/api/auth/logout`, clears role, and redirects to `#/login`).

Set a custom navbar title:

```js
layout.setNavbarTitle('My Application');
```

---

### RBAC / Roles

```js
layout.setRole('editor');
const currentRole = layout.getRole();
```

The layout filters pages and menus based on `roles` defined on each page or menu item.

---

### Middleware

```js
layout.middleware(async (path, pageConfig) => {
  if (pageConfig.roles && !userHasAccess()) {
    return { allowed: false, redirect: '/login' };
  }
  return { allowed: true };
});
```

Middleware runs before every page render and can cancel or redirect navigation.

---

### Navigation

```js
layout.navigate('/about');
```

---

### Render

Call once after all pages, menus, and navbar are registered:

```js
layout.render();
```

---

### Themes

Built-in themes: `default`, `blue`, `dark`, `light`, `purple`, `green`, `red`, `orange`, `teal`, `pink`, `gray`

```js
setLayoutTheme('dark');
// or
layout.setTheme('dark');
```

Create and apply a custom theme:

```js
layout.setCustomTheme({
  navbarBg: '#1a1a2e',
  navbarColor: '#fff',
  sidebarBg: '#16213e',
  sidebarColor: '#fff',
});
```

---

### Toast / Notify

```js
layout.toast('Saved!', { type: 'success', title: 'OK', duration: 3000 });

// Types: 'success' | 'error' | 'warning' | 'info'

layout.notify({ title: 'Info', message: 'Hello!', type: 'info', duration: 4000 });
```

---

### Confirm Dialog

```js
layout.confirm({
  title: 'Delete item?',
  message: 'This cannot be undone.',
  confirmText: 'Yes, delete',
  cancelText: 'Cancel',
  dismissible: true,  // click outside to close (default true)
  onConfirm: () => layout.toast('Deleted', { type: 'success' }),
  onCancel: () => layout.toast('Cancelled', { type: 'warning' }),
});
```

You can also close the confirm programmatically:

```js
layout.closeConfirm();
```

---

### Custom Modal

```js
layout.customModal({
  title: 'My Modal',
  message: el('div').child([
    el('p').text('Content built with el.js'),
  ]),
  size: 'medium',          // 'small' | 'medium' | 'large' | 'full'
  dismissible: true,       // click outside to close (default true)
  buttons: [
    { text: 'Cancel', variant: 'outline', onClick: () => layout.closeModal() },
    { text: 'Save',   variant: 'primary', onClick: () => layout.toast('Saved'), closeOnClick: true },
  ],
});
```

Aliases: `layout.modal()` and `layout.customModal()` both work.

`message` accepts: `string`, `el()` wrapper, or native `HTMLElement`.

Button `variant`: `'primary'` (default blue) | `'secondary'` (gray) | `'outline'` (white/bordered).

Use a custom footer element instead of buttons:

```js
layout.customModal({
  title: 'Details',
  message: 'Content here',
  footer: el('div').text('Custom footer'),
});
```

Close manually:

```js
layout.closeModal();
```

---

### Loader

```js
layout.showLoader();
layout.hideLoader();
```

---

## 🖥️ Desktop Sidebar Hide Toggle

A toggle switch appears in the navbar (desktop only) next to the title. When active:

- Sidebar collapses to a **4px transparent strip** at the left edge
- Hovering over the strip reveals the sidebar as a **floating overlay**
- State is **persisted to `localStorage`** and restored on next load

---

## 📱 Mobile Behavior

- Hamburger menu (☰) toggles sidebar as a **full-screen overlay**
- Hide toggle switch is **hidden on mobile**
- Sidebar closes automatically after a menu item is clicked

---

## ✨ Features Summary

| Feature | Details |
|---|---|
| Hash routing | `#/path` based SPA navigation |
| Dynamic routes | Parameterized routes like `/users/:id/profile` |
| CRUD dynamic routes | Auto-detect `/create` and `/edit/:id` patterns |
| Async pages | Promise-based component loading with spinner |
| Sidebar groups | Accordion dropdown, auto-opens for active route |
| Themes | 11 built-in + custom |
| Toast | 4 types, auto-dismiss, close button |
| Confirm | OK/Cancel callbacks, dismissible overlay |
| Custom modal | el.js content, custom buttons, 4 sizes, custom footer |
| RBAC | Role-based page & menu filtering |
| Middleware | Pre-render guards with redirect support |
| Desktop hide | Toggle switch + hover peek overlay |
| localStorage | Sidebar hide state persisted |
| Mobile | Overlay sidebar, hide switch hidden |
| i18n ready | `nameKey` support via `window.i18n.t()` |

---

## 👨‍💻 Author

Built with ❤️ using [el.js](https://github.com/slice-code/el.js)
