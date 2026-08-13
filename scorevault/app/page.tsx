"use client";
import { useState, useEffect, useCallback } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  supabase,
  signOut,
  getProfile, upsertProfile,
  savePicks, getUserPicks, getResults,
  getLeagueByCode, createLeague, joinLeague, getMyMembership,
  getLeagueLeaderboard, getLeagueMembers, markMemberAsPaid, markMemberAsUnpaid,
} from "./lib/supabase";
import type { League, LeagueMember, LeaderboardEntry, Pick as DBPick } from "./lib/supabase";

// ── Palette ───────────────────────────────────────────────────────────────────
const P = {
  bg:      "#050505",
  canvas:  "#f7f7f4",
  white:   "#ffffff",
  border:  "#deded8",
  blue:    "#111111",
  blueBg:  "#ededeb",
  ink:     "#111111",
  muted:   "#70706a",
  gray:    "#eeeeeb",
  green:   "#111111",
  greenBg: "rgba(17,17,17,0.08)",
  red:     "#3f3f3a",
};
const DARK_SCREEN = "linear-gradient(160deg, #050505 0%, #171717 52%, #000000 100%)";

// ── Points formula ────────────────────────────────────────────────────────────
function pts(pct: number) { return Math.round(22 * Math.pow(100 / Math.max(1, pct), 1.23)); }

// ── Types ─────────────────────────────────────────────────────────────────────
type Tab = "picks" | "results" | "deposit" | "leagues" | "profile";
type ScoreVal = number | "";

interface WCMatch {
  id: string;
  day: number;     // tournament day 1–16
  date: string;    // "Jun 12"
  kickoff: string; // UTC ISO — for countdown
  time: string;    // display in CET "21:00"
  home: { name: string; flag: string; pct: number };
  draw: { pct: number };
  away: { name: string; flag: string; pct: number };
}

