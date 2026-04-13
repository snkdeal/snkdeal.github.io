(function () {
  'use strict';

  var SITE_URL = 'https://snkdeal.github.io';

  function getProductIdFromUrl() {
    var path = window.location.pathname;
    var parts = path.replace(/\/index\.html$/, '').split('/').filter(Boolean);
    return parts[parts.length - 1] || 'goey-3';
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getAbsoluteUrl(url) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : SITE_URL + url;
  }

  function enableLink(el, href) {
    if (!el || !href) return;
    el.href = href;
    el.classList.remove('is-disabled');
    el.removeAttribute('aria-disabled');
  }

  function disableLink(el) {
    if (!el) return;
    el.href = '#';
    el.classList.add('is-disabled');
    el.setAttribute('aria-disabled', 'true');
  }

  function setupTheme() {
    var root = document.documentElement;
    var toggle = document.querySelector('[data-theme-toggle]');
    var savedTheme = localStorage.getItem('snkdeal-theme');
    var theme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    function updateIcon(currentTheme) {
      if (!toggle) return;
      toggle.innerHTML = currentTheme === 'dark'
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }

    root.setAttribute('data-theme', theme);
    updateIcon(theme);

    if (toggle) {
      toggle.addEventListener('click', function () {
        theme = theme === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', theme);
        localStorage.setItem('snkdeal-theme', theme);
        updateIcon(theme);

        var themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) {
          themeColor.setAttribute('content', theme === 'dark' ? '#111010' : '#f5f4f0');
        }
      });
    }
  }

  function setupRevealAnimations() {
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('.r').forEach(function (el) {
        el.classList.add('on');
      });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('on');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08 });

    document.querySelectorAll('.r').forEach(function (el) {
      io.observe(el);
    });
  }

  var SVGS = {
    'goey-3': '<svg aria-hidden="true" viewBox="0 0 260 180" width="230" fill="none"><ellipse cx="130" cy="168" rx="104" ry="9" fill="rgba(0,0,0,.05)"/><path d="M36 138 Q34 108 64 88 L150 79 Q194 77 212 96 L216 140Z" fill="#f4f1ee"/><path d="M66 88 Q100 72 140 71 L141 91 Q108 93 74 108Z" fill="#E8291C" opacity=".9"/><path d="M162 75 Q194 77 210 94 L208 112 Q188 98 166 96Z" fill="#E8291C" opacity=".55"/><path d="M36 138 Q35 110 52 98 L74 103 Q58 120 56 138Z" fill="#e8e2dc"/><path d="M34 134 Q32 143 36 138 L216 140 Q219 147 215 135Z" fill="#faf9f7" stroke="rgba(0,0,0,.06)" stroke-width=".8"/><path d="M32 146 Q32 155 36 151 L214 149 Q218 149 218 143 L216 140Z" fill="#18160f" opacity=".88"/><line x1="96" y1="102" x2="150" y2="95" stroke="#ccc" stroke-width="1.3" stroke-linecap="round"/><line x1="101" y1="113" x2="155" y2="106" stroke="#ccc" stroke-width="1.3" stroke-linecap="round"/><line x1="107" y1="124" x2="160" y2="117" stroke="#ccc" stroke-width="1.3" stroke-linecap="round"/></svg>',
    'wade-808-ultra-v2': '<svg aria-hidden="true" viewBox="0 0 260 180" width="230" fill="none"><ellipse cx="130" cy="168" rx="104" ry="9" fill="rgba(0,0,0,.05)"/><path d="M36 138 Q34 106 62 84 L148 74 Q190 72 208 92 L212 140Z" fill="#1a1e2a"/><path d="M64 84 Q98 68 138 67 L138 88 Q106 90 72 106Z" fill="#E8291C" opacity=".9"/><path d="M160 72 Q190 74 206 91 L204 110 Q184 96 164 94Z" fill="#E8291C" opacity=".6"/><path d="M36 138 Q35 108 52 96 L72 101 Q56 118 54 138Z" fill="#242838"/><path d="M34 134 Q32 143 36 138 L212 140 Q216 148 210 135Z" fill="#2a2e3e" stroke="rgba(255,255,255,.05)" stroke-width=".8"/><path d="M32 146 Q32 155 36 151 L210 149 Q214 149 214 143 L212 140Z" fill="#E8291C" opacity=".95"/><line x1="94" y1="98" x2="148" y2="91" stroke="rgba(255,255,255,.18)" stroke-width="1.2" stroke-linecap="round"/><line x1="99" y1="109" x2="153" y2="102" stroke="rgba(255,255,255,.18)" stroke-width="1.2" stroke-linecap="round"/><line x1="105" y1="120" x2="158" y2="113" stroke="rgba(255,255,255,.18)" stroke-width="1.2" stroke-linecap="round"/></svg>',
    'kai-1': '<svg aria-hidden="true" viewBox="0 0 260 180" width="230" fill="none"><ellipse cx="130" cy="168" rx="104" ry="9" fill="rgba(0,0,0,.05)"/><path d="M36 138 Q34 108 64 88 L150 79 Q194 77 212 96 L216 140Z" fill="#f0f5e8"/><path d="M66 88 Q100 72 140 71 L141 91 Q108 93 74 108Z" fill="#84cc16" opacity=".85"/><path d="M162 75 Q194 77 210 94 L208 112 Q188 98 166 96Z" fill="#84cc16" opacity=".55"/><path d="M36 138 Q35 110 52 98 L74 103 Q58 120 56 138Z" fill="#dce8cc"/><text x="178" y="128" font-size="26" font-weight="900" fill="#84cc16" opacity=".55" font-family="sans-serif">A</text><path d="M34 134 Q32 143 36 138 L216 140 Q219 147 215 135Z" fill="#f8fcf0" stroke="rgba(0,0,0,.05)" stroke-width=".8"/><path d="M32 146 Q32 155 36 151 L214 149 Q218 149 218 143 L216 140Z" fill="#18160f" opacity=".85"/><line x1="96" y1="102" x2="150" y2="95" stroke="#aad06c" stroke-width="1.5" stroke-linecap="round"/><line x1="101" y1="113" x2="155" y2="106" stroke="#aad06c" stroke-width="1.5" stroke-linecap="round"/><line x1="107" y1="124" x2="160" y2="117" stroke="#aad06c" stroke-width="1.5" stroke-linecap="round"/></svg>'
  };

  var BGS = {
    'goey-3': 'bwm',
    'wade-808-ultra-v2': 'bwk',
    'kai-1': 'bvv'
  };

  function getProductVisual(product, productId) {
    if (product.image && product.image.trim() !== '') {
      return '<img src="' + escapeHtml(getAbsoluteUrl(product.image)) + '" alt="' +
        escapeHtml(product.name + ' sneaker in ' + (product.colorway || 'featured colorway')) +
        '" loading="eager" decoding="async">';
    }
    return SVGS[productId] || '';
  }

  function renderFeatures(product) {
    var features = [product.feature1, product.feature2, product.feature3].filter(Boolean);
    $('feat-list').innerHTML = features.map(function (feature) {
      return '<li class="fi"><span class="fd"></span><span>' + escapeHtml(feature) + '</span></li>';
    }).join('');
  }

  function renderPricing(product) {
    $('p-price').textContent = product.price || '$—';

    var oldPriceEl = $('p-price-old');
    var saveEl = $('p-save');

    if (product.price_original) {
      oldPriceEl.textContent = product.price_original;
      oldPriceEl.hidden = false;
      saveEl.hidden = false;
      saveEl.textContent = 'Sale';
    } else {
      oldPriceEl.hidden = true;
      saveEl.hidden = true;
    }
  }

  function renderButtons(product) {
    var buyBtn = $('btn-buy');
    var ttBtn = $('btn-tt');

    if (product['affiliate-link']) {
      enableLink(buyBtn, product['affiliate-link']);
    } else {
      disableLink(buyBtn);
    }

    if (product['tiktok-link']) {
      enableLink(ttBtn, product['tiktok-link']);
    } else {
      disableLink(ttBtn);
    }
  }

  function renderProduct(product, productId) {
    $('crumb-name').textContent = product.name;
    $('p-brand').textContent = product.brand || 'Brand';
    $('h1').textContent = product.name;
    $('p-tagline').textContent = product.tagline || '';
    $('p-reviews').textContent = (product.reviews || '0') + ' reviews';
    $('p-sizes').textContent = product.sizes || 'Sizes unavailable';

    $('d-color').textContent = product.colorway || '—';
    $('d-sizes').textContent = product.sizes || '—';
    $('d-rating').textContent = product.rating ? product.rating + '★' : '—';
    $('d-reviews').textContent = product.reviews || '—';

    renderPricing(product);
    renderFeatures(product);
    renderButtons(product);

    var stage = $('shoe-stage');
    stage.className = 'stg ' + (BGS[productId] || 'bwm');
    stage.innerHTML = getProductVisual(product, productId);
  }

  function renderRelatedProducts(data, currentProductId) {
    var related = $('related');
    related.innerHTML = '';

    Object.keys(data).forEach(function (key) {
      if (key === currentProductId) return;

      var product = data[key];
      var bg = BGS[key] || 'bwm';
      var visual = getProductVisual(product, key);

      var link = document.createElement('a');
      link.className = 'mc2';
      link.href = product['page-link'] || '#';
      link.setAttribute('aria-label', (product.name || 'Product') + ' by ' + (product.brand || 'brand'));

      link.innerHTML =
        '<div class="ms ' + bg + '">' + visual + '</div>' +
        '<div class="mb">' +
          '<p class="mbn">' + escapeHtml(product.brand || '') + '</p>' +
          '<h3 class="mnn">' + escapeHtml(product.name || '') + '</h3>' +
          '<div class="mf">' +
            '<span class="mp">' + escapeHtml(product.price || '') + '</span>' +
            '<span class="mc3">View Deal &rarr;</span>' +
          '</div>' +
        '</div>';

      related.appendChild(link);
    });
  }

  function renderNotFound() {
    document.title = 'Product Not Found | SNKDEAL';
    $('h1').textContent = 'Product not found';
    $('p-tagline').textContent = 'We could not find this product in products.json.';
    $('feat-list').innerHTML = '';
    disableLink($('btn-buy'));
    disableLink($('btn-tt'));
  }

  function init() {
    setupTheme();
    setupRevealAnimations();

    var productId = getProductIdFromUrl();

    fetch('../products.json')
      .then(function (response) {
        if (!response.ok) throw new Error('Failed to load products.json');
        return response.json();
      })
      .then(function (data) {
        var product = data[productId];

        if (!product) {
          renderNotFound();
          return;
        }

        renderProduct(product, productId);
        renderRelatedProducts(data, productId);

        var pageUrl = product['page-link']
          ? getAbsoluteUrl(product['page-link'])
          : window.location.href;

        if (window.SNKSEO && typeof window.SNKSEO.update === 'function') {
          window.SNKSEO.update(product, {
            siteUrl: SITE_URL,
            pageUrl: pageUrl,
            productId: productId
          });
        }
      })
      .catch(function () {
        document.title = 'Error | SNKDEAL';
        $('h1').textContent = 'Could not load product';
        $('p-tagline').textContent = 'Please check that products.json exists and the path is correct.';
        $('feat-list').innerHTML = '';
        disableLink($('btn-buy'));
        disableLink($('btn-tt'));
      });
  }

  init();
})();