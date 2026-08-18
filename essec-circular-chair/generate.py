#!/usr/bin/env python3
"""Generate the static ESSEC Circular Economy Chair site."""
from pathlib import Path
import json

ROOT = Path(__file__).parent
IMG = json.loads((ROOT / "data" / "local-images.json").read_text())

def src(group, i, w=1600):
    return IMG[group][i - 1]


LOGO = """<svg class="brand-mark" viewBox="0 0 36 36" fill="none" aria-hidden="true">
  <circle cx="18" cy="18" r="15.2" stroke="currentColor" stroke-width="1.2"/>
  <path d="M18 7c-3.8 3.9-6.2 7.4-6.2 11s2.4 7.1 6.2 11c3.8-3.9 6.2-7.4 6.2-11S21.8 10.9 18 7Z" stroke="currentColor" stroke-width="1.2"/>
  <circle cx="18" cy="18" r="2" fill="currentColor"/>
</svg>"""

NAV = """
<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="index.html">
      {logo}
      <span class="brand-text"><strong>ESSEC</strong><span>Global Circular Economy Chair</span></span>
    </a>
    <nav class="nav-links" aria-label="Primary">
      <a href="index.html" class="{home}">The Chair</a>
      <div class="drop">
        <span>Program</span>
        <div class="drop-menu">
          <a href="program.html">Overview</a>
          <a href="education.html">Students Education</a>
          <a href="study-trips.html">Study Trips</a>
          <a href="site-visits.html">Site Visits</a>
          <a href="events.html">Events</a>
          <a href="apply.html">How to Apply</a>
        </div>
      </div>
      <div class="drop">
        <span>Students</span>
        <div class="drop-menu">
          <a href="students.html">Cohorts</a>
          <a href="testimonies.html">Testimonies</a>
        </div>
      </div>
      <a href="team.html" class="{team}">Team</a>
      <a href="partners.html" class="{partners}">Partners</a>
      <div class="drop">
        <span>Content</span>
        <div class="drop-menu">
          <a href="content.html">Research &amp; training</a>
          <a href="publications.html">Publications</a>
          <a href="circular-cac-40.html">Circular CAC 40</a>
        </div>
      </div>
      <a class="nav-cta" href="apply.html">Apply</a>
    </nav>
    <button class="burger" aria-label="Open menu" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
</header>
""".replace("{logo}", LOGO)

FOOT = """
<footer>
  <div class="wrap foot-grid">
    <div>
      <h4>ESSEC Chair</h4>
      <p style="color:rgba(255,252,247,.72);max-width:36ch">Training the next generation of circular economy leaders and future Chief Circular Officers.</p>
    </div>
    <div>
      <h4>Explore</h4>
      <ul>
        <li><a href="program.html">Program</a></li>
        <li><a href="education.html">Education</a></li>
        <li><a href="students.html">Students</a></li>
        <li><a href="partners.html">Partners</a></li>
      </ul>
    </div>
    <div>
      <h4>Join</h4>
      <ul>
        <li><a href="apply.html">Student applications</a></li>
        <li><a href="index.html#certificate">Executive Certificate</a></li>
        <li><a href="team.html">The team</a></li>
      </ul>
    </div>
    <div>
      <h4>Contact</h4>
      <ul>
        <li><a href="mailto:circulareco@essec.edu">circulareco@essec.edu</a></li>
        <li><a href="mailto:justine@circulab.com">justine@circulab.com</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap foot-bottom">
    <span>ESSEC Global Circular Economy Chair</span>
    <span>The future is circular.</span>
  </div>
</footer>
<script src="js/main.js"></script>
"""


