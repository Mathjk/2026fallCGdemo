// Use the original MathML for accessibility and render portable glyphs on phones.
(function () {
  "use strict";
  var mobile = window.matchMedia("(max-width: 53rem), (any-pointer: coarse)");
  var cache = new Map();
  var started = false;
  var mode = "";

  function hasMathLayout() {
    var probe = document.createElement("span");
    probe.style.cssText = "position:absolute;visibility:hidden;left:0;top:0;font-size:18px";
    probe.innerHTML = "<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>";
    document.body.appendChild(probe);
    var digits = probe.getElementsByTagName("mn");
    var top = digits[0].getBoundingClientRect();
    var bottom = digits[1].getBoundingClientRect();
    probe.remove();
    return top.height > 0 && bottom.top > top.top + top.height / 2;
  }

  // Preserve grouping if the SVG component is unavailable on a slow/offline connection.
  function linearMath(node) {
    var parts = Array.prototype.map.call(node.children, linearMath);
    switch (node.localName) {
      case "mfrac": return "(" + parts[0] + ")/(" + parts[1] + ")";
      case "msqrt": return "√(" + parts.join("") + ")";
      case "msub": return parts[0] + "_(" + parts[1] + ")";
      case "msup": return parts[0] + "^(" + parts[1] + ")";
      case "msubsup": return parts[0] + "_(" + parts[1] + ")^(" + parts[2] + ")";
      case "mspace": return " ";
      case "mtr": return "[" + parts.join(", ") + "]";
      case "mtable": return parts.join("；");
      default: return parts.length ? parts.join("") : node.textContent.trim();
    }
  }

  function svgFor(math) {
    var display = math.getAttribute("display") === "block";
    var markup = '<math xmlns="http://www.w3.org/1998/Math/MathML" display="' +
      (display ? "block" : "inline") + '">' + math.innerHTML + "</math>";
    var svg = cache.get(markup);
    if (!svg) {
      svg = window.MathJax.mathml2svg(markup, {display:display}).querySelector("svg");
      svg.setAttribute("focusable", "false");
      if (cache.size >= 256) cache.delete(cache.keys().next().value);
      cache.set(markup, svg);
    }
    return svg.cloneNode(true);
  }

  function render(root) {
    if (!mode) return;
    var sources = root.getElementsByTagName("math");
    for (var i = 0; i < sources.length; i++) {
      var math = sources[i];
      var previous = math.getAttribute("data-rendered");
      if (previous === mode) continue;
      var visual = previous ? math.nextElementSibling : document.createElement("span");
      visual.className = "course-math-visual";
      visual.setAttribute("aria-hidden", "true");
      visual.textContent = "";
      var used = mode;
      if (mode === "svg") {
        try { visual.appendChild(svgFor(math)); }
        catch (_) { used = "text"; }
      }
      if (used === "text") visual.textContent = linearMath(math);
      if (!previous) math.parentNode.insertBefore(visual, math.nextSibling);
      math.setAttribute("data-rendered", used);
    }
  }
  window.renderCourseMath = render;

  var nativeLayout = hasMathLayout();
  function useText() { mode = "text"; render(document); }
  function load() {
    if (started || (nativeLayout && !mobile.matches)) return;
    started = true;
    useText();
    window.MathJax = {
      startup: {typeset:false},
      options: {enableMenu:false},
      svg: {fontCache:"none", internalSpeechTitles:false}
    };
    var script = document.createElement("script");
    script.src = "./assets/mathjax-3.2.2/mml-svg.js";
    script.onload = function () {
      if (!window.MathJax.startup || !window.MathJax.startup.promise) { useText(); return; }
      window.MathJax.startup.promise.then(function () {
        mode = "svg";
        render(document);
      }, useText);
    };
    script.onerror = useText;
    document.head.appendChild(script);
  }
  load();
  if (!started) mobile.addListener(load);
})();
