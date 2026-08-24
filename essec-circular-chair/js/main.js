const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const burger = document.querySelector(".burger");
const nav = document.querySelector(".nav");
const setNavOpen = (open) => {
  if (!nav || !burger) return;
  nav.classList.toggle("open", open);
  document.body.classList.toggle("nav-open", open);
  burger.setAttribute("aria-expanded", String(open));
  burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
};

if (burger && nav) {
  burger.addEventListener("click", () => setNavOpen(!nav.classList.contains("open")));
  nav.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => setNavOpen(false));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      setNavOpen(false);
      document.querySelectorAll(".drop.open").forEach((drop) => {
        drop.classList.remove("open");
        const toggle = drop.querySelector(".drop-toggle");
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      });
    }
  });
  document.addEventListener("click", (event) => {
    if (!nav.contains(event.target)) setNavOpen(false);
  });
  window.addEventListener("resize", () => {
    if (window.matchMedia("(min-width: 981px)").matches) setNavOpen(false);
  });
}

document.querySelectorAll(".drop").forEach((drop) => {
  const toggle = drop.querySelector(".drop-toggle");
  if (!toggle) return;
  toggle.addEventListener("click", (event) => {
    if (window.matchMedia("(max-width: 980px)").matches) return;
    event.preventDefault();
    event.stopPropagation();
    const willOpen = !drop.classList.contains("open");
    document.querySelectorAll(".drop.open").forEach((other) => {
      if (other !== drop) {
        other.classList.remove("open");
        const otherToggle = other.querySelector(".drop-toggle");
        if (otherToggle) otherToggle.setAttribute("aria-expanded", "false");
      }
    });
    drop.classList.toggle("open", willOpen);
    toggle.setAttribute("aria-expanded", String(willOpen));
  });
});
document.addEventListener("click", () => {
  document.querySelectorAll(".drop.open").forEach((drop) => {
    drop.classList.remove("open");
    const toggle = drop.querySelector(".drop-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
  });
});

const studentCard = (s, fallbackHref) => {
  const name = escapeHtml(s.displayName || s.name || "");
  const linkedin = s.linkedin && /^https?:\/\//i.test(s.linkedin) ? s.linkedin : "";
  const href = linkedin || fallbackHref;
  const extra = linkedin ? ' target="_blank" rel="noopener"' : "";
  const initials = escapeHtml(
    (s.displayName || s.name || "")
      .split(" ")
      .map((word) => word[0])
      .join("")
      .slice(0, 2)
  );
  const photo =
    s.photo && !String(s.photo).endsWith("016.jpg")
      ? `<img src="${escapeHtml(s.photo)}" alt="${name}" loading="lazy">`
      : `<span class="initials">${initials}</span>`;
  const inner = `<div class="ph">${photo}</div>
              <div class="name">${name}</div>
              <div class="li">${linkedin ? "LinkedIn" : ""}</div>`;
  if (href) {
    return `<a class="student" href="${escapeHtml(href)}"${extra}>${inner}</a>`;
  }
  return `<div class="student">${inner}</div>`;
};

const swapSoftPortraits = (root) => {
  if (!root) return;
  root.querySelectorAll("img").forEach((img) => {
    const swap = () => {
      if (img.naturalWidth && img.naturalWidth < 560) {
        const name = img.getAttribute("alt") || "";
        const initials = name
          .split(" ")
          .map((word) => word[0])
          .join("")
          .slice(0, 2);
        const span = document.createElement("span");
        span.className = "initials";
        span.textContent = initials;
        img.replaceWith(span);
      }
    };
    if (img.complete) swap();
    else img.addEventListener("load", swap);
  });
};

const grid = document.querySelector("[data-students]");
if (grid) {
  const tabs = document.querySelectorAll("[data-year]");
  const note = document.querySelector("[data-cohort-note]");
  fetch("data/students.json")
    .then((r) => r.json())
    .then((students) => {
      const render = (year) => {
        if (year === "2026") {
          grid.innerHTML = "";
          for (let i = 0; i < 12; i += 1) {
            const slot = document.createElement("div");
            slot.className = "ph-slot";
            slot.textContent = "Photo 2026";
            grid.appendChild(slot);
          }
          if (note) {
            note.hidden = false;
          }
          return;
        }
        if (note) note.hidden = true;
        const list = students.filter((s) => (s.class || "").includes(year));
        grid.innerHTML = list.map((s) => studentCard(s, "")).join("");
        swapSoftPortraits(grid);
      };

      tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
          tabs.forEach((t) => t.classList.remove("active"));
          tab.classList.add("active");
          render(tab.dataset.year);
        });
      });
      render("2025");
    })
    .catch(() => {
      grid.innerHTML = "<p>Student portraits will appear here.</p>";
    });
}

const homeGrid = document.querySelector("[data-home-students]");
if (homeGrid) {
  fetch("data/students.json")
    .then((r) => r.json())
    .then((students) => {
      const soft = /\/(001|003|015|016|018|037|038|054|065|066|067)\.jpg$/;
      const list = students
        .filter((s) => (s.class || "").includes("2025") && s.photo && !soft.test(s.photo))
        .slice(0, 8);
      homeGrid.innerHTML = list.map((s) => studentCard(s, "students.html")).join("");
      swapSoftPortraits(homeGrid);
    })
    .catch(() => {});
}
