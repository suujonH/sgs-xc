(() => {
  "use strict";

  const search = document.getElementById("search");
  const sections = Array.from(document.querySelectorAll("#manual-content > section"));
  const links = Array.from(document.querySelectorAll("#navigation a"));
  const noResults = document.getElementById("no-results");

  function selectLink(id) {
    for (const link of links) link.classList.toggle("active", link.getAttribute("href") === `#${id}`);
  }

  const observer = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top);
    if (visible[0]) selectLink(visible[0].target.id);
  }, { rootMargin: "-10% 0px -72% 0px", threshold: [0, .2] });

  for (const section of sections) observer.observe(section);

  search.addEventListener("input", () => {
    const query = search.value.trim().toLowerCase();
    let count = 0;
    for (const section of sections) {
      const searchable = `${section.dataset.title || ""} ${section.textContent || ""}`.toLowerCase();
      const matched = !query || searchable.includes(query);
      section.hidden = !matched;
      if (matched) count += 1;
    }
    noResults.hidden = count !== 0;
  });
})();
