// 考公备考计划表 - 核心修复版
const START_DATE = new Date('2026-10-15');
const END_DATE = new Date('2027-11-27');
const STAGES = ['基础阶段', '强化阶段', '冲刺阶段', '模考阶段'];

// 初始化数据
function initData() {
    if (localStorage.getItem('tasks')) {
        window.tasks = JSON.parse(localStorage.getItem('tasks'));
    } else {
        window.tasks = generateDefaultTasks();
        saveData();
    }
    if (!window.config) {
        window.config = { stage: '基础阶段', sync: false };
    }
}

// 生成默认409天任务
function generateDefaultTasks() {
    const tasks = [];
    let current = new Date(START_DATE);
    let stageIndex = 0;
    
    while (current <= END_DATE) {
        const dateStr = current.toISOString().split('T')[0];
        const day = current.getDay();
        const weekday = ['周日','周一','周二','周三','周四','周五','周六'][day];
        
        tasks.push({
            date: dateStr,
            weekday: weekday,
            stage: STAGES[stageIndex],
            type: '每日备考',
            node: '日常学习',
            task: getTaskByStage(STAGES[stageIndex]),
            done: false,
            progress: 0,
            time: 0,
            note: ''
        });
        
        // 简单阶段切换逻辑
        if (tasks.length > 100 && stageIndex === 0) stageIndex = 1;
        if (tasks.length > 250 && stageIndex === 1) stageIndex = 2;
        if (tasks.length > 350 && stageIndex === 2) stageIndex = 3;
        
        current.setDate(current.getDate() + 1);
    }
    return tasks;
}

function getTaskByStage(stage) {
    if (stage === '基础阶段') return '【基础】学习各模块解题方法 (2h)';
    if (stage === '强化阶段') return '【强化】专项刷题+错题整理 (3h)';
    if (stage === '冲刺阶段') return '【冲刺】套卷训练+查漏补缺 (3h)';
    return '【模考】全真模拟考试 (4h)';
}

function saveData() {
    localStorage.setItem('tasks', JSON.stringify(window.tasks));
}

// 渲染打卡表
function renderDays() {
    const tbody = document.querySelector('.task-table tbody') || document.getElementById('task-list');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    window.tasks.forEach((t, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${t.date}</td>
            <td>${t.weekday}</td>
            <td>${t.stage}</td>
            <td>${t.type}</td>
            <td>${t.node}</td>
            <td contenteditable="true" onblur="updateTask(${index}, 'task', this.innerText)">${t.task}</td>
            <td><input type="checkbox" ${t.done?'checked':''} onclick="toggleTask(${index})"></td>
            <td>${t.time}h</td>
            <td><input type="text" value="${t.note}" onchange="updateTask(${index}, 'note', this.value)"></td>
            <td><button onclick="deleteTask(${index})">删</button></td>
        `;
        tbody.appendChild(tr);
    });
    updateStats();
}

function toggleTask(index) {
    window.tasks[index].done = !window.tasks[index].done;
    saveData();
    updateStats();
}

function updateTask(index, key, val) {
    window.tasks[index][key] = val;
    saveData();
}

function deleteTask(index) {
    window.tasks.splice(index, 1);
    saveData();
    renderDays();
}

// 更新顶部统计
function updateStats() {
    const done = window.tasks.filter(t => t.done).length;
    const total = window.tasks.length;
    document.querySelector('.stat-done').innerText = done;
    document.querySelector('.stat-total').innerText = total;
    document.querySelector('.stat-rate').innerText = total ? Math.round(done/total*100) + '%' : '0%';
    document.querySelector('.stat-days').innerText = done; // 简化
    document.querySelector('.stat-stage').innerText = window.config.stage;
}

// 新增一天
function addNewDay() {
    const last = window.tasks[window.tasks.length-1];
    const next = new Date(last.date);
    next.setDate(next.getDate() + 1);
    window.tasks.push({
        date: next.toISOString().split('T')[0],
        weekday: '新增',
        stage: last.stage,
        type: '补充',
        node: '-',
        task: '新增任务',
        done: false,
        progress: 0,
        time: 0,
        note: ''
    });
    saveData();
    renderDays();
}

// 恢复原始任务
function resetAllTasks() {
    window.tasks = generateDefaultTasks();
    saveData();
    renderDays();
    alert('已恢复原始409天任务！');
}

// 清空进度
function clearAll() {
    if(confirm('确定清空所有进度？')) {
        window.tasks.forEach(t => t.done = false);
        saveData();
        renderDays();
    }
}

// 绑定按钮
function bindButtons() {
    document.querySelectorAll('[data-action="add"]').forEach(btn => btn.onclick = addNewDay);
    document.querySelectorAll('[data-action="reset"]').forEach(btn => btn.onclick = resetAllTasks);
    document.querySelectorAll('[data-action="clear"]').forEach(btn => btn.onclick = clearAll);
    document.querySelectorAll('[data-tab="daily"]').forEach(btn => btn.onclick = () => switchTab('daily'));
    document.querySelectorAll('[data-tab="stage"]').forEach(btn => btn.onclick = () => switchTab('stage'));
    document.querySelectorAll('[data-tab="node"]').forEach(btn => btn.onclick = () => switchTab('node'));
}

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.getElementById('tab-' + tab).style.display = 'block';
    if(tab === 'daily') renderDays();
}

// 初始化
function init() {
    initData();
    bindButtons();
    switchTab('daily');
}

// 暴露全局
window.init = init;
window.renderDays = renderDays;
window.updateStats = updateStats;
window.addNewDay = addNewDay;
window.resetAllTasks = resetAllTasks;
window.clearAll = clearAll;
window.toggleTask = toggleTask;
window.updateTask = updateTask;
window.deleteTask = deleteTask;

// 执行
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