def page(title, body, active="home"):
    flags = {k: "active" if k == active else "" for k in ("home", "team", "partners")}
    nav = NAV.format(**flags)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title} — ESSEC Global Circular Economy Chair</title>
  <meta name="description" content="ESSEC Global Circular Economy Chair — training the next generation of circular economy leaders.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>
{nav}
{body}
{FOOT}
</body>
</html>
"""


INDEX = f"""
<section class="hero">
  <div class="hero-media">
    <img src="{src('trips', 1)}" alt="ESSEC Circular Economy Chair learning expedition in Brussels">
  </div>
  <div class="wrap hero-content">
    <p class="kicker">ESSEC Business School</p>
    <h1>Shaping the leaders of the economy of tomorrow</h1>
    <p class="lead">The ESSEC Global Circular Economy Chair trains future Chief Circular Officers — through academic courses, applied projects with industry, and an open ecosystem of corporates, startups and public institutions.</p>
    <div class="hero-actions">
      <a class="btn btn-gold" href="apply.html">Join the 2026 cohort</a>
      <a class="btn btn-ghost" href="#certificate">Executive Certificate</a>
    </div>
    <div class="hero-meta">
      <div><strong>~30</strong>students per master class</div>
      <div><strong>6</strong>courses to validate the Chair</div>
      <div><strong>Brussels</strong>annual learning expedition</div>
      <div><strong>Fall 2026</strong>Executive Certificate</div>
    </div>
  </div>
</section>

<section>
  <div class="wrap split">
    <div class="reveal">
      <span class="kicker">The Chair</span>
      <h2>An academic home for circular transformation</h2>
      <p>The circular economy is one of the most powerful approaches to reconcile economic growth with sustainable development. As resources become increasingly constrained and consumption patterns evolve towards more responsible models, circular approaches offer long-term solutions that create both environmental and economic value.</p>
      <p>The ESSEC Global Circular Economy Chair aims to train the next generation of circular economy leaders capable of driving transformation across industries and organizations.</p>
      <p>Through academic courses, applied projects, and close collaboration with industry partners including L’Oréal, SNCF Réseau and Equans, students gain hands-on experience of real-world circular challenges and opportunities.</p>
      <p>Beyond education, the Chair develops academic research and fosters an open, global ecosystem bringing together corporates, startups, think tanks, researchers and public institutions.</p>
      <p class="quote" style="margin-top:28px">The future is circular, let us build it together.</p>
    </div>
    <img src="{src('visits', 4)}" alt="Chair students on a partner site visit">
  </div>
</section>

<section style="padding-top:0">
  <div class="wrap">
    <div class="stat-row">
      <div class="stat"><strong>Ambassadors</strong><span>Leaders who promote circular economy as the model for tomorrow’s economic, environmental and social challenges.</span></div>
      <div class="stat"><strong>Makers</strong><span>Practitioners who implement circular principles on a real project, and measure their impact.</span></div>
      <div class="stat"><strong>Partners</strong><span>Applied work with L’Oréal, EssilorLuxottica, Bouygues, SNCF Réseau, Equans and expert studios.</span></div>
      <div class="stat"><strong>Campuses</strong><span>Progressively deployed across ESSEC’s three campuses: Cergy, Singapore and Rabat.</span></div>
    </div>
  </div>
</section>

<section class="panel" id="certificate">
  <div class="wrap">
    <div class="feature">
      <div class="body">
        <div class="tag kicker">Executive Education</div>
        <h2>Circular Executive Certificate</h2>
        <p>Strengthening Your Business Through Circular Economy Principles — a 25-hour in-person executive program developed by the TOGETHER Institute and the ESSEC Global Circular Economy Chair, in partnership with Circulab.</p>
        <p>Designed for business leaders, managers and decision-makers, the program helps participants assess business dependencies and risks, explore circular opportunities, and build a practical action plan tailored to their organization.</p>
        <p>Available in inter-company and customized in-company formats. First sessions expected in Fall 2026.</p>
        <div class="hero-actions" style="margin-top:24px">
          <a class="btn btn-dark" href="https://drive.google.com/file/d/1gWVCwRe7wDwRuNJzIV9xzYQOH-RW9Xzi/view" target="_blank" rel="noopener">Download the brochure</a>
          <a class="btn btn-line" href="mailto:justine@circulab.com">Contact Justine Laurent</a>
        </div>
      </div>
      <img src="{src('program', 1)}" alt="Circular Executive Certificate">
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">Impact &amp; projects</span>
      <h2>A Chair that is alive — in the field, with partners, every year</h2>
      <p class="lead">Recent work with students, faculty and industry partners. The 2026 cohort photos, LinkedIn profiles and new Brussels materials will be added as soon as they are received.</p>
    </div>
    <div class="grid-3">
      <article class="media-card">
        <img src="{src('trips', 2)}" alt="Brussels learning expedition">
        <div class="body">
          <div class="tag">Learning expedition</div>
          <h3>Brussels</h3>
          <p>Students met the European Parliament, Repair Together, cityfab 1, BC Materials, CBE-JU, Permafungi and The Upcycling Lab — from grassroots repair to bio-based innovation.</p>
          <a href="study-trips.html">Read the expedition →</a>
        </div>
      </article>
      <article class="media-card">
        <img src="{src('events', 1)}" alt="Final jury of the Chair">
        <div class="body">
          <div class="tag">June 2025</div>
          <h3>Final Jury</h3>
          <p>Students presented six-month projects developed with EssilorLuxottica, Bouygues Group and L’Oréal — academia and industry working on real circular briefs.</p>
          <a href="events.html">See events →</a>
        </div>
      </article>
      <article class="media-card">
        <img src="{src('visits', 2)}" alt="Site visit to a circular company">
        <div class="body">
          <div class="tag">Site visits</div>
          <h3>From Vesto to L’Oréal</h3>
          <p>Reconditioning, reuse in construction, packaging innovation and office furniture: visits to Vesto, Cyneo, L’Oréal Packaging Lab, Manutan and Villette Makerz.</p>
          <a href="site-visits.html">Explore visits →</a>
        </div>
      </article>
    </div>
  </div>
