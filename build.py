#!/usr/bin/env python3
"""从原始 app.js 重新生成 data.js。
原始 app.js 格式：/* 注释 */ window.DATA = {...};
本脚本只抽取 {...} 部分并写进 data.js，供前端直接 script 引入。"""
import json, io, sys, os

HERE = os.path.dirname(os.path.abspath(__file__))
ORIG = os.path.join(HERE, '..', '..', 'inputs', 'app.js')  # 原始文件相对路径
OUT = os.path.join(HERE, 'data.js')


def main():
    src = open(ORIG, encoding='utf-8').read()
    i = src.index('{')
    depth = 0
    j = -1
    for k in range(i, len(src)):
        if src[k] == '{': depth += 1
        elif src[k] == '}':
            depth -= 1
            if depth == 0:
                j = k + 1
                break
    assert j > 0, '未找到 DATA 对象的结束位置'
    data = json.loads(src[i:j])
    out = ('/* 考公计划表 · 原始计划数据（由 build.py 从原始 app.js 注入） */\n'
           'window.PLAN_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/') + ';\n')
    open(OUT, 'w', encoding='utf-8').write(out)
    print('OK: %d days, %d weekly, %d milestones -> %s' % (len(data['days']), len(data['weekly']), len(data['milestones']), OUT))


if __name__ == '__main__':
    main()
