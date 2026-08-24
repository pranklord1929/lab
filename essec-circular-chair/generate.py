#!/usr/bin/env python3
"""Generate the static ESSEC Circular Economy Chair site."""
from pathlib import Path
import json

ROOT = Path(__file__).parent
IMG = json.loads((ROOT / "data" / "local-images.json").read_text())

def src(group, i, w=1600):
    return IMG[group][i - 1]


LOGO = """<img class="brand-mark" src="assets/logo-essec-noir.svg" alt="ESSEC Business School">"""

NAV = """
<a class="skip-link" href="#main">Skip to content</a>
<header class="nav">
  <div class="nav-inner">
    <a class="brand" href="index.html">
      {logo}
      <span class="brand-text">Global Circular Economy Chair</span>
    </a>
    <nav class="nav-links" id="site-nav" aria-label="Primary">
      <a class="nav-cta nav-cta-menu" href="apply.html">Apply</a>
      <a href="index.html" class="{home}">The Chair</a>
      <div class="drop">
        <button type="button" class="drop-toggle" aria-expanded="false" aria-haspopup="true">Program</button>
        <div class="drop-menu">
          <a href="program.html">Overview</a>
          <a href="education.html">Students Education</a>
          <a href="study-trips.html">Study Trips</a>
          <a href="site-visits.html">Site Visits</a>
          <a href="events.html">Events</a>
          <a href="apply.html">Eligibility</a>
        </div>
      </div>
      <div class="drop">
        <button type="button" class="drop-toggle" aria-expanded="false" aria-haspopup="true">Students</button>
        <div class="drop-menu">
          <a href="students.html">Cohorts</a>
          <a href="testimonies.html">Testimonies</a>
        </div>
      </div>
      <a href="team.html" class="{team}">Team</a>
      <a href="partners.html" class="{partners}">Partners</a>
      <div class="drop">
        <button type="button" class="drop-toggle" aria-expanded="false" aria-haspopup="true">Content</button>
        <div class="drop-menu">
          <a href="content.html">Research &amp; training</a>
          <a href="publications.html">Publications</a>
          <a href="circular-cac-40.html">Circular CAC 40</a>
        </div>
      </div>
    </nav>
    <a class="nav-cta nav-cta-bar" href="apply.html">Apply</a>
    <button class="burger" type="button" aria-label="Open menu" aria-expanded="false" aria-controls="site-nav"><span></span><span></span><span></span></button>
  </div>
</header>
""".replace("{logo}", LOGO)

FOOT = """
<footer>
  <div class="wrap foot-grid">
    <div>
      <h4>ESSEC Chair</h4>
      <p style="color:rgba(255,255,255,.78);max-width:36ch">Training the next generation of circular economy leaders and future Chief Circular Officers.</p>
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
        <li><a href="apply.html">Eligibility and contact</a></li>
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
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>{title} · ESSEC Global Circular Economy Chair</title>
  <meta name="description" content="ESSEC Global Circular Economy Chair: training the next generation of circular economy leaders.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Mohave:wght@500;600;700&family=Noto+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="css/styles.css?v=20260824">
  <link rel="icon" href="assets/logo-essec-noir.svg" type="image/svg+xml">
</head>
<body>
{nav}
<main id="main">
{body}
</main>
{FOOT}
</body>
</html>
"""