</section>

<section class="forest">
  <div class="wrap split">
    <div>
      <span class="kicker">Applications</span>
      <h2>Join the Chair in September 2026</h2>
      <p>Each year the Chair welcomes approximately 30 students from eligible ESSEC programs. Applications for the September 2026 cohort will open in the coming months. The application link will be published here as soon as it is available.</p>
      <p>Currently eligible:</p>
      <div class="pill-list">
        <span class="pill">Master in Management (MiM)</span>
        <span class="pill">MSc in Sustainability Transformation</span>
        <span class="pill">SMIB</span>
        <span class="pill">Global BBA</span>
      </div>
      <p style="margin-top:18px">Additional programs currently under discussion:</p>
      <div class="pill-list">
        <span class="pill ghost">GAISC</span>
        <span class="pill ghost">IMHI</span>
        <span class="pill ghost">MMD</span>
      </div>
      <div class="hero-actions">
        <a class="btn btn-gold" href="apply.html">How to apply</a>
        <a class="btn btn-ghost" href="education.html">See the curriculum</a>
      </div>
    </div>
    <div class="notice" style="display:block;background:rgba(255,252,247,.06);border-color:rgba(201,168,106,.45)">
      <p class="soon">Application link</p>
      <h3 style="color:#fff;margin:12px 0">Coming soon</h3>
      <p>The candidature form for the 2026 cohort is not yet open. Typical timeline: applications in September, interviews in October, results mid-October. Check back here, or write to the Chair team.</p>
      <p style="margin-top:16px"><a class="btn btn-ghost" href="mailto:circulareco@essec.edu">circulareco@essec.edu</a></p>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">Partners</span>
      <h2>An ecosystem of industry and expertise</h2>
    </div>
    <div class="logo-row">
      <a class="logo-box" href="https://www.loreal.com/en/" target="_blank" rel="noopener"><img src="{src('partners', 1, 800)}" alt="L'Oréal, Gold Sponsor"></a>
      <div class="logo-box"><img src="{src('partners', 2, 800)}" alt="Silver sponsor"></div>
      <div class="logo-box"><img src="{src('partners', 3, 800)}" alt="Silver sponsor"></div>
    </div>
    <p style="margin-top:20px"><a href="partners.html">All partners →</a></p>
  </div>
</section>

<section class="panel">
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">The students</span>
      <h2>A living community of circular leaders</h2>
      <p class="lead">Portraits and LinkedIn of the current classes. The 2026 promotion — photos and profiles — will be published on this page as soon as they are available.</p>
    </div>
    <div class="students" data-home-students></div>
    <p style="margin-top:24px"><a class="btn btn-dark" href="students.html">Meet all cohorts</a></p>
  </div>