// ── WC 2026 full group stage schedule (70 matches, 16 days) ───────────────────
// Tournament Day 1 = June 12 · kickoff times UTC · display in CET (UTC+2)
const WC_MATCHES: WCMatch[] = [
  // ── Day 1 – Jun 12 ───────────────────────────────────────────────────────
  { id:"can-bih", day:1,  date:"Jun 12", kickoff:"2026-06-12T19:00:00Z", time:"21:00", home:{name:"Canada",       flag:"🇨🇦",pct:52}, draw:{pct:26}, away:{name:"Bosnia",      flag:"🇧🇦",pct:22} },
  { id:"usa-par", day:1,  date:"Jun 12", kickoff:"2026-06-13T01:00:00Z", time:"03:00", home:{name:"USA",          flag:"🇺🇸",pct:65}, draw:{pct:20}, away:{name:"Paraguay",    flag:"🇵🇾",pct:15} },
  // ── Day 2 – Jun 13 ───────────────────────────────────────────────────────
  { id:"qat-sui", day:2,  date:"Jun 13", kickoff:"2026-06-13T19:00:00Z", time:"21:00", home:{name:"Qatar",        flag:"🇶🇦",pct:18}, draw:{pct:25}, away:{name:"Switzerland", flag:"🇨🇭",pct:57} },
  { id:"bra-mar", day:2,  date:"Jun 13", kickoff:"2026-06-13T22:00:00Z", time:"00:00", home:{name:"Brazil",       flag:"🇧🇷",pct:50}, draw:{pct:28}, away:{name:"Morocco",     flag:"🇲🇦",pct:22} },
  { id:"hai-sco", day:2,  date:"Jun 13", kickoff:"2026-06-14T01:00:00Z", time:"03:00", home:{name:"Haiti",        flag:"🇭🇹",pct:15}, draw:{pct:25}, away:{name:"Scotland",    flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿",pct:60} },
  // ── Day 3 – Jun 14 ───────────────────────────────────────────────────────
  { id:"aus-tur", day:3,  date:"Jun 14", kickoff:"2026-06-14T04:00:00Z", time:"06:00", home:{name:"Australia",    flag:"🇦🇺",pct:40}, draw:{pct:28}, away:{name:"Türkiye",     flag:"🇹🇷",pct:32} },
  { id:"ger-cur", day:3,  date:"Jun 14", kickoff:"2026-06-14T17:00:00Z", time:"19:00", home:{name:"Germany",      flag:"🇩🇪",pct:75}, draw:{pct:15}, away:{name:"Curaçao",     flag:"🇨🇼",pct:10} },
  { id:"ned-jpn", day:3,  date:"Jun 14", kickoff:"2026-06-14T20:00:00Z", time:"22:00", home:{name:"Netherlands",  flag:"🇳🇱",pct:52}, draw:{pct:25}, away:{name:"Japan",       flag:"🇯🇵",pct:23} },
  { id:"civ-ecu", day:3,  date:"Jun 14", kickoff:"2026-06-14T23:00:00Z", time:"01:00", home:{name:"Ivory Coast",  flag:"🇨🇮",pct:42}, draw:{pct:30}, away:{name:"Ecuador",     flag:"🇪🇨",pct:28} },
  { id:"swe-tun", day:3,  date:"Jun 14", kickoff:"2026-06-15T02:00:00Z", time:"04:00", home:{name:"Sweden",       flag:"🇸🇪",pct:55}, draw:{pct:25}, away:{name:"Tunisia",     flag:"🇹🇳",pct:20} },
  // ── Day 4 – Jun 15 ───────────────────────────────────────────────────────
  { id:"esp-cpv", day:4,  date:"Jun 15", kickoff:"2026-06-15T16:00:00Z", time:"18:00", home:{name:"Spain",        flag:"🇪🇸",pct:72}, draw:{pct:18}, away:{name:"Cape Verde",  flag:"🇨🇻",pct:10} },
  { id:"bel-egy", day:4,  date:"Jun 15", kickoff:"2026-06-15T19:00:00Z", time:"21:00", home:{name:"Belgium",      flag:"🇧🇪",pct:58}, draw:{pct:22}, away:{name:"Egypt",       flag:"🇪🇬",pct:20} },
  { id:"ksa-uru", day:4,  date:"Jun 15", kickoff:"2026-06-15T22:00:00Z", time:"00:00", home:{name:"Saudi Arabia", flag:"🇸🇦",pct:22}, draw:{pct:28}, away:{name:"Uruguay",     flag:"🇺🇾",pct:50} },
  { id:"irn-nzl", day:4,  date:"Jun 15", kickoff:"2026-06-16T01:00:00Z", time:"03:00", home:{name:"Iran",         flag:"🇮🇷",pct:45}, draw:{pct:28}, away:{name:"New Zealand", flag:"🇳🇿",pct:27} },
  // ── Day 5 – Jun 16 ───────────────────────────────────────────────────────
  { id:"fra-sen", day:5,  date:"Jun 16", kickoff:"2026-06-16T19:00:00Z", time:"21:00", home:{name:"France",       flag:"🇫🇷",pct:60}, draw:{pct:22}, away:{name:"Senegal",     flag:"🇸🇳",pct:18} },
  { id:"irq-nor", day:5,  date:"Jun 16", kickoff:"2026-06-16T22:00:00Z", time:"00:00", home:{name:"Iraq",         flag:"🇮🇶",pct:20}, draw:{pct:22}, away:{name:"Norway",      flag:"🇳🇴",pct:58} },
  { id:"arg-alg", day:5,  date:"Jun 16", kickoff:"2026-06-17T01:00:00Z", time:"03:00", home:{name:"Argentina",    flag:"🇦🇷",pct:68}, draw:{pct:18}, away:{name:"Algeria",     flag:"🇩🇿",pct:14} },
  // ── Day 6 – Jun 17 ───────────────────────────────────────────────────────
  { id:"aut-jor", day:6,  date:"Jun 17", kickoff:"2026-06-17T04:00:00Z", time:"06:00", home:{name:"Austria",      flag:"🇦🇹",pct:55}, draw:{pct:25}, away:{name:"Jordan",      flag:"🇯🇴",pct:20} },
  { id:"por-cod", day:6,  date:"Jun 17", kickoff:"2026-06-17T17:00:00Z", time:"19:00", home:{name:"Portugal",     flag:"🇵🇹",pct:68}, draw:{pct:18}, away:{name:"Congo DR",    flag:"🇨🇩",pct:14} },
  { id:"eng-cro", day:6,  date:"Jun 17", kickoff:"2026-06-17T20:00:00Z", time:"22:00", home:{name:"England",      flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",pct:58}, draw:{pct:22}, away:{name:"Croatia",     flag:"🇭🇷",pct:20} },
  { id:"gha-pan", day:6,  date:"Jun 17", kickoff:"2026-06-17T23:00:00Z", time:"01:00", home:{name:"Ghana",        flag:"🇬🇭",pct:42}, draw:{pct:28}, away:{name:"Panama",      flag:"🇵🇦",pct:30} },
  { id:"uzb-col", day:6,  date:"Jun 17", kickoff:"2026-06-18T02:00:00Z", time:"04:00", home:{name:"Uzbekistan",   flag:"🇺🇿",pct:12}, draw:{pct:22}, away:{name:"Colombia",    flag:"🇨🇴",pct:66} },
  // ── Day 7 – Jun 18 ───────────────────────────────────────────────────────
  { id:"cze-rsa", day:7,  date:"Jun 18", kickoff:"2026-06-18T16:00:00Z", time:"18:00", home:{name:"Czechia",      flag:"🇨🇿",pct:52}, draw:{pct:28}, away:{name:"South Africa",flag:"🇿🇦",pct:20} },
  { id:"sui-bih", day:7,  date:"Jun 18", kickoff:"2026-06-18T19:00:00Z", time:"21:00", home:{name:"Switzerland",  flag:"🇨🇭",pct:65}, draw:{pct:20}, away:{name:"Bosnia",      flag:"🇧🇦",pct:15} },
  { id:"can-qat", day:7,  date:"Jun 18", kickoff:"2026-06-18T22:00:00Z", time:"00:00", home:{name:"Canada",       flag:"🇨🇦",pct:72}, draw:{pct:18}, away:{name:"Qatar",       flag:"🇶🇦",pct:10} },
  { id:"mex-kor", day:7,  date:"Jun 18", kickoff:"2026-06-19T01:00:00Z", time:"03:00", home:{name:"Mexico",       flag:"🇲🇽",pct:45}, draw:{pct:28}, away:{name:"South Korea", flag:"🇰🇷",pct:27} },
  // ── Day 8 – Jun 19 ───────────────────────────────────────────────────────
  { id:"usa-aus", day:8,  date:"Jun 19", kickoff:"2026-06-19T19:00:00Z", time:"21:00", home:{name:"USA",          flag:"🇺🇸",pct:45}, draw:{pct:28}, away:{name:"Australia",   flag:"🇦🇺",pct:27} },
  { id:"sco-mar", day:8,  date:"Jun 19", kickoff:"2026-06-19T22:00:00Z", time:"00:00", home:{name:"Scotland",     flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿",pct:35}, draw:{pct:30}, away:{name:"Morocco",     flag:"🇲🇦",pct:35} },
  { id:"bra-hai", day:8,  date:"Jun 19", kickoff:"2026-06-20T00:30:00Z", time:"02:30", home:{name:"Brazil",       flag:"🇧🇷",pct:80}, draw:{pct:12}, away:{name:"Haiti",       flag:"🇭🇹",pct:8 } },
  { id:"tur-par", day:8,  date:"Jun 19", kickoff:"2026-06-20T03:00:00Z", time:"05:00", home:{name:"Türkiye",      flag:"🇹🇷",pct:50}, draw:{pct:25}, away:{name:"Paraguay",    flag:"🇵🇾",pct:25} },
  // ── Day 9 – Jun 20 ───────────────────────────────────────────────────────
  { id:"ned-swe", day:9,  date:"Jun 20", kickoff:"2026-06-20T17:00:00Z", time:"19:00", home:{name:"Netherlands",  flag:"🇳🇱",pct:52}, draw:{pct:26}, away:{name:"Sweden",      flag:"🇸🇪",pct:22} },
  { id:"ger-civ", day:9,  date:"Jun 20", kickoff:"2026-06-20T20:00:00Z", time:"22:00", home:{name:"Germany",      flag:"🇩🇪",pct:60}, draw:{pct:22}, away:{name:"Ivory Coast", flag:"🇨🇮",pct:18} },
  { id:"ecu-cur", day:9,  date:"Jun 20", kickoff:"2026-06-21T00:00:00Z", time:"02:00", home:{name:"Ecuador",      flag:"🇪🇨",pct:70}, draw:{pct:18}, away:{name:"Curaçao",     flag:"🇨🇼",pct:12} },
  // ── Day 10 – Jun 21 ──────────────────────────────────────────────────────
  { id:"tun-jpn", day:10, date:"Jun 21", kickoff:"2026-06-21T04:00:00Z", time:"06:00", home:{name:"Tunisia",      flag:"🇹🇳",pct:22}, draw:{pct:25}, away:{name:"Japan",       flag:"🇯🇵",pct:53} },
  { id:"esp-ksa", day:10, date:"Jun 21", kickoff:"2026-06-21T16:00:00Z", time:"18:00", home:{name:"Spain",        flag:"🇪🇸",pct:72}, draw:{pct:18}, away:{name:"Saudi Arabia",flag:"🇸🇦",pct:10} },
  { id:"bel-irn", day:10, date:"Jun 21", kickoff:"2026-06-21T19:00:00Z", time:"21:00", home:{name:"Belgium",      flag:"🇧🇪",pct:60}, draw:{pct:22}, away:{name:"Iran",        flag:"🇮🇷",pct:18} },
  { id:"uru-cpv", day:10, date:"Jun 21", kickoff:"2026-06-21T22:00:00Z", time:"00:00", home:{name:"Uruguay",      flag:"🇺🇾",pct:72}, draw:{pct:18}, away:{name:"Cape Verde",  flag:"🇨🇻",pct:10} },
  { id:"nzl-egy", day:10, date:"Jun 21", kickoff:"2026-06-22T01:00:00Z", time:"03:00", home:{name:"New Zealand",  flag:"🇳🇿",pct:35}, draw:{pct:30}, away:{name:"Egypt",       flag:"🇪🇬",pct:35} },
  // ── Day 11 – Jun 22 ──────────────────────────────────────────────────────
  { id:"arg-aut", day:11, date:"Jun 22", kickoff:"2026-06-22T17:00:00Z", time:"19:00", home:{name:"Argentina",    flag:"🇦🇷",pct:60}, draw:{pct:22}, away:{name:"Austria",     flag:"🇦🇹",pct:18} },
  { id:"fra-irq", day:11, date:"Jun 22", kickoff:"2026-06-22T21:00:00Z", time:"23:00", home:{name:"France",       flag:"🇫🇷",pct:72}, draw:{pct:18}, away:{name:"Iraq",        flag:"🇮🇶",pct:10} },
  { id:"nor-sen", day:11, date:"Jun 22", kickoff:"2026-06-23T00:00:00Z", time:"02:00", home:{name:"Norway",       flag:"🇳🇴",pct:52}, draw:{pct:25}, away:{name:"Senegal",     flag:"🇸🇳",pct:23} },
  { id:"jor-alg", day:11, date:"Jun 22", kickoff:"2026-06-23T03:00:00Z", time:"05:00", home:{name:"Jordan",       flag:"🇯🇴",pct:30}, draw:{pct:28}, away:{name:"Algeria",     flag:"🇩🇿",pct:42} },
  // ── Day 12 – Jun 23 ──────────────────────────────────────────────────────
  { id:"por-uzb", day:12, date:"Jun 23", kickoff:"2026-06-23T17:00:00Z", time:"19:00", home:{name:"Portugal",     flag:"🇵🇹",pct:72}, draw:{pct:18}, away:{name:"Uzbekistan",  flag:"🇺🇿",pct:10} },
  { id:"eng-gha", day:12, date:"Jun 23", kickoff:"2026-06-23T20:00:00Z", time:"22:00", home:{name:"England",      flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",pct:58}, draw:{pct:22}, away:{name:"Ghana",       flag:"🇬🇭",pct:20} },
  { id:"pan-cro", day:12, date:"Jun 23", kickoff:"2026-06-23T23:00:00Z", time:"01:00", home:{name:"Panama",       flag:"🇵🇦",pct:22}, draw:{pct:28}, away:{name:"Croatia",     flag:"🇭🇷",pct:50} },
  { id:"col-cod", day:12, date:"Jun 23", kickoff:"2026-06-24T02:00:00Z", time:"04:00", home:{name:"Colombia",     flag:"🇨🇴",pct:70}, draw:{pct:18}, away:{name:"Congo DR",    flag:"🇨🇩",pct:12} },
  // ── Day 13 – Jun 24 (Matchday 3 starts — simultaneous kickoffs) ──────────
  { id:"bih-qat", day:13, date:"Jun 24", kickoff:"2026-06-24T19:00:00Z", time:"21:00", home:{name:"Bosnia",       flag:"🇧🇦",pct:45}, draw:{pct:28}, away:{name:"Qatar",       flag:"🇶🇦",pct:27} },
  { id:"sui-can", day:13, date:"Jun 24", kickoff:"2026-06-24T19:00:00Z", time:"21:00", home:{name:"Switzerland",  flag:"🇨🇭",pct:52}, draw:{pct:26}, away:{name:"Canada",      flag:"🇨🇦",pct:22} },
  { id:"mar-hai", day:13, date:"Jun 24", kickoff:"2026-06-24T22:00:00Z", time:"00:00", home:{name:"Morocco",      flag:"🇲🇦",pct:70}, draw:{pct:18}, away:{name:"Haiti",       flag:"🇭🇹",pct:12} },
  { id:"sco-bra", day:13, date:"Jun 24", kickoff:"2026-06-24T22:00:00Z", time:"00:00", home:{name:"Scotland",     flag:"🏴󠁧󠁢󠁳󠁣󠁴󠁿",pct:22}, draw:{pct:25}, away:{name:"Brazil",      flag:"🇧🇷",pct:53} },
  { id:"cze-mex", day:13, date:"Jun 24", kickoff:"2026-06-25T01:00:00Z", time:"03:00", home:{name:"Czechia",      flag:"🇨🇿",pct:42}, draw:{pct:28}, away:{name:"Mexico",      flag:"🇲🇽",pct:30} },
  { id:"rsa-kor", day:13, date:"Jun 24", kickoff:"2026-06-25T01:00:00Z", time:"03:00", home:{name:"South Africa", flag:"🇿🇦",pct:28}, draw:{pct:28}, away:{name:"South Korea", flag:"🇰🇷",pct:44} },
  // ── Day 14 – Jun 25 ──────────────────────────────────────────────────────
  { id:"cur-civ", day:14, date:"Jun 25", kickoff:"2026-06-25T20:00:00Z", time:"22:00", home:{name:"Curaçao",      flag:"🇨🇼",pct:25}, draw:{pct:28}, away:{name:"Ivory Coast", flag:"🇨🇮",pct:47} },
  { id:"ecu-ger", day:14, date:"Jun 25", kickoff:"2026-06-25T20:00:00Z", time:"22:00", home:{name:"Ecuador",      flag:"🇪🇨",pct:15}, draw:{pct:22}, away:{name:"Germany",     flag:"🇩🇪",pct:63} },
  { id:"jpn-swe", day:14, date:"Jun 25", kickoff:"2026-06-25T23:00:00Z", time:"01:00", home:{name:"Japan",        flag:"🇯🇵",pct:42}, draw:{pct:28}, away:{name:"Sweden",      flag:"🇸🇪",pct:30} },
  { id:"tun-ned", day:14, date:"Jun 25", kickoff:"2026-06-25T23:00:00Z", time:"01:00", home:{name:"Tunisia",      flag:"🇹🇳",pct:22}, draw:{pct:25}, away:{name:"Netherlands", flag:"🇳🇱",pct:53} },
  { id:"par-aus", day:14, date:"Jun 25", kickoff:"2026-06-26T02:00:00Z", time:"04:00", home:{name:"Paraguay",     flag:"🇵🇾",pct:38}, draw:{pct:28}, away:{name:"Australia",   flag:"🇦🇺",pct:34} },
  { id:"tur-usa", day:14, date:"Jun 25", kickoff:"2026-06-26T02:00:00Z", time:"04:00", home:{name:"Türkiye",      flag:"🇹🇷",pct:30}, draw:{pct:28}, away:{name:"USA",         flag:"🇺🇸",pct:42} },
  // ── Day 15 – Jun 26 ──────────────────────────────────────────────────────
  { id:"nor-fra", day:15, date:"Jun 26", kickoff:"2026-06-26T19:00:00Z", time:"21:00", home:{name:"Norway",       flag:"🇳🇴",pct:28}, draw:{pct:25}, away:{name:"France",      flag:"🇫🇷",pct:47} },
  { id:"sen-irq", day:15, date:"Jun 26", kickoff:"2026-06-26T19:00:00Z", time:"21:00", home:{name:"Senegal",      flag:"🇸🇳",pct:48}, draw:{pct:28}, away:{name:"Iraq",        flag:"🇮🇶",pct:24} },
  { id:"cpv-ksa", day:15, date:"Jun 26", kickoff:"2026-06-27T00:00:00Z", time:"02:00", home:{name:"Cape Verde",   flag:"🇨🇻",pct:25}, draw:{pct:28}, away:{name:"Saudi Arabia",flag:"🇸🇦",pct:47} },
  { id:"uru-esp", day:15, date:"Jun 26", kickoff:"2026-06-27T00:00:00Z", time:"02:00", home:{name:"Uruguay",      flag:"🇺🇾",pct:22}, draw:{pct:28}, away:{name:"Spain",       flag:"🇪🇸",pct:50} },
  { id:"egy-irn", day:15, date:"Jun 26", kickoff:"2026-06-27T03:00:00Z", time:"05:00", home:{name:"Egypt",        flag:"🇪🇬",pct:38}, draw:{pct:28}, away:{name:"Iran",        flag:"🇮🇷",pct:34} },
  { id:"nzl-bel", day:15, date:"Jun 26", kickoff:"2026-06-27T03:00:00Z", time:"05:00", home:{name:"New Zealand",  flag:"🇳🇿",pct:20}, draw:{pct:22}, away:{name:"Belgium",     flag:"🇧🇪",pct:58} },
  // ── Day 16 – Jun 27 ──────────────────────────────────────────────────────
  { id:"cro-gha", day:16, date:"Jun 27", kickoff:"2026-06-27T21:00:00Z", time:"23:00", home:{name:"Croatia",      flag:"🇭🇷",pct:48}, draw:{pct:28}, away:{name:"Ghana",       flag:"🇬🇭",pct:24} },
  { id:"pan-eng", day:16, date:"Jun 27", kickoff:"2026-06-27T21:00:00Z", time:"23:00", home:{name:"Panama",       flag:"🇵🇦",pct:15}, draw:{pct:22}, away:{name:"England",     flag:"🏴󠁧󠁢󠁥󠁮󠁧󠁿",pct:63} },
  { id:"col-por", day:16, date:"Jun 27", kickoff:"2026-06-27T23:30:00Z", time:"01:30", home:{name:"Colombia",     flag:"🇨🇴",pct:42}, draw:{pct:28}, away:{name:"Portugal",    flag:"🇵🇹",pct:30} },
  { id:"cod-uzb", day:16, date:"Jun 27", kickoff:"2026-06-27T23:30:00Z", time:"01:30", home:{name:"Congo DR",     flag:"🇨🇩",pct:40}, draw:{pct:28}, away:{name:"Uzbekistan",  flag:"🇺🇿",pct:32} },
  { id:"alg-aut", day:16, date:"Jun 27", kickoff:"2026-06-28T02:00:00Z", time:"04:00", home:{name:"Algeria",      flag:"🇩🇿",pct:38}, draw:{pct:28}, away:{name:"Austria",     flag:"🇦🇹",pct:34} },
  { id:"jor-arg", day:16, date:"Jun 27", kickoff:"2026-06-28T02:00:00Z", time:"04:00", home:{name:"Jordan",       flag:"🇯🇴",pct:12}, draw:{pct:22}, away:{name:"Argentina",   flag:"🇦🇷",pct:66} },
];

// Build lookup map for ResultsTab
const WC_META: Record<string, WCMatch> = Object.fromEntries(WC_MATCHES.map(m => [m.id, m]));

// Matchday (competition round) grouping — different from calendar day
// GW1 = group stage round 1 (days 1–8), GW2 = round 2 (days 9–12), GW3 = round 3 (days 13–16)
function getGW(day: number): 1 | 2 | 3 {
  if (day <= 8) return 1;
  if (day <= 12) return 2;
  return 3;
}
const GW_LABELS: Record<1 | 2 | 3, string> = {
  1: "Matchday 1  ·  Jun 12 – 19",
  2: "Matchday 2  ·  Jun 20 – 23",
  3: "Matchday 3  ·  Jun 24 – 27",
};

// Tournament day helpers
function getTournamentDay(): number {
  const start = Date.UTC(2026, 5, 12); // Jun 12 UTC
  const now   = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  return Math.max(1, Math.min(16, Math.floor((now - start) / 86400000) + 1));
}
const TODAY_TOURNEY_DAY = getTournamentDay();
function getTodayGW(): 1 | 2 | 3 { return getGW(TODAY_TOURNEY_DAY); }

function isMatchLocked(m: WCMatch): boolean {
  return Date.now() >= new Date(m.kickoff).getTime();
}

const AVATARS = ["⚽", "🦁", "🐯", "🦊", "🐺", "🦅", "🐉", "🦄"];

// ── Shared: flag circle ───────────────────────────────────────────────────────
function Flag({ emoji, size = 72 }: { emoji: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: P.gray, display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    }}>
      <span style={{ fontSize: size * 0.68, lineHeight: 1 }}>{emoji}</span>
    </div>
  );
}

// ── Shared: day strip ─────────────────────────────────────────────────────────
const TOURNEY_DAYS = Array.from({ length: 16 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 5, 12 + i)); // Jun 12 + i
  const date = d.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" });
  return { day: i + 1, date };
});

function DayStrip({ selected, onSelect }: { selected: number; onSelect: (d: number) => void }) {
  return (
    <div className="no-scrollbar" style={{
      display: "flex", gap: 4, overflowX: "auto", flexShrink: 0,
      padding: "8px 10px", background: P.white, borderBottom: `1px solid ${P.border}`,
    }}>
      {TOURNEY_DAYS.map(({ day }) => {
        const active  = day === selected;
        const isToday = day === TODAY_TOURNEY_DAY;
        return (
          <button key={day} onClick={() => onSelect(day)} style={{
            display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
            minWidth: 48, padding: "9px 6px", border: "none", cursor: "pointer",
            borderRadius: 11, background: active ? P.blueBg : "transparent",
            boxShadow: active ? `inset 0 0 0 1px ${P.border}` : "none",
          }}>
            <strong style={{ fontSize: 13, fontWeight: 800, color: active ? P.blue : P.ink }}>
              {isToday ? "Today" : `Day ${day}`}
            </strong>
          </button>
        );
      })}
    </div>
  );
}

// ── Shared: countdown pill ────────────────────────────────────────────────────
function Countdown({ day }: { day: number }) {
  const [s, setS] = useState(0);
  useEffect(() => {
    const targets = WC_MATCHES
      .filter(m => m.day === day)
      .map(m => new Date(m.kickoff).getTime())
      .filter(t => t > Date.now())
      .sort((a, b) => a - b);
    const target = targets[0];
    if (!target) { setS(0); return; }
    const tick = () => setS(Math.max(0, Math.floor((target - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [day]);

  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8, padding: "7px 12px",
      borderRadius: 999, background: P.white, border: `1px solid ${P.border}`,
      fontSize: 13, color: "#5f6375", boxShadow: "0 3px 12px rgba(32,39,78,0.04)",
    }}>
      <span style={{ fontSize: 18, color: P.blue, lineHeight: 1 }}>◷</span>
      {s === 0
        ? <span>Predictions closed</span>
        : <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {pad(Math.floor(s / 3600))} : {pad(Math.floor((s % 3600) / 60))} : {pad(s % 60)}
          </span>
      }
    </div>
  );
}

// ── Picks: match card ─────────────────────────────────────────────────────────
function MatchCard({ match: m, pick, onPick, isSaved = false, locked = false }: {
  match: WCMatch;
  pick: { home: ScoreVal; away: ScoreVal };
  onPick: (h: ScoreVal, a: ScoreVal) => void;
  isSaved?: boolean;
  locked?: boolean;
}) {
  const total = m.home.pct + m.draw.pct + m.away.pct;
  const hPct = Math.round((m.home.pct / total) * 100);
  const dPct = Math.round((m.draw.pct / total) * 100);
  const aPct = 100 - hPct - dPct;
  const maxP = Math.max(hPct, dPct, aPct);

  function OddPill({ label, pct }: { label: string; pct: number }) {
    const p = pts(pct);
    const fav = pct === maxP;
    const rare = pct < 25 && label !== "X";
    return (
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
        padding: "7px 0", borderRadius: 10, gap: 1,
        background: locked ? P.gray : fav ? "rgba(17,17,17,0.08)" : rare ? "rgba(17,17,17,0.05)" : P.gray,
        border: `1px solid ${locked ? "transparent" : fav ? "rgba(17,17,17,0.24)" : rare ? "rgba(17,17,17,0.14)" : "transparent"}`,
        opacity: locked ? 0.5 : 1,
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, color: P.muted, letterSpacing: "0.04em" }}>{label}</span>
        <span style={{ fontSize: 16, fontWeight: 900, color: locked ? P.muted : fav ? P.green : rare ? P.red : P.ink, lineHeight: 1 }}>{p}</span>
        <span style={{ fontSize: 8, fontWeight: 700, color: P.muted, opacity: 0.7 }}>pts</span>
      </div>
    );
  }

  const inputSt = (val: ScoreVal) => ({
    width: 52, height: 58, padding: 0, textAlign: "center" as const,
    fontSize: 24, fontWeight: 700, outline: "none", border: "none",
    borderRadius: 10, transition: "all 0.15s",
    background: locked ? P.gray : val !== "" ? P.blueBg : P.gray,
    color: locked ? P.muted : val !== "" ? P.blue : P.ink,
    boxShadow: locked ? `inset 0 0 0 1.5px ${P.border}` : val !== "" ? `inset 0 0 0 1.5px ${P.blue}` : `inset 0 0 0 1.5px ${P.border}`,
    cursor: locked ? "not-allowed" : "text",
  });

  const borderColor = isSaved ? P.blue : locked ? P.border : P.border;
  const cardBg = locked ? "#fafbfc" : P.white;

  return (
    <div style={{
      background: cardBg, borderRadius: 16,
      border: `2px solid ${borderColor}`,
      boxShadow: isSaved && !locked ? `0 0 0 1px ${P.blueBg}, 0 5px 18px rgba(0,0,0,0.10)` : "0 5px 18px rgba(0,0,0,0.055)",
      marginBottom: 10, overflow: "hidden", transition: "border-color 0.2s, box-shadow 0.2s",
      opacity: locked ? 0.75 : 1,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 13px 0", color: P.muted, fontSize: 11 }}>
        <span>{m.date} · {m.time} CET</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 9 }}>
          {locked
            ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: P.red, display: "inline-block" }} /><span style={{ color: P.red, fontWeight: 800 }}>Locked</span></>
            : isSaved
              ? <><span style={{ width: 6, height: 6, borderRadius: "50%", background: P.blue, display: "inline-block" }} /><span style={{ color: P.blue, fontWeight: 800 }}>Saved</span></>
              : <><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c2c5d0", display: "inline-block" }} />Open</>
          }
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 1fr", alignItems: "center", padding: "8px 8px 14px", gap: 4 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
          <Flag emoji={m.home.flag} size={68} />
          <span style={{ fontSize: 13, fontWeight: 650, color: P.ink, textAlign: "center" }}>{m.home.name}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="number" min={0} max={99} value={pick.home} readOnly={locked}
              onChange={locked ? undefined : e => onPick(e.target.value === "" ? "" : Math.min(99, parseInt(e.target.value) || 0), pick.away)}
              style={inputSt(pick.home)}
            />
            <span style={{ fontSize: 16, fontWeight: 700, color: P.muted }}>:</span>
            <input
              type="number" min={0} max={99} value={pick.away} readOnly={locked}
              onChange={locked ? undefined : e => onPick(pick.home, e.target.value === "" ? "" : Math.min(99, parseInt(e.target.value) || 0))}
              style={inputSt(pick.away)}
            />
          </div>
          <div style={{ display: "flex", gap: 4, width: "100%" }}>
              <OddPill label="1" pct={hPct} />
              <OddPill label="X" pct={dPct} />
              <OddPill label="2" pct={aPct} />
            </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
          <Flag emoji={m.away.flag} size={68} />
          <span style={{ fontSize: 13, fontWeight: 650, color: P.ink, textAlign: "center" }}>{m.away.name}</span>
        </div>
      </div>
    </div>
  );
}

// ── Sport switcher (Polymarket-style horizontal row) ─────────────────────────
function SportSwitcher() {
  const sports = [
    { id: "wc26", label: "🏆 World Cup 2026", active: true },
    { id: "nfl",  label: "🏈 NFL",            active: false },
    { id: "nba",  label: "🏀 NBA",            active: false },
    { id: "uso",  label: "🎾 US Open",        active: false },
  ];
  return (
    <div className="no-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", padding: "10px 12px 10px", background: P.white, borderBottom: `1px solid ${P.border}`, flexShrink: 0 }}>
      {sports.map(s => (
        <div key={s.id} style={{
          padding: "6px 14px", borderRadius: 999, whiteSpace: "nowrap",
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          background: s.active ? P.blue : P.gray,
          color: s.active ? "#fff" : P.muted,
          opacity: s.active ? 1 : 0.5,
          cursor: s.active ? "default" : "not-allowed",
        }}>{s.label}</div>
      ))}
    </div>
  );
}

