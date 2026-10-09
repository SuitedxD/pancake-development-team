const year = document.getElementById('year');
if (year) year.textContent = new Date().getFullYear();

const nav = document.querySelector('nav');
const hero = document.querySelector('.hero');
let lastScrollY = window.scrollY;
let rafId = 0;

function updateNavigation() {
  const currentY = window.scrollY;
  const direction = currentY - lastScrollY;

  if (!nav) return;

  if (currentY <= 24) {
    nav.classList.remove('nav-hidden');
  } else if (direction > 0) {
    nav.classList.add('nav-hidden');
  } else if (direction < 0) {
    nav.classList.remove('nav-hidden');
  }

  if (hero) {
    nav.classList.toggle('nav-on-dark', hero.getBoundingClientRect().bottom <= 70);
  }

  lastScrollY = currentY;
  rafId = 0;
}

window.addEventListener('scroll', () => {
  if (!rafId) rafId = window.requestAnimationFrame(updateNavigation);
}, { passive: true });

updateNavigation();

for (const card of document.querySelectorAll('.product-card')) {
  const select = () => {
    for (const item of document.querySelectorAll('.product-card')) item.classList.remove('active');
    card.classList.add('active');
  };

  card.addEventListener('click', select);
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
  });
}

(() => {
  const nav = document.querySelector(
    'nav[aria-label="Primary navigation"]'
  );

  const darkSections = document.querySelectorAll(
    '[data-nav-theme="dark"]'
  );

  if (!nav || !darkSections.length) return;

  function updateNavTheme() {
    const navBottom = nav.getBoundingClientRect().bottom;

    const isOverDarkSection = [...darkSections].some(section => {
      const rect = section.getBoundingClientRect();

      return rect.top <= navBottom && rect.bottom > navBottom;
    });

    nav.classList.toggle(
      "nav-on-dark-text",
      isOverDarkSection
    );
  }

  window.addEventListener("scroll", updateNavTheme, {
    passive: true
  });

  window.addEventListener("resize", updateNavTheme);

  updateNavTheme();
})();

(() => {
  const sections = document.querySelectorAll(
    ".pancake-teaser, " +
    ".pancake-documentation, " +
    ".pancake-showcase, " +
    ".pancake-final-cta"
  );

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  if (!("IntersectionObserver" in window)) {
    return;
  }

  const revealObserver = new IntersectionObserver(
    (entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
      rootMargin: "0px 0px -35px 0px"
    }
  );

  sections.forEach((section) => {
    section.classList.add("reveal-on-scroll");
    revealObserver.observe(section);
  });
})();