</section>
"""

PROGRAM = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our Program</span>
  <h1>From ambassadors to makers</h1>
</div></div>
<section>
  <div class="wrap split">
    <div>
      <h2>Introduction</h2>
      <p>The Global Circular Economy Chair holds a vision of a society in which the principles of the circular economy systematically become a priority in our economy, compared to the linear economy that wastes resources.</p>
      <h3 style="margin-top:36px">Objectives</h3>
      <div class="grid-2" style="margin-top:20px">
        <article class="card"><h3>Ambassadors</h3><p>To train ambassadors to promote the circular economy as the best model to solve the major challenges of tomorrow (economic, environmental and social), in all organizations.</p></article>
        <article class="card"><h3>Makers</h3><p>To train makers who will implement and apply the principles of the circular economy to a specific project in their own environment, by measuring its impacts.</p></article>
      </div>
    </div>
    <img src="{src('program', 2)}" alt="Chair program">
  </div>
  <div class="wrap" style="margin-top:56px">
    <div class="grid-4">
      <a class="card" href="education.html"><div class="tag">01</div><h3>Education</h3><p>Six compulsory courses, a Chair seminar and an application seminar with partners.</p></a>
      <a class="card" href="study-trips.html"><div class="tag">02</div><h3>Study trips</h3><p>An annual expedition to pioneering circular economy ecosystems — Brussels, and before that the Netherlands.</p></a>
      <a class="card" href="site-visits.html"><div class="tag">03</div><h3>Site visits</h3><p>Seminars and learning expeditions inside organizations that practice circularity.</p></a>
      <a class="card" href="apply.html"><div class="tag">04</div><h3>How to apply</h3><p>Eligible ESSEC programs, typical calendar, and the 2026 application link — coming soon.</p></a>
    </div>
  </div>
</section>
"""

EDUCATION = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Students Education</span>
  <h1>A pioneering educational offer on the circular economy</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">A master class of 30 multi-disciplinary international students: 6 compulsory courses in English to validate the curriculum, including a course dedicated to initiatives for our partners — design and prototyping of circular products, transformation of linear processes, new uses, reverse logistics, and the supply chains of tomorrow.</p>
    <p>An annual learning expedition to pioneering countries of the circular economy. In 2025, the Chair met organizations and hubs in Brussels. The program will be progressively deployed on all three ESSEC campuses (Singapore, Rabat, Cergy).</p>
    <h2 style="margin:56px 0 12px">Chair teaching program</h2>
    <div class="course">
      <code>DEVE31401 · T2 Tuesday</code>
      <h3>Chair Seminar Circular Economy</h3>
      <p>One mandatory Chair seminar. Expert presentations, site visits, and a one-week study trip to a pioneering country of the circular economy. Students meet academic experts, institutions and companies in order to define circular roadmaps inspired by these contributions and concrete examples.</p>
    </div>
    <div class="course">
      <code>Four mandatory courses</code>
      <h3>Core curriculum</h3>
      <p>DEVE31417 — Impact assessment of social innovations (T2 Monday)<br>
      DEVE31273 — From Linear To Circular: get the core methodology of circular economy (T2 Tuesday)<br>
      MOPP31327 — Environmental &amp; Social Challenges in Operations (T2 Monday)<br>
      ECOA31205 — Environmental Economics (T3 Tuesday)</p>
    </div>
    <div class="course">
      <code>DEVE31403 · T3 Tuesday</code>
      <h3>Circularize your organization</h3>
      <p>One application seminar. Student groups work on application cases whose problems are given by partner sponsors. Students learn to implement a circular economy project on a specific sector and value-chain element; to develop an economic, social and environmental model; and to present results to company representatives.</p>
    </div>
    <h2 style="margin:56px 0 16px">Validation conditions</h2>
    <div class="pill-list">
      <span class="pill">1 Chair seminar</span>
      <span class="pill">4 mandatory courses</span>
      <span class="pill">1 application seminar</span>
    </div>
  </div>
