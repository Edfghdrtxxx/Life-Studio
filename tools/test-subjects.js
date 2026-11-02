#!/usr/bin/env node
/* Life Studio subjects: the registry, tag parsing and PGRE.cardSubject
   precedence (card.subject wins, user-<tag>- falls back, everything else is
   physics). Run: node tools/test-subjects.js */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.resolve(__dirname, '..');
var sandbox = { console: console, window: {} };
sandbox.window.PGRE = {};
sandbox.PGRE = sandbox.window.PGRE;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'js', 'subjects.js'), 'utf8'), sandbox);
var PGRE = sandbox.PGRE;

var passed = 0;
var failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; console.log('  ok  — ' + msg); }
  else { failed++; console.log('  FAIL — ' + msg); }
}

assert(PGRE.SUBJECTS.length === 5, 'five subjects ship');
assert(PGRE.SUBJECTS[0].id === 'physics', 'physics is the first (inherited) subject');
assert(PGRE.subjectById('english').name === 'English usage and grammar',
  'subjectById finds by id');
assert(PGRE.subjectById('cs').name === 'Basic Computer Science',
  'computer science subject exists');
assert(PGRE.subjectById('vocab').tag === 'vocab', 'subjectById finds by tag');
assert(PGRE.subjectById('nope') === null, 'unknown subject -> null');
assert(PGRE.subjectName('english') === 'English usage and grammar', 'subjectName resolves');
assert(PGRE.subjectName('nope') === 'nope', 'subjectName falls back to the id itself');
assert(PGRE.subjectName(undefined) === 'Physics', 'missing subject falls back to Physics');

assert(PGRE.cardSubject({ id: 'cpgf-1.01' }) === 'physics', 'a book card is physics');
assert(PGRE.cardSubject({ id: 'cpgl-3.02' }) === 'physics', 'a recall-list card is physics');
assert(PGRE.cardSubject({ id: 'supp-abc' }) === 'physics', 'a supplemental card is physics');
assert(PGRE.cardSubject({ id: 'user-english-3' }) === 'english',
  'a user card resolves its subject from the id tag');
assert(PGRE.cardSubject({ id: 'user-nuclear-1' }) === 'nuclear', 'nuclear tag parses');
assert(PGRE.cardSubject({ id: 'user-zzz-1' }) === 'physics',
  'an unrecognized user- tag is physics');
assert(PGRE.cardSubject({ id: 'user-english-3', subject: 'vocab' }) === 'vocab',
  'an explicit subject field wins over the id tag');
assert(PGRE.cardSubject({ id: 'x', subject: 'bogus' }) === 'physics',
  'an invalid subject field is ignored');
assert(PGRE.cardSubject(null) === 'physics', 'a null card is physics');
assert(PGRE.cardSubject({}) === 'physics', 'a card with no id is physics');

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