INDEX = f"""
<section class="hero">
  <div class="hero-media">
    <img src="{src('home', 1)}" alt="Class of 2026 at the French Ministry for Ecological Transition, Hôtel de Roquelaure">
  </div>
  <div class="wrap hero-content">
    <p class="kicker">ESSEC Business School</p>
    <h1>Shaping the leaders of the economy of tomorrow</h1>
    <p class="lead">The ESSEC Global Circular Economy Chair trains future Chief Circular Officers: through academic courses, applied projects with industry, and an open ecosystem of corporates, startups and public institutions.</p>
    <div class="hero-actions">
      <a class="btn btn-gold" href="program.html">Discover the program</a>
      <a class="btn btn-ghost" href="#certificate">Executive Certificate</a>
    </div>
    <div class="hero-meta">
      <div><strong>~30</strong>students per cohort</div>
      <div><strong>6</strong>courses to validate the Chair</div>
      <div><strong>~12</strong>nationalities in each cohort</div>
      <div><strong>1</strong>annual learning expedition</div>
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
      <div class="stat"><strong>Methods</strong><span>Acquire the key methodologies and skills of the circular economy.</span></div>
      <div class="stat"><strong>Live projects</strong><span>Apply them on a live project to experiment circular transition, and measure impact.</span></div>
      <div class="stat"><strong>Pioneers</strong><span>Learn from the pioneers through site visits and an annual learning expedition.</span></div>
      <div class="stat"><strong>Leaders</strong><span>Meet circular practitioners and leaders across business, institutions and the field.</span></div>
    </div>
  </div>
</section>

<section class="panel" id="certificate">
  <div class="wrap">
    <div class="feature certificate">
      <div class="body">
        <div class="tag kicker">Executive Education</div>
        <h2>Circular Executive Certificate</h2>
        <p>Strengthening Your Business Through Circular Economy Principles: a 25-hour in-person executive program developed by the TOGETHER Institute and the ESSEC Global Circular Economy Chair, in partnership with Circulab.</p>
        <p>Designed for business leaders, managers and decision-makers, the program helps participants assess business dependencies and risks, explore circular opportunities, and build a practical action plan tailored to their organization.</p>
        <p>Available in inter-company and customized in-company formats. First sessions expected in Fall 2026.</p>
        <div class="hero-actions" style="margin-top:24px">
          <a class="btn btn-dark" href="https://drive.google.com/file/d/1gWVCwRe7wDwRuNJzIV9xzYQOH-RW9Xzi/view" target="_blank" rel="noopener">Download the program PDF</a>
          <a class="btn btn-line" href="mailto:justine@circulab.com">Contact Justine Laurent</a>
        </div>
      </div>
      <aside class="pdf-panel">
        <p class="soon">Brochure</p>
        <h3>Program PDF</h3>
        <p>The full Circular Executive Certificate outline (format, objectives, pedagogy) is in the brochure.</p>
        <a class="btn btn-dark" href="https://drive.google.com/file/d/1gWVCwRe7wDwRuNJzIV9xzYQOH-RW9Xzi/view" target="_blank" rel="noopener">Open the PDF</a>
      </aside>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">Impact &amp; projects</span>
      <h2>A Chair that is alive in the field</h2>
      <p class="lead">Beyond solid theoretical and methodological foundations, the program embodies the circular transition: live projects with partners, site visits, meetings with practitioners, and an annual learning expedition.</p>
    </div>
    <div class="grid-3">
      <article class="media-card">
        <img src="{src('trips2026', 1)}" alt="Brussels 2026 learning expedition">
        <div class="body">
          <div class="tag">April–May 2026</div>
          <h3>Brussels expedition</h3>
          <p>European Commission, Permafungi, CBE-JU, BC Materials, ecobuild.brussels, Syensqo and BIGH: from EU circular policy to rooftop farming and advanced materials.</p>
          <a href="study-trips.html">Read the expedition →</a>
        </div>
      </article>
      <article class="media-card">
        <img src="{src('home', 1)}" alt="Final Jury 2026 at the Hôtel de Roquelaure">
        <div class="body">
          <div class="tag">June 2026</div>
          <h3>Final Jury</h3>
          <p>Thirty students from twelve nationalities presented six consulting projects with L’Oréal, SNCF Réseau, Equans and AP-HP at the Hôtel de Roquelaure, hosted by Minister Mathieu Lefèvre.</p>
          <a href="events.html">See events →</a>
        </div>
      </article>
      <article class="media-card">
        <img src="{src('visits2026', 2)}" alt="Site visit to Vesto">
        <div class="body">
          <div class="tag">Paris, 2026</div>
          <h3>Field visits</h3>
          <p>Circularity on the ground at L’Oréal, the Manutan Hub, Vesto and Villette Makerz, plus partner site work during the consulting projects, including Equans.</p>
          <a href="site-visits.html">Explore visits →</a>
        </div>
      </article>
    </div>
  </div>
</section>

<section class="forest">
  <div class="wrap split">
    <div>
      <span class="kicker">Who it is for</span>
      <h2>A cohort of circular leaders, inside ESSEC</h2>
      <p>Each year the Chair welcomes about 30 students from eligible ESSEC programs. Selection is organised with the Chair team (not through a public form on this page). Write to the team if you want to be considered or notified.</p>
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
        <a class="btn btn-gold" href="education.html">See the curriculum</a>
        <a class="btn btn-ghost" href="apply.html">Eligibility and contact</a>
      </div>
    </div>
    <div class="notice" style="display:block;background:rgba(255,255,255,.08)">
      <p class="soon">Contact</p>
      <h3 style="color:#fff;margin:12px 0">Write to the Chair</h3>
      <p>Typical timeline: expressions of interest in September, interviews in October, results mid-October. The Chair team will point you to the right ESSEC process when it opens.</p>
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
      <a class="logo-box" href="https://www.loreal.com/" target="_blank" rel="noopener"><img src="{src('partners', 1, 800)}" alt="L’Oréal, Gold Sponsor"></a>
      <a class="logo-box" href="https://www.equans.com/" target="_blank" rel="noopener"><img src="{src('partners', 2, 800)}" alt="Equans"></a>
      <a class="logo-box" href="https://www.sncf-reseau.com/" target="_blank" rel="noopener"><img src="{src('partners', 3, 800)}" alt="SNCF Réseau"></a>
    </div>
    <p style="margin-top:20px"><a href="partners.html">Sponsors and the wider ecosystem →</a></p>
  </div>
</section>

<section class="panel">
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">After the Chair</span>
      <h2>Where circular leaders go next</h2>
      <p class="lead">Alumni move into roles that turn circular thinking into operations, strategy and impact: Chief Circular Officers, CSR and sustainability consulting, circular supply chains, and entrepreneurial projects in reuse, repair and new business models.</p>
    </div>
    <div class="grid-3">
      <article class="card"><h3>Circular officers</h3><p>Lead circular transformation inside industry: packaging, operations, procurement and product-service models.</p></article>
      <article class="card"><h3>Consulting and CSR</h3><p>Join firms that advise corporates and public actors on climate, ESG and circular economy roadmaps.</p></article>
      <article class="card"><h3>The field</h3><p>Build or scale circular ventures (reuse, remanufacturing, materials) or join public and ecosystem organisations.</p></article>
    </div>
    <p style="margin-top:24px"><a class="btn btn-line" href="testimonies.html">Read alumni testimonies</a></p>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head">
      <span class="kicker">The students</span>
      <h2>A living community of circular leaders</h2>
      <p class="lead">Portraits and LinkedIn of recent classes. Photos and profiles of the latest cohort will be published as soon as they are available.</p>
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
      <a class="card" href="study-trips.html"><div class="tag">02</div><h3>Study trips</h3><p>An annual expedition to pioneering circular economy ecosystems in Europe (and, in earlier years, the Netherlands).</p></a>
      <a class="card" href="site-visits.html"><div class="tag">03</div><h3>Site visits</h3><p>Seminars and learning expeditions inside organizations that practice circularity.</p></a>
      <a class="card" href="apply.html"><div class="tag">04</div><h3>Eligibility</h3><p>Eligible ESSEC programs, typical calendar, and how to contact the Chair team.</p></a>
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
    <p class="lead">A cohort of 30 multi-disciplinary international students: 6 compulsory courses in English to validate the curriculum, including a course dedicated to initiatives for our partners (design and prototyping of circular products, transformation of linear processes, new uses, reverse logistics, and the supply chains of tomorrow).</p>
    <p>An annual learning expedition to pioneering countries of the circular economy. In 2026, the Chair met the European Commission, CBE-JU, Permafungi, BC Materials, ecobuild.brussels, Syensqo and BIGH in Brussels. The Chair is based at ESSEC’s Cergy campus.</p>
    <h2 style="margin:56px 0 12px">Chair teaching program</h2>
    <div class="course">
      <code>DEVE31401 · T2 Tuesday</code>
      <h3>Chair Seminar Circular Economy</h3>
      <p>One mandatory Chair seminar. Expert presentations, site visits, and a one-week study trip to a pioneering country of the circular economy. Students meet academic experts, institutions and companies in order to define circular roadmaps inspired by these contributions and concrete examples.</p>
    </div>
    <div class="course">
      <code>Four mandatory courses</code>
      <h3>Core curriculum</h3>
      <p>DEVE31417: Impact assessment of social innovations (T2 Monday)<br>
      DEVE31273: From Linear To Circular: get the core methodology of circular economy (T2 Tuesday)<br>
      MOPP31327: Sustainable and circular operations management (T2 Monday)<br>
      ECOA31205: Environmental Economics (T3 Tuesday)</p>
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
    <article class="split" style="margin:48px 0 80px">
      <img src="{src('trips2026', 1)}" alt="Brussels 2026: BIGH rooftop farm">
      <div>
        <div class="tag kicker">Brussels, 2026</div>
        <h2>Policy, bio-based industry, construction and urban farming</h2>
        <p>In late April and early May 2026, the Class of 2026 spent several days in Brussels. Day 1 opened at Permafungi (organic waste turned into valuable resources), then at Circular Bio-based Europe Joint Undertaking (CBE-JU), on the scale of bio-based solutions across Europe.</p>
        <p>Day 2 focused on circular construction: BC Materials, transforming local earth and waste streams into building materials, and ecobuild.brussels, on how to scale sustainable construction practices across Europe.</p>
        <p>Day 3 moved from advanced materials at Syensqo’s Brussels headquarters to BIGH, where urban agriculture meets circular thinking on a city rooftop.</p>
        <p>The expedition also included an exchange at the European Commission with Luis Planas Herrera, Member of Cabinet of Commissioner Jessika Roswall, on waste reduction, sustainable product design, recycling, competitiveness and international cooperation.</p>
      </div>
    </article>
    <div class="grid-3" style="margin:-40px 0 80px">
      <article class="media-card"><img src="{src('trips2026', 2)}" alt="CBE-JU session in Brussels"><div class="body"><div class="tag">Day 1</div><h3>Permafungi &amp; CBE-JU</h3><p>Circular innovation from organic waste, then public–private bio-based industry at European scale.</p></div></article>
      <article class="media-card"><img src="{src('trips2026', 4)}" alt="BC Materials earth-block machine"><div class="body"><div class="tag">Day 2</div><h3>BC Materials &amp; ecobuild.brussels</h3><p>Earth, waste streams and the challenge of making circular construction the norm.</p></div></article>
      <article class="media-card"><img src="{src('trips2026', 3)}" alt="Syensqo circularity session"><div class="body"><div class="tag">Day 3</div><h3>Syensqo &amp; BIGH</h3><p>Industrial material science, then rooftop farming in the middle of the city.</p></div></article>
    </div>
    <article class="split" style="margin-bottom:80px">
      <img src="{src('trips', 2)}" alt="Brussels 2025">
      <div>
        <div class="tag kicker">Brussels, 2025</div>
        <h2>Parliament, repair, soil and bio-based industry</h2>
        <p>In April 2025, the Class of 2025 traveled to Brussels. At the European Parliament, students explored the legislative tools shaping circular policy. Visits to Repair Together and cityfab 1 showed how community repair and digital fabrication extend product lifecycles. BC Materials transforms excavated urban soils into construction materials; CBE-JU highlighted public–private partnerships in circular bio-based industries. Permafungi and The Upcycling Lab turned waste streams (mushroom substrates, discarded textiles) into products.</p>
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
        <p>Circle Economy, Circl, the City of Rotterdam, Excess Materials Exchange, BlueCity and Pieter Pot: circular metrics, low-waste food, local government, data collaboration and circular grocery models. A complete trip report remains available from the original Chair archive.</p>
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
    <h2 style="margin:48px 0 16px">Paris region, 2025–2026</h2>
    <p>Field visits of the Class of 2026, alongside the consulting work with L’Oréal, SNCF Réseau, Equans and AP-HP.</p>
    <div class="grid-2" style="margin-top:28px">
      <article class="media-card"><img src="{src('visits2026', 3)}" alt="L'Oréal site visit 2026"><div class="body"><div class="tag">March 2026</div><h3>L’Oréal</h3><p>An immersion in how a global company is shifting its models toward circularity: concrete action at industrial scale, from operations to packaging.</p></div></article>
      <article class="media-card"><img src="{src('visits2026', 4)}" alt="Manutan Hub visit 2026"><div class="body"><div class="tag">April 2026</div><h3>Manutan Hub</h3><p>Behind the scenes of circular logistics: how sustainable and circular models are built into operations, with the Manutan teams and Pierre-Emmanuel Saint-Esprit.</p></div></article>
      <article class="media-card"><img src="{src('visits2026', 2)}" alt="Vesto visit 2026"><div class="body"><div class="tag">April 2026</div><h3>Vesto</h3><p>Circular solutions in the food ecosystem: reconditioning professional kitchen equipment, and the operational challenges of deploying reuse at scale.</p></div></article>
      <article class="media-card"><img src="{src('visits2026', 1)}" alt="Villette Makerz visit 2026"><div class="body"><div class="tag">May 2026</div><h3>Villette Makerz</h3><p>A fablab and making space at Parc de la Villette where innovation, fabrication and collaboration support the ecological transition, hosted with Arthur Clayssen and the team.</p></div></article>
    </div>
    <h2 style="margin:64px 0 16px">Paris region, 2024–2025</h2>
    <p>Visits of the Class of 2025, the same ecosystem, a year earlier.</p>
    <div class="grid-2" style="margin-top:28px">
      <article class="media-card"><img src="{src('visits', 4)}" alt="L'Oréal Packaging Lab 2025"><div class="body"><div class="tag">March 2025</div><h3>L’Oréal Packaging Lab</h3><p>Eco-designed packaging (recyclable, refillable, responsible) and how circularity sits inside a global beauty strategy.</p></div></article>
      <article class="media-card"><img src="{src('visits', 5)}" alt="Manutan Reuse Center 2025"><div class="body"><div class="tag">March 2025</div><h3>Manutan Reuse Center</h3><p>Office furniture given a second life through reuse and recycling, reducing impact inside a circular B2B model.</p></div></article>
      <article class="media-card"><img src="{src('visits', 3)}" alt="Cyneo 2025"><div class="body"><div class="tag">1 April 2025</div><h3>Cyneo</h3><p>Reuse of construction materials in Vitry-sur-Seine: recycling, reuse networks, and the systemic changes required to make reuse the norm in building.</p></div></article>
      <article class="media-card"><img src="{src('visits', 2)}" alt="Vesto 2025"><div class="body"><div class="tag">April 2025</div><h3>Vesto</h3><p>Reconditioning of professional kitchen equipment. Students followed the process from collection to refurbishment: reuse as environmental, economic and social value.</p></div></article>
      <article class="media-card"><img src="{src('visits', 1)}" alt="Villette Makerz 2025"><div class="body"><div class="tag">2025</div><h3>Villette Makerz</h3><p>A fablab and cultural hub at Parc de la Villette dedicated to creativity, fabrication and sustainability: innovation through experimentation.</p></div></article>
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
      <img src="{src('home', 1)}" alt="Final Jury June 2026 at the Hôtel de Roquelaure">
      <div>
        <div class="tag kicker">June 2026</div>
        <h2>Final Jury at the Hôtel de Roquelaure</h2>
        <p>The Class of 2026 closed its year at the Hôtel de Roquelaure, home of the French Ministry for Ecological Transition. Minister Mathieu Lefèvre welcomed about 30 students from 12 nationalities. Six consulting projects, developed over the year with L’Oréal, SNCF Réseau, Equans and AP-HP, were presented to the jury. Three laureate groups were recognised for their work with L’Oréal, SNCF and Equans.</p>
        <p>The Chair thanked its partners, coaches and mentors, and the leadership of Pierre-Emmanuel Saint-Esprit, Justine Laurent and Felix Papier.</p>
      </div>
    </article>
    <div class="grid-3" style="margin-bottom:72px">
      <article class="card"><div class="tag">January 2026</div><h3>Launch of the Class of 2026</h3><p>Kick-off at the ESSEC Cergy campus: first business cases, and Equans and SNCF Réseau welcomed as new partners alongside long-standing supporter L’Oréal.</p></article>
      <article class="card"><div class="tag">April–May 2026</div><h3>Brussels learning expedition</h3><p>Permafungi, CBE-JU, BC Materials, ecobuild.brussels, Syensqo, BIGH, and an exchange at the European Commission on the future of Europe’s circular transition.</p></article>
      <article class="card"><div class="tag">March–May 2026</div><h3>Paris field visits</h3><p>L’Oréal, the Manutan Hub, Vesto and Villette Makerz: circularity in beauty, logistics, food equipment and making.</p></article>
    </div>
    <article class="split" style="margin-bottom:72px">
      <img src="{src('events', 1)}" alt="Final Jury June 2025">
      <div>
        <div class="tag kicker">17 June 2025</div>
        <h2>Final Jury of the Class of 2025</h2>
        <p>A day dedicated to projects developed over six months with EssilorLuxottica, Bouygues Group and L’Oréal. Partners engaged directly with students, offering feedback on practical applications that address real sustainability challenges.</p>
      </div>
    </article>
    <div class="grid-3">
      <article class="card"><div class="tag">15–18 April 2024</div><h3>World Circular Economy Forum</h3><p>The Chair participated in WCEF, engaging with international experts on trends, challenges and solutions driving the global circular transition.</p></article>
      <article class="card"><div class="tag">February 2024</div><h3>Launch dinner</h3><p>Students and alumni, with Guillaume Paoli (CEO of Aramis Group) and Lucie Perrin (Circul’R), strengthening the Chair’s expanding network.</p></article>
      <article class="card"><div class="tag">7 December 2024</div><h3>Circular Science Talk</h3><p>At ESSEC La Défense, Laetitia Vasseur and Felix Papier on reuse, repair and recycling: circular practices for the future of sustainability.</p></article>
    </div>
  </div>
</section>
"""