</section>
"""

TRIPS = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Study trips</span>
  <h1>Learning from the places that pioneer circularity</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">Every year, the Chair organizes a study visit to meet the people and organizations pioneering the circular economy. Students learn from their journeys, complement their work in school, and apply it to Chair projects and future careers.</p>
    <div class="notice" style="margin:32px 0 56px">
      <div>
        <p class="soon">2026 materials</p>
        <h3>Brussels, next chapter</h3>
        <p>New photographs, captions and student stories from the latest Brussels expedition will be integrated here when they are delivered.</p>
      </div>
    </div>
    <article class="split" style="margin-bottom:80px">
      <img src="{src('trips', 1)}" alt="Brussels 2025">
      <div>
        <div class="tag kicker">Brussels, 2025</div>
        <h2>Parliament, repair, soil and bio-based industry</h2>
        <p>In April 2025, the Chair traveled again to Brussels. At the European Parliament, students explored the legislative tools shaping circular policy. Visits to Repair Together and cityfab 1 showed how community repair and digital fabrication extend product lifecycles. BC Materials transforms excavated urban soils into construction materials; CBE-JU highlighted public–private partnerships in circular bio-based industries. Permafungi and The Upcycling Lab turned waste streams — mushroom substrates, discarded textiles — into products.</p>
      </div>
    </article>
    <article class="split" style="margin-bottom:80px">
      <div>
        <div class="tag kicker">Brussels, 2024</div>
        <h2>Construction, creativity, reuse</h2>
        <p>Students explored circular construction at ecobuild, art and entrepreneurship at Circularium, policy at the European Parliament, local reused materials at BC Materials, discarded-object value at R-Use Fabrik, and research at CBE-JU.</p>
      </div>
      <img src="{src('trips', 4)}" alt="Brussels 2024">
    </article>
    <article class="split">
      <img src="{src('trips', 7)}" alt="Netherlands 2022">
      <div>
        <div class="tag kicker">Netherlands, 2022</div>
        <h2>Amsterdam &amp; Rotterdam</h2>
        <p>Circle Economy, Circl, the City of Rotterdam, Excess Materials Exchange, BlueCity and Pieter Pot — circular metrics, low-waste food, local government, data collaboration and circular grocery models. A complete trip report remains available from the original Chair archive.</p>
      </div>
    </article>
  </div>
</section>
"""

VISITS = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Site visits</span>
  <h1>Circularity, on site</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">The Chair regularly organizes seminars and learning expeditions inside organizations engaged in the circular economy. Students meet practitioners, discover projects, and see how circular strategies are implemented across sectors.</p>
    <div class="grid-2" style="margin-top:48px">
      <article class="media-card"><img src="{src('visits', 1)}" alt="Villette Makerz"><div class="body"><div class="tag">2025</div><h3>Villette Makerz</h3><p>A fablab and cultural hub at Parc de la Villette dedicated to creativity, fabrication and sustainability — innovation through experimentation.</p></div></article>
      <article class="media-card"><img src="{src('visits', 2)}" alt="Vesto"><div class="body"><div class="tag">April 2025</div><h3>Vesto</h3><p>Reconditioning of professional kitchen equipment. Students followed the process from collection to refurbishment — reuse as environmental, economic and social value.</p></div></article>
      <article class="media-card"><img src="{src('visits', 3)}" alt="Cyneo"><div class="body"><div class="tag">April 2025</div><h3>Cyneo</h3><p>Reuse of construction materials: recycling, reuse networks, and the systemic changes required to make reuse the norm in building.</p></div></article>
      <article class="media-card"><img src="{src('visits', 4)}" alt="L'Oréal Packaging Lab"><div class="body"><div class="tag">March 2025</div><h3>L’Oréal Packaging Lab</h3><p>Eco-designed packaging — recyclable, refillable, responsible — and how circularity sits inside a global beauty strategy.</p></div></article>
      <article class="media-card"><img src="{src('visits', 5)}" alt="Manutan Reuse Center"><div class="body"><div class="tag">March 2025</div><h3>Manutan Reuse Center</h3><p>Office furniture given a second life through reuse and recycling, reducing impact inside a circular B2B model.</p></div></article>
    </div>
  </div>
</section>
"""

EVENTS = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Events</span>
  <h1>Where the Chair meets its ecosystem</h1>
</div></div>
<section>
  <div class="wrap">
    <article class="split" style="margin-bottom:72px">
      <img src="{src('events', 1)}" alt="Final Jury June 2025">
      <div>
        <div class="tag kicker">17 June 2025</div>
        <h2>Final Jury of the Chair</h2>
        <p>A day dedicated to projects developed over six months with EssilorLuxottica, Bouygues Group and L’Oréal. Partners engaged directly with students, offering feedback on practical applications that address real sustainability challenges.</p>
      </div>
    </article>
    <div class="grid-3">
      <article class="card"><div class="tag">15–18 April 2024</div><h3>World Circular Economy Forum</h3><p>The Chair participated in WCEF, engaging with international experts on trends, challenges and solutions driving the global circular transition.</p></article>
      <article class="card"><div class="tag">February 2024</div><h3>Launch dinner</h3><p>Students and alumni, with Guillaume Paoli (CEO of Aramis Group) and Lucie Perrin (Circul’R), strengthening the Chair’s expanding network.</p></article>
      <article class="card"><div class="tag">7 December 2024</div><h3>Circular Science Talk</h3><p>At ESSEC La Défense, Laetitia Vasseur and Felix Papier on reuse, repair and recycling — circular practices for the future of sustainability.</p></article>
    </div>
  </div>
</section>
"""

