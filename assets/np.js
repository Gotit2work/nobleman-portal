/* Nobleman Productions: scroll reveals, hero parallax, and the scroll progress line, shared by every page.
 * Loaded with defer from <head>, so it runs before the dc-runtime renders on DOMContentLoaded.
 *
 *   data-reveal=""|"card"|"left"|"right"|"title"|"zoom"   animates in as it scrolls into view (np.css)
 *   data-parallax="40"                                    drifts up to 40 px against the scroll
 *   data-intro="0..7", data-letterbox, data-hero-*        landing sequence and hero scroll effect (np.css)
 *   <section id="…">                                      deep-link target, e.g. /services#questions
 */
(function () {
  var root = document.documentElement;

  // The display font stylesheet loads async (media=print, switched to all on load); run cb once it's in.
  var css = document.querySelector('link[href*="fonts.googleapis.com/css2"]');
  function whenFontCss(cb) {
    if (!css || css.media !== "print") cb();
    else css.addEventListener("load", function () { setTimeout(cb, 0); });
  }
  // .np-serif = Cormorant Garamond Italic really loaded; effects measured from its shapes key off it.
  whenFontCss(function () {
    if (!document.fonts || !document.fonts.load) return;
    document.fonts.load("italic 400 1em 'Cormorant Garamond'", "i").then(function (faces) {
      if (faces && faces.length) root.classList.add("np-serif");
    }, function () {});
  });

  // Deep links (/services#questions, used by the site map): the runtime renders the page after load, so the
  // browser's own jump to the #id finds nothing. Jump once the target exists, and keep it in place while images
  // and fonts settle (about 3 s), until the visitor scrolls on their own. Instant, whatever scroll-behavior says.
  var hash = "";
  try { hash = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
  if (hash) {
    var t0 = Date.now(), left = false;
    var stop = function () { left = true; };
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (t) { window.addEventListener(t, stop, { once: true, passive: true }); });
    (function seek() {
      if (left) return;
      var el = document.getElementById(hash);
      if (el) {
        var prev = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto";
        el.scrollIntoView(true);
        root.style.scrollBehavior = prev;
      }
      if (Date.now() - t0 < 3000) setTimeout(seek, el ? 250 : 50);
    })();
  }

  if (!("IntersectionObserver" in window) || !window.requestAnimationFrame) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  root.classList.add("np-motion");

  // Hold the landing animation (and first-screen reveals) until the display font is in, capped at ~1 s, so
  // headlines never swap typeface mid-motion. The font stylesheet loads async (media=print → all on load).
  var started = false, waiting = [];
  function start() {
    if (started) return;
    started = true;
    root.classList.add("np-fonts");
    waiting.forEach(function (el) { io.observe(el); });
    waiting = null;
  }
  setTimeout(start, 1000);
  function loadFonts() {
    if (!document.fonts || !document.fonts.load) return start();
    Promise.all([
      document.fonts.load("500 1em 'Cormorant Garamond'"),
      document.fonts.load("italic 400 1em 'Cormorant Garamond'"),
    ]).then(start, start);
  }
  whenFontCss(loadFonts);
  css && css.addEventListener("error", start);

  // Reveals: in once the element's top clears the bottom 12% of the screen; out again when it sinks back below
  // that line (scrolling up), so cards fly in and out at the bottom edge. Leaving through the top keeps it in.
  // Everything entering in one batch is staggered top-to-bottom, left-to-right. Anything already above the
  // screen when first seen (a deep link, or a fast scroll while the page was still rendering) is simply shown:
  // it was skipped, not missed, and must not wait to fly in from the wrong side when the visitor scrolls back.
  var io = new IntersectionObserver(function (entries) {
    var entering = [];
    entries.forEach(function (e) {
      if (e.isIntersecting) entering.push(e);
      else if (e.boundingClientRect.bottom <= 0 && e.boundingClientRect.height > 0 && !e.target.hasAttribute("data-in")) {
        e.target.style.setProperty("--np-d", "0ms");
        e.target.setAttribute("data-in", "");
      }
      else if (e.boundingClientRect.top > 0 && e.target.hasAttribute("data-in")) {
        e.target.style.setProperty("--np-d", "0ms");
        e.target.removeAttribute("data-in");
      }
    });
    entering.sort(function (a, b) {
      var ra = a.boundingClientRect, rb = b.boundingClientRect;
      return (Math.round(ra.top / 60) - Math.round(rb.top / 60)) || (ra.left - rb.left);
    });
    entering.forEach(function (e, i) {
      e.target.style.setProperty("--np-d", Math.min(i, 6) * 95 + "ms");
      e.target.setAttribute("data-in", "");
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0 });

  // Parallax only runs for elements near the screen.
  var near = [];
  var pio = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var i = near.indexOf(e.target);
      if (e.isIntersecting && i < 0) near.push(e.target);
      else if (!e.isIntersecting && i >= 0) near.splice(i, 1);
    });
    queue();
  }, { rootMargin: "25% 0px 25% 0px" });

  function scan() {
    var r = document.querySelectorAll("[data-reveal]:not([data-np])");
    for (var i = 0; i < r.length; i++) {
      r[i].setAttribute("data-np", "");
      if (waiting) waiting.push(r[i]); else io.observe(r[i]);
    }
    var p = document.querySelectorAll("[data-parallax]:not([data-np])");
    for (var j = 0; j < p.length; j++) { p[j].setAttribute("data-np", ""); pio.observe(p[j]); }
  }

  var bar = document.createElement("div");
  bar.className = "np-progress";
  bar.setAttribute("aria-hidden", "true");

  var ticking = false;
  function queue() { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }
  function frame() {
    ticking = false;
    var vh = window.innerHeight || 1, y = window.pageYOffset || 0;
    root.style.setProperty("--np-hero", Math.min(1, Math.max(0, y / vh)).toFixed(3));
    var max = root.scrollHeight - vh;
    bar.style.transform = "scaleX(" + (max > 0 ? Math.min(1, y / max) : 0).toFixed(4) + ")";
    for (var i = 0; i < near.length; i++) {
      var el = near[i], r = el.getBoundingClientRect();
      var amt = parseFloat(el.getAttribute("data-parallax")) || 40;
      var t = (r.top + r.height / 2 - vh / 2) / vh;
      el.style.translate = "0 " + (Math.max(-1, Math.min(1, t)) * amt).toFixed(1) + "px";
    }
  }
  // IntersectionObserver only reports changes, so an element jumped over (below the screen, then above it, never
  // on it) gets no callback at all. Catch those while scrolling, at most every 150 ms plus once after it stops:
  // anything above the screen that is still hidden is shown.
  var lastSkip = 0, skipT = 0;
  function revealSkipped() {
    if (waiting) return;
    var now = Date.now();
    if (now - lastSkip < 150) { if (!skipT) skipT = setTimeout(function () { skipT = 0; revealSkipped(); }, 160); return; }
    lastSkip = now;
    var list = document.querySelectorAll("[data-reveal][data-np]:not([data-in])");
    for (var i = 0; i < list.length; i++) {
      var r = list[i].getBoundingClientRect();
      if (r.height > 0 && r.bottom <= 0) { list[i].style.setProperty("--np-d", "0ms"); list[i].setAttribute("data-in", ""); }
    }
  }
  // Safety sweep. The observer in boot() should see every rendered element, but on the live site about one load in
  // 30-40 left a page's elements unregistered (never found why; possibly the script arriving late). So for the first
  // 10 s, on load, and while scrolling, look for [data-reveal] elements scan() never saw: on screen or above it they
  // are shown at once (no flash of hidden content), below it they are registered and animate in as usual.
  function sweep() {
    var list = document.querySelectorAll("[data-reveal]:not([data-np])"), vh = window.innerHeight || 1;
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect();
      el.setAttribute("data-np", "");
      if (r.height > 0 && r.top < vh) { el.style.setProperty("--np-d", "0ms"); el.setAttribute("data-in", ""); }
      if (waiting) waiting.push(el); else io.observe(el);
    }
  }
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("scroll", function () { sweep(); revealSkipped(); }, { passive: true });
  window.addEventListener("load", sweep);
  var sweeps = 0, sweepT = setInterval(function () { sweep(); if (++sweeps >= 20) clearInterval(sweepT); }, 500);
  window.addEventListener("resize", queue);

  function boot() {
    document.body.appendChild(bar);
    // Arriving after the page is already drawn (a slow script load): don't hide what the visitor can already see.
    var drawn = document.getElementById("dc-root");
    if (drawn && drawn.firstChild) sweep();
    scan();
    var pending = false;
    new MutationObserver(function () {
      if (pending) return;
      pending = true;
      requestAnimationFrame(function () { pending = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });
    queue();
  }
  if (document.body) boot(); else document.addEventListener("DOMContentLoaded", boot);
})();