APPLY = """
<div class="page-hero"><div class="wrap">
  <span class="kicker">Eligibility and contact</span>
  <h1>Joining a cohort</h1>
</div></div>
<section>
  <div class="wrap">
    <p class="lead">Students do not apply through a public form on this website. Each year the Chair welcomes about 30 students from eligible ESSEC programs. Selection is organised with the Chair team, who will point you to the right ESSEC process.</p>
    <div class="notice" style="margin:32px 0 48px">
      <div>
        <p class="soon">Contact the Chair</p>
        <h3>Write if you want to be considered or notified</h3>
        <p>Eligible programs today include MiM (AST and ASC), MScST, SMIB and Global BBA, with additional programs under discussion. Email <a href="mailto:circulareco@essec.edu">circulareco@essec.edu</a>.</p>
      </div>
      <a class="btn btn-dark" href="mailto:circulareco@essec.edu">Contact the Chair</a>
    </div>
    <h2>Indicative timeline</h2>
    <div class="timeline">
      <div class="t-item"><strong>September</strong><div><p>Expressions of interest. Typical materials: CV, cover letter, ESSEC grading report (if applicable), grading report from previous universities (if applicable).</p></div></div>
      <div class="t-item"><strong>October</strong><div><p>Videoconferencing or face-to-face interviews for selected students.</p></div></div>
      <div class="t-item"><strong>Mid-October</strong><div><p>Announcement of the results.</p></div></div>
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
    <p class="lead">LinkedIn profiles as published with the Chair. The latest cohort will appear in its own tab once photos and links are provided.</p>
    <div class="tabs">
      <button type="button" class="tab" data-year="2026">Class of 2026</button>
      <button type="button" class="tab active" data-year="2025">Class of 2025</button>
      <button type="button" class="tab" data-year="2024">Class of 2024</button>
      <button type="button" class="tab" data-year="2023">Class of 2023</button>
      <button type="button" class="tab" data-year="2022">Founding class 2022</button>
    </div>
    <p data-cohort-note hidden class="notice">Photos, names and LinkedIn of the 2026 cohort will be published here. The structure (portrait, name, LinkedIn) is already in place.</p>
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
    <p class="lead">Alumni work as circular economy officers, in CSR and sustainability consulting, and on circular ventures. Three paths from recent classes:</p>
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
        <p>ESG and sustainability consulting, with a focus on climate for financial institutions (decarbonization and climate risk). At ESSEC he specialized in Green Finance and Energy Transition. In the Chair he worked on a circular business model for EssilorLuxottica’s Transitions brand.</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('testimonies', 3, 900)}" alt="Lucie Perrin">
      <div>
        <div class="role">Junior Consultant · Circul’R</div>
        <h2>Lucie Perrin</h2>
        <p>Projects in public and private sectors, primarily with CAC40 companies. After NEOMA CESEM and Northeastern University in Boston, and work at UMAï (plastic-free cosmetics), she joined ESSEC’s Master’s in Sustainable Development and the Chair, including a circular initiative with COLAS for a construction project in Montreal.</p>
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
        <div class="role">Chair-holder · Professor at ESSEC</div>
        <h2>Felix Papier</h2>
        <p>Professor of Operations and Supply Chain Management at ESSEC, and chair-holder of the Global Circular Economy Chair. His research and teaching focus on supply chain and operations strategy, circular economy, supply chain due diligence, and sustainable and humanitarian operations. He has published on remanufacturing, circular business models, humanitarian operations and forced labor in supply chains.</p>
        <p>At ESSEC he was Academic Director of the ESSEC &amp; Mannheim Executive MBA (2015-2017) and Dean of the Grande Ecole and Pre-Experience Programs (2017-2022). Visiting Scholar at UCLA Anderson in 2022/23. Previously consultant at McKinsey &amp; Company in Cologne.</p>
      </div>
    </article>
    <article class="person">
      <img src="{src('team', 3, 900)}" alt="Justine Laurent">
      <div>
        <div class="role">Educational Director · Managing Director, Circulab</div>
        <h2>Justine Laurent</h2>
        <p>Since 2016, Justine Laurent has dedicated her career to the circular economy, becoming a recognized voice in the field as a trainer, speaker, and consultant. She is Managing Director of Circulab, the first design-strategy agency dedicated to the circular economy, and now an emblematic training organization in the space, active in +10 countries through its community of certified experts.</p>
        <p>As Educational Director of the ESSEC Global Circular Economy Chair, Justine also teaches widely across leading institutions and trains executives and consultants on the topic.</p>
        <p>For the Chair, Justine builds programs grounded in the concrete, drawing on real-world examples and close ties to the field so that every concept connects to lived practice. She invites a diverse range of experts and practitioners to share the floor, each speaking from genuine mastery of their subject, so students hear directly from those shaping the field. She brings a critical and systemic lens to the circular economy, encouraging learners to question established models and grasp the subject as a web of interconnected challenges.</p>
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
    <a class="logo-box" style="max-width:360px;margin:20px 0 48px" href="https://www.loreal.com/" target="_blank" rel="noopener"><img src="{src('partners', 1, 900)}" alt="L’Oréal"></a>
    <h2>Silver Sponsors</h2>
    <div class="logo-row" style="margin:20px 0 48px">
      <a class="logo-box" href="https://www.equans.com/" target="_blank" rel="noopener"><img src="{src('partners', 2, 800)}" alt="Equans"></a>
      <a class="logo-box" href="https://www.sncf-reseau.com/" target="_blank" rel="noopener"><img src="{src('partners', 3, 800)}" alt="SNCF Réseau"></a>
      <div class="logo-box"><img src="{src('partners', 4, 800)}" alt="France 2030"></div>
    </div>
    <h2>Expert Partners</h2>
    <div class="logo-row" style="grid-template-columns:repeat(2,minmax(0,1fr));max-width:640px;margin:20px 0 56px">
      <div class="logo-box"><img src="{src('partners', 5, 800)}" alt="Zack, a Manutan brand"></div>
      <a class="logo-box" href="https://circulab.com/" target="_blank" rel="noopener"><img src="{src('partners', 6, 800)}" alt="Circulab"></a>
    </div>
    <h2>The wider ecosystem</h2>
    <p class="lead">Beyond sponsors, the Chair is connected to the organisations that open their doors for site visits and the learning expedition, and to the practitioners who join juries, classes and cocktail conversations.</p>
    <h3 style="margin-top:28px">Visits and learning expedition</h3>
    <div class="pill-list">
      <span class="pill">Permafungi</span>
      <span class="pill">CBE-JU</span>
      <span class="pill">BC Materials</span>
      <span class="pill">ecobuild.brussels</span>
      <span class="pill">Syensqo</span>
      <span class="pill">BIGH</span>
      <span class="pill">European Commission</span>
      <span class="pill">European Parliament</span>
      <span class="pill">Repair Together</span>
      <span class="pill">cityfab 1</span>
      <span class="pill">Circularium</span>
      <span class="pill">R-Use Fabrik</span>
      <span class="pill">The Upcycling Lab</span>
      <span class="pill">L’Oréal</span>
      <span class="pill">Manutan Hub</span>
      <span class="pill">Vesto</span>
      <span class="pill">Villette Makerz</span>
      <span class="pill">Cyneo</span>
      <span class="pill">AP-HP</span>
    </div>
    <h3 style="margin-top:32px">Juries, talks and cocktails</h3>
    <div class="pill-list">
      <span class="pill">EssilorLuxottica</span>
      <span class="pill">Bouygues</span>
      <span class="pill">GEODIS</span>
      <span class="pill">INEC</span>
      <span class="pill">Circul’R</span>
      <span class="pill">Aramis Group</span>
      <span class="pill">TOGETHER Institute</span>
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
    <p class="lead">The Chair is a reference in circular economy training and innovation. It produces MOOCs, e-books and academic research on circular operations, due diligence and new business models. The research agenda below reflects the chair-holder’s current work; further notes from Felix Papier will be added as they arrive.</p>
    <h2>Research axes</h2>
    <div class="grid-2" style="margin:24px 0 48px">
      <article class="card"><h3>Circular operations</h3><p>Remanufacturing, circular supply chains, and circular business models (including buildings as material banks).</p></article>
      <article class="card"><h3>Due diligence and labour</h3><p>Supply chain due diligence, forced labour, and the regulation of sustainable supply chains.</p></article>
      <article class="card"><h3>Barriers to circularity</h3><p>Why circular practices stall in organisations, and how incentives and collaboration can unlock them.</p></article>
      <article class="card"><h3>New loops</h3><p>Applied circular topics such as electric-vehicle batteries, hair-waste recycling, and OEM-recycler alliances.</p></article>
    </div>
    <p>The Chair is linked to ESSEC’s global strategy through the transition plan “Together.” This 360-degree environmental and social plan aims at transforming training programs, research, and life on campuses: through innovation, experimentation, and new business and economic models.</p>
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
    "program.html": ("Program", PROGRAM, ""),
    "education.html": ("Students Education", EDUCATION, ""),
    "study-trips.html": ("Study Trips", TRIPS, ""),
    "site-visits.html": ("Site Visits", VISITS, ""),
    "events.html": ("Events", EVENTS, ""),
    "apply.html": ("Eligibility", APPLY, ""),
    "students.html": ("Students", STUDENTS, ""),
    "testimonies.html": ("Testimonies", TESTIMONIES, ""),
    "team.html": ("Our Team", TEAM, "team"),
    "partners.html": ("Our Partners", PARTNERS, "partners"),
    "content.html": ("Our Content", CONTENT, ""),
    "publications.html": ("Publications", PUBLICATIONS, ""),
    "circular-cac-40.html": ("Circular CAC 40", CAC40, ""),
}


def main():
    for name, (title, body, active) in PAGES.items():
        (ROOT / name).write_text(page(title, body, active), encoding="utf-8")
        print("wrote", name)


if __name__ == "__main__":
    main()
