(() => {
  const s = document.querySelector('.stage');
  const fit = () => s.style.setProperty('--k', Math.min(innerWidth / 1920, innerHeight / 1080));
  fit(); addEventListener('resize', fit);
})();
