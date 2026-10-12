(() => {
  'use strict';
  const STORE_KEY = 'family-planner-items-v1';
  const SETTINGS_KEY = 'family-planner-settings-v1';
  const SUPABASE_URL = 'https://txlcyakktgtqgveosojz.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_bJPp8as_zZqo5NWVJVacaA_GGkDU86b';
  const cloud = window.supabase?.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) || null;
  let session = null;
  let cloudSyncReady = false;
  let syncingCloud = false;
  let activeCloudUserId = null;
  let syncTimer = null;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const today = () => { const d = new Date(); return localDate(d); };
  const localDate = d => [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  const parseDate = value => { const [y,m,d] = String(value || '').split('-').map(Number); return y && m && d ? new Date(y,m-1,d,12) : null; };
  const shiftDate = (value, days) => { const d = parseDate(value); if (!d) return ''; d.setDate(d.getDate()+days); return localDate(d); };
  const fmtDate = (value, options = {day:'numeric',month:'short'}) => { const d = parseDate(value); return d ? new Intl.DateTimeFormat('ru-RU', options).format(d) : ''; };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const categories = {
    task:{label:'Дело',icon:'✓'},family:{label:'Семья и даты',icon:'♡'},clinic:{label:'Врач / клиника',icon:'✚'},
    payment:{label:'Платёж',icon:'₽'},meter:{label:'Счётчики',icon:'◷'},reminder:{label:'Напоминание',icon:'✦'}
  };
  const seed = [];
  let items = loadItems();
  let settings = loadSettings();
  let currentView = 'today';
  let calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  let selectedDate = today();
  let filter = 'all';
  let editingId = null;
  let deferredPrompt = null;

  function loadItems() {
    try { const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(value) ? value.filter(x => x && typeof x.id === 'string' && typeof x.title === 'string') : seed; }
    catch { return seed; }
  }
  function saveItems() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
      $('#saveStatus').textContent = cloudSyncReady ? 'Сохранено на устройстве и в облаке' : 'Сохранено на этом устройстве';
      queueCloudSync();
    } catch { $('#saveStatus').textContent = 'Не удалось сохранить данные'; }
  }
  function loadSettings() {
    try { const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); return {pregnancyStart:s.pregnancyStart || '', dueDate:s.dueDate || ''}; }
    catch { return {pregnancyStart:'',dueDate:''}; }
  }
  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      if (cloudSyncReady && session?.user?.id) {
        cloud.from('planner_settings').upsert({
          user_id: session.user.id,
          pregnancy_start: settings.pregnancyStart || null,
          due_date: settings.dueDate || null,
          timezone: 'Asia/Novosibirsk',
          notifications_enabled: (typeof Notification !== 'undefined' && Notification.permission === 'granted')
        }, { onConflict: 'user_id' }).then(({error}) => {
          if (error) $('#saveStatus').textContent = 'Настройки не синхронизировались';
        });
      }
    } catch { $('#saveStatus').textContent = 'Не удалось сохранить настройки'; }
  }
  const isUuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  function dbItem(item) {
    if (!isUuid(item.id)) item.id = crypto.randomUUID();
    return {
      id: item.id, user_id: session.user.id, title: item.title, category: item.category || 'task',
      event_date: item.date || today(), event_time: item.time || null, notes: item.notes || '',
      done: item.done === true, remind_before: Number(item.remindBefore) || 0,
      created_at: item.createdAt || new Date().toISOString()
    };
  }
  function queueCloudSync() {
    if (!cloudSyncReady || !session?.user?.id || !cloud) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncItemsToCloud, 350);
  }
  async function syncItemsToCloud() {
    if (!cloudSyncReady || !session?.user?.id || !cloud || syncingCloud) return;
    const rows = items.map(dbItem);
    try {
      if (rows.length) {
        const { error } = await cloud.from('planner_items').upsert(rows, { onConflict: 'id' });
        if (error) throw error;
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
      $('#saveStatus').textContent = 'Синхронизировано с облаком';
    } catch (error) {
      $('#saveStatus').textContent = 'Нет связи с облаком — проверь интернет';
      console.error('Planner cloud sync failed', error);
    }
  }
  async function syncFromCloud(nextSession) {
    if (!cloud || !nextSession?.user?.id || syncingCloud || activeCloudUserId === nextSession.user.id && cloudSyncReady) return;
    syncingCloud = true;
    session = nextSession;
    activeCloudUserId = nextSession.user.id;
    $('#authGate').classList.add('hidden');
    $('#appShell').classList.remove('hidden');
    $('#authStatus').textContent = '';
    $('#saveStatus').textContent = 'Загружаем защищённые данные…';
    try {
      const [itemsResult, settingsResult] = await Promise.all([
        cloud.from('planner_items').select('*').order('event_date', {ascending:true}),
        cloud.from('planner_settings').select('*').eq('user_id', session.user.id).maybeSingle()
      ]);
      if (itemsResult.error) throw itemsResult.error;
      if (settingsResult.error) throw settingsResult.error;
      const localItems = items.map(item => ({...item, id: isUuid(item.id) ? item.id : crypto.randomUUID()}));
      const remoteItems = (itemsResult.data || []).map(row => ({
        id: row.id, title: row.title, category: row.category || 'task',
        date: row.event_date, time: row.event_time ? String(row.event_time).slice(0,5) : '',
        notes: row.notes || '', done: row.done === true, remindBefore: Number(row.remind_before) || 0,
        createdAt: row.created_at || ''
      }));
      const merged = new Map(remoteItems.map(item => [item.id, item]));
      for (const item of localItems) merged.set(item.id, item);
      items = [...merged.values()];
      if (settingsResult.data) {
        if (!settings.pregnancyStart) settings.pregnancyStart = settingsResult.data.pregnancy_start || '';
        if (!settings.dueDate) settings.dueDate = settingsResult.data.due_date || '';
      }
      localStorage.setItem(STORE_KEY, JSON.stringify(items));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      cloudSyncReady = true;
      await syncItemsToCloud();
      await cloud.from('planner_settings').upsert({
        user_id: session.user.id, pregnancy_start: settings.pregnancyStart || null,
        due_date: settings.dueDate || null, timezone: 'Asia/Novosibirsk',
        notifications_enabled: (typeof Notification !== 'undefined' && Notification.permission === 'granted')
      }, { onConflict: 'user_id' });
      render();
      refreshPushStatus();
    } catch (error) {
      cloudSyncReady = false;
      $('#saveStatus').textContent = 'Не удалось загрузить облачные записи';
      $('#authStatus').textContent = 'Вход выполнен, но облако пока недоступно. Проверь подключение и обнови страницу.';
      console.error('Planner initial cloud sync failed', error);
    } finally {
      syncingCloud = false;
    }
  }
  function showSignedOut() {
    session = null;
    cloudSyncReady = false;
    syncingCloud = false;
    activeCloudUserId = null;
    $('#appShell').classList.add('hidden');
    $('#authGate').classList.remove('hidden');
    $('#authPassword').value = '';
  }
  async function authLogin(event) {
    event.preventDefault();
    if (!cloud) { $('#authStatus').textContent = 'Не загрузился модуль входа. Проверь интернет и обнови страницу.'; return; }
    const submit = $('#authSubmit');
    submit.disabled = true;
    $('#authStatus').textContent = 'Входим…';
    try {
      const {data, error} = await cloud.auth.signInWithPassword({
        email: $('#authEmail').value.trim(), password: $('#authPassword').value
      });
      if (error) throw error;
      await syncFromCloud(data.session);
    } catch (error) {
      $('#authStatus').textContent = 'Не удалось войти. Проверь почту и пароль.';
    } finally { submit.disabled = false; }
  }
  function safeText(value, max = 500) { return typeof value === 'string' ? value.slice(0, max) : ''; }
  function validBackup(data) {
    if (!data || data.format !== 'family-planner-backup' || data.version !== 1 || !Array.isArray(data.items) || !data.settings || typeof data.settings !== 'object') return false;
    if (data.items.length > 10000) return false;
    return data.items.every(x => x && typeof x === 'object' && typeof x.title === 'string' && x.title.trim().length > 0 && x.title.length <= 120 && typeof x.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && (!x.category || Object.hasOwn(categories, x.category)));
  }
  function exportBackup() {
    const data = {format:'family-planner-backup',version:1,exportedAt:new Date().toISOString(),items,settings};
    const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href=url; a.download='family-planner-backup-'+today()+'.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('#saveStatus').textContent = 'Резервная копия подготовлена';
  }
  async function importBackup(file) {
    if (!file || file.size > 2 * 1024 * 1024) { alert('Файл не выбран или он больше 2 МБ.'); return; }
    try {
      const data = JSON.parse(await file.text());
      if (!validBackup(data)) { alert('Не удалось распознать резервную копию планера. Исходные данные не изменены.'); return; }
      if (!confirm('Восстановить '+data.items.length+' записей из копии? Текущие записи на этом устройстве будут заменены.')) return;
      items = data.items.map(x => ({
        id: safeText(x.id,100) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random()),
        title: x.title.trim(), category: Object.hasOwn(categories,x.category) ? x.category : 'task',
        date: x.date, time: /^\d{2}:\d{2}$/.test(x.time || '') ? x.time : '',
        notes: safeText(x.notes,500), done: x.done === true, createdAt: safeText(x.createdAt,50)
      }));
      settings = {pregnancyStart:/^\d{4}-\d{2}-\d{2}$/.test(data.settings.pregnancyStart || '') ? data.settings.pregnancyStart : '',dueDate:/^\d{4}-\d{2}-\d{2}$/.test(data.settings.dueDate || '') ? data.settings.dueDate : ''};
      saveItems(); saveSettings(); $('#settingsDialog').close(); render();
      $('#saveStatus').textContent = 'Резервная копия восстановлена';
    } catch { alert('Файл повреждён или имеет неверный формат. Данные не изменены.'); }
  }
  function icsEscape(value) { return String(value||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;'); }
  function exportCalendarEvent(id) {
    const item=items.find(x=>x.id===id); if(!item) return;
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
    const date=(item.date||today()).replace(/-/g,'');
    const start=item.time ? date+'T'+item.time.replace(':','')+'00' : date;
    const end=item.time ? (()=>{const d=parseDate(item.date);const [h,m]=item.time.split(':').map(Number);d.setHours(h,m+30,0,0);return localDate(d).replace(/-/g,'')+'T'+String(d.getHours()).padStart(2,'0')+String(d.getMinutes()).padStart(2,'0')+'00';})() : '';
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Family Planner//RU','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:'+icsEscape(item.id)+'@family-planner.local','DTSTAMP:'+stamp];
    if(item.time){lines.push('DTSTART:'+start,'DTEND:'+end);}else{const next=shiftDate(item.date||today(),1).replace(/-/g,'');lines.push('DTSTART;VALUE=DATE:'+date,'DTEND;VALUE=DATE:'+next);}
    lines.push('SUMMARY:'+icsEscape(item.title));
    if(item.notes) lines.push('DESCRIPTION:'+icsEscape(item.notes));
    if(item.category) lines.push('CATEGORIES:'+icsEscape(categories[item.category]?.label||item.category));
    lines.push('END:VEVENT','END:VCALENDAR');
    const blob=new Blob([lines.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='family-planner-'+date+'.ics';
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
    $('#saveStatus').textContent='Файл события подготовлен для календаря iPhone';
  }
  function sortedItems(list = items) { return [...list].sort((a,b) => (a.date || '').localeCompare(b.date || '') || (a.time || '99:99').localeCompare(b.time || '99:99') || a.title.localeCompare(b.title,'ru')); }
  function upcoming(days = 30) {
    const end = shiftDate(today(), days);
    return sortedItems(items.filter(x => !x.done && x.date >= today() && x.date <= end));
  }
  function itemMeta(item) {
    const reminderLabels={10:'за 10 мин',30:'за 30 мин',60:'за 1 час',1440:'за 1 день',10080:'за 1 неделю'};
    const bits = [categories[item.category]?.label || 'Дело', item.time || '', item.remindBefore ? 'Напомнить '+(reminderLabels[item.remindBefore]||'заранее') : '', item.notes || ''].filter(Boolean);
    return bits.join(' · ');
  }
  function eventRow(item, showDate = true) {
    const cat = categories[item.category] || categories.task;
    return `<article class="event-item category-${esc(item.category || 'task')} ${item.done ? 'completed' : ''}">
      <input class="done-toggle" type="checkbox" data-done="${esc(item.id)}" ${item.done ? 'checked' : ''} aria-label="Отметить выполненным: ${esc(item.title)}">
      ${showDate ? `<div class="event-date"><strong>${esc(parseDate(item.date)?.getDate() || '—')}</strong><span>${esc(fmtDate(item.date,{month:'short'}).replace('.',''))}</span></div>` : ''}
      <div class="event-main"><strong>${esc(item.title)}</strong><div class="event-meta">${esc(itemMeta(item))}</div></div>
      <div class="event-actions"><button class="icon-button" data-ics="${esc(item.id)}" aria-label="Добавить в календарь iPhone" title="Экспорт в календарь iPhone">▦</button><button class="icon-button" data-edit="${esc(item.id)}" aria-label="Изменить">✎</button><button class="icon-button" data-delete="${esc(item.id)}" aria-label="Удалить">×</button></div>
    </article>`;
  }
  function emptyState(title = 'Пока здесь спокойно', text = 'Добавь событие — и оно появится здесь.') {
    return `<div class="empty"><span>🌱</span><b>${esc(title)}</b><br>${esc(text)}</div>`;
  }
  function head(title, subtitle, button = true) {
    return `<div class="view-head"><div><h2>${title}</h2><p>${subtitle}</p></div>${button ? '<button class="button button-primary" data-add>＋ Добавить</button>' : ''}</div>`;
  }
  function card(title, content, extra = '') {
    return `<section class="panel section-card"><div class="section-top"><h3>${title}</h3>${extra}</div>${content}</section>`;
  }
  function render() {
    const view = $('#view');
    if (currentView === 'today') view.innerHTML = renderToday();
    else if (currentView === 'calendar') view.innerHTML = renderCalendar();
    else if (currentView === 'tasks') view.innerHTML = renderTasks();
    else if (currentView === 'home') view.innerHTML = renderHome();
    else if (currentView === 'pregnancy') view.innerHTML = renderPregnancy();
    bindView();
  }
  function renderToday() {
    const d = parseDate(today());
    $('#todayLabel').textContent = new Intl.DateTimeFormat('ru-RU',{weekday:'long',day:'numeric',month:'long'}).format(d).toLocaleUpperCase('ru-RU');
    const todayItems = sortedItems(items.filter(x => x.date === today()));
    const next = upcoming(14).filter(x => x.date !== today()).slice(0,5);
    const pending = items.filter(x => !x.done).length;
    const dates = items.filter(x => !x.done && x.category === 'family' && x.date >= today()).length;
    const duePayments = items.filter(x => !x.done && x.category === 'payment' && x.date <= shiftDate(today(),7) && x.date >= today()).length;
    return `
      <div class="stats">
        <div class="panel stat"><div class="stat-label">Дела на сегодня</div><div class="stat-number">${todayItems.filter(x=>!x.done).length}</div><div class="stat-note">Шаг за шагом</div></div>
        <div class="panel stat"><div class="stat-label">Ближайшие даты</div><div class="stat-number">${dates}</div><div class="stat-note">Семейные моменты</div></div>
        <div class="panel stat"><div class="stat-label">Платежи на неделе</div><div class="stat-number">${duePayments}</div><div class="stat-note">Всё под контролем</div></div>
      </div>
      <div class="content-grid">
        ${card('План на сегодня',todayItems.length ? `<div class="item-list">${todayItems.map(x=>eventRow(x,false)).join('')}</div>` : emptyState('День свободен','Можно выдохнуть или запланировать что-то приятное.'),'<button class="text-link" data-view-link="calendar">Календарь →</button>')}
        <div style="display:flex;flex-direction:column;gap:14px">
          ${card('Быстро добавить',`<div class="quick-actions">
            <button class="quick-action" data-add-category="family"><span>🎂</span><b>Семейную дату</b><small>День рождения, годовщина</small></button>
            <button class="quick-action" data-add-category="clinic"><span>🩺</span><b>Приём врача</b><small>Время, адрес, заметки</small></button>
            <button class="quick-action" data-add-category="payment"><span>🏡</span><b>Платёж</b><small>Аренда, ЖКХ, интернет</small></button>
            <button class="quick-action" data-add-category="meter"><span>💧</span><b>Счётчики</b><small>Напомнить снять показания</small></button>
          </div>`)}
          ${card('Скоро',next.length ? `<div class="item-list">${next.map(x=>eventRow(x,true)).join('')}</div>` : emptyState('Пока без планов','Добавь важную дату, чтобы не забыть.'))}
        </div>
      </div>`;
  }
  function renderCalendar() {
    const year = calendarMonth.getFullYear(), month = calendarMonth.getMonth();
    const first = new Date(year,month,1), offset = (first.getDay()+6)%7, count = new Date(year,month+1,0).getDate();
    const prevCount = new Date(year,month,0).getDate();
    const cells = [];
    for(let i=0;i<42;i++) {
      let date, muted = false;
      if(i<offset){date=localDate(new Date(year,month-1,prevCount-offset+i+1,12));muted=true;}
      else if(i>=offset+count){date=localDate(new Date(year,month+1,i-offset-count+1,12));muted=true;}
      else date=localDate(new Date(year,month,i-offset+1,12));
      const dayItems = items.filter(x=>x.date===date);
      cells.push(`<button class="day ${muted?'muted-day':''} ${date===today()?'today':''} ${date===selectedDate?'selected':''}" data-date="${date}" aria-pressed="${date===selectedDate?'true':'false'}" aria-label="${esc(fmtDate(date,{day:'numeric',month:'long',year:'numeric'}))}, событий: ${dayItems.length}">
        <span class="day-num">${parseDate(date).getDate()}</span><span class="day-dots">${dayItems.slice(0,4).map(x=>`<i class="dot ${esc(x.category)}" title="${esc(categories[x.category]?.label||'Событие')}"></i>`).join('')}${dayItems.length>4?`<small class="more-dots">+${dayItems.length-4}</small>`:''}</span></button>`);
    }
    const chosen = sortedItems(items.filter(x=>x.date===selectedDate));
    const monthLabel = new Intl.DateTimeFormat('ru-RU',{month:'long',year:'numeric'}).format(calendarMonth);
    const monthItems = items.filter(x=>x.date && x.date.startsWith(year+'-'+String(month+1).padStart(2,'0')+'-')).length;
    return `${head('Календарь','Месяц, планы и важные даты')}
      <section class="panel section-card">
        <div class="month-bar"><button class="icon-button" data-month="-1" aria-label="Предыдущий месяц">←</button><div class="month-heading"><h3>${esc(monthLabel)}</h3><small>${monthItems} ${monthItems===1?'событие':monthItems>1&&monthItems<5?'события':'событий'}</small></div><button class="button button-soft month-today" data-month-today type="button">Сегодня</button><button class="icon-button" data-month="1" aria-label="Следующий месяц">→</button></div>
        <div class="month-grid">${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map(x=>`<div class="weekday">${x}</div>`).join('')}${cells.join('')}</div>
        <div class="calendar-detail divider"></div>
        <div class="section-top"><h3>${esc(fmtDate(selectedDate,{day:'numeric',month:'long'}))}</h3><button class="text-link" data-add-date="${selectedDate}">＋ Добавить сюда</button></div>
        ${chosen.length ? `<div class="item-list">${chosen.map(x=>eventRow(x,false)).join('')}</div>` : emptyState('На эту дату пока ничего нет','Выбери день в календаре или добавь событие.')}
      </section>
      <div class="calendar-legend" aria-label="Цвета событий"><span><i class="dot family"></i> Семья</span><span><i class="dot clinic"></i> Врач</span><span><i class="dot payment"></i> Платёж</span><span><i class="dot meter"></i> Счётчик</span><span><i class="dot reminder"></i> Напоминание</span><span><i class="dot task"></i> Дело</span></div>`;
  }
  function renderTasks() {
    const list = sortedItems(items.filter(x => filter==='all' || (filter==='open' && !x.done) || (filter==='done' && x.done) || x.category===filter));
    return `${head('Мои дела','Все напоминания в одном месте')}
      <div class="filter-row">${[['all','Все'],['open','Активные'],['done','Готово'],['task','Дела'],['reminder','Напоминания'],['family','Семья'],['clinic','Врач']].map(([key,label])=>`<button class="filter ${filter===key?'active':''}" data-filter="${key}">${label}</button>`).join('')}</div>
      ${list.length ? `<div class="item-list">${list.map(x=>eventRow(x,true)).join('')}</div>` : emptyState('Здесь пока пусто','Добавь дело или поменяй фильтр.')}`;
  }
  function renderHome() {
    const homeItems = sortedItems(items.filter(x=>['payment','meter'].includes(x.category)));
    const payments = homeItems.filter(x=>x.category==='payment'&&!x.done);
    const meters = homeItems.filter(x=>x.category==='meter'&&!x.done);
    return `${head('Дом и платежи','Аренда, коммуналка и показания счётчиков')}
      <div class="stats">
        <div class="panel stat"><div class="stat-label">Неоплаченные напоминания</div><div class="stat-number">${payments.length}</div><div class="stat-note">Отмечай после оплаты</div></div>
        <div class="panel stat"><div class="stat-label">Счётчики</div><div class="stat-number">${meters.length}</div><div class="stat-note">Ожидают внимания</div></div>
        <div class="panel stat"><div class="stat-label">Всего записей</div><div class="stat-number">${homeItems.length}</div><div class="stat-note">История личных записей</div></div>
      </div>
      <div class="content-grid">
        ${card('Платежи',payments.length? `<div class="item-list">${payments.map(x=>eventRow(x,true)).join('')}</div>`:emptyState('Все спокойно','Добавь напоминание об аренде или ЖКХ.'),'<button class="text-link" data-add-category="payment">＋ Платёж</button>')}
        ${card('Показания счётчиков',meters.length? `<div class="item-list">${meters.map(x=>eventRow(x,true)).join('')}</div>`:emptyState('Показания не запланированы','Создай напоминание на нужный день.'),'<button class="text-link" data-add-category="meter">＋ Счётчик</button>')}
      </div>
      <div class="note" style="margin-top:15px">Совет: укажи сумму, лицевой счёт или последние показания в заметке. Для конфиденциальности пока не добавляй пароли и полные банковские реквизиты.</div>`;
  }
  function pregnancyInfo() {
    const now = parseDate(today());
    let start = parseDate(settings.pregnancyStart);
    const due = parseDate(settings.dueDate);
    if (!start && due) { start = new Date(due); start.setDate(start.getDate()-280); }
    if (!start) return null;
    const days = Math.floor((now-start)/86400000);
    return {start,days,week:Math.floor(days/7),day:days%7,due:settings.dueDate?parseDate(settings.dueDate):new Date(start.getTime()+280*86400000)};
  }
  function renderPregnancy() {
    const p = pregnancyInfo();
    const info = p && p.days >= 0 && p.days <= 315 ? p : null;
    return `${head('Календарь беременности','Бережный ориентир по неделям',false)}
      <div class="content-grid">
        <section class="pregnancy-hero">
          <span class="tag">Личный календарь</span>
          ${info ? `<div class="big-week">${info.week} недель ${info.day} дн.</div><h2>${info.week<13?'Первый триместр':info.week<28?'Второй триместр':'Третий триместр'}</h2><p class="muted">Ориентировочная дата родов: <b>${esc(fmtDate(localDate(info.due),{day:'numeric',month:'long',year:'numeric'}))}</b></p><div class="progress-track"><div class="progress-fill" style="width:${Math.min(100,Math.max(0,info.days/280*100))}%"></div></div><div class="event-meta">Примерно ${Math.max(0,280-info.days)} дней до ПДР по расчёту</div>` : `<h2>Ваш календарь начинается здесь</h2><p class="muted">Укажи первый день последней менструации или предполагаемую дату родов. Расчёт приблизительный.</p>`}
          <div class="note" style="margin-top:20px">Это календарный ориентир, а не медицинская рекомендация. Сроки и обследования лучше уточнять у врача. Данные сохраняются в защищённом облаке вашего аккаунта.</div>
        </section>
        <section class="panel section-card">
          <h3 style="margin:0 0 8px">Настройки срока</h3>
          <form id="pregnancyForm">
            <label>Первый день последней менструации<input type="date" name="pregnancyStart" value="${esc(settings.pregnancyStart)}"></label>
            <div style="text-align:center;color:var(--muted);font-size:11px">или</div>
            <label>Предполагаемая дата родов<input type="date" name="dueDate" value="${esc(settings.dueDate)}"></label>
            <button class="button button-primary" type="submit" style="width:100%;margin-top:8px">Сохранить даты</button>
            <button class="button button-soft" type="button" id="clearPregnancy" style="width:100%;margin-top:8px">Очистить даты</button>
          </form>
        </section>
      </div>
      ${info ? `<section class="panel section-card" style="margin-top:14px"><h3 style="margin:0 0 8px">Ближайшие недели</h3><div class="item-list">${[0,1,2,3].map(i=>`<div class="event-item"><div class="event-date"><strong>${info.week+i}</strong><span>неделя</span></div><div class="event-main"><strong>${i===0?'Текущая неделя':i===1?'Следующая неделя':'Через '+i+' нед.'}</strong><div class="event-meta">${esc(fmtDate(shiftDate(today(),i*7),{day:'numeric',month:'long'}))} — ориентир для планирования вопросов врачу</div></div></div>`).join('')}</div></section>` : ''}
      `;
  }
  function addItem(category = 'task', date = today()) {
    editingId = null;
    $('#itemForm').reset();
    $('#dialogTitle').textContent = 'Добавить событие';
    $('#itemCategory').value = categories[category] ? category : 'task';
    $('#itemDate').value = date || today(); $('#itemReminder').value = '0';
    $('#saveItemBtn').textContent = 'Сохранить';
    $('#itemDialog').showModal();
    $('#itemTitle').focus();
  }
  function editItem(id) {
    const item = items.find(x=>x.id===id); if(!item) return;
    editingId = id;
    $('#dialogTitle').textContent = 'Изменить событие';
    $('#itemTitle').value = item.title;
    $('#itemCategory').value = item.category || 'task';
    $('#itemDate').value = item.date || today();
    $('#itemTime').value = item.time || '';
    $('#itemNotes').value = item.notes || ''; $('#itemReminder').value = String(item.remindBefore ?? '0');
    $('#saveItemBtn').textContent = 'Сохранить изменения';
    $('#itemDialog').showModal();
  }
  function bindView() {
    $$('[data-add]').forEach(b=>b.addEventListener('click',()=>addItem()));
    $$('[data-add-category]').forEach(b=>b.addEventListener('click',()=>addItem(b.dataset.addCategory)));
    $$('[data-add-date]').forEach(b=>b.addEventListener('click',()=>addItem('task',b.dataset.addDate)));
    $$('[data-view-link]').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.viewLink)));
    $$('[data-view]', $('#view')).forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
    $$('[data-edit]').forEach(b=>b.addEventListener('click',()=>editItem(b.dataset.edit)));
    $$('[data-ics]').forEach(b=>b.addEventListener('click',()=>exportCalendarEvent(b.dataset.ics)));
    $$('[data-delete]').forEach(b=>b.addEventListener('click',()=>{
      const item=items.find(x=>x.id===b.dataset.delete); if(!item)return;
      if(confirm('Удалить «'+item.title+'»?')){
        items=items.filter(x=>x.id!==item.id); saveItems(); render();
        if (cloudSyncReady && session?.user?.id) cloud.from('planner_items').delete().eq('id', item.id).eq('user_id', session.user.id);
      }
    }));
    $$('[data-done]').forEach(b=>b.addEventListener('change',()=>{
      const item=items.find(x=>x.id===b.dataset.done);if(item){item.done=b.checked;saveItems();render();}
    }));
    $$('[data-month]').forEach(b=>b.addEventListener('click',()=>{
      const next = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+Number(b.dataset.month),1);
      calendarMonth=next;
      const selected=parseDate(selectedDate);
      if(!selected || selected.getFullYear()!==next.getFullYear() || selected.getMonth()!==next.getMonth()) selectedDate=localDate(next);
      render();
    }));
    $$('[data-month-today]').forEach(b=>b.addEventListener('click',()=>{
      const now=parseDate(today());calendarMonth=new Date(now.getFullYear(),now.getMonth(),1);selectedDate=today();render();
    }));
    $$('[data-date]').forEach(b=>b.addEventListener('click',()=>{
      selectedDate=b.dataset.date;
      const d=parseDate(selectedDate);calendarMonth=new Date(d.getFullYear(),d.getMonth(),1);render();
    }));
    $$('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render();}));
    const pf=$('#pregnancyForm');
    if(pf) pf.addEventListener('submit',e=>{
      e.preventDefault();const data=new FormData(pf);
      settings.pregnancyStart=String(data.get('pregnancyStart')||'');
      settings.dueDate=String(data.get('dueDate')||'');
      if(settings.pregnancyStart && settings.dueDate) {
        const start=parseDate(settings.pregnancyStart), due=parseDate(settings.dueDate);
        if(Math.abs((due-start)/86400000-280)>14 && !confirm('Эти даты заметно отличаются от стандартного расчёта 280 дней. Сохранить обе даты как есть?')) return;
      }
      saveSettings();render();
    });
    const clear=$('#clearPregnancy');
    if(clear) clear.addEventListener('click',()=>{if(confirm('Очистить даты беременности?')){settings={pregnancyStart:'',dueDate:''};saveSettings();render();}});
  }
  function setView(view) {
    if(!['today','calendar','tasks','home','pregnancy'].includes(view))return;
    currentView=view;
    $$('.tab').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');});
    render();window.scrollTo({top:0,behavior:'smooth'});
  }
  $('#settingsBtn').addEventListener('click',()=>{ $('#settingsDialog').showModal(); refreshPushStatus(); });
  $('#closeSettings').addEventListener('click',()=>$('#settingsDialog').close());
  $('#exportBackup').addEventListener('click',exportBackup);
  $('#importBackup').addEventListener('click',()=>$('#backupFile').click());
  $('#backupFile').addEventListener('change',e=>{const file=e.target.files?.[0]; if(file) importBackup(file); e.target.value='';});
  $('#signOutBtn').addEventListener('click', async () => {
    if (!confirm('Выйти из личного планера?')) return;
    if (cloud) await cloud.auth.signOut();
    showSignedOut();
  });
  $('#authForm').addEventListener('submit', authLogin);
  $('#togglePush').addEventListener('click', togglePushNotifications);
  $('#clearAllData').addEventListener('click',()=>{
    if(!confirm('Удалить все события и настройки с этого устройства? Это нельзя отменить. Сначала скачай резервную копию, если она нужна.')) return;
    items=[]; settings={pregnancyStart:'',dueDate:''};
    saveItems(); saveSettings(); $('#settingsDialog').close(); render();
    $('#saveStatus').textContent='Локальные записи удалены';
  });
  async function callPushFunction(payload) {
    if (!cloud || !session) throw new Error('Нужно войти в планер');
    const {data, error} = await cloud.functions.invoke('push-notifications', {body: payload});
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data;
  }
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }
  async function refreshPushStatus() {
    const status = $('#pushStatus');
    const button = $('#togglePush');
    if (!status || !button) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      status.textContent = 'Этот браузер не поддерживает push-уведомления.';
      button.disabled = true; return;
    }
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        status.textContent = (typeof Notification !== 'undefined' && Notification.permission === 'granted') ? 'Уведомления включены на этом устройстве.' : 'Подписка найдена, но разрешение браузера не выдано.';
        button.textContent = 'Отключить уведомления'; button.disabled = false;
      } else if (Notification.permission === 'denied') {
        status.textContent = 'Уведомления запрещены в настройках iPhone. Разреши их в настройках сайта.';
        button.textContent = 'Разрешить в настройках iPhone'; button.disabled = false;
      } else {
        status.textContent = 'Push отправляется сервером по времени события, даже когда планер закрыт.';
        button.textContent = 'Включить уведомления'; button.disabled = false;
      }
    } catch {
      status.textContent = 'Сначала добавь планер на экран «Домой» и открой его с иконки.';
      button.disabled = false;
    }
  }
  async function togglePushNotifications() {
    const button = $('#togglePush');
    const status = $('#pushStatus');
    if (!cloud || !session) { status.textContent = 'Сначала войди в планер.'; return; }
    button.disabled = true;
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('Этот браузер не поддерживает push-уведомления.');
      }
      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await callPushFunction({action:'unsubscribe', endpoint:existing.endpoint});
        await existing.unsubscribe();
        status.textContent = 'Уведомления отключены на этом устройстве.';
        button.textContent = 'Включить уведомления';
        return;
      }
      const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
      if (isIOS && !standalone) throw new Error('На iPhone сначала выбери Safari → Поделиться → На экран «Домой», затем открой планер с иконки.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Разрешение на уведомления не выдано.');
      const {publicKey} = await callPushFunction({action:'public-key'});
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey)
      });
      await callPushFunction({action:'subscribe', subscription:subscription.toJSON(), userAgent:navigator.userAgent});
      status.textContent = 'Готово! Сервер сможет присылать напоминания по событиям.';
      button.textContent = 'Отключить уведомления';
    } catch (error) {
      status.textContent = error?.message || 'Не удалось включить уведомления. Попробуй ещё раз.';
    } finally { button.disabled = false; }
  }
  const itemDialog = $('#itemDialog');
  itemDialog.addEventListener('cancel',()=>{ editingId=null; });
  itemDialog.addEventListener('close',()=>{
    editingId=null;
    $('#itemForm').reset();
  });
  itemDialog.addEventListener('click',event=>{
    if(event.target===itemDialog) itemDialog.close();
  });
  $('#itemForm').addEventListener('submit',e=>{
    // Cancel buttons bypass validation and let the native method=dialog close the window.
    if (e.submitter?.hasAttribute('data-cancel-item')) return;
    e.preventDefault();
    const title=$('#itemTitle').value.trim();if(!title)return;
    const payload={title,category:$('#itemCategory').value,date:$('#itemDate').value||today(),time:$('#itemTime').value,notes:$('#itemNotes').value.trim(),remindBefore:Number($('#itemReminder').value)||0};
    if(editingId) { const old=items.find(x=>x.id===editingId); if(old)Object.assign(old,payload); }
    else items.push({id:crypto.randomUUID?crypto.randomUUID():String(Date.now())+'-'+Math.random().toString(36).slice(2),...payload,done:false,createdAt:new Date().toISOString()});
    saveItems();editingId=null;itemDialog.close();render();
  });
  $$('.tab').forEach(b=>b.addEventListener('click',()=>setView(b.dataset.view)));
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;$('#installBtn').classList.remove('hidden');});
  $('#installBtn').addEventListener('click',async()=>{
    if(!deferredPrompt){alert('На iPhone открой сайт в Safari, нажми «Поделиться» и выбери «На экран Домой».');return;}
    deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;$('#installBtn').classList.add('hidden');
  });
  if('serviceWorker' in navigator && (location.protocol==='https:' || location.hostname==='localhost')) {
    window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
  }
  render();
  if (!cloud) {
    $('#authStatus').textContent = 'Для входа нужен интернет: не удалось загрузить модуль авторизации.';
  } else {
    cloud.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession) { if (event !== 'INITIAL_SESSION' || !activeCloudUserId) syncFromCloud(nextSession); }
      else if (event === 'SIGNED_OUT') showSignedOut();
    });
    cloud.auth.getSession().then(({data}) => {
      if (data.session) syncFromCloud(data.session);
      else showSignedOut();
    }).catch(() => showSignedOut());
  }
})();