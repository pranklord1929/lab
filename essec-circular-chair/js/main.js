const burger = document.querySelector(".burger");
const nav = document.querySelector(".nav");
if (burger && nav) {
  burger.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
  });
}

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
        grid.innerHTML = list
          .map((s) => {
            const name = s.displayName || s.name;
            const href = s.linkedin || "#";
            const extra = s.linkedin ? ' target="_blank" rel="noopener"' : "";
            const initials = name.split(" ").map((w) => w[0]).join("").slice(0, 2);
            const photo = s.photo
              ? `<img src="${s.photo}" alt="${name}" loading="lazy">`
              : `<span class="initials">${initials}</span>`;
            return `<a class="student" href="${href}"${extra}>
              <div class="ph">${photo}</div>
              <div class="name">${name}</div>
              <div class="li">${s.linkedin ? "LinkedIn" : ""}</div>
            </a>`;
          })
          .join("");
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
      const list = students.filter((s) => (s.class || "").includes("2025")).slice(0, 10);
      homeGrid.innerHTML = list
        .map((s) => {
          const name = s.displayName || s.name;
          const href = s.linkedin || "students.html";
          const extra = s.linkedin ? ' target="_blank" rel="noopener"' : "";
          return `<a class="student" href="${href}"${extra}>
            <div class="ph">${s.photo ? `<img src="${s.photo}" alt="${name}" loading="lazy">` : `<span class="initials">${name.split(" ").map((w)=>w[0]).join("").slice(0,2)}</span>`}</div>
            <div class="name">${name}</div>
            <div class="li">${s.linkedin ? "LinkedIn" : ""}</div>
          </a>`;
        })
        .join("");
    })
    .catch(() => {});
}
