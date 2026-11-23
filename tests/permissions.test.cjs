const { before, after, test } = require('node:test');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { createHash } = require('node:crypto');
const { initializeTestEnvironment, assertSucceeds, assertFails } = require('@firebase/rules-unit-testing');

const projectId = 'demo-checkformation';
const rules = readFileSync(join(__dirname, '..', 'database.rules.json'), 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
let env;

function account(id, role, mailbox = 'equipe@example.test') {
  const key = 'id_' + id;
  const uid = 'test-' + id;
  const email = id + '@example.test';
  const loginHash = hash(id);
  const mailHash = hash(mailbox);
  const fields = {id, role, login:id, name:id, on:true, authUid:uid, authEmail:email, email:mailbox, loginHash, mailHash};
  if (role === 'op') fields.depts = ['d1'];
  const changes = {
    ['members/' + uid]:key,
    ['logins/' + loginHash]:{key, email},
    ['mailboxes/' + mailHash + '/' + loginHash]:email
  };
  for (const [field, value] of Object.entries(fields)) changes['users/' + key + '/' + field] = value;
  return {key, uid, fields, changes};
}

const senior = account('senior-de-teste', 'senior');
const supervisor = account('supervisor-de-teste', 'supervisor');
const operator = account('operador-de-teste', 'op');
function db(person) {
  const token = {firebase:{sign_in_provider:'password', identities:{}}};
  return env.authenticatedContext(person.uid, token).database();
}

before(async () => {
  if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== '127.0.0.1:9000') {
    throw new Error('Execute estes testes com o emulador local na porta 9000.');
  }
  env = await initializeTestEnvironment({projectId, database:{host:'127.0.0.1', port:9000, rules}});
  await env.withSecurityRulesDisabled(async ctx => {
    await ctx.database().ref().update({...senior.changes, ...supervisor.changes, ...operator.changes});
  });
});
after(async () => { if (env) await env.cleanup(); });

test('sênior cadastra os três perfis com login e recuperação associados', async () => {
  for (const role of ['op','supervisor','senior']) {
    const person = account('novo-' + role, role);
    await assertSucceeds(db(senior).ref().update(person.changes));
    await assertSucceeds(db(person).ref('tasks').once('value'));
  }
});

test('supervisor cria operadores e gerencia tarefas e dados operacionais', async () => {
  const person = account('novo-operacional', 'op');
  const database = db(supervisor);
  await assertSucceeds(database.ref().update(person.changes));
  await assertSucceeds(database.ref('users/' + person.key + '/on').set(false));
  await assertSucceeds(database.ref('tasks/tarefa-de-teste').set({id:1, title:'Tarefa de teste', dept:'d1', on:true}));
  await assertSucceeds(database.ref('cats').set(['Rotina']));
  await assertSucceeds(database.ref('records/registro-de-teste').set({id:1, dept:'d1', title:'Tarefa de teste'}));
  await assertSucceeds(database.ref('records/registro-de-teste').remove());
});

test('somente sênior cria perfis de gestão e configura departamentos', async () => {
  for (const role of ['supervisor','senior']) {
    await assertFails(db(supervisor).ref().update(account('perfil-restrito-' + role, role).changes));
  }
  await assertFails(db(supervisor).ref('depts/d2').set({id:'d2',name:'Teste',on:true}));
  await assertSucceeds(db(senior).ref('depts/d2').set({id:'d2',name:'Teste',on:true}));
});

test('supervisor administra os acessos de operadores e preserva as contas de gestão', async () => {
  const database = db(supervisor);
  for (const person of [senior, supervisor]) {
    await assertFails(database.ref('users/' + person.key + '/on').set(false));
    await assertFails(database.ref('logins/' + person.fields.loginHash).remove());
    await assertFails(database.ref('members/' + person.uid).remove());
    await assertFails(database.ref('mailboxes/' + person.fields.mailHash + '/' + person.fields.loginHash).remove());
  }
  const rotated = account('nova-identidade','op');
  const newLogin = hash('operador-renomeado');
  const path = 'users/' + operator.key + '/';
  const mailbox = 'mailboxes/' + operator.fields.mailHash + '/';
  const changes = {
    [path + 'authUid']:rotated.uid, [path + 'authEmail']:rotated.fields.authEmail,
    [path + 'login']:'operador-renomeado', [path + 'loginHash']:newLogin,
    ['members/' + operator.uid]:null, ['members/' + rotated.uid]:operator.key,
    ['logins/' + operator.fields.loginHash]:null,
    ['logins/' + newLogin]:{key:operator.key,email:rotated.fields.authEmail},
    [mailbox + operator.fields.loginHash]:null, [mailbox + newLogin]:rotated.fields.authEmail
  };
  await assertSucceeds(database.ref().update(changes));
  await assertFails(db(operator).ref('tasks').once('value'));
  await assertSucceeds(db(rotated).ref('tasks').once('value'));
});

test('operador usa o checklist e fica fora da gestão', async () => {
  const person = account('operacao-checklist','op');
  await assertSucceeds(db(senior).ref().update(person.changes));
  const database = db(person);
  await assertSucceeds(database.ref('records/2026-11-23_101').set({
    day:'2026-11-23', task:101, uid:person.fields.id, by:person.fields.name,
    at:'2026-11-23T12:00:00Z', dept:'d1'
  }));
  await assertFails(database.ref('tasks/tarefa-nova').set({id:2, dept:'d1'}));
  await assertFails(database.ref().update(account('outro-operador','op').changes));
  await assertFails(env.unauthenticatedContext().database().ref('users').once('value'));
});