APPLY = """
<div class="page-hero"><div class="wrap">
  <span class="kicker">How to apply</span>
  <h1>Enter the 2026 master class</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">Each year, the ESSEC Global Circular Economy Chair welcomes approximately 30 students from eligible ESSEC programs. Currently eligible programs include MiM (AST and ASC), MScST, SMIB and Global BBA, with additional programs under discussion.</p>
    <div class="notice" style="margin:32px 0 48px">
      <div>
        <p class="soon">September 2026 cohort</p>
        <h3>The application link will be available soon</h3>
        <p>Applications are not open yet. The form will be published on this page, as on the current Chair site. Write to <a href="mailto:circulareco@essec.edu">circulareco@essec.edu</a> if you wish to be notified.</p>
      </div>
      <a class="btn btn-dark" href="mailto:circulareco@essec.edu">Contact the Chair</a>
    </div>
    <h2>Indicative timeline</h2>
    <div class="timeline">
      <div class="t-item"><strong>1–25 September</strong><div><p>Students apply on this website (link forthcoming). Required: CV, cover letter, ESSEC grading report (if applicable), grading report from previous universities (if applicable).</p></div></div>
      <div class="t-item"><strong>October</strong><div><p>Videoconferencing or face-to-face interviews for selected students.</p></div></div>
      <div class="t-item"><strong>Mid-October</strong><div><p>Announcement of the results. (On the current site: 12 October.)</p></div></div>
    </div>
  </div>
</section>
"""

STUDENTS = """
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our students</span>
  <h1>Portraits of the Chair</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">LinkedIn profiles as published on the current Chair site. The 2026 promotion will appear in its own tab once photos and links are provided.</p>
    <div class="tabs">
      <button class="tab" data-year="2026">Class of 2026</button>
      <button class="tab active" data-year="2025">Class of 2025</button>
      <button class="tab" data-year="2024">Class of 2024</button>
      <button class="tab" data-year="2023">Class of 2023</button>
      <button class="tab" data-year="2022">Founding class 2022</button>
    </div>
    <p data-cohort-note hidden class="notice">Photos, names and LinkedIn of the 2026 cohort will be published here. The structure — portrait, name, LinkedIn — is already in place.</p>
    <div class="students" data-students></div>
  </div>
</section>
"""

TESTIMONIES = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Testimonies</span>
  <h1>After the Chair</h1>
</div></div>
<section>
  <div class="wrap">
    <article class="person">
      <img src="{src('testimonies', 1, 900)}" alt="Léna Massaro">
      <div>
        <div class="role">Junior CSR Specialist · Albea Group</div>
        <h2>Léna Massaro</h2>
        <p>Former student of the Global Circular Economy Chair. From BCPST at Lycée Henri-IV and PHELMA to ESSEC’s Master in Sustainability Transformation. Her participation in the Chair was a turning point: life-cycle analysis and a real project for L’Oréal. At Albea she works on environmental impact data with the Ellen MacArthur Foundation, towards 100% reusable packaging, waste management and eco-design.</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('testimonies', 2, 900)}" alt="Théo Lutard">
      <div>
        <div class="role">Associate Consultant · Onepoint</div>
        <h2>Théo Lutard</h2>
        <p>ESG and sustainability consulting, with a focus on climate for financial institutions — decarbonization and climate risk. At ESSEC he specialized in Green Finance and Energy Transition. In the Chair he worked on a circular business model for EssilorLuxottica’s Transitions brand.</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('testimonies', 3, 900)}" alt="Lucie Perrin">
      <div>
        <div class="role">Junior Consultant · Circul’R</div>
        <h2>Lucie Perrin</h2>
        <p>Projects in public and private sectors, primarily with CAC40 companies. After NEOMA CESEM and Northeastern University in Boston, and work at UMAï (plastic-free cosmetics), she joined ESSEC’s Master’s in Sustainable Development and the Chair — including a circular initiative with COLAS for a construction project in Montreal.</p>
      </div>
    </article>
  </div>
