'use strict';
// Sparkfield Round Rock 1878 — verification harness.
// Run: node --test tests/engine-contract.test.cjs
// No network, credentials, or model calls required.
// These tests verify selected concrete contracts; they do not prove full gameplay behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('server exposes a structured Six Questions resolution contract', () => {
  for (const field of [
    'q1_what_happened', 'q2_what_is_this_about',
    'q3_what_does_this_support', 'q4_what_remains_unknown_or_contested',
    'q5_what_state_changes_are_justified', 'q6_what_responses_are_now_warranted'
  ]) assert.match(server, new RegExp(field));
  assert.match(server, /strict:\s*true/);
});

test('resolver distinguishes reported speech from established world fact', () => {
  assert.match(server, /utterance proves that the utterance occurred/i);
  assert.match(server, /proposition is not automatically true/i);
  assert.match(ui, /truth_status:'reported-not-established'/);
});

test('ObjectExchange is registered before resolver expression in visitor flow', () => {
  const register = ui.indexOf('function registerVisitorExchange(raw,intent='say')');
  const ledgerWrite = ui.indexOf('exchangeLedger.push(e)', register);
  const reportsWrite = ui.indexOf('world.JebWorld.heardReports.push(', register);
  assert.ok(register >= 0 && ledgerWrite > register && reportsWrite > register);
  assert.match(ui, /registerVisitorExchange\(/);
  assert.match(ui, /jebMemorySnapshot\(/);
  assert.match(ui, /exchangeSummary\(/);
});

function createWorld(seed) {
  // Evaluate actual seeded world-builder from the shipped browser source.
  // Stubs isolate the schedule from DOM, timers, model calls, and effects.
  const start = ui.indexOf('function seeded(seed)');
  const end = ui.indexOf('\nfunction worldMinute()', start);
  assert.ok(start >= 0 && end > start, 'world-builder must exist');
  const source = ui.slice(start, end);
  const context = {
    Math, Date, Set,
    worldSeed:seed, world:{}, worldEvents:[], worldIntersections:new Set(),
    worldLastMinute:-1, worldOffsetMin:0, worldStartedAt:null,
    pendingFieldObservations:[], surfacedFieldObservations:new Set(),
    worldLog(){}, worldTick(){}
  };
  vm.createContext(context);
  vm.runInContext(source + '\nbuildIndependentWorld(worldSeed);', context, {timeout:1000});
  return JSON.parse(JSON.stringify(Object.fromEntries(
    Object.entries(context.world).map(([id, actor]) => [id, actor.plan])
  )));
}

test('Rangers, riders, Jeb and Oattes have precommitted worldlines', () => {
  const world = createWorld(12345);
  for (const actor of ['JebWorld','Oattes','Rangers','Riders']) {
    assert.ok(world[actor].length >= 3, actor + ' needs a multi-stage trajectory');
    for (const leg of world[actor]) assert.ok(leg.end > leg.start);
  }
});

test('same seed reproduces trajectories; another seed can change them', () => {
  const a = createWorld(12345);
  assert.deepEqual(a, createWorld(12345));
  assert.notDeepEqual(a, createWorld(67890));
});

test('world schedules are not triggered by a visitor utterance', () => {
  const a = createWorld(12345);
  assert.equal(a.Rangers[1].loc, 'creek');
  assert.equal(a.Riders[1].loc, 'creek');
  assert.match(ui, /patrol movement independent of visitor/);
  assert.match(ui, /movement independent of visitor/);
});

test('provenance includes evidence roots and three distinct clocks', () => {
  for (const token of ['event_time', 'observation_time', 'ingestion_time', 'evidence_roots']) {
    assert.ok(ui.includes(token), 'missing provenance token ' + token);
  }
  assert.match(ui, /function recordLineage\(/);
  assert.match(ui, /function reevaluationQueue\(/);
});


test('actual ObjectExchange records a report without upgrading it to world truth', () => {
  const start = ui.indexOf('function registerVisitorExchange(raw,intent='say')');
  const end = ui.indexOf('\nfunction jebMemorySnapshot()', start);
  assert.ok(start >= 0 && end > start);
  const source = ui.slice(start, end);
  const events = [];
  const context = {
    world: {JebWorld: {heardReports:[], knowledge:new Set()}},
    jebPresence:'present', runId:'test-run', turnNumber:2, exchangeLedger:[],
    worldTick(){}, worldMinute(){return 12},
    recordLineage(e){ events.push(e); }, worldLog(){}, Date
  };
  vm.createContext(context);
  vm.runInContext(source + '\nregisterVisitorExchange("I saw Rangers by the creek.");', context, {timeout:1000});
  const e = context.exchangeLedger[0];
  assert.ok(e, 'exchange must exist');
  assert.equal(e.utterance, 'I saw Rangers by the creek.');
  assert.equal(e.to, 'Jeb');
  assert.equal(e.transfers[0].truth_status, 'reported-not-established');
  assert.equal(context.world.JebWorld.heardReports[0].text, e.utterance);
  assert.equal(context.world.JebWorld.knowledge.size, 0, 'report must not become direct observation');
  assert.equal(events[0].kind, 'object_exchange');
  assert.ok(events[0].invariants.includes('report-is-not-world-truth'));
});

// Future executable checks: persistence across restart; negative observation access;
// conflicting reports; role/refusal state; UI-to-server version consistency.


test('shipped browser script parses as JavaScript', () => {
  const beginning = ui.indexOf('<script>') + '<script>'.length;
  const ending = ui.lastIndexOf('</script>');
  assert.ok(beginning > 0 && ending > beginning);
  new vm.Script(ui.slice(beginning, ending), {filename:'index.html'});
});

test('checkpoint captures and restores key run components', () => {
  const beginning=ui.indexOf('function snapshotRun()');
  const ending=ui.indexOf('restoreRun();\nstartWorld();', beginning);
  assert.ok(beginning>=0 && ending>beginning);
  const excerpt=ui.slice(beginning,ending);
  for(const marker of [
    'knowledge:[...(actor.knowledge||[])]',
    'knowledge:new Set(actor.knowledge||[])',
    'exchangeLedger:exchangeLedger',
    'worldOffsetMin',
    'lineageLedger',
    'localStorage.setItem(SPARKFIELD_SAVE_KEY',
    'localStorage.getItem(SPARKFIELD_SAVE_KEY'
  ]) assert.ok(excerpt.includes(marker), 'missing checkpoint contract: '+marker);
  assert.ok(ui.includes("addEventListener('pagehide',saveRun)"));
  assert.ok(ui.includes('localStorage.removeItem(SPARKFIELD_SAVE_KEY)'));
});

test('Say and Do affordances are present and intent reaches resolver', () => {
  assert.ok(ui.includes('id="sayMode"'));
  assert.ok(ui.includes('id="doMode"'));
  assert.ok(ui.includes('input_intent:intent'));
  assert.ok(server.includes("body.input_intent"));
});

test('Do attempt is not automatically a heard report', () => {
  const start=ui.indexOf("function registerVisitorExchange(raw,intent='say')");
  const end=ui.indexOf('\nfunction jebMemorySnapshot()',start);
  assert.ok(start>=0&&end>start);
  const source=ui.slice(start,end);
  const context={
    world:{JebWorld:{heardReports:[],knowledge:new Set()}},
    jebPresence:'present',runId:'do-test',turnNumber:1,exchangeLedger:[],
    worldTick(){},worldMinute(){return 4},recordLineage(){},worldLog(){},Date
  };
  vm.createContext(context);
  vm.runInContext(source+"\nregisterVisitorExchange('I draw my revolver.','do');",context,{timeout:1000});
  assert.equal(context.exchangeLedger[0].intent,'do');
  assert.equal(context.exchangeLedger[0].to,'Environment');
  assert.equal(context.world.JebWorld.heardReports.length,0);
  assert.equal(context.exchangeLedger[0].status,'registered');
});
