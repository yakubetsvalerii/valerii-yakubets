/**
 * Tisso Header - mobile menu toggle (vanilla JS)
 */
(function () {
  'use strict';

  function initHeader(root) {
    if (!root || root.dataset.tissoHeaderReady === 'true') return;
    root.dataset.tissoHeaderReady = 'true';

    var toggle = root.querySelector('[data-tisso-header-toggle]');
    var drawer = root.querySelector('[data-tisso-header-drawer]');
    if (!toggle || !drawer) return;

    function setOpen(open) {
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      document.body.classList.toggle('tisso-header-menu-open', open);
    }

    toggle.addEventListener('click', function () {
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    drawer.querySelectorAll('[data-tisso-header-close]').forEach(function (node) {
      node.addEventListener('click', function () {
        setOpen(false);
      });
    });

    drawer.addEventListener('click', function (event) {
      if (event.target.closest('a')) setOpen(false);
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && drawer.classList.contains('is-open')) {
        setOpen(false);
      }
    });
  }

  function initAll() {
    document.querySelectorAll('[data-tisso-header]').forEach(initHeader);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (event) {
    var root = event.target.querySelector('[data-tisso-header]');
    if (root) {
      root.dataset.tissoHeaderReady = 'false';
      initHeader(root);
    }
  })
})();
