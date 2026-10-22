// 极简兜底代码，防止脚本中断
const safeEmpty = () => { console.log("Function not implemented yet"); };

// 强制初始化测试数据
window.tasks = [
    { date: new Date().toISOString().split('T')[0], weekday: '今天', stage: '阶段一', type: '备考', node: '启动', task: '测试打卡任务（点文字修改）', done: false, progress: 0, time: 0, note: '' }
];
window.config = { stage: '阶段一' };

// 强制渲染每日打卡表格
window.renderDays = function() {
    const tbody = document.querySelector('tbody');
    if(!tbody) return;
    tbody.innerHTML = window.tasks.map((t, index) => `
        <tr>
            <td>${t.date}</td><td>${t.weekday}</td><td>${t.stage}</td>
            <td>${t.type}</td><td>${t.node}</td>
            <td contenteditable="true">${t.task}</td>
            <td><input type="checkbox" ${t.done?'checked':''}></td>
            <td>${t.time}h</td><td>${t.note}</td><td>测试</td>
        </tr>
    `).join('');
};

// 更新顶部统计
window.updateStats = function() {
    const done = window.tasks.filter(t => t.done).length;
    const total = window.tasks.length;
    document.body.innerText.includes('已完成天数') ? console.log('渲染统计') : null;
};

// 绑定基础按钮
window.addNewDay = function() { alert('新增功能暂不可用，等待修复'); };
window.resetAllTasks = function() { location.reload(); };
window.clearAll = function() { if(confirm('清空？')) location.reload(); };

// 暴露全局防报错
['renderNodes','mergeVersions','testConnection','renderWeekly','saveNote','saveTime','editTask','deleteDay','saveSyncConfig','openSyncConfig','closeSyncConfig','switchTab','backToToday','applyFilter','sortBy','toggle'].forEach(fn => window[fn] = safeEmpty);

// 执行渲染
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', window.renderDays);
} else {
    window.renderDays();
}
