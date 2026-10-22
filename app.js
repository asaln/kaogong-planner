/* ============================================================
   考公计划表 · 前端核心逻辑
   - 打卡 / 修改任务 / 增删日期：本地即时生效 + 云端实时同步
   - 多端（手机/电脑/不同浏览器）打开同一网址，进度互通
   - 纯静态前端 + GitHub Pages + Actions 后端，无需自建服务器
   ============================================================ */
(function () {
  'use strict';

  var DATA = window.PLAN_DATA || { stages: [], milestones: [], weekly: [], days: [] };

  /* ---------- 工具 ---------- */
  var escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return escapeMap[c]; });
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtDate(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseDate(s) { var p = String(s).split('-'); return new Date(p[0] | 0, (p[1] | 0) - 1, p[2] | 0); }
  function todayStr() { return fmtDate(new Date()); }
  // 比较两个日期字符串的先后，用于判断"今天/已过期/未到"
  function cmpDay(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  /* ---------- 配置：API 后端地址（双入口）----------
     部署方式 A（推荐，GitHub Pages，零成本）：
       1) Fork 本仓库，开启 Pages（Settings → Pages → Source = GitHub Actions）。
       2) 在仓库 Settings → Secrets and variables → Actions 添加 GH_TOKEN
          （Fine-grained token，权限：当前仓库 Contents:Read and Write）。
       部署步骤（详见 README.md）：
       1) Fork 本仓库到自己的 GitHub 账号，开启 Pages（Source = GitHub Actions）。
       2) 仓库 Settings → Secrets and variables → Actions 添加：
            API_TOKEN  自己定的任意字符串（前后端保持一致，作为访问密码）
            GH_TOKEN   有当前仓库 Contents:Write 权限的 Token（推荐 Fine-grained）
       3) 页面上点 ⚙ 同步设置，填入：
            仓库地址  你的用户名/仓库名（如 zhangsan/kaogong）
            API 令牌  与第 2 步的 API_TOKEN 完全一致
     同步机制（双入口）：
       读取 = 直接 GET Pages 的 /data/progress.json（快、免配额）
       写入 = POST Actions 的 repository_dispatch → 触发 put.yml 合并提交
     若不上云：两栏都留空，进度只存在当前浏览器本地，刷新不丢失。 */
  var API_REPO = '';    // 形如 '用户名/仓库名'，留空则由同步设置表单填写
  var API_BASE = '';    // 留空则走 raw.githubusercontent.com 直读
  var SYNC_KEY = 'syncConfig';
  var CACHE_KEY = 'kaogongCache'; // 本地兜底：最后一次拉到的云端数据
  var EDIT_KEY = 'kaogongEdits';  // 用户自定义修改（任务项增删改、日期增删）
  var NOTE_KEY = 'kaogongNotes';  // 备注/用时
  var CHECK_KEY = 'kaogongChecks'; // 打卡勾选状态
  var SORT_KEY = 'kaogongSort';

  var syncCfg = null;     // {repo, token}
  var editStore = {};     // {date: [items]}
  var noteStore = {};     // {date: {note, mins}}
  var checkStore = {};    // {date: {0:true, 1:true}}
  var dayMap = {};        // date -> 原始 day 对象
  var daysArr = [];       // 合并编辑后的日期数组
  var currentTab = 'daily';
  var sortState = { key: 'date', dir: 1 };
  var filterState = { q: '', stage: '', type: '', done: '' };
  var isOnline = false;
  var pendingTimer = null;
  var PUSH_DELAY = 1200;

  function loadStore(key, def) {
    try { var v = localStorage.getItem(key); if (v) return JSON.parse(v); } catch (e) { }
    return def;
  }
  function saveStore(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { }
  }

  /* ---------- 数据合并 ----------
     原始计划只读，所有修改落在 editStore 上，刷新后从这里还原。
     优先级：editStore 里存在该日期 → 用它；否则用原始 items。 */
  function resolveItems(day) {
    if (editStore[day.date]) return editStore[day.date];
    if (day.items) return day.items;
    // 兜底：传入的是临时对象（如 {date:'xxx'}），从 dayMap 取原始数据
    var orig = dayMap[day.date];
    return (orig && orig.items) || [];
  }
  function buildDays() {
    dayMap = {};
    daysArr = [];
    for (var i = 0; i < DATA.days.length; i++) {
      var d = DATA.days[i];
      dayMap[d.date] = d;
      daysArr.push(d);
    }
    // 编辑仓库里可能有"新增的日期"（原数据没有）
    var ekeys = Object.keys(editStore);
    for (var j = 0; j < ekeys.length; j++) {
      if (!dayMap[ekeys[j]]) {
        daysArr.push({ date: ekeys[j], wk: '', dtype: '标准工作日', tag: '', stage: '', ms: '', items: editStore[ekeys[j]], _added: true });
      }
    }
    daysArr.sort(function (a, b) { return cmpDay(a.date, b.date); });
  }

  /* ---------- 进度计算 ---------- */
  function calc(day) {
    var items = resolveItems(day);
    var total = items.length;
    var done = 0;
    if (total === 0) return { total: 0, done: 0, pct: 0, state: 'none' };
    var cs = checkStore[day.date] || {};
    for (var i = 0; i < total; i++) if (cs[i]) done++;
    var pct = Math.round(done / total * 100);
    var state = pct === 100 ? 'done' : pct > 0 ? 'part' : 'none';
    return { total: total, done: done, pct: pct, state: state };
  }
  function currentStage() {
    var t = todayStr();
    for (var i = 0; i < DATA.stages.length; i++) {
      var s = DATA.stages[i];
      if (cmpDay(t, s.start.replace(/\./g, '-')) >= 0 && cmpDay(t, s.end.replace(/\./g, '-')) <= 0) return s.name;
    }
    // 未落在任何阶段内时，取最近的一个
    for (var j = DATA.stages.length - 1; j >= 0; j--) {
      if (cmpDay(t, DATA.stages[j].end.replace(/\./g, '-')) > 0) return DATA.stages[j].name;
    }
    return DATA.stages[0] ? DATA.stages[0].name : '-';
  }

  /* ============================================================
     渲染：每日打卡表
     ============================================================ */
  var TYPE_LABEL = { '标准工作日': '标准', '值班日': '值班', '游泳日': '游泳', '周末非值班': '周末', '周末值班日': '周末值班' };
  var TAG_LABEL = { 'zb': '值班', 'yp': '游泳', 'dm': '双考', 'lc': '联考' };

  function renderDays() {
    var tbody = document.querySelector('#dayTbl tbody');
    if (!tbody) { console.warn('[renderDays] 找不到 #dayTbl tbody，DOM 未就绪'); return; }
    var rows = [];
    for (var i = 0; i < daysArr.length; i++) rows.push(daysArr[i]);
    rows = applyFilter(rows);
    rows = applySort(rows);

    var html = '';
    for (var r = 0; r < rows.length; r++) {
      var day = rows[r];
      var items = resolveItems(day);
      var c = calc(day);
      var ns = noteStore[day.date] || {};
      var cs = checkStore[day.date] || {};
      var ms = day.ms ? '<span class="ms-flag">' + esc(day.ms) + '</span>' : '';
      var tagHtml = day.tag ? '<span class="tag ' + esc(day.tag) + '">' + esc(TAG_LABEL[day.tag] || day.tag) + '</span>' : '';
      var typeHtml = '<span class="typepill ' + esc(day.dtype || '') + '">' + esc(TYPE_LABEL[day.dtype] || day.dtype || '-') + '</span>';
      var li = '';
      for (var k = 0; k < items.length; k++) {
        var txt = String(items[k] == null ? '' : items[k]);
        var cls = cs[k] ? ' class="done"' : '';
        var chked = cs[k] ? ' checked' : '';
        // 任务文本：多行安全，保留换行，双击编辑，点击勾选
        li += '<li' + cls + ' data-i="' + k + '">' +
              '<input type="checkbox" data-date="' + day.date + '" data-i="' + k + '"' + chked + ' aria-label="标记完成">' +
              '<span class="itxt" contenteditable="true" data-date="' + day.date + '" data-i="' + k + '" spellcheck="false">' +
                txt.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>') +
              '</span>' +
              '<button class="xdel" data-date="' + day.date + '" data-i="' + k + '" title="删除这条任务">×</button>' +
              '</li>';
      }
      var op = '<button class="opbtn additem" data-date="' + day.date + '">＋</button>' +
               '<button class="opbtn editday" data-date="' + day.date + '">✎</button>' +
               '<button class="opbtn delday" data-date="' + day.date + '">🗑</button>';
      var trCls = ' class="' + (c.state === 'done' ? 'done-row' : c.state === 'part' ? 'part-row' : '') + '"';
      var pctCls = ' class="pct ' + (c.state === 'done' ? 'pctdone' : c.state === 'part' ? 'pctpart' : '') + '"';
      var isToday = day.date === todayStr() ? ' data-today="1"' : '';
      html +=
        '<tr' + trCls + isToday + ' data-date="' + day.date + '">' +
        '<td data-l="日期"><b>' + esc(day.date) + '</b>' + (isToday ? '<br><span class="today-badge">今</span>' : '') + '</td>' +
        '<td data-l="星期">' + esc(day.wk || '') + '</td>' +
        '<td data-l="阶段">' + esc(day.stage || '-') + '</td>' +
        '<td data-l="类型">' + typeHtml + '</td>' +
        '<td data-l="节点">' + ms + '</td>' +
        '<td data-l="任务"><div class="taskbox"><ul>' + li + '</ul>' +
          '<button class="addone" data-date="' + day.date + '">＋ 新增一条任务</button></div></td>' +
        '<td data-l="完成度"' + pctCls + '>' + c.pct + '%<div class="minitrack"><i style="width:' + c.pct + '%"></i></div></td>' +
        '<td data-l="用时"><input class="mini-note" type="number" min="0" step="10" placeholder="分钟" data-date="' + day.date + '" data-f="mins" value="' + (ns.mins || '') + '"></td>' +
        '<td data-l="备注"><input class="mini-note" type="text" placeholder="备注" data-date="' + day.date + '" data-f="note" value="' + esc(ns.note || '') + '"></td>' +
        '<td data-l="操作" class="opcell">' + op + '</td>' +
        '</tr>';
    }
    tbody.innerHTML = html || '<tr><td colspan="10" style="text-align:center;color:#999;padding:30px;">没有符合条件的日期，试试清空筛选条件</td></tr>';

    // 绑定事件（事件委托放在 tbody 上，见 bindEvents）
  }

  function applyFilter(list) {
    var q = filterState.q.trim();
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (filterState.stage && d.stage !== filterState.stage) continue;
      if (filterState.type && d.dtype !== filterState.type) continue;
      if (q) {
        var hay = (d.date + ' ' + (d.wk || '') + ' ' + (d.stage || '') + ' ' + (d.dtype || '') + ' ' + resolveItems(d).join(' ')).toLowerCase();
        if (hay.indexOf(q.toLowerCase()) === -1) continue;
      }
      if (filterState.done) {
        var s = calc(d).state;
        if (filterState.done === 'done' && s !== 'done') continue;
        if (filterState.done === 'none' && s !== 'none') continue;
        if (filterState.done === 'part' && s !== 'part') continue;
      }
      out.push(d);
    }
    return out;
  }
  function applySort(list) {
    var k = sortState.key, dir = sortState.dir;
    var arr = list.slice();
    arr.sort(function (a, b) {
      var va, vb;
      if (k === 'pct') { va = calc(a).pct; vb = calc(b).pct; }
      else if (k === 'date') { return cmpDay(a.date, b.date) * dir; }
      else { va = String(a[k] || ''); vb = String(b[k] || ''); return va.localeCompare(vb, 'zh') * dir; }
      return (va - vb) * dir;
    });
    return arr;
  }

  /* ============================================================
     写入操作：打卡 / 改任务 / 改备注
     每个写入都做两件事：① 改本地 store 并立刻重算 ② 推送到云端
     ============================================================ */
  function setCheck(date, i, val) {
    if (!checkStore[date]) checkStore[date] = {};
    if (val) checkStore[date][i] = 1; else delete checkStore[date][i];
    saveStore(CHECK_KEY, checkStore);
    refreshStats();
    // 只更新这一行的完成度，不全量重绘（保留滚动位置与焦点）
    var tr = document.querySelector('#dayTbl tr[data-date="' + date + '"]');
    if (tr) {
      var c = calc(dayMap[date] || { date: date, items: resolveItems({ date: date }) });
      // 用快照重算
      var total = resolveItems({ date: date }).length;
      var done = 0, cs = checkStore[date] || {};
      for (var k = 0; k < total; k++) if (cs[k]) done++;
      var pct = total ? Math.round(done / total * 100) : 0;
      var td = tr.querySelector('.pct');
      if (td) {
        td.textContent = pct + '%';
        td.className = 'pct ' + (pct === 100 ? 'pctdone' : pct > 0 ? 'pctpart' : '');
        var track = tr.querySelector('.minitrack i');
        if (track) track.style.width = pct + '%';
      }
      tr.className = pct === 100 ? 'done-row' : pct > 0 ? 'part-row' : '';
    }
    schedulePush();
  }

  function setNote(date, f, val) {
    if (!noteStore[date]) noteStore[date] = {};
    noteStore[date][f] = val;
    saveStore(NOTE_KEY, noteStore);
    schedulePush();
  }

  // 保存某天的任务清单（覆盖式）
  function setItems(date, items) {
    editStore[date] = items.filter(function (t) { return String(t).trim() !== ''; });
    if (editStore[date].length === 0 && !dayMap[date]) delete editStore[date];
    saveStore(EDIT_KEY, editStore);
    buildDays();
    renderDays();
    refreshStats();
    renderStages();
    schedulePush();
  }

  // 单条任务编辑：原位更新（contenteditable 失焦时调用）
  function editItem(date, i, newText) {
    var cur = resolveItems({ date: date }).slice();
    newText = newText.replace(/<br\s*\/?>(\s)?/gi, function (m, sp) { return '\n' + (sp || ''); });
    newText = newText.replace(/&nbsp;/g, ' ');
    var div = document.createElement('div');
    div.innerHTML = newText;
    newText = (div.textContent || div.innerText || '').trim();
    if (i >= cur.length) return;
    if (cur[i] === newText) return; // 没变化，不写
    cur[i] = newText;
    editStore[date] = cur;
    saveStore(EDIT_KEY, editStore);
    schedulePush();
  }

  function addItem(date, text) {
    var cur = resolveItems({ date: date }).slice();
    cur.push(text || '新任务（点这里修改）');
    editStore[date] = cur;
    saveStore(EDIT_KEY, editStore);
    buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
  }

  function delItem(date, i) {
    var cur = resolveItems({ date: date }).slice();
    cur.splice(i, 1);
    editStore[date] = cur;
    // 同步清理勾选与备注
    if (checkStore[date]) { delete checkStore[date][i]; saveStore(CHECK_KEY, checkStore); }
    saveStore(EDIT_KEY, editStore);
    buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
  }

  function addNewDay() {
    var def = todayStr();
    var date = window.prompt('新增日期（格式 YYYY-MM-DD，留空则用今天）：', def);
    if (date == null) return;
    date = date.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { toast('格式错误，请用 YYYY-MM-DD'); return; }
    if (dayMap[date] || editStore[date]) { toast('这一天已存在'); return; }
    editStore[date] = ['新任务（双击修改内容）'];
    saveStore(EDIT_KEY, editStore);
    buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
    filterState = { q: date, stage: '', type: '', done: '' };
    syncFilters();
    toast('已新增 ' + date + '，请填写任务');
  }

  function delDay(date) {
    confirmBox('删除这一天的计划？', '日期 <b>' + esc(date) + '</b> 的任务清单、打卡记录、备注都会被删除，且<b>无法自动恢复</b>。确定继续吗？', function () {
      delete editStore[date];
      delete checkStore[date];
      delete noteStore[date];
      saveStore(EDIT_KEY, editStore); saveStore(CHECK_KEY, checkStore); saveStore(NOTE_KEY, noteStore);
      buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
      toast('已删除 ' + date);
    });
  }

  function resetAllTasks() {
    confirmBox('恢复全部原始任务？', '这将清空你对任务清单的所有自定义修改（新增/删除/改写的任务文字）。<br><b>打卡进度、用时、备注会保留。</b><br>确定恢复吗？', function () {
      editStore = {};
      saveStore(EDIT_KEY, editStore);
      buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
      toast('已恢复全部原始任务，打卡进度保留');
    });
  }

  function clearAll() {
    confirmBox('清空全部进度？', '将清空<b>所有</b>打卡勾选、用时、备注。<br>任务清单会保留。此操作不可自动恢复。', function () {
      checkStore = {}; noteStore = {};
      saveStore(CHECK_KEY, checkStore); saveStore(NOTE_KEY, noteStore);
      buildDays(); renderDays(); refreshStats(); renderStages(); schedulePush();
      toast('已清空全部进度');
    });
  }

  /* ============================================================
     统计 / 阶段 / 节点 / 周计划
     ============================================================ */
  function refreshStats() {
    var doneDays = 0, totalDone = 0, totalTask = 0;
    for (var i = 0; i < daysArr.length; i++) {
      var c = calc(daysArr[i]);
      if (c.total > 0 && c.pct === 100) doneDays++;
      totalDone += c.done; totalTask += c.total;
    }
    var rate = totalTask ? Math.round(totalDone / totalTask * 100) : 0;
    setText('stDone', doneDays);
    setText('stRate', rate + '%');
    setText('stTask', totalDone);
    setText('stTotal', totalTask);
    setText('stStage', currentStage());
  }
  function setText(id, v) {
    var el = document.getElementById(id);
    if (el) el.textContent = v;
  }

  function renderStages() {
    var grid = document.getElementById('stageGrid');
    var bars = document.getElementById('stageBars');
    if (!grid) return;
    var html = '', bhtml = '';
    for (var i = 0; i < DATA.stages.length; i++) {
      var s = DATA.stages[i];
      var ds = s.start.replace(/\./g, '-'), de = s.end.replace(/\./g, '-');
      var daysIn = 0, doneIn = 0, taskIn = 0;
      for (var j = 0; j < daysArr.length; j++) {
        var d = daysArr[j];
        if (cmpDay(d.date, ds) >= 0 && cmpDay(d.date, de) <= 0) {
          daysIn++;
          var c = calc(d);
          taskIn += c.total; doneIn += c.done;
        }
      }
      var pct = taskIn ? Math.round(doneIn / taskIn * 100) : 0;
      var cur = currentStage() === s.name;
      html += '<div class="stage-card' + (cur ? ' cur' : '') + '">' +
              '<div class="sn">' + esc(s.name) + (cur ? ' <span class="cur-tag">进行中</span>' : '') + '</div>' +
              '<div class="sd">' + esc(s.start) + ' ~ ' + esc(s.end) + ' · ' + daysIn + '天</div>' +
              '<div class="sg">目标：' + esc(s.goal) + '</div>' +
              '<div class="st">标准：' + esc(s.std) + '</div>' +
              '</div>';
      bhtml += '<div class="pbar"><div class="pl"><span>' + esc(s.name) + ' · ' + esc(s.goal) + '</span><span>' + pct + '%</span></div>' +
               '<div class="track"><div class="fill" style="width:' + pct + '%"></div></div></div>';
    }
    grid.innerHTML = html;
    if (bars) bars.innerHTML = bhtml;
  }

  function renderMilestones() {
    var ul = document.getElementById('msList');
    if (!ul) return;
    var t = todayStr();
    var rows = DATA.milestones.slice().sort(function (a, b) { return cmpDay(a.date, b.date); });
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var m = rows[i];
      var cls = cmpDay(m.date, t) < 0 ? 'm-past' : cmpDay(m.date, t) === 0 ? 'm-today' : 'm-fut';
      html += '<li class="' + cls + '"><span class="md">' + esc(m.date) + '</span>' +
              '<div><span class="mt">' + esc(m.title) + '</span>' +
              '<div class="mn">目标：' + esc(m.goal) + '　备注：' + esc(m.note || '-') + '</div></div></li>';
    }
    ul.innerHTML = html;
  }

  function renderWeekly() {
    var tbody = document.querySelector('#weekTbl tbody');
    if (!tbody) return;
    var rows = DATA.weekly.slice();
    if (sortState.key === 'w' || sortState.key === 'range' || sortState.key === 'duty' || sortState.key === 'theme' || sortState.key === 'std') {
      rows.sort(function (a, b) {
        var va = String(a[sortState.key] || ''), vb = String(b[sortState.key] || '');
        return va.localeCompare(vb, 'zh') * sortState.dir;
      });
    }
    var html = '';
    for (var i = 0; i < rows.length; i++) {
      var w = rows[i];
      html += '<tr><td data-l="周期">' + esc(w.w) + '</td><td data-l="日期">' + esc(w.range) + '</td>' +
              '<td data-l="值班类型">' + esc(w.duty || '-') + '</td><td data-l="本周主攻"><b>' + esc(w.theme) + '</b></td>' +
              '<td data-l="每日要点" class="wk-task">' + esc(w.task || '-') + '</td><td data-l="验收标准">' + esc(w.std || '-') + '</td></tr>';
    }
    tbody.innerHTML = html;
  }

  /* ============================================================
     排序 / 筛选 / 标签页
     ============================================================ */
  function syncFilters() {
    var q = document.getElementById('qDate'); if (q) q.value = filterState.q;
    var s = document.getElementById('fStage'); if (s) s.value = filterState.stage;
    var t = document.getElementById('fType'); if (t) t.value = filterState.type;
    var d = document.getElementById('fDone'); if (d) d.value = filterState.done;
  }
  function bindFilters() {
    var q = document.getElementById('qDate');
    if (q) q.addEventListener('input', function (e) { filterState.q = e.target.value; renderDays(); });
    ['fStage', 'fType', 'fDone'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('change', function (e) {
        var f = e.target.id.replace('f', '').toLowerCase();
        var map = { stage: 'stage', type: 'type', done: 'done' };
        filterState[map[f]] = e.target.value; renderDays();
      });
    });
  }
  function bindSort() {
    document.querySelectorAll('#dayTbl th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (sortState.key === k) sortState.dir = -sortState.dir; else { sortState.key = k; sortState.dir = 1; }
        saveStore(SORT_KEY, sortState);
        renderDays();
      });
    });
  }

  function switchTab(name) {
    currentTab = name;
    document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    var panel = document.getElementById('tab-' + name);
    if (panel) panel.classList.add('active');
    var btn = document.getElementById('tabBtn-' + name);
    if (btn) btn.classList.add('active');
    if (name === 'weekly') renderWeekly();
  }

  function backToToday() {
    filterState = { q: '', stage: '', type: '', done: '' };
    syncFilters(); renderDays();
    var t = todayStr();
    var el = document.querySelector('#dayTbl tr[data-date="' + t + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('today-focus');
      setTimeout(function () { el.classList.remove('today-focus'); }, 2600);
    } else {
      var tbl = document.querySelector('#dayTbl');
      if (tbl) tbl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }

  // 网页打开时自动定位到今天的打卡行（仅在没有主动筛选/搜索时执行）
  function autoFocusToday() {
    if (filterState.q || filterState.stage || filterState.type || filterState.done) return;
    backToToday();
  }

  /* ============================================================
     事件委托：勾选 / 编辑任务 / 删除 / 备注
     关键改动：contenteditable 让任务真正可编辑并保留换行；
     失焦才落盘，避免输入过程中频繁写入。
     ============================================================ */
  function bindEvents() {
    var tbody = document.querySelector('#dayTbl tbody');
    if (tbody) {
      tbody.addEventListener('change', function (e) {
        var el = e.target;
        if (el.matches('input[type="checkbox"]')) {
          setCheck(el.getAttribute('data-date'), +el.getAttribute('data-i'), el.checked);
        } else if (el.matches('input.mini-note')) {
          setNote(el.getAttribute('data-date'), el.getAttribute('data-f'), el.value);
        }
      });
      tbody.addEventListener('click', function (e) {
        var el = e.target;
        if (el.matches('.xdel')) { delItem(el.getAttribute('data-date'), +el.getAttribute('data-i')); return; }
        if (el.matches('.addone') || el.matches('.additem')) { addItem(el.getAttribute('data-date'), ''); return; }
        if (el.matches('.editday')) { editDay(el.getAttribute('data-date')); return; }
        if (el.matches('.delday')) { delDay(el.getAttribute('data-date')); return; }
      });
      tbody.addEventListener('focusout', function (e) {
        var el = e.target;
        if (el.matches('.itxt')) {
          editItem(el.getAttribute('data-date'), +el.getAttribute('data-i'), el.innerHTML);
        }
      });
      // 回车结束编辑并落盘（Shift+Enter 才换行）
      tbody.addEventListener('keydown', function (e) {
        if (e.target.matches('.itxt') && e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault(); e.target.blur();
        }
      });
    }
    bindFilters();
    bindSort();
  }

  function editDay(date) {
    var cur = resolveItems({ date: date });
    var txt = window.prompt('修改这一天的任务清单\n一行一条，可多行编辑：', cur.join('\n'));
    if (txt == null) return;
    var items = txt.split(/\r?\n/).map(function (t) { return t.trim(); }).filter(function (t) { return t !== ''; });
    setItems(date, items);
    toast('已保存 ' + date + ' 的任务清单');
  }

  /* ============================================================
     云端同步：通过后端 API 读写 progress.json
     ============================================================ */
  function loadSyncCfg() {
    syncCfg = loadStore(SYNC_KEY, null);
  }
  function isConfigured() { return !!(syncCfg && syncCfg.repo && syncCfg.token); }

  /* ---------- API：双入口（详见 README.md 部署说明）----------
     读取（GET）  → 直接读 Pages 上的 /data/progress.json
                    （公开、CDN 缓存、不消耗 Actions 配额，毫秒级）
     写入（PUT）  → POST 到 Actions 的 repository_dispatch 入口
                    → 触发 put.yml workflow 合并提交回仓库
                    → workflow 跑完约 10-30 秒后，前端再次 GET 即拿到新值
     冲突解决    → 每次写入带时间戳 _t，服务端按"较新者优先"合并，
                    不会因两个设备并发而互相覆盖。 */
  function api(path, opts) {
    opts = opts || {};
    var isWrite = (opts.method || 'GET') !== 'GET';
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (isWrite) {
      // 写入走 Actions：仓库地址与令牌都从同步设置里取，不写死在前端
      var repo = (syncCfg && syncCfg.repo) || API_REPO;
      var tok = (syncCfg && syncCfg.token) || '';
      if (!repo) return Promise.reject(new Error('API_NOT_CONFIGURED'));
      return fetch('https://api.github.com/repos/' + repo + '/actions/workflows/put.yml/dispatches', {
        method: 'POST',
        headers: Object.assign({}, headers, { 'Authorization': 'Bearer ' + tok, 'Accept': 'application/vnd.github+json' }),
        body: JSON.stringify({
          ref: 'main',
          inputs: { payload: b64encode(opts.body || '{}') }
        })
      }).then(function (r) {
        if (r.status === 204 || r.status === 200) return { queued: true };
        if (r.status === 401 || r.status === 403) throw new Error('TOKEN_INVALID');
        if (r.status === 404) throw new Error('API_NOT_FOUND'); // workflow 未部署或仓库地址错
        return r.json().then(function (d) { throw new Error('HTTP ' + r.status + ' ' + (d && d.message || '')); },
                             function () { throw new Error('HTTP ' + r.status); });
      });
    }
    // 读取走 Pages 静态资源
    var base = API_BASE || 'https://raw.githubusercontent.com/' + ((syncCfg && syncCfg.repo) || API_REPO) + '/main';
    return fetch(base.replace(/\/$/, '') + '/data/progress.json?_=' + Date.now(), { cache: 'no-cache' })
      .then(function (r) {
        if (r.status === 404) return { _version: 0, checks: {}, notes: {}, edits: {} };
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  // 拉取：合并到本地（云端优先，但本地有更晚的修改则保留本地）
  function pull() {
    if (!isConfigured()) { setSyncStatus('noset'); return Promise.resolve(); }
    setSyncStatus('syncing');
    return api('/progress.json').then(function (remote) {
      var updated = 0;
      if (remote.checks) {
        for (var k in remote.checks) {
          if (!checkStore[k] || (remote.checks[k]._t || 0) >= (getT(checkStore[k]) || 0)) {
            checkStore[k] = remote.checks[k]; updated++;
          }
        }
      }
      if (remote.notes) {
        for (var n in remote.notes) {
          if (!noteStore[n] || (remote.notes[n]._t || 0) >= (getT(noteStore[n]) || 0)) noteStore[n] = remote.notes[n];
        }
      }
      if (remote.edits) {
        for (var e in remote.edits) {
          if (!editStore[e] || (remote.edits[e]._t || 0) >= (getT(editStore[e]) || 0)) editStore[e] = remote.edits[e];
        }
      }
      saveStore(CHECK_KEY, checkStore); saveStore(NOTE_KEY, noteStore); saveStore(EDIT_KEY, editStore);
      buildDays(); renderDays(); refreshStats(); renderStages();
      saveStore(CACHE_KEY, { checks: checkStore, notes: noteStore, edits: editStore, at: Date.now() });
      isOnline = true; setSyncStatus('online');
      if (updated > 0) toast('已从云端同步 ' + updated + ' 项更新');
      return remote;
    }).catch(function (err) {
      if (String(err).indexOf('TOKEN_INVALID') > -1) {
        setSyncStatus('invalid'); toast('同步令牌无效，请点 ⚙ 同步设置重新填写', true);
      } else {
        isOnline = false; setSyncStatus('offline'); console.warn('[sync] pull failed', err);
      }
    });
  }

  // 推送：把本地全量进度发给后端（后端负责合并落盘）
  function push() {
    if (!isConfigured()) { setSyncStatus('noset'); return; }
    var payload = {
      checks: stamp(checkStore),
      notes: stamp(noteStore),
      edits: stamp(editStore),
      client: shortId()
    };
    setSyncStatus('syncing');
    api('/progress.json', { method: 'PUT', body: JSON.stringify(payload) })
      .then(function () {
        isOnline = true; setSyncStatus('queued');
        // workflow 跑完约 10-30 秒，稍后主动拉一次确认最新值
        setTimeout(pull, 12000);
        saveStore(CACHE_KEY, { checks: checkStore, notes: noteStore, edits: editStore, at: Date.now() });
      })
      .catch(function (err) {
        var msg = String(err && err.message || err);
        if (msg.indexOf('TOKEN_INVALID') > -1) { setSyncStatus('invalid'); toast('同步令牌无效', true); }
        else if (msg.indexOf('API_NOT_FOUND') > -1) { setSyncStatus('offline'); toast('写入入口未就绪，请确认 put.yml workflow 已推送', true); }
        else if (msg.indexOf('API_NOT_CONFIGURED') > -1) { setSyncStatus('noset'); }
        else { isOnline = false; setSyncStatus('offline'); console.warn('[sync] push failed', msg); }
      });
  }
  function schedulePush() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(function () { pendingTimer = null; push(); }, PUSH_DELAY);
  }
  function stamp(obj) {
    var o = JSON.parse(JSON.stringify(obj || {}));
    o._t = Date.now();
    return o;
  }
  function getT(v) { return (v && v._t) || 0; }
  function shortId() { return (navigator.userAgent || 'unk').slice(0, 40); }
  function b64encode(str) {
    // UTF-8 安全的 base64 编码
    var s = typeof str === 'string' ? str : JSON.stringify(str);
    if (typeof btoa === 'function') {
      try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { }
    }
    return s;
  }

  function setSyncStatus(s) {
    var el = document.getElementById('syncStatus');
    if (!el) return;
    var map = {
      online: ['●', '云端已同步', 'ok'],
      queued: ['◐', '已提交，同步中…', 'ing'],
      syncing: ['◐', '同步中…', 'ing'],
      offline: ['○', '本地模式（未同步）', 'off'],
      invalid: ['⚠', '令牌无效', 'bad'],
      noset: ['○', '未配置', 'off']
    };
    var m = map[s] || map.offline;
    el.innerHTML = '<span class="dot ' + m[2] + '">' + m[0] + '</span>' + m[1];
    el.className = 'sync-status ' + m[2];
  }

  /* ---------- 同步设置弹窗 ---------- */
  function openSyncConfig() {
    var box = document.getElementById('syncBox');
    var mask = document.getElementById('syncMask');
    if (box) box.style.display = 'block';
    if (mask) mask.style.display = 'block';
    var inp = document.getElementById('apiToken');
    var irep = document.getElementById('apiRepo');
    if (inp && syncCfg) inp.value = syncCfg.token || '';
    if (irep && syncCfg) irep.value = syncCfg.repo || '';
  }
  function closeSyncConfig() {
    var box = document.getElementById('syncBox');
    var mask = document.getElementById('syncMask');
    if (box) box.style.display = 'none';
    if (mask) mask.style.display = 'none';
  }
  function saveSyncConfig() {
    var rep = document.getElementById('apiRepo');
    var tok = document.getElementById('apiToken');
    var r = rep ? rep.value.trim() : '';
    var t = tok ? tok.value.trim() : '';
    if (!r && !t) { toast('请至少填写一项，或保持空即为仅本机模式', true); syncCfg = null; saveStore(SYNC_KEY, null); closeSyncConfig(); return; }
    if (r && !/^[\w.-]+\/[\w.-]+$/.test(r)) { toast('仓库地址格式应为 用户名/仓库名', true); return; }
    if (!t) { toast('请填写同步令牌', true); return; }
    syncCfg = { repo: r, token: t };
    saveStore(SYNC_KEY, syncCfg);
    toast('配置已保存，正在同步…');
    closeSyncConfig();
    pull().then(function () { push(); });
  }
  function testConnection() {
    if (!isConfigured()) { toast('请先填写并保存令牌', true); return; }
    toast('正在连接…');
    pull().then(function (r) {
      if (r) toast('连接成功！云端共有 ' + Object.keys(r.checks || {}).length + ' 天的进度记录');
    });
  }

  /* ============================================================
     导入 / 导出（本地 JSON 备份，作为云端之外的第二份保险）
     ============================================================ */
  function exportData() {
    var blob = {
      exportedAt: new Date().toISOString(),
      planVersion: (DATA.stages[0] && DATA.stages[0].start) || '2026.10.15',
      checks: checkStore, notes: noteStore, edits: editStore, sync: syncCfg
    };
    var url = URL.createObjectURL(new Blob([JSON.stringify(blob, null, 2)], { type: 'application/json' }));
    var a = document.createElement('a');
    a.href = url; a.download = 'kaogong-backup-' + todayStr() + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出备份文件');
  };
  function bindImport() {
    var f = document.getElementById('importFile');
    if (!f) return;
    f.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        try {
          var json = JSON.parse(ev.target.result);
          if (json.checks) { checkStore = json.checks; saveStore(CHECK_KEY, checkStore); }
          if (json.notes) { noteStore = json.notes; saveStore(NOTE_KEY, noteStore); }
          if (json.edits) { editStore = json.edits; saveStore(EDIT_KEY, editStore); }
          buildDays(); renderDays(); refreshStats(); renderStages();
          push();
          toast('备份已导入（打卡/备注/任务修改已恢复，计划清单未改动）');
        } catch (err) { toast('备份文件格式错误：' + err.message, true); }
      };
      reader.readAsText(file);
      f.value = '';
    });
  }

  /* ---------- 通用提示 & 确认弹窗 ---------- */
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = document.getElementById('tip');
    if (!el) { console.log(msg); return; }
    el.textContent = msg;
    el.className = 'show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = ''; }, 2600);
  }
  function confirmBox(title, body, ok) {
    var mask = document.getElementById('confirmMask');
    var box = document.getElementById('confirmBox');
    document.getElementById('confirmTitle').innerHTML = esc(title);
    document.getElementById('confirmBody').innerHTML = body;
    if (mask) mask.classList.add('show');
    if (box) box.classList.add('show');
    var ob = document.getElementById('confirmOk');
    var cb = document.getElementById('confirmCancel');
    ob.onclick = function () { hide(); ok && ok(); };
    cb.onclick = hide;
    function hide() {
      if (mask) mask.classList.remove('show');
      if (box) box.classList.remove('show');
    }
  }

  /* ============================================================
     初始化
     ============================================================ */
  function initStagesFilter() {
    var sel = document.getElementById('fStage');
    if (!sel) return;
    for (var i = 0; i < DATA.stages.length; i++) {
      var o = document.createElement('option');
      o.value = DATA.stages[i].name; o.textContent = DATA.stages[i].name;
      sel.appendChild(o);
    }
  }

  function init() {
    loadSyncCfg();
    sortState = loadStore(SORT_KEY, sortState);
    buildDays();
    initStagesFilter();
    bindEvents();
    bindImport();
    renderDays();
    refreshStats();
    renderStages();
    renderMilestones();
    window.switchTab('daily');
    setSyncStatus(isConfigured() ? 'syncing' : 'offline');

    window.addEventListener('beforeunload', function () { if (pendingTimer) push(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && isConfigured()) pull();
    });

    if (isConfigured()) pull().then(function () { push(); });
    else {
      var cache = loadStore(CACHE_KEY, null);
      if (cache) { if (cache.checks) checkStore = cache.checks; if (cache.notes) noteStore = cache.notes; if (cache.edits) editStore = cache.edits; buildDays(); renderDays(); refreshStats(); }
      toast('当前为本地模式：进度仅存在本机。点 ⚙ 同步设置可开启多端同步');
    }

    window.addEventListener('online', function () { if (isConfigured()) pull(); });

    // 打开网页自动定位到当天任务（本地与云端数据就绪后再定位）
    if (isConfigured()) {
      pull().then(function () { autoFocusToday(); });
    } else {
      autoFocusToday();
    }
  }

  // 仅挂载真实存在的函数，避免 ReferenceError 导致 init() 无法执行
  window.backToToday = backToToday;
  window.renderWeekly = renderWeekly;
  window.applyFilter = applyFilter;
  window.deleteDay = delDay;
  window.saveSyncConfig = saveSyncConfig;
  window.openSyncConfig = openSyncConfig;
  window.closeSyncConfig = closeSyncConfig;
  window.testConnection = testConnection;
  window.switchTab = switchTab;
  window.addNewDay = addNewDay;
  window.clearAll = clearAll;
  window.resetAllTasks = resetAllTasks;
  window.exportData = exportData;
  window.renderDays = renderDays;
  window.renderStages = renderStages;
  window.delDay = delDay;
  window.renderMilestones = renderMilestones;

  function boot() {
    try {
      init();
    } catch (e) {
      console.error('[考公计划表] 初始化失败：', e);
      var t = document.getElementById('tip');
      if (t) { t.textContent = '页面初始化出错：' + e.message + '（请按 F12 查看控制台）'; t.className = 'show err'; }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
