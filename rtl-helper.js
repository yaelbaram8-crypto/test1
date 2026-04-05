/* -------------- rtl-helper.js – JavaScript גלובלי ל-RTL -------------- */

function containsHebrew(text) {
  return /[\u0590-\u05FF]/.test(text);
}

function applyRtlIfHebrew(el, text) {
  if (containsHebrew(text)) {
    el.classList.add('rtl');
    el.setAttribute('dir', 'rtl');
  } else {
    el.classList.remove('rtl');
    el.removeAttribute('dir');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.auto-rtl').forEach(el => {
    applyRtlIfHebrew(el, el.textContent);
  });
});

window.rtlHelper = {
  containsHebrew,
  applyRtlIfHebrew,
};
