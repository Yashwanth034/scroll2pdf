(function initializeLazyImages() {
  "use strict";

  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const image = entry.target;
      const index = image.dataset.index;
      const hue = 195 + (Number(index) * 28);
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800">
          <rect width="1200" height="800" fill="hsl(${hue} 70% 82%)"/>
          <text x="600" y="420" text-anchor="middle" font-family="sans-serif" font-size="76" fill="#10213b">Lazy image ${index}</text>
        </svg>`;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      observer.unobserve(image);
    }
  }, { rootMargin: "100px" });

  document.querySelectorAll(".lazy-image").forEach((image) => observer.observe(image));
})();
