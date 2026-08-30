// The hero card alternates between its two slate kinds, like switching slates in the app.
(() => {
  const demo = document.querySelector('.demo');
  if (demo && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const kinds = ['terminal', 'browser'];
    let i = 0;
    setInterval(() => {
      i = (i + 1) % kinds.length;
      demo.dataset.slate = kinds[i];
      // restart the entrance animation on the newly shown body
      const body = demo.querySelector('.demo-body > .only-' + kinds[i]);
      if (body) { body.style.animation = 'none'; void body.offsetWidth; body.style.animation = ''; }
    }, 4500);
  }

  for (const btn of document.querySelectorAll('.copy[data-copy]')) {
    btn.addEventListener('click', async () => {
      const target = document.querySelector(btn.dataset.copy);
      if (!target) return;
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        btn.textContent = 'Copied';
        btn.classList.add('done');
        setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('done'); }, 1600);
      } catch { /* clipboard unavailable */ }
    });
  }
})();