// ── Matchday dropdown (competition round, not calendar day) ───────────────────
function MatchdayPicker({ selected, onSelect }: { selected: 1 | 2 | 3; onSelect: (gw: 1 | 2 | 3) => void }) {
  return (
    <div style={{ padding: "8px 12px", background: P.white, borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
      <span style={{ fontSize: 11, color: P.muted, fontWeight: 600, flexShrink: 0 }}>Round</span>
      <select
        value={selected}
        onChange={e => onSelect(Number(e.target.value) as 1 | 2 | 3)}
        style={{ flex: 1, padding: "9px 12px", borderRadius: 10, border: `1px solid ${P.border}`, background: P.white, fontSize: 13, fontWeight: 700, color: P.ink, cursor: "pointer", outline: "none", appearance: "auto" }}
      >
        {([1, 2, 3] as const).map(gw => (
          <option key={gw} value={gw}>{GW_LABELS[gw]}</option>
        ))}
      </select>
    </div>
  );
}

// ── Picks tab ─────────────────────────────────────────────────────────────────
function PicksTab({ userId, onShowLeagueSetup }: { userId: string | null; onShowLeagueSetup: () => void }) {
  const [gw, setGW] = useState<1 | 2 | 3>(() => getTodayGW());
  const [picks, setPicks] = useState<Record<string, { home: ScoreVal; away: ScoreVal }>>({});
  const [savedPickIds, setSavedPickIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getUserPicks(userId).then((rows: DBPick[]) => {
      const map: Record<string, { home: ScoreVal; away: ScoreVal }> = {};
      const ids = new Set<string>();
      for (const r of rows) {
        map[r.match_id] = { home: r.home_score, away: r.away_score };
        ids.add(r.match_id);
      }
      setPicks(map);
      setSavedPickIds(ids);
    });
  }, [userId]);

  const gwMatches = WC_MATCHES.filter(m => getGW(m.day) === gw);
  const openMatches = gwMatches.filter(m => !isMatchLocked(m));
  const filledMatches = openMatches.filter(m => { const p = picks[m.id]; return p && p.home !== "" && p.away !== ""; });
  const filled = filledMatches.length;
  const openCount = openMatches.length;

  async function save() {
    if (!userId || filled === 0) return;
    setSaving(true);
    const rows = filledMatches.map(m => ({ matchId: m.id, homeScore: Number(picks[m.id].home), awayScore: Number(picks[m.id].away) }));
    await savePicks(userId, rows);
    const newSaved = new Set(savedPickIds);
    rows.forEach(r => newSaved.add(r.matchId));
    setSavedPickIds(newSaved);
    setSaving(false);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2200);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: P.canvas, position: "relative" }}>
      <SportSwitcher />
      <MatchdayPicker selected={gw} onSelect={setGW} />

      {/* Create / Join / Import — private league shortcuts */}
      <div style={{ padding: "10px 12px", background: P.white, borderBottom: `1px solid ${P.border}`, display: "flex", gap: 8, flexShrink: 0 }}>
        {[{ label: "Create", icon: "✨" }, { label: "Join", icon: "🔗" }, { label: "Import", icon: "📥", soon: true }].map(({ label, icon, soon }) => (
          <button key={label} onClick={soon ? undefined : onShowLeagueSetup} style={{
            flex: 1, padding: "9px 0", borderRadius: 10,
            background: soon ? P.gray : P.gray, border: `1px solid ${P.border}`,
            fontSize: 11, fontWeight: 700, color: soon ? P.muted : P.ink, cursor: soon ? "default" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            opacity: soon ? 0.55 : 1,
          }}>
            <span style={{ fontSize: 15 }}>{icon}</span>
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", padding: "8px 16px 4px", flexShrink: 0 }}>
        <span style={{ fontSize: 10, color: P.muted }}>Pick value via Polymarket</span>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "4px 12px 0" }}>
        {gwMatches.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 240, gap: 12, color: P.muted }}>
            <span style={{ fontSize: 40 }}>⚽</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>No games this matchday</span>
          </div>
        ) : gwMatches.map(m => (
          <MatchCard
            key={m.id}
            match={m}
            pick={picks[m.id] ?? { home: "", away: "" }}
            onPick={(h, a) => setPicks(prev => ({ ...prev, [m.id]: { home: h, away: a } }))}
            isSaved={savedPickIds.has(m.id)}
            locked={isMatchLocked(m)}
          />
        ))}
        <div style={{ height: 88 }} />
      </div>

      <div style={{
        position: "absolute", inset: "auto 0 0 0", padding: "26px 16px 12px",
        background: `linear-gradient(to top, ${P.canvas} 60%, transparent)`,
        pointerEvents: "none",
      }}>
        <button onClick={save} disabled={filled === 0 || saving} style={{
          width: "100%", minHeight: 52, borderRadius: 13, border: "none",
          cursor: filled === 0 ? "default" : "pointer", fontSize: 14, fontWeight: 750,
          background: justSaved ? P.green : filled === 0 ? P.border : `linear-gradient(180deg, #222222, ${P.blue})`,
          color: filled === 0 ? P.muted : "#fff",
          boxShadow: filled > 0 && !justSaved ? "0 9px 24px rgba(0,0,0,0.24)" : "none",
          transition: "all 0.2s", pointerEvents: "auto",
        }}>
          {justSaved ? "✓ Picks saved!" : saving ? "Saving…" : openCount === 0 ? "All matches locked" : filled === 0 ? "Enter a prediction above" : `🔒 Lock ${filled} of ${openCount} picks`}
        </button>
      </div>
    </div>
  );
}

