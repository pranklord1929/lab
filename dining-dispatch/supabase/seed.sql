-- Generated from content/fixtures.json
-- Do not edit by hand; regenerate with: node scripts/ingest.mjs content/fixtures.json --sql
begin;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-restaurants-mexico-city', 'Best restaurants in Mexico City', 'Verified tables worth the trip across Mexico City — not a ranking, a working set.', 'city-wide', 'Best restaurants in Mexico City', 'A verified shortlist of Mexico City restaurants with current menus, reservation difficulty, and human context.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-restaurants-polanco', 'Best restaurants in Polanco', 'Polanco tables with verified hours, menus, and booking reality.', 'neighborhood', 'Best restaurants in Polanco, Mexico City', 'Where to eat in Polanco: verified restaurants, tasting menus, and reservation lead times.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-restaurants-roma-norte', 'Best restaurants in Roma Norte', 'Roma Norte restaurants selected for food quality, occasion fit, and data freshness.', 'neighborhood', 'Best restaurants in Roma Norte, Mexico City', 'Verified Roma Norte restaurants for lunch, dinner, and walk-in corn cooking.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-date-night-restaurants', 'Best date night restaurants', 'Rooms and menus that hold a conversation and a night.', 'occasion', 'Best date night restaurants in Mexico City', 'Mexico City restaurants for date night: ambiance, booking difficulty, and what they are not for.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-mexican-restaurants', 'Best Mexican restaurants', 'Mexican cooking with a current menu and a reason to go.', 'cuisine', 'Best Mexican restaurants in Mexico City', 'Verified Mexican restaurants in Mexico City, from tasting menus to nixtamal kitchens.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-vegetarian-restaurants', 'Best vegetarian restaurants', 'Kitchens that can actually feed a vegetarian without collapsing the menu.', 'diet', 'Best vegetarian restaurants in Mexico City', 'Mexico City restaurants with verified vegetarian options and current menus.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.collections (slug, title, description, intent, seo_title, seo_description)
values ('best-business-dinner-restaurants', 'Best business dinner restaurants', 'Tables that work when the meal is also a meeting.', 'occasion', 'Best business dinner restaurants in Mexico City', 'Where to take a business dinner in Mexico City: noise, booking, and neighborhood.')
on conflict (slug) do update set
  title = excluded.title,
  description = excluded.description,
  intent = excluded.intent,
  seo_title = excluded.seo_title,
  seo_description = excluded.seo_description;
