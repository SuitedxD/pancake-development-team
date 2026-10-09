(() => {
  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  const nav = document.querySelector('.page-nav');
  let lastY = window.scrollY;
  let raf = 0;

  const syncNav = () => {
    if (!nav) return;
    const y = window.scrollY;
    const delta = y - lastY;

    if (y <= 24 || delta < 0) {
      nav.classList.remove('nav-hidden');
    } else if (delta > 0) {
      nav.classList.add('nav-hidden');
    }

    lastY = y;
    raf = 0;
  };

  window.addEventListener('scroll', () => {
    if (!raf) raf = window.requestAnimationFrame(syncNav);
  }, { passive: true });

  syncNav();
})();