// ── Results tab ───────────────────────────────────────────────────────────────
function ResultsTab({ userId }: { userId: string | null }) {
  const [day, setDay] = useState(() => TODAY_TOURNEY_DAY);
  const [results, setResults]   = useState<Record<string, { home: number; away: number; is_final: boolean }>>({});
  const [picks, setPicks]       = useState<Record<string, { home: number; away: number }>>({});
  const [syncing, setSyncing]   = useState(false);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  async function sync(silent = false) {
    if (!silent) setSyncing(true);
    try { await fetch("/api/sync-scores"); } catch {}
    const res = await getResults();
    const map: Record<string, { home: number; away: number; is_final: boolean }> = {};
    res.forEach(r => { map[r.match_id] = { home: r.home_score, away: r.away_score, is_final: r.is_final }; });
    setResults(map);
    setLastSync(new Date());
    if (!silent) setSyncing(false);
  }

  useEffect(() => {
    sync(true);
    if (userId) {
      getUserPicks(userId).then(ps => {
        const m: Record<string, { home: number; away: number }> = {};
        ps.forEach(p => { m[p.match_id] = { home: p.home_score, away: p.away_score }; });
        setPicks(m);
      });
    }
    const interval = setInterval(() => sync(true), 3 * 60 * 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const dayMatches = WC_MATCHES.filter(m => m.day === day);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <DayStrip selected={day} onSelect={setDay} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 14px 2px" }}>
        <span style={{ fontSize: 11, color: P.muted }}>
          {lastSync ? `Updated ${lastSync.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Loading…"}
        </span>
        <button onClick={() => sync(false)} disabled={syncing}
          style={{ background: "none", border: "none", fontSize: 11, color: P.blue, fontWeight: 700, cursor: "pointer", padding: "2px 6px" }}>
          {syncing ? "Syncing…" : "↻ Refresh"}
        </button>
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", background: P.canvas, padding: "8px 12px 0" }}>
        {dayMatches.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 240, gap: 12, color: P.muted }}>
            <span style={{ fontSize: 40 }}>📅</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>No matches this day</span>
          </div>
        ) : dayMatches.map(m => {
          const id     = m.id;
          const result = results[id];
          const pick   = picks[id];
          if (!result) {
            return (
              <div key={id} style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, marginBottom: 10, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 22 }}>{m.home.flag}</span>
                <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: P.muted }}>{m.home.name} vs {m.away.name}</span>
                <span style={{ fontSize: 22 }}>{m.away.flag}</span>
                <span style={{ fontSize: 11, color: P.muted, marginLeft: 6 }}>⏳ {m.time} CET</span>
              </div>
            );
          }
          const homeWon = result.home > result.away;
          const awayWon = result.away > result.home;
          const isDraw  = !homeWon && !awayWon;
          const exact   = !!pick && pick.home === result.home && pick.away === result.away;
          const correct = !exact && !!pick && (
            (homeWon && pick.home > pick.away) ||
            (awayWon && pick.away > pick.home) ||
            (isDraw  && pick.home === pick.away)
          );
          const winPct    = homeWon ? m.home.pct : awayWon ? m.away.pct : m.draw.pct;
          const earnedPts = exact ? pts(winPct) * 3 : correct ? pts(winPct) : 0;

          return (
            <div key={id} style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, boxShadow: "0 5px 18px rgba(0,0,0,0.055)", marginBottom: 10, overflow: "hidden" }}>
              <div style={{ padding: "10px 13px 0", display: "flex", gap: 6, alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: P.muted }}>{m.date} · {m.time} CET</span>
                {!result.is_final && <span style={{ fontSize: 10, fontWeight: 800, color: P.red, padding: "2px 7px", borderRadius: 6, background: "rgba(17,17,17,0.08)" }}>LIVE</span>}
                {result.is_final && <span style={{ fontSize: 10, fontWeight: 700, color: P.muted }}>FT</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", padding: "10px 12px 14px", gap: 8 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <Flag emoji={m.home.flag} size={68} />
                  <span style={{ fontSize: 12, fontWeight: 650, color: P.ink, textAlign: "center" }}>{m.home.name}</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <div style={{ padding: "8px 20px", borderRadius: 10, background: P.gray, border: `2px solid ${exact ? P.blue : correct ? P.green : P.border}` }}>
                    <span style={{ fontSize: 22, fontWeight: 900, color: P.ink, fontVariantNumeric: "tabular-nums" }}>
                      {result.home} : {result.away}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {pick && <span style={{ fontSize: 11, color: P.muted }}>Pick: {pick.home}–{pick.away}</span>}
                    {earnedPts > 0 && (
                      <div style={{ padding: "3px 10px", borderRadius: 8, background: exact ? P.blue : P.greenBg, border: `1px solid ${exact ? P.blue : P.green}` }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: exact ? "#fff" : P.green }}>+{earnedPts} pts {exact ? "🎯" : "✓"}</span>
                      </div>
                    )}
                    {!earnedPts && pick && <span style={{ fontSize: 11, color: P.red }}>✗ miss</span>}
                    {!pick && <span style={{ fontSize: 11, color: P.muted }}>No pick</span>}
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <Flag emoji={m.away.flag} size={68} />
                  <span style={{ fontSize: 12, fontWeight: 650, color: P.ink, textAlign: "center" }}>{m.away.name}</span>
                </div>
              </div>
            </div>
          );
        })}
        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

// ── Deposit tab — coming soon ─────────────────────────────────────────────────
function DepositTab() {
  return (
    <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", background: P.canvas, padding: "0 16px 32px" }}>
      <div style={{ paddingTop: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, marginBottom: 28 }}>
        <div style={{ width: 64, height: 64, borderRadius: 18, background: P.blue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, boxShadow: "0 8px 24px rgba(0,0,0,0.24)", marginBottom: 4 }}>💳</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: P.ink }}>Deposit</h2>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.08em", color: P.blue, background: P.blueBg, padding: "4px 10px", borderRadius: 6 }}>COMING SOON</div>
      </div>

      <div style={{ background: P.white, borderRadius: 18, border: `1px solid ${P.border}`, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ padding: "18px 18px 6px" }}>
          <p style={{ margin: "0 0 16px", fontSize: 15, fontWeight: 800, color: P.ink }}>Instant transfer · No fees on first deposit</p>
          <p style={{ margin: 0, fontSize: 13, color: P.muted, lineHeight: 1.6 }}>
            When the money layer launches, you&apos;ll be able to fund your league pot instantly — no bank delays, no middleman.
          </p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0, borderTop: `1px solid ${P.border}`, marginTop: 16 }}>
          {[
            { icon: "⚡", label: "Instant", desc: "Funds appear immediately" },
            { icon: "🔒", label: "Secure", desc: "Non-custodial prize pool" },
            { icon: "💸", label: "No fees", desc: "First deposit is free" },
            { icon: "🏆", label: "Winner takes all", desc: "Auto-distributed on final" },
          ].map(({ icon, label, desc }, i) => (
            <div key={label} style={{
              padding: "14px 16px",
              borderRight: i % 2 === 0 ? `1px solid ${P.border}` : "none",
              borderBottom: i < 2 ? `1px solid ${P.border}` : "none",
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: P.ink, marginBottom: 2 }}>{label}</div>
              <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.4 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, padding: "16px 18px" }}>
        <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 800, color: P.ink }}>Currently in free-to-play mode</p>
        <p style={{ margin: 0, fontSize: 12, color: P.muted, lineHeight: 1.55 }}>
          All picks, points and rankings are live — the prize layer drops later this summer.
        </p>
      </div>
    </div>
  );
}

// ── My Leagues tab (replaces Ranking) ────────────────────────────────────────
function MyLeaguesTab({ league, user, authUserId, onNewLeague }: { league: League | null; user: { name: string; avatar: string }; authUserId: string; onNewLeague: () => void }) {
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  useEffect(() => { if (league) getLeagueLeaderboard(league.id).then(setBoard); }, [league?.id]);

  const myRank    = board.findIndex(p => p.user_id === authUserId) + 1;
  const paidCount = board.filter(p => p.paid).length;
  const potEuros  = league ? (league.stake_cents * paidCount) / 100 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: P.canvas }}>

      {/* Global ranking hero */}
      <div style={{ background: `linear-gradient(135deg, #050505, ${P.blue})`, padding: "18px 16px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 700, marginBottom: 4 }}>GLOBAL RANKING</div>
          <div style={{ fontSize: 32, fontWeight: 900, color: "#fff", lineHeight: 1 }}>
            {myRank > 0 ? `#${myRank}` : "–"}
          </div>
          {board.length > 0 && <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", marginTop: 3 }}>out of {board.length} players</div>}
        </div>
        {potEuros > 0 && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 11, color: "rgba(255,255,255,0.65)", fontWeight: 700, marginBottom: 4 }}>PRIZE POOL</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#fff" }}>{potEuros.toFixed(0)}€</div>
          </div>
        )}
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>

        {/* Leagues I'm in */}
        {league ? (
          <div style={{ margin: "12px 12px 0" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: P.muted, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>MY LEAGUES</div>
            <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden" }}>
              {/* leaderboard rows */}
              <div style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${P.border}` }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: P.ink }}>{league.name}</div>
                  <div style={{ fontSize: 11, color: P.muted }}>{board.length} players{league.stake_cents > 0 ? ` · ${(league.stake_cents / 100).toFixed(0)}€ stake` : ""}</div>
                </div>
                <div style={{ padding: "4px 10px", borderRadius: 8, background: P.blueBg, fontSize: 12, fontWeight: 900, color: P.blue }}>{league.code}</div>
              </div>
              {board.slice(0, 5).map((p, i) => {
                const isMe = p.user_id === authUserId;
                return (
                  <div key={p.user_id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${P.border}`, background: isMe ? P.blueBg : P.white }}>
                    <span style={{ fontSize: 13, fontWeight: 800, width: 22, flexShrink: 0, color: P.muted }}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
                    </span>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0, background: P.gray, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, marginRight: 8, border: `2px solid ${isMe ? P.blue : "transparent"}` }}>{p.avatar}</div>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: P.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.name}{isMe && <span style={{ fontSize: 10, color: P.blue, marginLeft: 5 }}>you</span>}
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 900, color: P.blue }}>{p.total_pts} pts</span>
                  </div>
                );
              })}
              {board.length > 5 && (
                <div style={{ padding: "10px 14px", fontSize: 12, color: P.muted, textAlign: "center" }}>+{board.length - 5} more players</div>
              )}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "32px 24px", gap: 12 }}>
            <span style={{ fontSize: 48 }}>🏆</span>
            <p style={{ fontSize: 15, fontWeight: 800, color: P.ink, textAlign: "center", margin: 0 }}>No league yet</p>
            <p style={{ fontSize: 13, color: P.muted, textAlign: "center", margin: 0, lineHeight: 1.55 }}>Create a private league to compete with friends and share the pot.</p>
          </div>
        )}

        {/* + New League button */}
        <div style={{ padding: "16px 12px 12px" }}>
          <button onClick={onNewLeague} style={{
            width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
            background: P.blue, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer",
            boxShadow: "0 6px 18px rgba(0,0,0,0.20)",
          }}>+ New League</button>
        </div>

        <div style={{ height: 16 }} />
      </div>
    </div>
  );
}