</section>
"""

TEAM = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our team</span>
  <h1>Faculty, founders, pedagogy</h1>
</div></div>
<section style="padding-top:24px">
  <div class="wrap">
    <article class="person">
      <img src="{src('team', 1, 900)}" alt="Pierre-Emmanuel Saint-Esprit">
      <div>
        <div class="role">Founder &amp; Executive Director</div>
        <h2>Pierre-Emmanuel Saint-Esprit</h2>
        <p>Passionate about the circular economy, Pierre-Emmanuel co-founded ZACK at 22 while studying at ESSEC and the University of California Berkeley. ZACK became a leading French company in the second life of electronic products (recycling, repair, resale, donation) and was acquired by the Manutan Group.</p>
        <p>In 2020, ZACK was among the top 3 French circular companies according to the TECH FOR GOOD report of the French Presidency, with Phénix and Castalie. That year he won BCG employees’ vote for social entrepreneur of the year. In 2021 he was among the top 50 CSR personalities of the Giverny Circle, and nominated in Forbes France 30 Under 30.</p>
        <p>He is Professor of Circular Economy, President of the ESSEC Alumni Entrepreneurs Club, pioneer of the Ellen MacArthur Foundation for the Circular Economy, mentor at Antropia ESSEC, and Ambassador of the IMPACT FRANCE Movement. Regularly invited to discuss circular economy in France (UEED, BFM TV, Le Point, Le Parisien, Le Figaro, Produrable, LH Forum, Cercle de Giverny…).</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('team', 2, 900)}" alt="Felix Papier">
      <div>
        <div class="role">Co-holder · Professor at ESSEC</div>
        <h2>Felix Papier</h2>
        <p>Professor of Supply Chain Management at ESSEC since 2011. His research and teaching focus on supply chain and operations strategy and on sustainable, socially responsible operations. He has published on remanufacturing, humanitarian operations and forced labor in supply chains.</p>
        <p>At ESSEC he was Academic Director of the ESSEC &amp; Mannheim Executive MBA (2015–2017) and Dean of the Grande Ecole and Pre-Experience Programs (2017–2022). Visiting Scholar at UCLA Anderson in 2022/23. Previously consultant at McKinsey &amp; Company in Cologne.</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('team', 3, 900)}" alt="Justine Laurent">
      <div>
        <div class="role">Pedagogical Officer · Managing Director, Circulab</div>
        <h2>Justine Laurent</h2>
        <p>Change maker in circular design, with experience in circular economy and business design applied to training, facilitation, mentoring and consulting. Managing Director of Circulab, a strategy and design studio dedicated to the circular and regenerative economy — a B Corp operating in 19 countries through certified experts since 2012.</p>
        <p>She co-created the Circulab Toolbox and Circulab Academy. She works with the City of Paris on phasing out single-use plastics, with food companies on circular offers, and with entrepreneurs on European projects. She trains UNESCO, GIZ Kosovo and companies such as Salomon and Orange. In 2022 she was included in the top 50 CSR personalities of the Cercle de Giverny.</p>
      </div>
    </article>
  </div>
</section>
"""

PARTNERS = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our partners</span>
  <h1>Gold, silver, experts</h1>
</div></div>
<section>
  <div class="wrap">
    <h2>Gold Sponsor</h2>
    <a class="logo-box" style="max-width:360px;margin:20px 0 48px" href="https://www.loreal.com/en/" target="_blank" rel="noopener"><img src="{src('partners', 1, 900)}" alt="L'Oréal"></a>
    <h2>Silver Sponsors</h2>
    <div class="logo-row" style="margin:20px 0 48px">
      <div class="logo-box"><img src="{src('partners', 2, 800)}" alt="Silver sponsor"></div>
      <div class="logo-box"><img src="{src('partners', 3, 800)}" alt="Silver sponsor"></div>
      <div class="logo-box"><img src="{src('partners', 4, 800)}" alt="Silver sponsor"></div>
    </div>
    <h2>Expert Partners</h2>
    <div class="logo-row" style="grid-template-columns:repeat(2,1fr);max-width:640px;margin-top:20px">
      <div class="logo-box"><img src="{src('partners', 5, 800)}" alt="Expert partner"></div>
      <a class="logo-box" href="https://circulab.com/" target="_blank" rel="noopener"><img src="{src('partners', 6, 800)}" alt="Circulab"></a>
    </div>
  </div>
