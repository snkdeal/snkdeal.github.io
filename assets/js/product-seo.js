(function () {
  'use strict';

  function setMetaByName(name, content) {
    if (!content) return;
    var el = document.querySelector('meta[name="' + name + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('name', name);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setMetaByProperty(property, content) {
    if (!content) return;
    var el = document.querySelector('meta[property="' + property + '"]');
    if (!el) {
      el = document.createElement('meta');
      el.setAttribute('property', property);
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  }

  function setCanonical(url) {
    if (!url) return;
    var canon = document.querySelector('link[rel="canonical"]');
    if (!canon) {
      canon = document.createElement('link');
      canon.rel = 'canonical';
      document.head.appendChild(canon);
    }
    canon.href = url;
  }

  function parsePrice(value) {
    return String(value || '').replace(/[^0-9.]/g, '');
  }

  function parseReviewCount(value) {
    var raw = String(value || '').trim().toLowerCase();
    if (raw.indexOf('k') > -1) {
      return String(Math.round(parseFloat(raw.replace('k', '')) * 1000));
    }
    return raw.replace(/[^0-9]/g, '') || '0';
  }

  function toAbsoluteUrl(url, siteUrl) {
    if (!url) return '';
    return /^https?:\/\//i.test(url) ? url : siteUrl + url;
  }

  function isValidNumber(value) {
    return value !== '' && !isNaN(Number(value));
  }

  window.SNKSEO = {
    update: function (product, options) {
      if (!product || !options) return;

      var siteUrl = options.siteUrl;
      var pageUrl = options.pageUrl;
      var productId = options.productId;

      var imageUrl = product.image && product.image.trim() !== ''
        ? toAbsoluteUrl(product.image, siteUrl)
        : siteUrl + '/og-image.jpg';

      document.title = product.name + ' Review, Price & Deal | SNKDEAL';

      setMetaByName(
        'description',
        product.name + ' by ' + product.brand + '. ' + product.tagline +
        ' View price, sizes, colorway, rating, and TikTok review on SNKDEAL.'
      );

      setMetaByName('robots', 'index,follow,max-image-preview:large');
      setCanonical(pageUrl);

      setMetaByProperty('og:type', 'website');
      setMetaByProperty('og:title', product.name + ' Review, Price & Deal | SNKDEAL');
      setMetaByProperty('og:description', product.tagline + ' View pricing, sizes, and product details.');
      setMetaByProperty('og:url', pageUrl);
      setMetaByProperty('og:site_name', 'SNKDEAL');
      setMetaByProperty('og:image', imageUrl);

      setMetaByName('twitter:card', 'summary_large_image');
      setMetaByName('twitter:site', '@popwiremedia');
      setMetaByName('twitter:title', product.name + ' Review, Price & Deal | SNKDEAL');
      setMetaByName('twitter:description', product.tagline + ' View pricing and product details.');
      setMetaByName('twitter:image', imageUrl);

      var priceValue = parsePrice(product.price);
      var ratingValue = String(product.rating || '').trim();
      var reviewCount = parseReviewCount(product.reviews);

      var productLd = {
        '@context': 'https://schema.org',
        '@type': 'Product',
        '@id': pageUrl + '#product',
        'mainEntityOfPage': pageUrl,
        'name': product.name,
        'description': product.tagline,
        'url': pageUrl,
        'image': [imageUrl],
        'sku': product.id || productId,
        'brand': {
          '@type': 'Brand',
          'name': product.brand
        },
        'category': 'Sneakers',
        'offers': {
          '@type': 'Offer',
          'url': pageUrl,
          'price': priceValue,
          'priceCurrency': 'USD',
          'availability': 'https://schema.org/InStock',
          'itemCondition': 'https://schema.org/NewCondition'
        }
      };

      if (isValidNumber(ratingValue) && isValidNumber(reviewCount) && Number(reviewCount) > 0) {
        productLd.aggregateRating = {
          '@type': 'AggregateRating',
          'ratingValue': Number(ratingValue),
          'reviewCount': Number(reviewCount),
          'bestRating': 5,
          'worstRating': 1
        };
      }

      var productLdEl = document.getElementById('ld-product');
      if (productLdEl) {
        productLdEl.textContent = JSON.stringify(productLd);
      }

      var breadcrumbLdEl = document.getElementById('ld-breadcrumb');
      if (breadcrumbLdEl) {
        breadcrumbLdEl.textContent = JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          'itemListElement': [
            {
              '@type': 'ListItem',
              'position': 1,
              'name': 'Home',
              'item': siteUrl + '/'
            },
            {
              '@type': 'ListItem',
              'position': 2,
              'name': product.name,
              'item': pageUrl
            }
          ]
        });
      }
    }
  };
})();