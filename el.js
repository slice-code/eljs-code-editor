// library for easy DOM manipulation
// support by slice-code.com
// version 1.0.6

/**
 * el.js - A lightweight DOM manipulation library
 * Supports both ES module import and direct script tag usage
 */

(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
      (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.el = factory());
})(this, (function () {
  'use strict';

  const el = function (elementDOMP) {
    let obj = {}
    if (typeof elementDOMP == 'object') {
      obj.el = elementDOMP;
    } else {
      // Check if it's an SVG element
      const svgElements = ['svg', 'circle', 'rect', 'path', 'line', 'polyline', 'polygon', 'text', 'g', 'defs', 'use', 'image', 'ellipse', 'foreignObject'];
      if (svgElements.includes(elementDOMP)) {
        obj.el = document.createElementNS('http://www.w3.org/2000/svg', elementDOMP);
      } else {
        obj.el = document.createElement(elementDOMP || 'div');
      }
    }
    obj.ch = [];
    obj.id = function (a) {
      this.el.id = a;
      return this;
    }
    obj.text = function (a) {
      // SVG elements need textContent, HTML elements use innerText
      if (this.el instanceof SVGElement) {
        this.el.textContent = a;
      } else {
        this.el.innerText = a;
      }
      return this;
    }
    obj.addModule = function (name, func) {
      this.el[name] = func;
      return this;
    }
    obj.html = function (a) {
      this.el.innerHTML = a;
      return this;
    }
    obj.clear = function (top = false) {
      this.el.innerHTML = '';
      // add scroll top 0
      if (top) {
        this.el.scrollTop = 0;
        this.el.scrollLeft = 0;
      }
      return this;
    }
    obj.name = function (a) {
      this.el.setAttribute('name', a);
      return this;
    }
    obj.href = function (a) {
      this.el.setAttribute('href', a);
      return this;
    }
    obj.rel = function (a) {
      this.el.setAttribute('rel', a);
      return this;
    }

    obj.loopFunc = function (callback, time = 1000) {
      var gopy = this.el;
      let noscript = document.createElement('noscript');
      this.ch.push(noscript);

      setTimeout(function () {

        var id = 'loop-' + Date.now();
        noscript.setAttribute('loopFunc-id-el-ui', id);

        var timeoutId = null;

        async function loop(id, callback, time) {
          let search = document.querySelector('[loopFunc-id-el-ui="' + id + '"]');
          if (search) {
            try {
              await callback(search);
            } catch (error) {
              console.error('loopFunc error:', error);
            }
            timeoutId = setTimeout(function () {
              loop(id, callback, time);
            }, time);
          } else {
            console.log('Element removed from DOM and loop stopped');
            if (timeoutId) clearTimeout(timeoutId);
          }
        }

        loop(id, callback, time);
      }, 10)
      return this;
    }

    obj.value = function (a) {
      this.el.value = a;
      return this;
    }
    obj.getValue = function () {
      return this.el.value
    }
    var toCamelCase = function (str) {
      // Jika CSS variable (--var), kembalikan apa adanya
      if (str.startsWith('--')) return str;
      // Convert kebab-case ke camelCase
      return str.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
    }
    obj.css = function (a, b) {
      if (typeof a == "object") {
        var ky = Object.keys(a);
        ky.forEach(function (item) {
          this.el.style[toCamelCase(item)] = a[item];
        }, this)
        return this;
      } else {
        this.el.style[toCamelCase(a)] = b;
        return this;
      }
    }
    // Alias for css()
    obj.style = obj.css;
    obj.change = function (func) {
      this.el.addEventListener('change', func, false);
      return this;
    }
    obj.keydown = function (func) {
      this.el.addEventListener('keydown', func, false);
      return this;
    }
    obj.paste = function (func) {
      this.el.addEventListener('paste', func, false);
      return this;
    }
    obj.mouseover = function (func) {
      this.el.addEventListener('mouseover', func, false);
      return this;
    }
    obj.resize = function (func) {
      var gopy = this;
      window.addEventListener('resize', function (e) {
        width = e.target.outerWidth;
        height = e.target.outerHeight;
        var elm = {
          el: gopy.el,
          width: width,
          height: height
        }
        setTimeout(function () {
          func(elm);
        }, 100)
      }, gopy)
      return gopy;
    }
    obj.load = function (func) {
      var gopy = this;
      var width = window.outerWidth;
      var height = window.outerHeight;
      var elm = {
        el: gopy.el,
        width: width,
        height: height
      }
      setTimeout(function () {
        func(elm);
      }, 10)
      return gopy;
    }
    obj.mouseout = function (func) {
      this.el.addEventListener('mouseout', func, false);
      return this;
    }
    obj.mousedown = function (func) {
      this.el.addEventListener('mousedown', func, false);
      return this;
    }
    obj.mouseup = function (func) {
      this.el.addEventListener('mouseup', func, false);
      return this;
    }
    obj.keypress = function (func) {
      this.el.addEventListener('keypress', func, false);
      return this;
    }
    obj.input = function (func) {
      this.el.addEventListener('input', func, false);
      return this;
    }
    obj.focus = function (func) {
      if (func) {
        this.el.addEventListener('focus', func, false);
      } else {
        this.el.focus();
      }
      return this;
    }
    obj.blur = function (func) {
      if (func) {
        this.el.addEventListener('blur', func, false);
      } else {
        this.el.blur();
      }
      return this;
    }
    obj.touchstart = function (func) {
      this.el.addEventListener('touchstart', func, false);
      return this;
    }
    obj.touchend = function (func) {
      this.el.addEventListener('touchend', func, false);
      return this;
    }
    obj.touchmove = function (func) {
      this.el.addEventListener('touchmove', func, false);
      return this;
    }
    obj.dblclick = function (func) {
      this.el.addEventListener('dblclick', func, false);
      return this;
    }
    obj.contextmenu = function (func) {
      this.el.addEventListener('contextmenu', func, false);
      return this;
    }
    obj.wheel = function (func) {
      this.el.addEventListener('wheel', func, false);
      return this;
    }
    obj.scroll = function (func) {
      this.el.addEventListener('scroll', func, false);
      return this;
    }
    obj.click = function (func) {
      if (func) {
        this.el.addEventListener('click', func, false);
      }
      return this;
    }
    obj.hover = function (enterFunc, leaveFunc) {
      if (enterFunc) {
        this.el.addEventListener('mouseenter', enterFunc, false);
      }
      if (leaveFunc) {
        this.el.addEventListener('mouseleave', leaveFunc, false);
      }
      return this;
    }
    obj.submit = function (func) {
      this.el.addEventListener('submit', function (e) {
        el = e.path[0];

        el = new FormData(el);

        var object = {};
        el.forEach(function (value, key) {
          object[key] = value;
        });
        var json = object;

        func(json)

        e.preventDefault();
      }, false);
      return this;
    }
    obj.keyup = function (func) {
      this.el.addEventListener('keyup', func, false);
      return this;
    }
    obj.src = function (a) {
      this.el.setAttribute('src', a);
      return this;
    }
    obj.required = function (a) {
      this.el.setAttribute('required', '');
      return this;
    }
    obj.disabled = function (a) {
      if (a) {
        this.el.setAttribute('disabled', '');
      } else {
        this.el.removeAttribute('disabled');
      }
      return this;
    }
    obj.checked = function (a) {
      this.el.checked = a;
      return this;
    }
    obj.width = function (a) {
      this.el.style.width = a;
      return this;
    }
    obj.margin = function (a) {
      this.el.style.margin = a;
      return this;
    }
    obj.outline = function (a) {
      this.el.style.outline = a;
      return this;
    }
    obj.border = function (a) {
      this.el.style.border = a;
      return this;
    }
    obj.borderBottom = function (a) {
      this.el.style.borderBottom = a;
      return this;
    }
    obj.borderTop = function (a) {
      this.el.style.borderTop = a;
      return this;
    }
    obj.borderLeft = function (a) {
      this.el.style.borderLeft = a;
      return this;
    }
    obj.borderRight = function (a) {
      this.el.style.borderRight = a;
      return this;
    }
    obj.padding = function (a) {
      this.el.style.padding = a;
      return this;
    }
    obj.fixed = function () {
      this.el.style.position = "fixed";
      return this;
    }
    obj.radius = function (a) {
      this.el.style.borderRadius = a;
      return this;
    }
    obj.bottom = function (a) {
      this.el.style.bottom = a;
      return this;
    }
    obj.right = function (a) {
      this.el.style.right = a;
      return this;
    }
    obj.left = function (a) {
      this.el.style.left = a;
      return this;
    }
    obj.top = function (a) {
      this.el.style.top = a;
      return this;
    }
    obj.float = function (a) {
      this.el.style.float = a;
      return this;
    }
    obj.color = function (a) {
      this.el.style.color = a;
      return this;
    }
    obj.align = function (a) {
      this.el.style.textAlign = a;
      return this;
    }
    obj.size = function (a) {
      this.el.style.fontSize = a;
      return this;
    }
    obj.fontWeight = function (a) {
      if (a == undefined) {
        a = 'bold';
      }
      this.el.style.fontWeight = a;
      return this;
    }
    obj.background = function (a) {
      this.el.style.background = a;
      return this;
    }
    obj.link = function (obj, name) {
      if (typeof obj == 'object' && obj && name) {
        obj[name] = this.el;
      }
      return this;
    }
    obj.marginTop = function (a) {
      this.el.style.marginTop = a;
      return this;
    }
    obj.marginBottom = function (a) {
      this.el.style.marginBottom = a;
      return this;
    }
    obj.marginLeft = function (a) {
      this.el.style.marginLeft = a;
      return this;
    }
    obj.marginRight = function (a) {
      this.el.style.marginRight = a;
      return this;
    }
    obj.backgroundImage = function (a) {
      this.el.style.backgroundImage = "url(" + a + ")";
      return this;
    }
    obj.font = function (a) {
      this.el.style.fontFamily = a;
      return this;
    }
    obj.backgroundSize = function (a) {
      this.el.style.backgroundSize = a;
      return this;
    }
    obj.backgroundRepeat = function (a) {
      this.el.style.backgroundRepeat = a;
      return this;
    }
    obj.backgroundPosition = function (a) {
      this.el.style.backgroundPosition = a;
      return this;
    }
    obj.cursor = function (a) {
      this.el.style.cursor = a;
      return this;
    }
    obj.display = function (a) {
      this.el.style.display = a;
      return this;
    }
    obj.show = function () {
      this.el.style.display = '';
      return this;
    }
    obj.hide = function () {
      this.el.style.display = 'none';
      return this;
    }
    obj.toggle = function () {
      this.el.style.display = this.el.style.display === 'none' ? '' : 'none';
      return this;
    }
    obj.index = function (a = 0) {
      this.el.setAttribute('tabIndex', a);
      return this;
    }
    obj.on = function (a, func) {
      this.el.addEventListener(a, func, false);
      return this;
    }
    obj.opacity = function (a) {
      this.el.style.opacity = a;
      return this;
    }
    obj.zIndex = function (a) {
      this.el.style.zIndex = a;
      return this;
    }
    obj.overflow = function (a) {
      this.el.style.overflow = a;
      return this;
    }
    obj.overflowX = function (a) {
      this.el.style.overflowX = a;
      return this;
    }
    obj.overflowY = function (a) {
      this.el.style.overflowY = a;
      return this;
    }
    obj.boxShadow = function (a) {
      this.el.style.boxShadow = a;
      return this;
    }
    obj.transform = function (a) {
      this.el.style.transform = a;
      return this;
    }
    obj.transition = function (a) {
      this.el.style.transition = a;
      return this;
    }
    obj.lineHeight = function (a) {
      this.el.style.lineHeight = a;
      return this;
    }
    obj.maxWidth = function (a) {
      this.el.style.maxWidth = a;
      return this;
    }
    obj.maxHeight = function (a) {
      this.el.style.maxHeight = a;
      return this;
    }
    obj.minWidth = function (a) {
      this.el.style.minWidth = a;
      return this;
    }
    obj.minHeight = function (a) {
      this.el.style.minHeight = a;
      return this;
    }
    obj.gap = function (a) {
      this.el.style.gap = a;
      return this;
    }
    obj.grid = function (a) {
      this.el.style.display = 'grid';
      if (a) this.el.style.gridTemplateColumns = a;
      return this;
    }
    obj.flex = function (a) {
      this.el.style.display = 'flex';
      if (a) this.el.style.flexDirection = a;
      return this;
    }
    obj.justify = function (a) {
      this.el.style.justifyContent = a;
      return this;
    }
    obj.items = function (a) {
      this.el.style.alignItems = a;
      return this;
    }
    obj.self = function (a) {
      this.el.style.alignSelf = a;
      return this;
    }
    obj.wrap = function (a) {
      this.el.style.flexWrap = a;
      return this;
    }
    obj.height = function (a) {
      this.el.style.height = a;
      return this;
    }
    obj.placeholder = function (a) {
      this.el.setAttribute('placeholder', a);
      return this;
    }
    obj.hold = function (a) {
      this.el.setAttribute('placeholder', a);
      return this;
    }
    obj.draggable = function (a = true) {
      this.el.setAttribute('draggable', a);
      return this;
    }
    obj.dragStart = function (func) {
      this.el.addEventListener('dragstart', func, false);
      return this;
    }
    obj.dragEnd = function (func) {
      this.el.addEventListener('dragend', func, false);
      return this;
    }
    obj.dragEnter = function (func) {
      this.el.addEventListener('dragenter', func, false);
      return this;
    }
    obj.design = function (status = true) {
      this.el.setAttribute('contenteditable', status);
      return this;
    }
    obj.clearClass = function () {
      this.el.classList = [];
      return this;
    }
    obj.class = function (a, replace = false) {
      // Use classList for both HTML and SVG elements
      if (typeof replace === 'boolean' && replace) {
        this.el.classList = [];
      }
      if (a && a.trim()) {
        const classes = a.trim().split(/\s+/);
        classes.forEach(cls => {
          if (cls) this.el.classList.add(cls);
        });
      }
      return this;
    }
    obj.removeClass = function (a) {
      this.el.classList.remove(a);
      return this;
    }
    obj.toggleClass = function (a) {
      this.el.classList.toggle(a);
      return this;
    }
    obj.hasClass = function (a) {
      return this.el.classList.contains(a);
    }
    obj.type = function (a) {
      this.el.setAttribute("type", a);
      return this;
    }
    obj.attr = function (a, d) {
      this.el.setAttribute(a, d);
      return this;
    }
    obj.data = function (a, d) {
      this.el.setAttribute('data-' + a, d);
      return this;
    }
    obj.aria = function (a, d) {
      this.el.setAttribute('aria-' + a, d);
      return this;
    }

    obj.get = function () {
      if (this.ch.length != 0) {
        this.ch.forEach(function (item) {
          try {
            if (item != null) {
              this.el.appendChild(item);
            }
          } catch (e) {
            console.warn('el.get: Failed to append child', e);
          }
        }, this);
      }
      return this.el;
    }

    obj.replace = function (a) {
      if (a == null) return this;

      this.el.innerHTML = '';
      try {
        if (a instanceof HTMLElement) {
          this.ch.push(a);
        } else if (typeof a.get === 'function') {
          this.ch.push(a.get());
        }
      } catch (e) {
        console.warn('el.replace: Error replacing content', e);
      }
      return this;
    }

    obj.child = function (a) {
      // Handle null/undefined
      if (a == null) return this;

      try {
        if (Array.isArray(a)) {
          // Limit array to max 1000 children to prevent browser hang
          var MAX_CHILDREN = 1000;
          if (a.length > MAX_CHILDREN) {
            console.warn('el.child: Array truncated from ' + a.length + ' to ' + MAX_CHILDREN + ' items (max limit). Use pagination or virtual scrolling for large lists.');
            a = a.slice(0, MAX_CHILDREN);
          }

          for (let l of a) {
            if (l == null) continue;
            try {
              // Handle Promise - append placeholder, replace when resolved
              if (l instanceof Promise) {
                const placeholder = document.createElement('div');
                this.ch.push(placeholder);
                l.then(result => {
                  if (result instanceof HTMLElement) {
                    placeholder.replaceWith(result);
                  } else if (result && typeof result.get === 'function') {
                    placeholder.replaceWith(result.get());
                  }
                }).catch(e => {
                  console.warn('el.child: Promise rejected', e);
                  placeholder.remove();
                });
              } else if (l instanceof HTMLElement) {
                this.ch.push(l);
              } else if (typeof l.get === 'function') {
                this.ch.push(l.get());
              }
            } catch (e) {
              console.warn('el.child: Failed to add child element', e);
            }
          }
          return this;
        }

        // Handle Promise for single child
        if (a instanceof Promise) {
          const placeholder = document.createElement('div');
          this.ch.push(placeholder);
          a.then(result => {
            if (result instanceof HTMLElement) {
              placeholder.replaceWith(result);
            } else if (result && typeof result.get === 'function') {
              placeholder.replaceWith(result.get());
            }
          }).catch(e => {
            console.warn('el.child: Promise rejected', e);
            placeholder.remove();
          });
          return this;
        }

        if (a instanceof HTMLElement) {
          this.ch.push(a);
          return this;
        }

        if (typeof a.get === 'function') {
          this.ch.push(a.get());
        }
      } catch (e) {
        console.warn('el.child: Error adding child', e);
      }

      return this;
    }
    obj.prepend = function (a) {
      if (a == null) return this;

      try {
        if (a instanceof HTMLElement) {
          this.el.prepend(a);
        } else if (typeof a.get === 'function') {
          this.el.prepend(a.get());
        }
      } catch (e) {
        console.warn('el.prepend: Error prepending child', e);
      }
      return this;
    }
    obj.remove = function () {
      this.el.remove();
      return this;
    }
    obj.off = function (event, func) {
      this.el.removeEventListener(event, func);
      return this;
    }
    obj.selectAll = function () {
      this.el.select();
      return this;
    }
    obj.scrollTo = function (x, y) {
      this.el.scrollTo(x, y);
      return this;
    }
    obj.scrollIntoView = function (a) {
      this.el.scrollIntoView(a || true);
      return this;
    }
    obj.empty = function () {
      this.el.innerHTML = '';
      this.ch = [];
      return this;
    }
    obj.attrRemove = function (a) {
      this.el.removeAttribute(a);
      return this;
    }
    obj.styleRemove = function (a) {
      this.el.style.removeProperty(a);
      return this;
    }
    obj.cssText = function (a) {
      this.el.style.cssText = a;
      return this;
    }
    obj.textContent = function (a) {
      this.el.textContent = a;
      return this;
    }
    obj.getVal = function () {
      return this.el.value;
    }
    obj.getText = function () {
      return this.el.innerText;
    }
    obj.getHtml = function () {
      return this.el.innerHTML;
    }
    obj.getAttr = function (a) {
      return this.el.getAttribute(a);
    }
    obj.getData = function (a) {
      return this.el.dataset[a];
    }
    obj.getStyle = function (a) {
      return getComputedStyle(this.el)[a];
    }
    obj.getParent = function () {
      return this.el.parentElement;
    }
    obj.getChildren = function () {
      return this.el.children;
    }
    obj.getSiblings = function () {
      return this.el.parentElement.children;
    }
    obj.getIndex = function () {
      return Array.from(this.el.parentElement.children).indexOf(this.el);
    }
    obj.getWidth = function () {
      return this.el.offsetWidth;
    }
    obj.getHeight = function () {
      return this.el.offsetHeight;
    }
    obj.find = function (selector) {
      const found = this.el.querySelector(selector);
      return found ? el(found) : null;
    }
    obj.findAll = function (selector) {
      return Array.from(this.el.querySelectorAll(selector)).map(function (e) {
        return el(e);
      });
    }
    obj.closest = function (selector) {
      const found = this.el.closest(selector);
      return found ? el(found) : null;
    }
    obj.next = function () {
      const sibling = this.el.nextElementSibling;
      return sibling ? el(sibling) : null;
    }
    obj.prev = function () {
      const sibling = this.el.previousElementSibling;
      return sibling ? el(sibling) : null;
    }
    obj.first = function () {
      const child = this.el.firstElementChild;
      return child ? el(child) : null;
    }
    obj.last = function () {
      const child = this.el.lastElementChild;
      return child ? el(child) : null;
    }
    obj.eq = function (index) {
      const child = this.el.children[index];
      return child ? el(child) : null;
    }

    obj.roboto = function () {
      this.el.style.fontFamily = 'Roboto';
      return this;
    }


    obj.getChild = function (pop) {
      return {
        parent: this.get().children[pop],
        el: el(this.get().children[pop]),
        child: function (a) {
          return this.parent.appendChild(a.get())
        }
      }
    }

    obj.row = function (a) {
      var d = div()
        .class('row')

      a.forEach(function (elm) {
        d.child(
          div().class(elm['class']).child(elm['content'])
        )
      }, d);
      this.ch.push(d.get());
      return this;
    }
    return obj;
  }

  return el;

}));
