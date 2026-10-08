// Сотрудники и права: добавить, назначить права, отключить, завершить сессии.
// Владелец (owner) — всегда все права; его можно только переименовать.

export async function renderUsers(container, { call, guarded, el, me }) {
  container.replaceChildren(el('p', { class: 'muted' }, 'Загрузка…'));
  const data = await guarded(() => call('users_list'));
  if (!data) return;
  draw(data);

  function draw(d) {
    const perms = Object.entries(d.permissions);
    container.replaceChildren(
      el('p', { class: 'muted' },
        'Новому сотруднику также нужен доступ ко входу Google: добавьте его e-mail в Google Cloud → ' +
        'Google Auth Platform → Audience → Test users (или переведите приложение в рабочий режим — тогда список не нужен).'),
      el('ul', { class: 'list users-list' }, d.users.map((u) => userCard(u, perms))),
      addForm(perms)
    );
  }

  function permBoxes(perms, selected, disabled) {
    return el('div', { class: 'perm-grid' }, perms.map(([key, label]) => el('label', { class: 'check-row' },
      el('input', { type: 'checkbox', value: key, checked: selected.includes(key), disabled }), ' ', label)));
  }

  function userCard(u, perms) {
    const name = el('input', { value: u.name || '', placeholder: 'Имя', 'aria-label': `Имя ${u.email}` });
    const active = el('input', { type: 'checkbox', checked: u.active, disabled: u.owner });
    const boxes = permBoxes(perms, u.perms, u.owner);
    const status = el('span', { class: 'muted' });

    const save = async () => {
      const chosen = [...boxes.querySelectorAll('input:checked')].map((i) => i.value);
      const res = await guarded(() => call('user_save', { email: u.email, name: name.value, perms: chosen, active: active.checked }));
      if (res) draw(res);
    };
    const endSessions = async () => {
      const self = u.email === me?.email;
      if (!confirm(`Завершить все сессии ${u.email}?${self ? ' Вы тоже выйдете на всех устройствах.' : ''}`)) return;
      const res = await guarded(() => call('user_end_sessions', { email: u.email }));
      if (res) draw(res);
      if (self) location.reload();
    };

    return el('li', { class: 'user-card' },
      el('div', { class: 'row-between' },
        el('div', {},
          el('strong', {}, u.email),
          u.owner ? el('span', { class: 'badge st-confirmed' }, 'владелец') : null,
          !u.active ? el('span', { class: 'badge st-cancelled' }, 'отключён') : null),
        el('span', { class: 'muted' },
          u.sessions ? `устройств: ${u.sessions}${u.last_seen ? ` · был ${u.last_seen}` : ''}` : 'не входил')),
      el('div', { class: 'form' },
        el('label', {}, 'Имя', name),
        u.owner ? el('p', { class: 'muted' }, 'Владелец: все права, отключить нельзя.') : boxes,
        u.owner ? null : el('label', { class: 'check-row' }, active, ' доступ включён')),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'button primary', onclick: save }, 'Сохранить'),
        u.sessions ? el('button', { type: 'button', class: 'button', onclick: endSessions }, 'Завершить сессии') : null,
        status));
  }

  function addForm(perms) {
    const email = el('input', { type: 'email', placeholder: 'e-mail Google-аккаунта', required: true });
    const name = el('input', { placeholder: 'Имя' });
    const boxes = permBoxes(perms, ['bookings', 'issue', 'inventory', 'clients'], false);
    const form = el('form', { class: 'panel form' },
      el('h3', {}, 'Добавить сотрудника'),
      el('label', {}, 'E-mail', email),
      el('label', {}, 'Имя', name),
      boxes,
      el('button', { type: 'submit', class: 'button primary' }, 'Добавить'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const chosen = [...boxes.querySelectorAll('input:checked')].map((i) => i.value);
      const res = await guarded(() => call('user_save', { email: email.value, name: name.value, perms: chosen, active: true, isNew: true }));
      if (res) draw(res);
    });
    return form;
  }
}
