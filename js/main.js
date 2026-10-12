// js/main.js — shared site behavior
(() => {
  'use strict';

  // Supports both current footers: #year and the project template's [data-year].
  const currentYear = String(new Date().getFullYear());
  document.querySelectorAll('#year, [data-year]').forEach((element) => {
    element.textContent = currentYear;
  });

  const nav = document.querySelector('.site-nav');
  const darkSections = Array.from(
    document.querySelectorAll('[data-nav-theme="dark"]')
  );

  if (nav) {
    let lastScrollY = window.scrollY;
    let scrollDelta = 0;
    let lastDirection = 0;
    let framePending = false;

    const updateNavigation = () => {
      const currentY = window.scrollY;
      const delta = currentY - lastScrollY;
      const direction = Math.sign(delta);

      // Keep the header visible at the top and use the same threshold everywhere.
      if (currentY <= 24) {
        nav.classList.remove('nav-hidden');
        scrollDelta = 0;
        lastDirection = 0;
      } else if (direction !== 0) {
        if (direction !== lastDirection) scrollDelta = 0;
        scrollDelta += delta;

        if (scrollDelta >= 8) {
          nav.classList.add('nav-hidden');
          scrollDelta = 0;
        } else if (scrollDelta <= -8) {
          nav.classList.remove('nav-hidden');
          scrollDelta = 0;
        }

        lastDirection = direction;
      }

      // Switch the same glass/background and text treatment over marked dark sections.
      const navHeight = nav.offsetHeight;
      const themeThreshold = Math.max(navHeight, 58) + 12;
      const isOverDarkSection = darkSections.some((section) => {
        const rect = section.getBoundingClientRect();
        // Use offsetHeight, not the transformed rectangle: the nav may be hidden above the viewport.
        // The 70px threshold aligns with the former home-page theme change.
        return rect.top <= themeThreshold && rect.bottom > navHeight;
      });
      nav.classList.toggle('nav-on-dark', isOverDarkSection);

      lastScrollY = currentY;
      framePending = false;
    };

    const scheduleNavigationUpdate = () => {
      if (framePending) return;
      framePending = true;
      window.requestAnimationFrame(updateNavigation);
    };

    window.addEventListener('scroll', scheduleNavigationUpdate, { passive: true });
    window.addEventListener('resize', scheduleNavigationUpdate);
    updateNavigation();
  }

  // Product cards are real links; preserve their optional clicked/active visual state.
  const productCards = Array.from(document.querySelectorAll('.product-card'));
  productCards.forEach((card) => {
    card.addEventListener('click', () => {
      productCards.forEach((item) => item.classList.remove('active'));
      card.classList.add('active');
    });
  });

  // Pancake page section reveals; the rest of the site is unaffected.
  const revealSections = document.querySelectorAll(
    '.pancake-teaser, .pancake-documentation, .pancake-showcase, .pancake-final-cta'
  );

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!prefersReducedMotion && 'IntersectionObserver' in window && revealSections.length) {
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, {
      threshold: 0.12,
      rootMargin: '0px 0px -35px 0px'
    });

    revealSections.forEach((section) => {
      section.classList.add('reveal-on-scroll');
      revealObserver.observe(section);
    });
  }
})();