// ── Profile tab ───────────────────────────────────────────────────────────────
const RULES = [
  { icon: "⚽", title: "Predict the score",   body: "Enter the exact scoreline for each match before kick-off." },
  { icon: "🔒", title: "Lock before kick-off", body: "Picks are locked once the match starts — no edits after." },
  { icon: "📊", title: "Earn points",           body: "Exact score = max points (rarity-weighted). Correct result = bonus." },
  { icon: "🏆", title: "Top score wins",        body: "Most points at end of the tournament wins the full pot." },
];

type ProfileSubTab = "stats" | "picks" | "badges" | "friends";
type DrawerSection = null | "rules" | "settings" | "ads";

function ProfileTab({ league, membership, user, authUserId, onSignOut, onProfileUpdate, onJoinLeague }: {
  league: League | null;
  membership: LeagueMember | null;
  user: { name: string; avatar: string };
  authUserId: string;
  onSignOut: () => void;
  onProfileUpdate: (name: string, avatar: string) => void;
  onJoinLeague: () => void;
}) {
  const [subTab, setSubTab] = useState<ProfileSubTab>("stats");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState<DrawerSection>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState(user.name);
  const [savingName, setSavingName] = useState(false);
  const [pickingAvatar, setPickingAvatar] = useState(false);
  const [board, setBoard] = useState<LeaderboardEntry[]>([]);
  const [members, setMembers] = useState<(LeagueMember & { name: string; avatar: string })[]>([]);
  const [toggling, setToggling] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [myPickHistory, setMyPickHistory] = useState<DBPick[]>([]);
  const isCreator = league ? league.creator_id === authUserId : false;

  useEffect(() => {
    if (!league) return;
    getLeagueLeaderboard(league.id).then(setBoard);
    if (isCreator) getLeagueMembers(league.id).then(setMembers);
  }, [league?.id, isCreator]);

  useEffect(() => {
    getUserPicks(authUserId).then(setMyPickHistory);
  }, [authUserId]);

  const myRank = board.findIndex(p => p.user_id === authUserId) + 1;

  async function saveName() {
    if (!nameInput.trim() || nameInput.trim() === user.name) { setEditingName(false); return; }
    setSavingName(true);
    await upsertProfile(authUserId, nameInput.trim(), user.avatar);
    onProfileUpdate(nameInput.trim(), user.avatar);
    setSavingName(false);
    setEditingName(false);
  }

  async function saveAvatar(av: string) {
    await upsertProfile(authUserId, user.name, av);
    onProfileUpdate(user.name, av);
    setPickingAvatar(false);
  }

  function share() {
    if (!league) return;
    const text = `Join my ScoreVault league! Code: ${league.code}`;
    if (navigator.share) navigator.share({ title: "ScoreVault", text }).catch(() => {});
    else { navigator.clipboard.writeText(league.code); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  async function togglePaid(m: LeagueMember & { name: string; avatar: string }) {
    if (!league) return;
    setToggling(m.user_id);
    if (m.paid) await markMemberAsUnpaid(league.id, m.user_id);
    else        await markMemberAsPaid(league.id, m.user_id);
    const fresh = await getLeagueMembers(league.id);
    setMembers(fresh);
    setToggling(null);
  }

  const SUB_TABS: { id: ProfileSubTab; label: string }[] = [
    { id: "stats",  label: "Stats" },
    { id: "picks",  label: "My Picks" },
    { id: "badges", label: "Badges" },
    { id: "friends",label: "Friends" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: P.canvas, position: "relative" }}>

      {/* Hamburger drawer overlay */}
      {drawerOpen && (
        <div onClick={() => { setDrawerOpen(false); setDrawerSection(null); }} style={{ position: "absolute", inset: 0, zIndex: 50, background: "rgba(15,18,45,0.5)", backdropFilter: "blur(2px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: 0, left: 0, bottom: 0, width: 280, background: P.white, boxShadow: "4px 0 32px rgba(0,0,0,0.16)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
            <div style={{ padding: "20px 18px 12px", borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              {drawerSection && (
                <button onClick={() => setDrawerSection(null)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: P.muted, padding: 0, lineHeight: 1 }}>←</button>
              )}
              <div style={{ fontSize: 15, fontWeight: 900, color: P.ink }}>
                {drawerSection === "rules" ? "Game rules" : drawerSection === "settings" ? "Settings" : drawerSection === "ads" ? "Remove ads" : "Menu"}
              </div>
            </div>

            {/* Main menu items */}
            {!drawerSection && (
              <>
                {[
                  { icon: "⚙️", label: "Settings",    section: "settings" as DrawerSection },
                  { icon: "🚫", label: "Remove ads",  section: "ads"      as DrawerSection },
                  { icon: "📋", label: "Game rules",  section: "rules"    as DrawerSection },
                ].map(({ icon, label, section }) => (
                  <button key={label} onClick={() => setDrawerSection(section)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: P.ink, textAlign: "left", borderBottom: `1px solid ${P.border}` }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 18 }}>{icon}</span>{label}</span>
                    <span style={{ color: P.muted, fontSize: 16 }}>›</span>
                  </button>
                ))}
                <button onClick={() => { window.location.href = "mailto:hello@scorevault.io"; }} style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: 700, color: P.ink, borderBottom: `1px solid ${P.border}` }}>
                  <span style={{ fontSize: 18 }}>💬</span>Contact
                </button>
              </>
            )}

            {/* Game rules */}
            {drawerSection === "rules" && (
              <div style={{ padding: "12px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                {RULES.map(r => (
                  <div key={r.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginBottom: 3 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>{r.body}</div>
                    </div>
                  </div>
                ))}
                <div style={{ marginTop: 4, padding: "12px 14px", borderRadius: 12, background: P.blueBg, border: `1px solid ${P.border}` }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: P.blue, marginBottom: 4 }}>Pick value</div>
                  <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>Points are calculated from Polymarket odds snapshotted 15 min before kick-off. Rarer outcomes pay more.</div>
                </div>
              </div>
            )}

            {/* Settings */}
            {drawerSection === "settings" && (
              <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: P.ink, marginBottom: 4 }}>Account</div>
                <div style={{ background: P.gray, borderRadius: 12, padding: "12px 14px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: P.muted, marginBottom: 2 }}>Username</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: P.ink }}>Edit in Profile tab →</div>
                </div>
                <div style={{ fontSize: 13, fontWeight: 800, color: P.ink, marginTop: 8, marginBottom: 4 }}>Coming soon</div>
                {["Language", "Match alerts", "Club alerts", "Newsletter", "Payment settings"].map(s => (
                  <div key={s} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: P.gray, borderRadius: 10, opacity: 0.6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: P.ink }}>{s}</span>
                    <span style={{ fontSize: 10, color: P.muted, background: P.border, padding: "2px 6px", borderRadius: 4, fontWeight: 700 }}>SOON</span>
                  </div>
                ))}
                <button onClick={() => { setDrawerSection(null); setDrawerOpen(false); onSignOut(); }} style={{ marginTop: 16, padding: "12px 0", borderRadius: 12, border: `1px solid ${P.border}`, background: "none", color: P.red, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                  Delete account
                </button>
              </div>
            )}

            {/* Remove ads */}
            {drawerSection === "ads" && (
              <div style={{ padding: "24px 18px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" }}>
                <span style={{ fontSize: 40 }}>🚫</span>
                <div style={{ fontSize: 15, fontWeight: 800, color: P.ink }}>Remove ads</div>
                <div style={{ fontSize: 13, color: P.muted, lineHeight: 1.6 }}>Ad-free premium is coming with the v2 money layer. You&apos;ll be first to know.</div>
                <div style={{ padding: "6px 14px", borderRadius: 8, background: P.blueBg, fontSize: 11, fontWeight: 800, color: P.blue }}>COMING SOON</div>
              </div>
            )}

            <div style={{ flex: 1 }} />
            {!drawerSection && (
              <button onClick={() => { setDrawerOpen(false); setDrawerSection(null); onSignOut(); }} style={{ margin: "0 18px 24px", padding: "12px 0", borderRadius: 12, border: `1px solid ${P.border}`, background: "none", color: P.muted, fontSize: 13, cursor: "pointer" }}>
                Sign out
              </button>
            )}
          </div>
        </div>
      )}

      {/* Profile header */}
      <div style={{ background: P.white, borderBottom: `1px solid ${P.border}`, padding: "16px 16px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, position: "relative" }}>
        <button onClick={() => setDrawerOpen(true)} style={{ position: "absolute", top: 16, left: 16, width: 36, height: 36, borderRadius: 10, background: P.gray, border: "none", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4 }}>
          {[0,1,2].map(i => <span key={i} style={{ width: 16, height: 2, background: P.ink, borderRadius: 2, display: "block" }} />)}
        </button>

        <button onClick={() => setPickingAvatar(v => !v)} style={{ width: 64, height: 64, borderRadius: "50%", background: P.gray, border: `3px solid ${P.blue}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 30, boxShadow: "0 4px 16px rgba(0,0,0,0.14)", cursor: "pointer", position: "relative" }}>
          {user.avatar}
          <span style={{ position: "absolute", bottom: 0, right: 0, width: 18, height: 18, borderRadius: "50%", background: P.blue, color: "#fff", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center" }}>✏️</span>
        </button>

        {pickingAvatar && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, width: "100%" }}>
            {AVATARS.map(a => (
              <button key={a} onClick={() => saveAvatar(a)} style={{ fontSize: 26, padding: "9px 0", borderRadius: 10, cursor: "pointer", background: user.avatar === a ? P.blueBg : P.gray, border: `2px solid ${user.avatar === a ? P.blue : "transparent"}` }}>{a}</button>
            ))}
          </div>
        )}

        {editingName ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
            <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
              style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: `2px solid ${P.blue}`, fontSize: 15, fontWeight: 700, outline: "none", textAlign: "center" }} />
            <button onClick={saveName} disabled={savingName} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: P.blue, color: "#fff", fontWeight: 800, cursor: "pointer", fontSize: 13 }}>
              {savingName ? "…" : "Save"}
            </button>
          </div>
        ) : (
          <button onClick={() => { setNameInput(user.name); setEditingName(true); }} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 16, fontWeight: 900, color: P.ink }}>{user.name}</span>
            <span style={{ fontSize: 11, color: P.blue }}>✏️</span>
          </button>
        )}

        {myRank > 0 && <span style={{ fontSize: 11, color: P.blue, fontWeight: 700 }}>#{myRank} global · {board.length} players</span>}
      </div>

      {/* Sub-tab bar */}
      <div style={{ display: "flex", background: P.white, borderBottom: `1px solid ${P.border}`, flexShrink: 0 }}>
        {SUB_TABS.map(st => (
          <button key={st.id} onClick={() => setSubTab(st.id)} style={{
            flex: 1, padding: "10px 4px", border: "none", background: "none", cursor: "pointer",
            fontSize: 12, fontWeight: subTab === st.id ? 800 : 500,
            color: subTab === st.id ? P.blue : P.muted,
            borderBottom: `2px solid ${subTab === st.id ? P.blue : "transparent"}`,
            transition: "all 0.15s",
          }}>{st.label}</button>
        ))}
      </div>

      {/* Sub-tab content */}
      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto" }}>

        {subTab === "stats" && (
          <div style={{ padding: "12px 12px 32px", display: "flex", flexDirection: "column", gap: 12 }}>
            {/* Prize money */}
            <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, padding: "16px 16px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: P.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>Prize money</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: P.blue, background: P.blueBg, padding: "3px 8px", borderRadius: 5 }}>PLAY</span>
              </div>
              <div style={{ fontSize: 28, fontWeight: 900, color: P.ink }}>$0.00</div>
              <div style={{ fontSize: 11, color: P.muted, marginTop: 3 }}>Testnet — play money, not real cash</div>
            </div>

            {/* Stats grid */}
            <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden" }}>
              <div style={{ padding: "12px 16px 8px", borderBottom: `1px solid ${P.border}` }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: P.ink, letterSpacing: "0.04em" }}>MY STATS — WC 2026</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 0 }}>
                {[
                  { label: "Picks made",    value: myPickHistory.length },
                  { label: "Global rank",   value: myRank > 0 ? `#${myRank}` : "–" },
                  { label: "Correct picks", value: "–" },
                  { label: "Exact scores",  value: "–" },
                ].map(({ label, value }, i) => (
                  <div key={label} style={{ padding: "14px 16px", borderRight: i % 2 === 0 ? `1px solid ${P.border}` : "none", borderBottom: i < 2 ? `1px solid ${P.border}` : "none" }}>
                    <div style={{ fontSize: 20, fontWeight: 900, color: P.blue, marginBottom: 3 }}>{value}</div>
                    <div style={{ fontSize: 11, color: P.muted }}>{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* League info */}
            {league ? (
              <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${P.border}` }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: P.ink }}>{league.name}</div>
                    <div style={{ fontSize: 11, color: P.muted }}>Stake: {(league.stake_cents / 100).toFixed(0)}€ per player</div>
                  </div>
                  <div style={{ padding: "5px 11px", borderRadius: 8, background: P.blueBg, fontSize: 12, fontWeight: 900, color: P.blue }}>{league.code}</div>
                </div>
                <div style={{ padding: "10px 14px" }}>
                  <button onClick={share} style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: "none", background: P.blue, color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer" }}>
                    {copied ? "Copied!" : "+ Invite friends"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, padding: "16px 14px" }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: P.ink, marginBottom: 8 }}>No league yet</div>
                <button onClick={onJoinLeague} style={{ width: "100%", padding: "12px 0", borderRadius: 10, border: "none", background: P.blue, color: "#fff", fontSize: 14, fontWeight: 800, cursor: "pointer" }}>
                  Create or join a league →
                </button>
              </div>
            )}

            {/* Admin: payment management (creator only) */}
            {isCreator && (
              <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden" }}>
                <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${P.border}`, display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 14 }}>🔑</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: P.ink, letterSpacing: "0.04em" }}>PAYMENT ADMIN</span>
                </div>
                {members.length === 0 ? (
                  <div style={{ padding: "16px 14px", fontSize: 13, color: P.muted }}>No members yet.</div>
                ) : members.map(m => (
                  <div key={m.user_id} style={{ display: "flex", alignItems: "center", padding: "10px 14px", borderTop: `1px solid ${P.border}` }}>
                    <span style={{ fontSize: 22, marginRight: 10 }}>{m.avatar}</span>
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: P.ink }}>{m.name}</span>
                    <button onClick={() => togglePaid(m)} disabled={toggling === m.user_id} style={{ padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 800, background: m.paid ? P.greenBg : "rgba(17,17,17,0.08)", color: m.paid ? P.green : P.red, opacity: toggling === m.user_id ? 0.5 : 1 }}>
                      {toggling === m.user_id ? "…" : m.paid ? "✓ Paid" : "Mark paid"}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* How to play */}
            <div style={{ background: P.white, borderRadius: 16, border: `1px solid ${P.border}`, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${P.border}` }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: P.ink, letterSpacing: "0.04em" }}>HOW TO PLAY</span>
              </div>
              <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 12 }}>
                {RULES.map(r => (
                  <div key={r.title} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                    <span style={{ fontSize: 20, flexShrink: 0 }}>{r.icon}</span>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: P.ink, marginBottom: 1 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: P.muted, lineHeight: 1.5 }}>{r.body}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === "picks" && (
          <div style={{ padding: "12px 12px 32px", display: "flex", flexDirection: "column", gap: 8 }}>
            {myPickHistory.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 0", gap: 12, color: P.muted }}>
                <span style={{ fontSize: 40 }}>⚽</span>
                <span style={{ fontSize: 14, fontWeight: 600 }}>No picks yet</span>
              </div>
            ) : myPickHistory.map(p => {
              const meta = WC_META[p.match_id];
              return (
                <div key={p.match_id} style={{ background: P.white, borderRadius: 14, border: `1px solid ${P.border}`, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10 }}>
                  {meta && <span style={{ fontSize: 20 }}>{meta.home.flag} vs {meta.away.flag}</span>}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: P.ink }}>{meta ? `${meta.home.name} – ${meta.away.name}` : p.match_id}</div>
                    <div style={{ fontSize: 11, color: P.muted }}>Pick: {p.home_score} – {p.away_score}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {subTab === "badges" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px", gap: 12, color: P.muted }}>
            <span style={{ fontSize: 48 }}>🏅</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Badges coming soon</span>
          </div>
        )}

        {subTab === "friends" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 24px", gap: 12, color: P.muted }}>
            <span style={{ fontSize: 48 }}>👥</span>
            <span style={{ fontSize: 14, fontWeight: 600 }}>Friends coming soon</span>
          </div>
        )}

      </div>
    </div>
  );
}

// ── Onboarding ────────────────────────────────────────────────────────────────
const BG_FLOATS = [
  { emoji: "⚽", top: "8%",  left: "10%", delay: "0s",   size: 32, dur: "5.5s" },
  { emoji: "🏆", top: "14%", left: "78%", delay: "0.8s", size: 28, dur: "6.2s" },
  { emoji: "⭐", top: "62%", left: "88%", delay: "1.4s", size: 22, dur: "5.0s" },
  { emoji: "🎯", top: "74%", left: "6%",  delay: "2.1s", size: 24, dur: "6.8s" },
  { emoji: "⚽", top: "44%", left: "92%", delay: "0.4s", size: 18, dur: "4.8s" },
  { emoji: "🌟", top: "30%", left: "4%",  delay: "1.9s", size: 20, dur: "7.0s" },
  { emoji: "🏅", top: "86%", left: "55%", delay: "0.6s", size: 26, dur: "5.8s" },
];

function Onboarding({ onDone, suggestedName = "" }: { onDone: (name: string, avatar: string) => void; suggestedName?: string }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState(suggestedName);
  const [avatar, setAvatar] = useState(AVATARS[0]);
  const valid = name.trim().length >= 2;

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden", background: DARK_SCREEN, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>

      {BG_FLOATS.map((f, i) => (
        <span key={i} style={{ position: "absolute", top: f.top, left: f.left, fontSize: f.size, opacity: 0.12, pointerEvents: "none", userSelect: "none", animation: `sv-float ${f.dur} ease-in-out ${f.delay} infinite` }}>{f.emoji}</span>
      ))}

      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center" }}>

        <div style={{ position: "relative", marginBottom: 22 }}>
          <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", animation: "sv-pulse-ring 1.8s ease-out 0.6s infinite" }} />
          <div style={{ position: "absolute", inset: -18, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", animation: "sv-pulse-ring 1.8s ease-out 1.1s infinite" }} />
          <div style={{ width: 90, height: 90, borderRadius: 26, background: "rgba(255,255,255,0.15)", backdropFilter: "blur(12px)", border: "1.5px solid rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, animation: "sv-pop-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>⚽</div>
        </div>

        <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", margin: "0 0 6px", letterSpacing: "0.06em", textAlign: "center", animation: "sv-fade-up 0.5s ease 0.4s both" }}>SCOREVAULT</h1>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", margin: "0 0 32px", textAlign: "center", lineHeight: 1.65, animation: "sv-fade-up 0.5s ease 0.55s both" }}>
          {step === 1 ? "Predict scores · Climb the board · Win the pot" : `Let's go, ${name.trim()}! Pick your avatar`}
        </p>

        <div style={{ width: "100%", animation: "sv-fade-up 0.45s ease 0.65s both" }}>
          {step === 1 ? (
            <>
              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Your username (shown on the leaderboard)</label>
              <input
                autoFocus placeholder="ex: Vianney, Jules, Chacha…" value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && valid && setStep(2)}
                style={{ width: "100%", padding: "17px 20px", marginBottom: 12, borderRadius: 16, outline: "none", border: `2px solid ${valid ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.2)"}`, background: "rgba(255,255,255,0.12)", backdropFilter: "blur(8px)", fontSize: 18, fontWeight: 700, color: "#fff", transition: "border-color 0.2s" }}
              />
              <div style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
                <button onClick={() => valid && setStep(2)} disabled={!valid}
                  style={{ width: "100%", padding: 17, borderRadius: 16, border: "none", background: valid ? "#fff" : "rgba(255,255,255,0.18)", color: valid ? P.ink : "rgba(255,255,255,0.35)", fontSize: 15, fontWeight: 900, cursor: valid ? "pointer" : "default", transition: "all 0.2s" }}>
                  Continue →
                </button>
                {valid && <div style={{ position: "absolute", top: 0, left: 0, width: "40%", height: "100%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", animation: "sv-shine 1.6s ease 0.9s infinite", pointerEvents: "none" }} />}
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, width: "100%", marginBottom: 16 }}>
                {AVATARS.map(a => (
                  <button key={a} onClick={() => setAvatar(a)} style={{ fontSize: 34, padding: "13px 0", borderRadius: 14, cursor: "pointer", background: avatar === a ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.1)", border: `2px solid ${avatar === a ? "rgba(255,255,255,0.8)" : "rgba(255,255,255,0.15)"}`, transition: "all 0.15s", transform: avatar === a ? "scale(1.1)" : "scale(1)" }}>{a}</button>
                ))}
              </div>
              <div style={{ position: "relative", overflow: "hidden", borderRadius: 16 }}>
                <button onClick={() => onDone(name.trim(), avatar)}
                  style={{ width: "100%", padding: 17, borderRadius: 16, border: "none", background: "#fff", color: P.ink, fontSize: 15, fontWeight: 900, cursor: "pointer" }}>
                  Let&apos;s play! 🚀
                </button>
                <div style={{ position: "absolute", top: 0, left: 0, width: "40%", height: "100%", background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)", animation: "sv-shine 1.6s ease 0.3s infinite", pointerEvents: "none" }} />
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  );
}

// ── Bottom nav ────────────────────────────────────────────────────────────────
const TAB_TITLES: Record<Tab, string> = {
  picks: "My Picks", results: "Results", deposit: "Deposit", leagues: "My Leagues", profile: "Profile",
};

function BottomNav({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  type NavItem = { id: Tab; label: string; icon: React.JSX.Element; center?: boolean };
  const items: NavItem[] = [
    { id: "picks", label: "My Picks", icon: (
      <div style={{ width: 26, height: 22, borderRadius: 6, fontSize: 9, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", background: tab === "picks" ? P.blue : "#a8abba", color: "#fff" }}>1:1</div>
    )},
    { id: "results", label: "Results", icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab === "results" ? P.blue : "#9a9eaf"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
      </svg>
    )},
    { id: "deposit", label: "Deposit", center: true, icon: (
      <div style={{ width: 44, height: 44, borderRadius: 14, background: tab === "deposit" ? P.blue : `linear-gradient(145deg, #272727, ${P.blue})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 14px rgba(0,0,0,0.24)", marginTop: -10 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>
        </svg>
      </div>
    )},
    { id: "leagues", label: "Leagues", icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab === "leagues" ? P.blue : "#9a9eaf"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
        <path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>
        <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>
        <path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/>
      </svg>
    )},
    { id: "profile", label: "Profile", icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={tab === "profile" ? P.blue : "#9a9eaf"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    )},
  ];

  return (
    <nav style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", minHeight: 68, background: P.white, borderTop: `1px solid ${P.border}`, boxShadow: "0 -8px 24px rgba(38,45,82,0.06)", paddingBottom: "env(safe-area-inset-bottom, 0)", alignItems: "end" }}>
      {items.map(item => (
        <button key={item.id} onClick={() => setTab(item.id)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: item.center ? "flex-start" : "center",
          gap: item.center ? 2 : 4, border: "none", cursor: "pointer", background: "transparent",
          padding: item.center ? "4px 2px 8px" : "8px 2px",
          color: tab === item.id ? P.blue : "#9a9eaf",
          borderTop: item.center ? "none" : `3px solid ${tab === item.id ? P.blue : "transparent"}`,
          transition: "color 0.15s",
        }}>
          {item.icon}
          <span style={{ fontSize: 10, fontWeight: tab === item.id ? 700 : 500, lineHeight: 1, color: item.center ? (tab === "deposit" ? P.blue : P.muted) : undefined }}>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── InstallBanner ─────────────────────────────────────────────────────────────
function InstallBanner({ onDismiss }: { onDismiss: () => void }) {
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

  // iOS share icon SVG (box + arrow up)
  const ShareIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={P.blue} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  );
  // Android menu icon (⋮)
  const MenuIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill={P.blue} stroke="none">
      <circle cx="12" cy="5"  r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
    </svg>
  );

  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%",
      transform: "translateX(-50%)",
      width: "min(100vw, 430px)", zIndex: 998,
      animation: "sv-slide-up 0.5s cubic-bezier(0.34,1.46,0.64,1) forwards",
      paddingBottom: "env(safe-area-inset-bottom, 0)",
    }}>
      {/* main card */}
      <div style={{
        margin: "0 10px 10px",
        borderRadius: 20,
        background: P.white,
        boxShadow: "0 -2px 40px rgba(0,0,0,0.16), 0 0 0 1px rgba(0,0,0,0.06)",
        padding: "18px 18px 16px",
        position: "relative",
      }}>
        {/* × */}
        <button onClick={onDismiss} style={{
          position: "absolute", top: 12, right: 12,
          width: 28, height: 28, borderRadius: "50%",
          border: "none", background: P.gray,
          color: P.muted, fontSize: 18, lineHeight: 1,
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
        }}>×</button>

        {/* header row */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 13, flexShrink: 0,
            background: P.blue, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, boxShadow: "0 4px 14px rgba(0,0,0,0.24)",
          }}>⚽</div>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 800, color: P.ink }}>Add to Home Screen</p>
            <p style={{ margin: "2px 0 0", fontSize: 12, color: P.muted }}>Keep ScoreVault one tap away</p>
          </div>
        </div>

        {/* step */}
        <div style={{
          padding: "12px 14px", borderRadius: 12,
          background: P.blueBg, border: `1px solid ${P.border}`,
          display: "flex", alignItems: "center", gap: 10, marginBottom: 14,
        }}>
          <span style={{ animation: "sv-tap-pulse 1.4s ease-in-out infinite", display: "flex" }}>
            {isIOS ? ShareIcon : MenuIcon}
          </span>
          <span style={{ fontSize: 13, color: P.ink, lineHeight: 1.45 }}>
            {isIOS
              ? <><strong>Tap Share</strong> at the bottom, then <strong>"Add to Home Screen"</strong></>
              : <><strong>Tap ⋮ Menu</strong> in your browser, then <strong>"Add to Home Screen"</strong></>
            }
          </span>
        </div>

        {/* actions */}
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onDismiss} style={{
            flex: 1, padding: "11px 0", borderRadius: 10,
            border: `1px solid ${P.border}`, background: "none",
            color: P.muted, fontSize: 13, cursor: "pointer",
          }}>Maybe later</button>
          <button onClick={onDismiss} style={{
            flex: 2, padding: "11px 0", borderRadius: 10,
            border: "none", background: P.blue,
            color: "#fff", fontSize: 13, fontWeight: 800, cursor: "pointer",
          }}>Got it ✓</button>
        </div>
      </div>

      {/* bouncing arrow pointing at browser chrome below */}
      <div style={{
        textAlign: "center", fontSize: 20, color: P.blue,
        marginBottom: 6, lineHeight: 1,
        animation: "sv-bounce-down 1.1s ease-in-out infinite",
      }}>↓</div>
    </div>
  );
}

// ── PromoPopup ────────────────────────────────────────────────────────────────
function PromoPopup({ onDismiss, onDone }: { onDismiss: () => void; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");

  async function submit() {
    if (!email.includes("@") || status !== "idle") return;
    setStatus("loading");
    try {
      await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {}
    setStatus("done");
    setTimeout(onDone, 1600); // close after showing confirmation
  }

  return (
    <div
      onClick={onDismiss}
      style={{ position: "fixed", inset: 0, zIndex: 999, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, background: "rgba(15,18,45,0.62)", backdropFilter: "blur(4px)" }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ position: "relative", width: "100%", maxWidth: 340, borderRadius: 22, background: P.white, boxShadow: "0 32px 80px rgba(0,0,0,0.28), 0 0 0 1px rgba(0,0,0,0.06)", overflow: "hidden" }}
      >
        {/* gradient header */}
        <div style={{ background: DARK_SCREEN, padding: "26px 24px 20px" }}>
          <div style={{ fontSize: 8, fontWeight: 900, letterSpacing: "0.09em", color: P.ink, background: "#fff", width: "fit-content", padding: "5px 9px", borderRadius: 5, marginBottom: 14 }}>
            COMING SOON · WC2026
          </div>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🏟️</div>
          <h2 style={{ margin: "0 0 8px", fontFamily: "Impact, sans-serif", fontSize: 26, color: "#fff", letterSpacing: "0.02em", lineHeight: 1.1 }}>
            Win 2 seats<br />in NYC
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "rgba(255,255,255,0.72)", lineHeight: 1.5 }}>
            Right now ScoreVault is free — predict scores &amp; climb the board with your crew. <strong style={{ color: "#fff" }}>Soon you&apos;ll stake real money</strong> and play for keeps.
          </p>
        </div>

        {/* body */}
        <div style={{ padding: "18px 20px 20px" }}>
          {/* two pillars */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
            {[
              { icon: "👥", label: "Today", desc: "Track scores with friends, free" },
              { icon: "💰", label: "Soon", desc: "Stake USDC, win real prizes" },
            ].map(({ icon, label, desc }) => (
              <div key={label} style={{ padding: "12px 10px", borderRadius: 12, background: P.blueBg, border: `1px solid ${P.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>{icon}</div>
                <div style={{ fontSize: 11, fontWeight: 800, color: P.blue, marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 11, color: P.muted, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>

          <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 700, color: P.ink }}>
            Drop your email → enter the WC ticket draw &amp; be first to know when v2 drops
          </p>

          {status === "done" ? (
            <div style={{ padding: "14px 12px", borderRadius: 12, background: P.greenBg, border: "1px solid rgba(21,169,87,0.25)", textAlign: "center", fontSize: 13, fontWeight: 800, color: P.green }}>
              ✓ You&apos;re in — we&apos;ll be in touch!
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submit()}
                style={{ padding: "13px 14px", borderRadius: 10, border: `1px solid ${P.border}`, background: P.white, color: P.ink, fontSize: 14, outline: "none" }}
              />
              <button
                onClick={submit}
                disabled={!email.includes("@") || status === "loading"}
                style={{ padding: "13px 0", borderRadius: 10, border: "none", background: P.blue, color: "#fff", fontSize: 14, fontWeight: 800, cursor: email.includes("@") ? "pointer" : "default", opacity: email.includes("@") ? 1 : 0.55 }}
              >
                {status === "loading" ? "Joining…" : "I'm in →"}
              </button>
            </div>
          )}

          <button onClick={onDismiss} style={{ display: "block", width: "100%", marginTop: 10, padding: "8px 0", background: "none", border: "none", fontSize: 12, color: P.muted, cursor: "pointer" }}>
            Not now
          </button>
        </div>

        {/* X */}
        <button
          onClick={onDismiss}
          style={{ position: "absolute", top: 12, right: 12, width: 30, height: 30, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.22)", color: "#fff", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, lineHeight: 1 }}
        >
          ×
        </button>
      </div>
    </div>
  );
}

// ── Auth screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onGuest }: { onGuest: () => Promise<void> }) {
  const [loading, setLoading] = useState<"google" | "guest" | null>(null);
  const [error, setError]     = useState("");

  const redirect = typeof window !== "undefined" ? `${window.location.origin}/` : "";

  async function signInGoogle() {
    setLoading("google"); setError("");
    const { error: e } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirect } });
    if (e) { setError("Google sign-in failed. Try again."); setLoading(null); }
  }

  async function signInGuest() {
    setLoading("guest"); setError("");
    try {
      await onGuest();
    } catch {
      setError("Something went wrong. Try again.");
      setLoading(null);
    }
  }

  const GoogleIcon = (
    <svg width="20" height="20" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden", background: DARK_SCREEN, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
      {BG_FLOATS.map((f, i) => (
        <span key={i} style={{ position: "absolute", top: f.top, left: f.left, fontSize: f.size, opacity: 0.1, pointerEvents: "none", userSelect: "none", animation: `sv-float ${f.dur} ease-in-out ${f.delay} infinite` }}>{f.emoji}</span>
      ))}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ position: "relative", marginBottom: 22 }}>
          <div style={{ position: "absolute", inset: -8, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", animation: "sv-pulse-ring 1.8s ease-out 0.6s infinite" }} />
          <div style={{ position: "absolute", inset: -18, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", animation: "sv-pulse-ring 1.8s ease-out 1.1s infinite" }} />
          <div style={{ width: 90, height: 90, borderRadius: 26, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, animation: "sv-pop-in 0.7s cubic-bezier(0.34,1.56,0.64,1) both", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>⚽</div>
        </div>
        <h1 style={{ fontSize: 32, fontWeight: 900, color: "#fff", margin: "0 0 6px", letterSpacing: "0.06em", animation: "sv-fade-up 0.5s ease 0.3s both" }}>SCOREVAULT</h1>
        <p style={{ fontSize: 14, color: "rgba(255,255,255,0.6)", margin: "0 0 36px", textAlign: "center", lineHeight: 1.65, animation: "sv-fade-up 0.5s ease 0.45s both" }}>
          Predict scores · Climb the board · Win the pot
        </p>
        {error && <div style={{ width: "100%", marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.14)", color: "#fff", fontSize: 13 }}>{error}</div>}
        <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10, animation: "sv-fade-up 0.5s ease 0.55s both" }}>
          {/* Google */}
          <button onClick={signInGoogle} disabled={loading !== null} style={{ width: "100%", padding: "15px 20px", borderRadius: 14, border: "none", background: "#fff", color: "#1a1a1a", fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, opacity: loading && loading !== "google" ? 0.5 : 1 }}>
            {loading === "google" ? <span style={{ fontSize: 14 }}>Redirecting…</span> : <>{GoogleIcon}<span>Continue with Google</span></>}
          </button>
          {/* Guest */}
          <button onClick={signInGuest} disabled={loading !== null} style={{ width: "100%", padding: "12px 0", background: "none", border: "none", color: "rgba(255,255,255,0.45)", fontSize: 13, cursor: "pointer", textDecoration: "underline", opacity: loading && loading !== "guest" ? 0.5 : 1 }}>
            {loading === "guest" ? "Entering…" : "Browse without account →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── League screen ─────────────────────────────────────────────────────────────
function LeagueScreen({ userId, onJoined }: {
  userId: string;
  onJoined: (league: League, membership: LeagueMember) => void;
}) {
  const [step, setStep]             = useState<"choose" | "join" | "join-confirm" | "create" | "created">("choose");
  const [joinCode, setJoinCode]     = useState("");
  const [found, setFound]           = useState<League | null>(null);
  const [leagueName, setLeagueName] = useState("");
  const [stakeInput, setStakeInput] = useState("");
  const [createdLeague, setCreatedLeague] = useState<League | null>(null);
  const [copied, setCopied]         = useState(false);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");

  function genCode(name: string) {
    const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SV";
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const suffix = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${prefix}-${suffix}`;
  }

  async function lookup() {
    if (!joinCode.trim()) return;
    setLoading(true); setError("");
    const lg = await getLeagueByCode(joinCode);
    setLoading(false);
    if (lg) { setFound(lg); setStep("join-confirm"); }
    else { setError("No league found with this code. Ask your friend to check."); }
  }

  async function join() {
    if (!found) return;
    setLoading(true);
    await joinLeague(found.id, userId);
    localStorage.setItem("sv_league_code", found.code);
    const mem = await getMyMembership(found.id, userId);
    onJoined(found, mem ?? { league_id: found.id, user_id: userId, paid: false, paid_at: null, joined_at: new Date().toISOString() });
  }

  async function create() {
    if (!leagueName.trim()) return;
    setLoading(true); setError("");
    let attempts = 0;
    while (attempts < 5) {
      const code = genCode(leagueName);
      try {
        const cents = Math.round(parseFloat(stakeInput || "0") * 100);
        const lg = await createLeague(code, leagueName.trim(), cents, userId);
        localStorage.setItem("sv_league_code", lg.code);
        setCreatedLeague(lg);
        setStep("created");
        setLoading(false);
        return;
      } catch { attempts++; }
    }
    setError("Something went wrong. Try again.");
    setLoading(false);
  }

  async function enterCreated() {
    if (!createdLeague) return;
    const mem = await getMyMembership(createdLeague.id, userId);
    onJoined(createdLeague, mem ?? { league_id: createdLeague.id, user_id: userId, paid: true, paid_at: new Date().toISOString(), joined_at: new Date().toISOString() });
  }

  const inputSt = { width: "100%", padding: "16px 18px", borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.25)", background: "rgba(255,255,255,0.12)", color: "#fff", fontSize: 16, fontWeight: 700, outline: "none" } as const;
  const btnSt   = { width: "100%", padding: 16, borderRadius: 14, border: "none", background: "#fff", color: P.ink, fontSize: 15, fontWeight: 900, cursor: "pointer" } as const;
  const back    = (s: "choose") => <button onClick={() => { setStep(s); setError(""); setFound(null); }} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 13, cursor: "pointer", textAlign: "center" as const, padding: "8px 0" }}>← Back</button>;

  return (
    <div style={{ height: "100%", position: "relative", overflow: "hidden", background: DARK_SCREEN, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px" }}>
      {BG_FLOATS.map((f, i) => (
        <span key={i} style={{ position: "absolute", top: f.top, left: f.left, fontSize: f.size, opacity: 0.08, pointerEvents: "none", userSelect: "none", animation: `sv-float ${f.dur} ease-in-out ${f.delay} infinite` }}>{f.emoji}</span>
      ))}
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 360 }}>
        {error && <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "rgba(255,255,255,0.14)", color: "#fff", fontSize: 13 }}>{error}</div>}

        {step === "choose" && (
          <>
            <div style={{ textAlign: "center", fontSize: 42, marginBottom: 12 }}>🏆</div>
            <h2 style={{ fontSize: 24, fontWeight: 900, color: "#fff", margin: "0 0 8px", textAlign: "center" }}>Your league</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", textAlign: "center", margin: "0 0 32px", lineHeight: 1.55 }}>Got a code from a friend, or starting a new league?</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <button style={btnSt} onClick={() => setStep("join")}>
                🔗 Join a league
              </button>
              <button
                onClick={() => setStep("create")}
                style={{ width: "100%", padding: 16, borderRadius: 14, border: "1.5px solid rgba(255,255,255,0.35)", background: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 15, fontWeight: 900, cursor: "pointer" }}
              >
                ✨ Create my league
              </button>
            </div>
          </>
        )}

        {step === "join" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: "0 0 6px", textAlign: "center" }}>Join a league</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", textAlign: "center", margin: "0 0 18px" }}>Enter the code your friend shared with you.</p>
            <input style={{ ...inputSt, textTransform: "uppercase", letterSpacing: "0.12em" }} placeholder="LEAGUE CODE" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())} onKeyDown={e => e.key === "Enter" && lookup()} autoFocus />
            <button style={btnSt} onClick={lookup} disabled={!joinCode.trim() || loading}>{loading ? "Searching…" : "Find league →"}</button>
            {back("choose")}
          </div>
        )}

        {step === "join-confirm" && found && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: "0 0 16px", textAlign: "center" }}>League found!</h2>
            <div style={{ padding: "16px 18px", borderRadius: 14, background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.22)", marginBottom: 6 }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>League</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#fff" }}>{found.name}</div>
              <div style={{ fontSize: 14, color: "rgba(255,255,255,0.75)", marginTop: 6 }}>Stake: <strong style={{ color: "#fff" }}>{(found.stake_cents / 100).toFixed(0)}€</strong> per player</div>
            </div>
            <button style={btnSt} onClick={join} disabled={loading}>{loading ? "Joining…" : "Join this league →"}</button>
            {back("choose")}
          </div>
        )}

        {step === "create" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: "0 0 6px", textAlign: "center" }}>Create my league</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", textAlign: "center", margin: "0 0 18px", lineHeight: 1.5 }}>Name your league and set the stake. We generate the code automatically.</p>
            <input style={inputSt} placeholder="League name (e.g. The Crew)" value={leagueName} onChange={e => setLeagueName(e.target.value)} onKeyDown={e => e.key === "Enter" && create()} autoFocus />
            <input style={inputSt} type="number" placeholder="Stake per player (€)" value={stakeInput} onChange={e => setStakeInput(e.target.value)} />
            <button style={btnSt} onClick={create} disabled={!leagueName.trim() || loading}>{loading ? "Creating…" : "Create my league →"}</button>
            {back("choose")}
          </div>
        )}

        {step === "created" && createdLeague && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
            <div style={{ fontSize: 44, animation: "sv-pop-in 0.6s cubic-bezier(0.34,1.56,0.64,1) both" }}>🎉</div>
            <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: 0, textAlign: "center" }}>{createdLeague.name}</h2>
            <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", textAlign: "center", margin: 0 }}>
              Share this code with your crew:
            </p>
            <div
              onClick={() => { navigator.clipboard.writeText(createdLeague.code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "18px 24px", borderRadius: 16, background: "rgba(255,255,255,0.15)", border: "1.5px solid rgba(255,255,255,0.3)", cursor: "pointer", width: "100%" }}
            >
              <span style={{ fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: "0.12em", fontFamily: "monospace" }}>{createdLeague.code}</span>
              <span style={{ fontSize: 18 }}>{copied ? "✅" : "📋"}</span>
            </div>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", textAlign: "center", margin: 0 }}>
              Stake: {(createdLeague.stake_cents / 100).toFixed(0)}€ · Tap the code to copy
            </p>
            <button style={{ ...btnSt, marginTop: 4 }} onClick={enterCreated}>Enter my league →</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pending payment screen ────────────────────────────────────────────────────
function PendingPaymentScreen({ league, onRefresh, onSignOut }: {
  league: League;
  onRefresh: () => void;
  onSignOut: () => void;
}) {
  const [checking, setChecking] = useState(false);
  async function check() { setChecking(true); await onRefresh(); setChecking(false); }
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "32px 24px", background: DARK_SCREEN }}>
      <div style={{ fontSize: 52, marginBottom: 16 }}>⏳</div>
      <h2 style={{ fontSize: 22, fontWeight: 900, color: "#fff", margin: "0 0 10px", textAlign: "center" }}>Waiting for payment confirmation</h2>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.65)", textAlign: "center", lineHeight: 1.65, margin: "0 0 8px" }}>
        League: <strong style={{ color: "#fff" }}>{league.name}</strong><br />
        Stake: <strong style={{ color: "#fff" }}>{(league.stake_cents / 100).toFixed(0)}€</strong>
      </p>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.55)", textAlign: "center", lineHeight: 1.6, margin: "0 0 32px" }}>
        Transfer your stake to the league organiser (bank transfer, cash, Lydia…). Once confirmed, they&apos;ll unlock your access.
      </p>
      <button onClick={check} disabled={checking} style={{ width: "100%", maxWidth: 320, padding: "15px 0", borderRadius: 14, border: "none", background: "#fff", color: P.ink, fontSize: 15, fontWeight: 900, cursor: "pointer", marginBottom: 12 }}>
        {checking ? "Checking…" : "I've paid — check again"}
      </button>
      <button onClick={onSignOut} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.4)", fontSize: 12, cursor: "pointer" }}>Sign out</button>
    </div>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
type AppScreen = "loading" | "auth" | "profile_setup" | "app";

export default function App() {
  const [screen, setScreen]         = useState<AppScreen>("loading");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [profile, setProfile]       = useState<{ name: string; avatar: string } | null>(null);
  const [league, setLeague]         = useState<League | null>(null);
  const [membership, setMembership] = useState<LeagueMember | null>(null);
  const [suggestedName, setSuggestedName] = useState("");
  const [tab, setTab]               = useState<Tab>("picks");
  const [showPromo, setShowPromo]   = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [showLeagueSetup, setShowLeagueSetup] = useState(false);

  const advance = useCallback(async (uid: string) => {
    try {
      const p = await getProfile(uid);
      if (!p) { setScreen("profile_setup"); return; }
      setProfile({ name: p.name, avatar: p.avatar });

      // Silently load saved league — not required to enter the app
      const savedCode = (() => { try { return localStorage.getItem("sv_league_code"); } catch { return null; } })();
      if (savedCode) {
        const lg = await getLeagueByCode(savedCode);
        if (lg) {
          setLeague(lg);
          let mem = await getMyMembership(lg.id, uid);
          if (!mem) { await joinLeague(lg.id, uid); mem = await getMyMembership(lg.id, uid); }
          setMembership(mem);
        }
      }

      setScreen("app");
      try {
        if (!localStorage.getItem("sv_promo_done")) {
          const snoozed = localStorage.getItem("sv_promo_snoozed");
          const elapsed = snoozed ? Date.now() - parseInt(snoozed) : Infinity;
          if (elapsed > 24 * 3600 * 1000) setShowPromo(true);
        }
      } catch {}
    } catch {
      setScreen("auth");
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    async function handleSession(session: Session | null) {
      if (!mounted) return;
      if (!session?.user) {
        setAuthUserId(null);
        setScreen("auth");
        return;
      }

      setAuthUserId(session.user.id);
      // Pre-fill username from Google OAuth metadata
      const meta = session.user.user_metadata;
      const oauthName = meta?.full_name || meta?.name || "";
      if (oauthName) setSuggestedName(oauthName.split(" ")[0]); // first name only
      await advance(session.user.id);
    }

    supabase.auth.getSession().then(({ data }) => {
      void handleSession(data.session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      await handleSession(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [advance]);

  useEffect(() => {
    if (screen !== "app") return;
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isStandalone) return;
    try { if (localStorage.getItem("sv_install_seen")) return; } catch {}
    const t = setTimeout(() => setShowInstall(true), 5000);
    return () => clearTimeout(t);
  }, [screen]);

  function dismissPromo()     { try { localStorage.setItem("sv_promo_snoozed", Date.now().toString()); } catch {} setShowPromo(false); }
  function dismissPromoDone() { try { localStorage.setItem("sv_promo_done", "1"); } catch {} setShowPromo(false); }
  function dismissInstall()   { try { localStorage.setItem("sv_install_seen", "1"); } catch {} setShowInstall(false); }

  async function doSignOut() {
    try { localStorage.removeItem("sv_league_code"); } catch {}
    await signOut();
    setProfile(null); setLeague(null); setMembership(null);
    setScreen("auth");
  }

  const Wrapper = ({ children, full = false }: { children: React.ReactNode; full?: boolean }) => (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: full ? "#050505" : P.bg }}>
      <div style={{ height: "min(100dvh, 932px)", width: "min(100vw, 430px)", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );

  if (screen === "loading")       return null;
  if (screen === "auth")          return <Wrapper full><AuthScreen onGuest={async () => { const { error } = await supabase.auth.signInAnonymously(); if (error) throw error; }} /></Wrapper>;
  if (screen === "profile_setup") return <Wrapper full><Onboarding suggestedName={suggestedName} onDone={async (name, avatar) => { if (!authUserId) return; await upsertProfile(authUserId, name, avatar); setProfile({ name, avatar }); await advance(authUserId); }} /></Wrapper>;

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", placeItems: "center", background: P.bg }}>
      <div style={{ position: "relative", display: "flex", flexDirection: "column", width: "min(100vw, 430px)", height: "min(100dvh, 932px)", overflow: "hidden", background: P.canvas, boxShadow: "0 28px 90px rgba(0,0,0,0.28), 0 0 0 1px rgba(255,255,255,0.10)" }}>
        {/* Top bar — hidden on Profile (it has its own header with hamburger) */}
        {tab !== "profile" && (
          <header style={{ display: "grid", gridTemplateColumns: "1fr", alignItems: "center", minHeight: 56, padding: "max(0px,env(safe-area-inset-top)) 16px 0", background: P.white, borderBottom: `1px solid ${P.border}`, boxShadow: "0 4px 18px rgba(32,39,78,0.04)", flexShrink: 0 }}>
            <h1 style={{ margin: 0, textAlign: "center", fontSize: 16, fontWeight: 800, color: P.ink, letterSpacing: "-0.02em" }}>{TAB_TITLES[tab]}</h1>
          </header>
        )}
        <main style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab === "picks"   && <PicksTab userId={authUserId} onShowLeagueSetup={() => setShowLeagueSetup(true)} />}
          {tab === "results" && <ResultsTab userId={authUserId} />}
          {tab === "deposit" && <DepositTab />}
          {tab === "leagues" && <MyLeaguesTab league={league} user={profile!} authUserId={authUserId!} onNewLeague={() => setShowLeagueSetup(true)} />}
          {tab === "profile" && <ProfileTab league={league} membership={membership} user={profile!} authUserId={authUserId!} onSignOut={doSignOut} onProfileUpdate={(name, avatar) => setProfile({ name, avatar })} onJoinLeague={() => { setShowLeagueSetup(true); }} />}
        </main>
        <BottomNav tab={tab} setTab={setTab} />

        {/* League setup overlay — accessible from within the app */}
        {showLeagueSetup && (
          <div style={{ position: "absolute", inset: 0, zIndex: 40, background: DARK_SCREEN, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "max(env(safe-area-inset-top),14px) 16px 0", display: "flex", alignItems: "center" }}>
              <button onClick={() => setShowLeagueSetup(false)} style={{ background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", borderRadius: 20, padding: "7px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>← Back</button>
            </div>
            <div style={{ flex: 1 }}>
              <LeagueScreen userId={authUserId!} onJoined={(lg, mem) => {
                setLeague(lg);
                setMembership(mem);
                setShowLeagueSetup(false);
              }} />
            </div>
          </div>
        )}
      </div>
      {showPromo && <PromoPopup onDismiss={dismissPromo} onDone={dismissPromoDone} />}
      {showInstall && !showPromo && <InstallBanner onDismiss={dismissInstall} />}
    </div>
  );
}