</section>
"""

CONTENT = f"""
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our content</span>
  <h1>Training, research, public debate</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">The Chair is a reference in Circular Economy training and innovation. It produces, annually, MOOCs and e-books to share its initiatives, and research dedicated to the circular economy.</p>
    <h2>Research axes</h2>
    <div class="grid-2" style="margin:24px 0 48px">
      <article class="card"><h3>New economic models</h3><p>Including the functionality economy and other circular business models.</p></article>
      <article class="card"><h3>Regulation and sustainability</h3><p>The influence of regulation on sustainability transitions.</p></article>
      <article class="card"><h3>Skills observatory</h3><p>Circular economy competencies and skills.</p></article>
      <article class="card"><h3>Circular economy and data</h3><p>Links between available data and circular transformation.</p></article>
    </div>
    <p>The Chair is linked to ESSEC’s global strategy through the transition plan “Together.” This 360-degree environmental and social plan aims at transforming training programs, research, and life on campuses — through innovation, experimentation, and new business and economic models.</p>
    <p><a href="publications.html">Publications →</a> &nbsp; <a href="circular-cac-40.html">Towards a circular CAC 40 →</a></p>
  </div>
</section>
"""

PUBLICATIONS = """
<div class="page-hero"><div class="wrap">
  <span class="kicker">Publications</span>
  <h1>Working papers of the Chair</h1>
</div></div>
<section>
  <div class="wrap">
    <article class="course"><div class="tag">April 2022</div><h3>Environmental Regulation and Profitability: The Porter Hypothesis</h3></article>
    <article class="course"><div class="tag">July 2022</div><h3>The Economics of Durable Goods</h3></article>
    <article class="course"><div class="tag">November 2022</div><h3>The Economics of Waste</h3></article>
    <p style="margin-top:32px">Source PDFs remain on the current Google Site. Additional articles referenced by the Chair include work on the circular economy, sustainable companies, the triple helix of innovation systems, circular supply chains, globalization of circularity, targets and limits of a sustainable economy.</p>
  </div>
</section>
"""

CAC40 = """
<div class="page-hero"><div class="wrap">
  <span class="kicker">Our content</span>
  <h1>Towards a circular CAC 40</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">The circular economy is about ecosystem and cooperation. Many implementation problems are similar from one company to another.</p>
    <p>Towards a circular CAC 40 is a club of advanced CAC 40 companies that brings together every quarter the members of the executive committees in charge of Circular Economy: Schneider Electric, Véolia, Bouygues, Carrefour, EssilorLuxottica, L’Oréal, Saint Gobain, Axa and Michelin.</p>
    <p>A different topic is chosen every meeting to be shared and worked throughout various sectors and companies.</p>
    <h2 style="margin-top:48px">Objectives</h2>
    <div class="grid-3" style="margin-top:24px">
      <article class="card"><h3>Roadmaps</h3><p>Share circular roadmaps validated by executive committees, and common problematics.</p></article>
      <article class="card"><h3>Practices</h3><p>Share circularization best practices across sectors.</p></article>
      <article class="card"><h3>Joint initiatives</h3><p>Launch joint circular initiatives between members.</p></article>
    </div>
  </div>
</section>
"""

PAGES = {
    "index.html": ("Home", INDEX, "home"),
    "program.html": ("Program", PROGRAM, "home"),
    "education.html": ("Students Education", EDUCATION, "home"),
    "study-trips.html": ("Study Trips", TRIPS, "home"),
    "site-visits.html": ("Site Visits", VISITS, "home"),
    "events.html": ("Events", EVENTS, "home"),
    "apply.html": ("How to Apply", APPLY, "home"),
    "students.html": ("Students", STUDENTS, "home"),
    "testimonies.html": ("Testimonies", TESTIMONIES, "home"),
    "team.html": ("Our Team", TEAM, "team"),
    "partners.html": ("Our Partners", PARTNERS, "partners"),
    "content.html": ("Our Content", CONTENT, "home"),
    "publications.html": ("Publications", PUBLICATIONS, "home"),
    "circular-cac-40.html": ("Circular CAC 40", CAC40, "home"),
}


def main():
    for name, (title, body, active) in PAGES.items():
        (ROOT / name).write_text(page(title, body, active), encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
