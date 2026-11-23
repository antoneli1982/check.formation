const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const code = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
new vm.Script(code);

function section(start, end) {
  const first = code.indexOf(start);
  const last = code.indexOf(end, first + start.length);
  assert.ok(first >= 0 && last > first, start);
  return code.slice(first, last);
}

function view(role) {
  const roles = ['op','supervisor','senior'];
  const users = roles.map(value => ({
    id:value, role:value, name:value, login:value, on:true,
    authUid:'uid-' + value, depts:value === 'op' ? ['d1'] : []
  }));
  const actor = users.find(person => person.role === role);
  const context = vm.createContext({
    S:{users, tasks:[], depts:[{id:'d1',name:'Operação',on:true}]},
    cur:() => actor, editUser:null, esc:value => String(value ?? ''),
    initialManagerUid:'titular', deptName:() => 'Operação', canDo:() => true
  });
  vm.runInContext([
    section('const roleNames', 'const userName'),
    section('function vEquipe()', '/* ---------- Histórico'),
    section('const managementViews=', 'function render()')
  ].join('\n'), context);
  return {context, form:() => vm.runInContext('vEquipe()', context),
    tabs:() => [...vm.runInContext('VIEWS[cur().role].map(row=>row[0])', context)]};
}

test('formulário do sênior oferece os três perfis e preserva o perfil de contas existentes', () => {
  const senior = view('senior');
  const form = senior.form();
  for (const [key, label] of Object.entries({op:'Operador',supervisor:'Supervisor',senior:'Sênior'})) {
    assert.match(form, new RegExp('<option value="' + key + '"[^>]*>' + label + '</option>'));
  }
  assert.ok(senior.tabs().includes('deptos'));
  senior.context.editUser = 'supervisor';
  assert.match(senior.form(), /<select id="uRole" disabled>/);
});

test('supervisor encontra tarefas, registros e operadores e vê apenas Operador no cadastro', () => {
  const supervisor = view('supervisor');
  const form = supervisor.form();
  assert.match(form, /<option value="op" selected>Operador<\/option>/);
  assert.doesNotMatch(form, /<option value="(?:supervisor|senior)"/);
  assert.match(form, /data-uedit="op"/);
  assert.doesNotMatch(form, /data-u(?:edit|tog)="(?:supervisor|senior)"/);
  assert.deepEqual(supervisor.tabs(), ['dash','global','checklist','tarefas','equipe','historico']);
});

test('operador segue no checklist; conta principal só pode ser editada pelo titular', () => {
  assert.deepEqual(view('op').tabs(), ['checklist']);
  const senior = view('senior');
  assert.equal(vm.runInContext("canManageAccount(cur(),{role:'senior',authUid:initialManagerUid})", senior.context), false);
  const supervisor = view('supervisor');
  assert.equal(vm.runInContext("canManageAccount(cur(),{role:'senior'})", supervisor.context), false);
  assert.equal(vm.runInContext("canManageAccount(cur(),{role:'op'})", supervisor.context), true);
});