insert into public.restaurants (slug, name, description, neighborhood, address, lat, lng, cuisine, price_range, experience_type, website, instagram, hours, reservation_platform, reservation_url, reservation_difficulty, reservation_lead_days, reservation_tips, best_for, avoid_for, ambiance, ideal_moment, visitor_type, tags, confidence_score, last_verified, featured, published)
values ('quintonil', 'Quintonil', 'Jorge Vallejo and Alejandra Flores''s Polanco tasting room: Mexican ingredients, botanical precision, high demand.', 'Polanco', 'Av. Isaac Newton 55, Polanco IV Secc, Miguel Hidalgo, 11560 Ciudad de México', 19.4324, -99.1963, '"Mexican","Contemporary Mexican"', '$$$$', 'Tasting menu', 'https://quintonil.com/', 'https://www.instagram.com/quintonil/', '{"monday":[],"tuesday":[{"open":"13:00","close":"14:00"},{"open":"17:30","close":"21:30"}],"wednesday":[{"open":"13:00","close":"14:00"},{"open":"17:30","close":"21:30"}],"thursday":[{"open":"13:00","close":"14:00"},{"open":"17:30","close":"21:30"}],"friday":[{"open":"13:00","close":"14:00"},{"open":"17:30","close":"21:30"}],"saturday":[{"open":"13:00","close":"14:00"},{"open":"17:30","close":"21:30"}],"sunday":[]}'::jsonb, 'Tock / official site', 'https://www.exploretock.com/quintonil', 'very_hard', 60, 'Book only via the restaurant reservation flow. Email is not accepted. Deposit required. Tell them dietary needs at booking — vegan, vegetarian, and pescatarian adaptations exist; they cannot exclude corn, chile, or onion.', '"Special occasion","Ingredient-driven tasting","Visitors who already booked Pujol"', '"Walk-ins","A quiet cheap dinner","Groups larger than the room allows"', 'Two rooms: one darker and contained, one brighter. Service is formal without theater.', 'Weeknight dinner if you can get it; lunch is the more obtainable slot.', 'Travelers who plan weeks out; locals celebrating.', '"tasting-menu","fine-dining","polanco","michelin"', 86, '2026-08-17', true, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  neighborhood = excluded.neighborhood,
  address = excluded.address,
  lat = excluded.lat,
  lng = excluded.lng,
  cuisine = excluded.cuisine,
  price_range = excluded.price_range,
  experience_type = excluded.experience_type,
  website = excluded.website,
  instagram = excluded.instagram,
  hours = excluded.hours,
  reservation_platform = excluded.reservation_platform,
  reservation_url = excluded.reservation_url,
  reservation_difficulty = excluded.reservation_difficulty,
  reservation_lead_days = excluded.reservation_lead_days,
  reservation_tips = excluded.reservation_tips,
  best_for = excluded.best_for,
  avoid_for = excluded.avoid_for,
  ambiance = excluded.ambiance,
  ideal_moment = excluded.ideal_moment,
  visitor_type = excluded.visitor_type,
  tags = excluded.tags,
  confidence_score = excluded.confidence_score,
  last_verified = excluded.last_verified,
  featured = excluded.featured,
  published = excluded.published;
delete from public.menus where restaurant_id = (select id from public.restaurants where slug = 'quintonil');
delete from public.verifications where restaurant_id = (select id from public.restaurants where slug = 'quintonil');
delete from public.notes where restaurant_id = (select id from public.restaurants where slug = 'quintonil');
delete from public.faqs where restaurant_id = (select id from public.restaurants where slug = 'quintonil');
delete from public.collection_restaurants where restaurant_id = (select id from public.restaurants where slug = 'quintonil');
insert into public.menus (restaurant_id, menu_type, name, currency, price, items, vegetarian_options, source, last_verified, notes)
values ((select id from public.restaurants where slug = 'quintonil'), 'tasting', 'August 2026 tasting menu', 'MXN', 6090, '"[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]","[object Object]"', true, 'https://quintonil.com/', '2026-08-17', 'Per person, not shared. Pairings listed separately. Prices change without notice.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'quintonil'), 'https://quintonil.com/', 'menu, price, pairings, dietary policy, address', '2026-08-17', 92, 'August 2026 menu posted on the official site. Pairings: Liquid Horizons 3380, Mexican wine 3140, Terroir & Rarities 8450, non-alcoholic 2175 MXN.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'quintonil'), 'https://www.exploretock.com/quintonil', 'reservation platform, deposit, service windows', '2026-08-17', 80, 'Tock lists kitchen-counter and dining-room deposits. Confirm the live booking link on quintonil.com before traveling.');
insert into public.notes (restaurant_id, author, date, context, note)
values ((select id from public.restaurants where slug = 'quintonil'), 'The Dining Dispatch', '2026-08-17', 'fixture', 'Fixture record for the V0 template. Replace with field notes after the Mexico trip.');
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'quintonil'), 'Is Quintonil worth visiting?', 'Yes if you want a current, high-precision Mexican tasting menu in Polanco and you can secure a reservation. It is not a spontaneous meal.', 0);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'quintonil'), 'How much does Quintonil cost?', 'The August 2026 tasting menu is 6,090 MXN per person before pairings. Beverage pairings run 2,175–8,450 MXN. Confirm on quintonil.com; prices change.', 1);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'quintonil'), 'Is Quintonil good for tourists?', 'Yes, if tourists book far ahead through the official reservation flow. Walk-ins are not a plan.', 2);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'quintonil'), 'Does Quintonil have vegetarian options?', 'The tasting menu can be adapted for vegan, vegetarian, and pescatarian diets if declared at reservation. Corn, chile, and onion cannot be excluded.', 3);
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-mexico-city'),
  (select id from public.restaurants where slug = 'quintonil'),
  0
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-polanco'),
  (select id from public.restaurants where slug = 'quintonil'),
  1
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-date-night-restaurants'),
  (select id from public.restaurants where slug = 'quintonil'),
  2
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-mexican-restaurants'),
  (select id from public.restaurants where slug = 'quintonil'),
  3
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-vegetarian-restaurants'),
  (select id from public.restaurants where slug = 'quintonil'),
  4
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-business-dinner-restaurants'),
  (select id from public.restaurants where slug = 'quintonil'),
  5
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.restaurants (slug, name, description, neighborhood, address, lat, lng, cuisine, price_range, experience_type, website, instagram, hours, reservation_platform, reservation_url, reservation_difficulty, reservation_lead_days, reservation_tips, best_for, avoid_for, ambiance, ideal_moment, visitor_type, tags, confidence_score, last_verified, featured, published)
values ('contramar', 'Contramar', 'Gabriela Cámara''s Roma Norte seafood room. Lunch is the point. The pescado a la talla is the reason people return.', 'Roma Norte', 'Durango 200, Roma Norte, Cuauhtémoc, 06700 Ciudad de México', 19.4198, -99.1664, '"Seafood","Mexican"', '$$', 'Lunch', 'https://contramar.com.mx/', 'https://www.instagram.com/contramar/', '{"monday":[{"open":"12:00","close":"20:00"}],"tuesday":[{"open":"12:00","close":"20:00"}],"wednesday":[{"open":"12:00","close":"20:00"}],"thursday":[{"open":"12:00","close":"20:00"}],"friday":[{"open":"12:00","close":"20:00"}],"saturday":[{"open":"11:00","close":"20:00"}],"sunday":[{"open":"11:00","close":"20:00"}]}'::jsonb, 'OpenTable', 'https://www.opentable.com/r/contramar-ciudad-de-mexico', 'moderate', 7, 'Weekend lunch fills first. Weekday 12:00–14:00 is the realistic walk-in window. The room is loud at peak. Closes at 20:00 — this is not a late dinner.', '"Long lunch","Groups","First-time Mexico City seafood"', '"A quiet table","Late dinner","Tasting-menu hunters"', 'Bright, packed, coastal energy inland. Conversation competes with the room.', 'Saturday 13:00 if booked; Tuesday 12:30 if not.', 'Almost everyone — tourists, locals, business lunch if they accept noise.', '"lunch","seafood","roma-norte","iconic"', 84, '2026-08-17', true, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  neighborhood = excluded.neighborhood,
  address = excluded.address,
  lat = excluded.lat,
  lng = excluded.lng,
  cuisine = excluded.cuisine,
  price_range = excluded.price_range,
  experience_type = excluded.experience_type,
  website = excluded.website,
  instagram = excluded.instagram,
  hours = excluded.hours,
  reservation_platform = excluded.reservation_platform,
  reservation_url = excluded.reservation_url,
  reservation_difficulty = excluded.reservation_difficulty,
  reservation_lead_days = excluded.reservation_lead_days,
  reservation_tips = excluded.reservation_tips,
  best_for = excluded.best_for,
  avoid_for = excluded.avoid_for,
  ambiance = excluded.ambiance,
  ideal_moment = excluded.ideal_moment,
  visitor_type = excluded.visitor_type,
  tags = excluded.tags,
  confidence_score = excluded.confidence_score,
  last_verified = excluded.last_verified,
  featured = excluded.featured,
  published = excluded.published;
delete from public.menus where restaurant_id = (select id from public.restaurants where slug = 'contramar');
delete from public.verifications where restaurant_id = (select id from public.restaurants where slug = 'contramar');
delete from public.notes where restaurant_id = (select id from public.restaurants where slug = 'contramar');
delete from public.faqs where restaurant_id = (select id from public.restaurants where slug = 'contramar');
delete from public.collection_restaurants where restaurant_id = (select id from public.restaurants where slug = 'contramar');
insert into public.menus (restaurant_id, menu_type, name, currency, price, items, vegetarian_options, source, last_verified, notes)
values ((select id from public.restaurants where slug = 'contramar'), 'a_la_carte', 'Seafood a la carte', 'MXN', null, '"[object Object]","[object Object]","[object Object]","[object Object]","[object Object]"', false, 'https://contramar.com.mx/', '2026-08-17', 'À la carte. Confirm live prices in the room. Vegetarian is not the point of this kitchen.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'contramar'), 'https://www.opentable.com/r/contramar-ciudad-de-mexico', 'address, hours, reservation platform, phone', '2026-08-17', 88, 'OpenTable lists Durango 200; Mon–Fri 12:00–20:00; Sat–Sun 11:00–20:00; phone 55 5514 3169.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'contramar'), 'https://contramar.com.mx/', 'signature preparations', '2026-08-17', 75, 'Official site confirms pescado a la talla variants. Full priced menu is not published as a stable page.');
insert into public.notes (restaurant_id, author, date, context, note)
values ((select id from public.restaurants where slug = 'contramar'), 'The Dining Dispatch', '2026-08-17', 'fixture', 'Fixture record. Price list needs an on-the-ground pass.');
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'contramar'), 'Is Contramar worth visiting?', 'Yes for a Mexico City lunch. It is still one of the most reliable seafood rooms in Roma Norte if you accept noise and a wait at peak.', 0);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'contramar'), 'How much does Contramar cost?', 'Plan $$ — a serious lunch without tasting-menu pricing. Exact item prices are confirmed at the table; they are not stably published.', 1);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'contramar'), 'Is Contramar good for tourists?', 'Yes. Book OpenTable for weekend lunch. It is a tourist magnet and still a local lunch habit.', 2);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'contramar'), 'Does Contramar have vegetarian options?', 'This is a fish and seafood restaurant. Vegetarians should pick another table.', 3);
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-mexico-city'),
  (select id from public.restaurants where slug = 'contramar'),
  0
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-roma-norte'),
  (select id from public.restaurants where slug = 'contramar'),
  1
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-mexican-restaurants'),
  (select id from public.restaurants where slug = 'contramar'),
  2
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-business-dinner-restaurants'),
  (select id from public.restaurants where slug = 'contramar'),
  3
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.restaurants (slug, name, description, neighborhood, address, lat, lng, cuisine, price_range, experience_type, website, instagram, hours, reservation_platform, reservation_url, reservation_difficulty, reservation_lead_days, reservation_tips, best_for, avoid_for, ambiance, ideal_moment, visitor_type, tags, confidence_score, last_verified, featured, published)
values ('expendio-de-maiz', 'Expendio de Maíz', 'Jesús Salas Tornés''s Roma Norte corn kitchen: no menu, no reservations, cash, communal tables, food until you stop.', 'Roma Norte', 'Av. Yucatán 84, Roma Norte, Cuauhtémoc, 06700 Ciudad de México', 19.41417, -99.162639, '"Mexican","Antojitos"', '$$', 'Walk-in · no menu', null, 'https://www.instagram.com/expendiodemaiz/', '{"monday":[],"tuesday":[{"open":"10:00","close":"16:30"}],"wednesday":[{"open":"10:00","close":"16:30"}],"thursday":[{"open":"10:00","close":"16:30"}],"friday":[{"open":"09:00","close":"19:30"}],"saturday":[{"open":"09:00","close":"19:30"}],"sunday":[{"open":"10:00","close":"16:30"}]}'::jsonb, 'None', null, 'walk_in', 0, 'No reservations. Put your name on the on-site list. Arrive early. Bring cash. State allergies when seated. Weekend waits can run hours.', '"Nixtamal cooking","Flexible lunch","People who will wait"', '"Timed reservations","Card-only travelers","A private table","Dinner on a schedule"', 'Open kitchen on the street side, four communal tables, no signage theater. The food is the system.', 'Weekday late morning. Do not sandwich this between two timed bookings.', 'Curious eaters. Not hotel-concierge logistics.', '"walk-in","corn","roma-norte","cash-only","vegetarian-friendly"', 74, '2026-08-17', true, true)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  neighborhood = excluded.neighborhood,
  address = excluded.address,
  lat = excluded.lat,
  lng = excluded.lng,
  cuisine = excluded.cuisine,
  price_range = excluded.price_range,
  experience_type = excluded.experience_type,
  website = excluded.website,
  instagram = excluded.instagram,
  hours = excluded.hours,
  reservation_platform = excluded.reservation_platform,
  reservation_url = excluded.reservation_url,
  reservation_difficulty = excluded.reservation_difficulty,
  reservation_lead_days = excluded.reservation_lead_days,
  reservation_tips = excluded.reservation_tips,
  best_for = excluded.best_for,
  avoid_for = excluded.avoid_for,
  ambiance = excluded.ambiance,
  ideal_moment = excluded.ideal_moment,
  visitor_type = excluded.visitor_type,
  tags = excluded.tags,
  confidence_score = excluded.confidence_score,
  last_verified = excluded.last_verified,
  featured = excluded.featured,
  published = excluded.published;
