/**
 * Tisso Collection — load up to 6 products from a collection, hotspot quick-view,
 * variant selection, and Add to Cart (vanilla JS).
 *
 * Products are fetched from /collections/{handle}/products.json so the grid
 * is not limited by Liquid pagination quirks.
 */
(function () {
  'use strict';

  var PRODUCTS_LIMIT = 6;

  function formatMoney(cents) {
    if (typeof Shopify !== 'undefined' && typeof Shopify.formatMoney === 'function') {
      return Shopify.formatMoney(cents, window.theme && window.theme.moneyFormat);
    }
    return (Number(cents) / 100).toFixed(2).replace('.', ',') + '€';
  }

  function parseJSON(node) {
    if (!node) return null;
    try {
      return JSON.parse(node.textContent);
    } catch (error) {
      console.error('[Tisso Collection] Invalid JSON', error);
      return null;
    }
  }

  function normalize(value) {
    return String(value || '')
      .trim()
      .toLowerCase();
  }

  function isColorOption(name) {
    var n = normalize(name);
    return n === 'color' || n === 'colour' || n === 'couleur' || n === 'farbe';
  }

  function isSizeOption(name) {
    var n = normalize(name);
    return n === 'size' || n === 'taille' || n === 'größe' || n === 'groesse';
  }

  function accentForColor(value) {
    var map = {
      blue: '#1f4b99',
      black: '#000000',
      white: '#ffffff',
      red: '#b00020',
      green: '#1f7a3f',
      brown: '#6b3f2a',
      beige: '#c8b59a',
      grey: '#777777',
      gray: '#777777',
      navy: '#0b1f44',
      pink: '#d46a8e',
      cream: '#f5f0e6',
      ivory: '#fffff0',
      yellow: '#e6c200',
    };
    return map[normalize(value)] || '#1f4b99';
  }

  function isLightColor(value) {
    var n = normalize(value);
    return (
      n === 'white' ||
      n === 'ivory' ||
      n === 'cream' ||
      n === 'beige' ||
      n === 'off-white' ||
      n === 'offwhite' ||
      n === 'yellow'
    );
  }

  function stripHtml(html) {
    var template = document.createElement('div');
    template.innerHTML = html || '';
    return (template.textContent || template.innerText || '').trim();
  }

  function truncate(text, max) {
    if (!text || text.length <= max) return text || '';
    return text.slice(0, max - 1).trim() + '…';
  }

  /**
   * Normalize Ajax /collections/.../products.json product into our modal shape.
   * Ajax prices are dollar strings; convert to cents.
   */
  function normalizeAjaxProduct(product) {
    var options = (product.options || []).map(function (option) {
      if (typeof option === 'string') {
        return { name: option, values: [] };
      }
      return {
        name: option.name,
        values: option.values || [],
      };
    });

    // If option values were omitted, derive them from variants
    options.forEach(function (option, index) {
      if (option.values.length) return;
      var key = 'option' + (index + 1);
      var seen = {};
      option.values = (product.variants || []).reduce(function (list, variant) {
        var value = variant[key];
        if (value && !seen[value]) {
          seen[value] = true;
          list.push(value);
        }
        return list;
      }, []);
    });

    var image =
      product.featured_image ||
      (product.images && product.images[0] && (product.images[0].src || product.images[0])) ||
      '';

    return {
      id: product.id,
      title: product.title || '',
      description: truncate(stripHtml(product.body_html || product.description || ''), 220),
      price: toCents(product.price || (product.variants && product.variants[0] && product.variants[0].price)),
      featured_image: image,
      options: options,
      variants: (product.variants || []).map(function (variant) {
        return {
          id: variant.id,
          title: variant.title,
          available: variant.available !== false,
          price: toCents(variant.price),
          option1: variant.option1,
          option2: variant.option2,
          option3: variant.option3,
        };
      }),
    };
  }

  function toCents(value) {
    // Ajax Collection API returns dollar amounts as strings (e.g. "980.00")
    if (typeof value === 'string' || typeof value === 'number') {
      var parsed = parseFloat(value);
      if (Number.isNaN(parsed)) return 0;
      return Math.round(parsed * 100);
    }
    return 0;
  }

  function findVariant(product, selections) {
    if (!product || !product.variants) return null;

    return (
      product.variants.find(function (variant) {
        return product.options.every(function (option, index) {
          return normalize(variant['option' + (index + 1)]) === normalize(selections[option.name]);
        });
      }) || null
    );
  }

  function optionValuesAvailable(product, optionIndex, value, selections) {
    return product.variants.some(function (variant) {
      if (!variant.available) return false;
      if (normalize(variant['option' + (optionIndex + 1)]) !== normalize(value)) return false;

      return product.options.every(function (option, index) {
        if (index === optionIndex) return true;
        var selected = selections[option.name];
        if (!selected) return true;
        return normalize(variant['option' + (index + 1)]) === normalize(selected);
      });
    });
  }

  function getCartAddUrl() {
    return (window.routes && window.routes.cart_add_url) || '/cart/add';
  }

  function addToCart(items) {
    return fetch(getCartAddUrl() + '.js', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ items: items }),
    }).then(function (response) {
      return response.json().then(function (data) {
        if (!response.ok) {
          throw new Error((data && (data.description || data.message)) || 'Unable to add to cart.');
        }
        return data;
      });
    });
  }

  function publishCartUpdate() {
    try {
      if (typeof publish === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
        publish(PUB_SUB_EVENTS.cartUpdate, { source: 'tisso-collection' });
      }
    } catch (error) {
      // Non-fatal
    }
    document.dispatchEvent(new CustomEvent('cart:refresh'));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function TissoCollection(root) {
    this.root = root;
    this.grid = root.querySelector('[data-tisso-grid]');
    this.popup = root.querySelector('[data-tisso-popup]');
    this.products = [];
    this.product = null;
    this.selections = {};
    this.bonusVariantId = root.dataset.bonusVariantId || '';
    this.collectionHandle = root.dataset.collectionHandle || '';
    this.limit = parseInt(root.dataset.productsLimit || PRODUCTS_LIMIT, 10) || PRODUCTS_LIMIT;

    this.els = {
      thumb: root.querySelector('[data-tisso-popup-thumb]'),
      title: root.querySelector('[data-tisso-popup-title]'),
      price: root.querySelector('[data-tisso-popup-price]'),
      description: root.querySelector('[data-tisso-popup-description]'),
      options: root.querySelector('[data-tisso-popup-options]'),
      error: root.querySelector('[data-tisso-popup-error]'),
      add: root.querySelector('[data-tisso-popup-add]'),
    };

    this.onHotspotClick = this.onHotspotClick.bind(this);
    this.onClose = this.onClose.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.onAddToCart = this.onAddToCart.bind(this);

    this.bindChrome();
    this.loadProducts();
  }

  TissoCollection.prototype.bindChrome = function () {
    var self = this;

    this.root.querySelectorAll('[data-tisso-popup-close]').forEach(function (node) {
      node.addEventListener('click', self.onClose);
    });

    if (this.els.add) {
      this.els.add.addEventListener('click', this.onAddToCart);
    }
  };

  function clampPercent(value, fallback) {
    var number = parseFloat(value);
    if (Number.isNaN(number)) return fallback;
    if (number < 0) return 0;
    if (number > 100) return 100;
    return number;
  }

  function mergeHotspotPositions(products, bootstrap) {
    var map = {};

    (bootstrap || []).forEach(function (item) {
      map[String(item.id)] = {
        hotspot_x: clampPercent(item.hotspot_x, 50),
        hotspot_y: clampPercent(item.hotspot_y, 50),
      };
    });

    return (products || []).map(function (product) {
      var spots = map[String(product.id)] || {};
      product.hotspot_x = clampPercent(spots.hotspot_x != null ? spots.hotspot_x : product.hotspot_x, 50);
      product.hotspot_y = clampPercent(spots.hotspot_y != null ? spots.hotspot_y : product.hotspot_y, 50);
      return product;
    });
  }

  TissoCollection.prototype.loadProducts = function () {
    var self = this;
    var bootstrap = parseJSON(this.root.querySelector('[data-tisso-products-bootstrap]'));

    if (this.collectionHandle) {
      var rootUrl = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || '/';
      var url = rootUrl + 'collections/' + encodeURIComponent(this.collectionHandle) + '/products.json?limit=' + this.limit;

      fetch(url, { headers: { Accept: 'application/json' } })
        .then(function (response) {
          if (!response.ok) throw new Error('Failed to load collection products');
          return response.json();
        })
        .then(function (data) {
          var products = (data.products || []).slice(0, self.limit).map(normalizeAjaxProduct);
          if (!products.length && Array.isArray(bootstrap) && bootstrap.length) {
            products = bootstrap.slice(0, self.limit);
          }
          self.products = mergeHotspotPositions(products, bootstrap);
          self.renderGrid();
        })
        .catch(function (error) {
          console.warn('[Tisso Collection] Ajax load failed, using Liquid bootstrap', error);
          self.products = mergeHotspotPositions(
            Array.isArray(bootstrap) ? bootstrap.slice(0, self.limit) : [],
            bootstrap
          );
          self.renderGrid();
        });
      return;
    }

    this.products = mergeHotspotPositions(
      Array.isArray(bootstrap) ? bootstrap.slice(0, this.limit) : [],
      bootstrap
    );
    this.renderGrid();
  };

  TissoCollection.prototype.renderGrid = function () {
    if (!this.grid) return;

    if (!this.products.length) {
      this.grid.innerHTML =
        '<li class="tisso-collection__empty-item"><p class="tisso-collection__empty">This collection has no products yet.</p></li>';
      return;
    }

    var self = this;
    this.grid.innerHTML = this.products
      .map(function (product) {
        var hotspotX = clampPercent(product.hotspot_x, 50);
        var hotspotY = clampPercent(product.hotspot_y, 50);
        var image = product.featured_image
          ? '<img class="tisso-collection__image" src="' +
            escapeHtml(product.featured_image) +
            '" alt="' +
            escapeHtml(product.title) +
            '" loading="lazy" width="600" height="600">'
          : '<div class="tisso-collection__placeholder">No image</div>';

        return (
          '<li class="tisso-collection__item" data-tisso-product-item data-product-id="' +
          escapeHtml(product.id) +
          '">' +
          image +
          '<button type="button" class="tisso-collection__hotspot" data-tisso-hotspot style="--hotspot-x: ' +
          hotspotX +
          '%; --hotspot-y: ' +
          hotspotY +
          '%;" aria-label="Quick view ' +
          escapeHtml(product.title) +
          '"><span aria-hidden="true">+</span></button>' +
          '</li>'
        );
      })
      .join('');

    this.grid.querySelectorAll('[data-tisso-hotspot]').forEach(function (button) {
      button.addEventListener('click', self.onHotspotClick);
    });
  };

  TissoCollection.prototype.getProductById = function (id) {
    var target = String(id);
    return (
      this.products.find(function (product) {
        return String(product.id) === target;
      }) || null
    );
  };

  TissoCollection.prototype.onHotspotClick = function (event) {
    var item = event.currentTarget.closest('[data-tisso-product-item]');
    if (!item) return;
    var product = this.getProductById(item.getAttribute('data-product-id'));
    if (!product) return;
    this.open(product);
  };

  TissoCollection.prototype.open = function (product) {
    this.product = product;
    this.selections = {};
    this.clearError();

    product.options.forEach(function (option, index) {
      if (isSizeOption(option.name)) {
        this.selections[option.name] = '';
        return;
      }

      if (isColorOption(option.name) || index === 0) {
        var firstAvailable = option.values.find(function (value) {
          return optionValuesAvailable(product, index, value, {});
        });
        this.selections[option.name] = firstAvailable || option.values[0] || '';
      } else {
        this.selections[option.name] = '';
      }
    }, this);

    this.renderChrome();
    this.renderOptions();
    this.syncVariantState();

    this.popup.classList.add('is-open');
    this.popup.setAttribute('aria-hidden', 'false');
    document.body.classList.add('tisso-popup-open');
    document.addEventListener('keydown', this.onKeydown);

    var closeBtn = this.popup.querySelector('.tisso-popup__close');
    if (closeBtn) closeBtn.focus();
  };

  TissoCollection.prototype.close = function () {
    if (!this.popup) return;
    this.popup.classList.remove('is-open');
    this.popup.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('tisso-popup-open');
    document.removeEventListener('keydown', this.onKeydown);
    this.product = null;
  };

  TissoCollection.prototype.onClose = function () {
    this.close();
  };

  TissoCollection.prototype.onKeydown = function (event) {
    if (event.key === 'Escape') this.close();
  };

  TissoCollection.prototype.renderChrome = function () {
    var product = this.product;
    if (!product) return;

    if (this.els.thumb) {
      this.els.thumb.src = product.featured_image || '';
      this.els.thumb.alt = product.title || '';
      this.els.thumb.hidden = !product.featured_image;
    }

    if (this.els.title) this.els.title.textContent = product.title || '';
    if (this.els.description) this.els.description.textContent = product.description || '';
  };

  function sortedOptions(product) {
    return product.options
      .map(function (option, index) {
        return { option: option, index: index };
      })
      .sort(function (a, b) {
        var aColor = isColorOption(a.option.name);
        var bColor = isColorOption(b.option.name);
        var aSize = isSizeOption(a.option.name);
        var bSize = isSizeOption(b.option.name);

        // Color first, then Size, then anything else in original order
        if (aColor && !bColor) return -1;
        if (!aColor && bColor) return 1;
        if (aSize && !bSize) return 1;
        if (!aSize && bSize) return -1;
        return a.index - b.index;
      });
  }

  TissoCollection.prototype.renderOptions = function () {
    var self = this;
    var product = this.product;
    if (!this.els.options || !product) return;

    this.els.options.innerHTML = '';

    sortedOptions(product).forEach(function (entry, displayIndex) {
      var option = entry.option;
      var optionIndex = entry.index;
      var field = document.createElement('div');
      field.className = 'tisso-popup__option';

      var label = document.createElement('label');
      label.className = 'tisso-popup__option-label';
      label.textContent = option.name;
      field.appendChild(label);

      var useSwatches = isColorOption(option.name) || (!isSizeOption(option.name) && displayIndex === 0);

      if (useSwatches) {
        var swatches = document.createElement('div');
        swatches.className = 'tisso-popup__swatches';
        swatches.setAttribute('role', 'listbox');
        swatches.setAttribute('aria-label', option.name);

        option.values.forEach(function (value) {
          var button = document.createElement('button');
          button.type = 'button';
          button.className = 'tisso-popup__swatch';
          button.textContent = value;
          button.dataset.optionName = option.name;
          button.dataset.optionValue = value;
          button.style.setProperty('--swatch-accent', accentForColor(value));
          button.dataset.swatchLight = isLightColor(value) ? 'true' : 'false';
          button.setAttribute('role', 'option');

          button.addEventListener('click', function () {
            self.selections[option.name] = value;
            self.renderOptions();
            self.syncVariantState();
          });

          swatches.appendChild(button);
        });

        field.appendChild(swatches);
      } else {
        var wrap = document.createElement('div');
        wrap.className = 'tisso-popup__select-wrap';

        var select = document.createElement('select');
        select.className = 'tisso-popup__select';
        select.setAttribute('aria-label', option.name);
        select.dataset.optionName = option.name;

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = isSizeOption(option.name) ? 'Choose your size' : 'Choose ' + option.name.toLowerCase();
        placeholder.disabled = true;
        select.appendChild(placeholder);

        option.values.forEach(function (value) {
          var opt = document.createElement('option');
          opt.value = value;
          opt.textContent = value;
          select.appendChild(opt);
        });

        if (self.selections[option.name]) {
          select.value = self.selections[option.name];
        } else {
          placeholder.selected = true;
        }

        select.addEventListener('change', function () {
          self.selections[option.name] = select.value;
          self.renderOptions();
          self.syncVariantState();
        });

        var icon = document.createElement('span');
        icon.className = 'tisso-popup__select-icon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML =
          '<svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" stroke-width="1.5"/></svg>';

        wrap.appendChild(select);
        wrap.appendChild(icon);
        field.appendChild(wrap);
      }

      self.els.options.appendChild(field);
    });
  };

  TissoCollection.prototype.syncVariantState = function () {
    var product = this.product;
    if (!product) return;

    var self = this;
    var variant = findVariant(product, this.selections);

    this.els.options.querySelectorAll('.tisso-popup__swatch').forEach(function (button) {
      var name = button.dataset.optionName;
      var value = button.dataset.optionValue;
      var optionIndex = product.options.findIndex(function (option) {
        return option.name === name;
      });

      button.classList.toggle('is-selected', normalize(self.selections[name]) === normalize(value));
      button.disabled = !optionValuesAvailable(product, optionIndex, value, self.selections);
      button.setAttribute('aria-selected', button.classList.contains('is-selected') ? 'true' : 'false');
    });

    this.els.options.querySelectorAll('.tisso-popup__select').forEach(function (select) {
      var name = select.dataset.optionName;
      var optionIndex = product.options.findIndex(function (option) {
        return option.name === name;
      });

      Array.prototype.forEach.call(select.options, function (opt) {
        if (!opt.value) return;
        opt.disabled = !optionValuesAvailable(product, optionIndex, opt.value, self.selections);
      });

      if (self.selections[name]) select.value = self.selections[name];
    });

    if (this.els.price) {
      this.els.price.textContent = formatMoney(variant ? variant.price : product.price);
    }

    if (this.els.add) {
      var complete = product.options.every(function (option) {
        return !!self.selections[option.name];
      });
      this.els.add.disabled = !complete || !variant || !variant.available;
      this.els.add.dataset.variantId = variant && variant.available ? String(variant.id) : '';
    }
  };

  TissoCollection.prototype.shouldAddBonusProduct = function () {
    var colorValue = '';
    var sizeValue = '';

    Object.keys(this.selections).forEach(
      function (name) {
        if (isColorOption(name)) colorValue = this.selections[name];
        if (isSizeOption(name)) sizeValue = this.selections[name];
      }.bind(this)
    );

    if (!colorValue || !sizeValue) {
      Object.keys(this.selections).forEach(
        function (name) {
          var value = normalize(this.selections[name]);
          if (!colorValue && value === 'black') colorValue = this.selections[name];
          if (!sizeValue && (value === 'medium' || value === 'm')) sizeValue = this.selections[name];
        }.bind(this)
      );
    }

    return normalize(colorValue) === 'black' && (normalize(sizeValue) === 'medium' || normalize(sizeValue) === 'm');
  };

  TissoCollection.prototype.onAddToCart = function () {
    var self = this;
    var variantId = this.els.add && this.els.add.dataset.variantId;

    if (!variantId) {
      this.showError('Please choose available options.');
      return;
    }

    var items = [{ id: Number(variantId), quantity: 1 }];

    if (this.shouldAddBonusProduct() && this.bonusVariantId) {
      items.push({ id: Number(this.bonusVariantId), quantity: 1 });
    }

    this.clearError();
    this.els.add.classList.add('is-loading');
    this.els.add.disabled = true;

    addToCart(items)
      .then(function () {
        publishCartUpdate();
        self.close();
      })
      .catch(function (error) {
        self.showError(error.message || 'Unable to add to cart.');
      })
      .finally(function () {
        if (self.els.add) {
          self.els.add.classList.remove('is-loading');
          self.syncVariantState();
        }
      });
  };

  TissoCollection.prototype.showError = function (message) {
    if (this.els.error) this.els.error.textContent = message || '';
  };

  TissoCollection.prototype.clearError = function () {
    this.showError('');
  };

  function initAll() {
    document.querySelectorAll('[data-tisso-collection]').forEach(function (root) {
      if (root.dataset.tissoCollectionReady === 'true') return;
      root.dataset.tissoCollectionReady = 'true';
      new TissoCollection(root);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
  } else {
    initAll();
  }

  document.addEventListener('shopify:section:load', function (event) {
    var root = event.target.querySelector('[data-tisso-collection]');
    if (root) {
      root.dataset.tissoCollectionReady = 'false';
      initAll();
    }
  });
})();
