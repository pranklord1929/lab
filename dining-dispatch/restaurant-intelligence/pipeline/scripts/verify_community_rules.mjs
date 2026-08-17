#!/usr/bin/env node

import { readFileSync } from 'node:fs';

const rules = JSON.parse(readFileSync('shared/community-rules.json', 'utf8'));
const swift = readFileSync('ios/TheDiningDispatch/Models.swift', 'utf8');
const typescript = readFileSync('web/src/lib/community.ts', 'utf8');

const checks = [
  ['Swift topics', swift, rules.topics],
  ['Swift meal times', swift, rules.mealTimes],
  ['Swift companies', swift, rules.companies],
  ['Swift report reasons', swift, rules.reportReasons],
  ['TypeScript topics', typescript, rules.topics],
  ['TypeScript meal times', typescript, rules.mealTimes],
  ['TypeScript companies', typescript, rules.companies],
  ['TypeScript reactions', typescript, rules.reactionTypes],
  ['TypeScript report reasons', typescript, rules.reportReasons],
];

let failed = 0;
for (const [label, source, values] of checks) {
  const missing = values.filter((value) => !source.includes(`"${value}"`) && !source.includes(`'${value}'`));
  if (missing.length) {
    failed++;
    console.error(`FAIL ${label}: missing ${missing.join(', ')}`);
  } else {
    console.log(`OK   ${label}`);
  }
}

const missingSwiftReactions = rules.reactionTypes.filter((value) => !(new RegExp(`\\b${value}\\b`)).test(swift));
if (missingSwiftReactions.length) {
  failed++;
  console.error(`FAIL Swift reactions: missing ${missingSwiftReactions.join(', ')}`);
} else {
  console.log('OK   Swift reactions');
}

// Vérifier la présence ne suffit pas : le vocabulaire hérité a survécu à la
// décision Phase 0 précisément parce qu'un client pouvait ajouter la nouvelle
// valeur sans retirer l'ancienne. On refuse aussi ce qui doit avoir disparu.
const retired = rules.retiredReactionTypes ?? [];
for (const [label, source] of [['Swift', swift], ['TypeScript', typescript]]) {
  const survivors = retired.filter((value) => (new RegExp(`['"]${value}['"]`)).test(source));
  if (survivors.length) {
    failed++;
    console.error(`FAIL ${label} retired reactions still present: ${survivors.join(', ')}`);
  } else {
    console.log(`OK   ${label} retired reactions absent`);
  }
}

const quickLimitsPresent = swift.includes(`length < ${rules.quickSignal.minCharacters}`)
  && swift.includes(`length > ${rules.quickSignal.maxCharacters}`);
if (!quickLimitsPresent) {
  failed++;
  console.error('FAIL Swift Quick Signal limits do not match shared rules');
} else {
  console.log('OK   Swift Quick Signal limits');
}

process.exit(failed ? 1 : 0);