delete from public.menus where restaurant_id = (select id from public.restaurants where slug = 'expendio-de-maiz');
delete from public.verifications where restaurant_id = (select id from public.restaurants where slug = 'expendio-de-maiz');
delete from public.notes where restaurant_id = (select id from public.restaurants where slug = 'expendio-de-maiz');
delete from public.faqs where restaurant_id = (select id from public.restaurants where slug = 'expendio-de-maiz');
delete from public.collection_restaurants where restaurant_id = (select id from public.restaurants where slug = 'expendio-de-maiz');
insert into public.menus (restaurant_id, menu_type, name, currency, price, items, vegetarian_options, source, last_verified, notes)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'other', 'No written menu', 'MXN', null, '"[object Object]","[object Object]","[object Object]"', true, 'Michelin Guide listing + on-site format', '2026-08-17', 'Kitchen sends antojitos until you stop. Heirloom corn, tortillas, sopes, huaraches. Cash only.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'https://guide.michelin.com/en/ciudad-de-mexico/cuauhtemoc_1995126/restaurant/expendio-de-maiz', 'address, no-reservation policy, format, cash', '2026-08-17', 85, 'Michelin confirms Yucatán 84, communal tables, no menu, no reservations, waitlist.');
insert into public.verifications (restaurant_id, source, information_checked, date_checked, confidence, notes)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'public hours roundup', 'hours', '2026-08-17', 55, 'Hours conflict across secondary sources. Treat hours as unverified until an on-site check. Monday likely closed.');
insert into public.notes (restaurant_id, author, date, context, note)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'The Dining Dispatch', '2026-08-17', 'fixture', 'Hours are the weakest field on this fixture. Verify in person before treating them as trusted.');
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'Is Expendio de Maíz worth visiting?', 'Yes if you will wait and pay cash for corn cooking with no menu. No if you need a reservation, a card, or a private table.', 0);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'How much does Expendio de Maíz cost?', '$$, paid in cash, no published prix fixe. You eat until you stop, so the check tracks appetite.', 1);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'Is Expendio de Maíz good for tourists?', 'Yes for tourists who can handle a waitlist and Spanish at the counter. It is not a concierge booking.', 2);
insert into public.faqs (restaurant_id, question, answer, sort_order)
values ((select id from public.restaurants where slug = 'expendio-de-maiz'), 'Does Expendio de Maíz have vegetarian options?', 'Yes — declare restrictions when you sit. The kitchen builds plates to order around nixtamal. Confirm meat and lard in the moment.', 3);
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-mexico-city'),
  (select id from public.restaurants where slug = 'expendio-de-maiz'),
  0
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-restaurants-roma-norte'),
  (select id from public.restaurants where slug = 'expendio-de-maiz'),
  1
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-mexican-restaurants'),
  (select id from public.restaurants where slug = 'expendio-de-maiz'),
  2
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
insert into public.collection_restaurants (collection_id, restaurant_id, sort_order)
values (
  (select id from public.collections where slug = 'best-vegetarian-restaurants'),
  (select id from public.restaurants where slug = 'expendio-de-maiz'),
  3
)
on conflict (collection_id, restaurant_id) do update set sort_order = excluded.sort_order;
commit;
