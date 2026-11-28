import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const domModule = process.env.COMMUNITY_DOM_MODULE;
const options = { skip: !domModule && 'Set COMMUNITY_DOM_MODULE to run comment editor tests.' };

async function loadEditor() {
  const imported = await import(domModule);
  const JSDOM = imported.JSDOM || imported.default.JSDOM;
  const dom = new JSDOM(
    '<!doctype html><html><body><form id="f"><textarea id="ta"></textarea></form></body></html>',
    { url: 'https://blog.invalid/post.html', runScripts: 'outside-only' },
  );
  const w = dom.window;

  /* 假 Vditor：记录 options，暴露 insertValue / getValue / setValue / focus / setTheme */
  class FakeVditor {
    constructor(el, options) {
      this.el = el;
      this.options = options;
      this.value = options.value || '';
      w.__fakeVditorInstances = w.__fakeVditorInstances || [];
      w.__fakeVditorInstances.push(this);
      if (options.after) options.after();
    }
    getValue() { return this.value; }
    setValue(v, clearStack) { this.value = String(v || ''); if (this.options.input) this.options.input(v); }
    insertValue(v, render) { this.value += String(v || ''); if (this.options.input) this.options.input(this.value); }
    focus() { this.focused = true; }
    setTheme(a, b, c) { this.theme = a; }
  }

  w.__editorEngine = 'vditor';
  w.EditorEngine = {
    use: () => true,
    CDN: 'vendor/vditor',
    load: () => Promise.resolve(FakeVditor),
  };

  w.CommentAssetPicker = {
    open(opts) {
      w.__pickerOpened = true;
      if (opts && opts.onSelect) {
        opts.onSelect({ url: 'https://cdn.invalid/storage/v1/object/public/avatars/u1/comments/x.jpg', name: 'test.jpg' });
      }
    },
    close() {},
  };

  w.eval(await readFile(new URL('../js/editor-comment.js', import.meta.url), 'utf8'));
  return { w, dom };
}

test('enhance swaps the textarea for Vditor and syncs values both ways', options, async () => {
  const { w, dom } = await loadEditor();
  try {
    const ta = w.document.getElementById('ta');
    ta.value = 'hello';
    const api = w.CommentEditor.enhance(ta, { placeholder: 'p' });
    assert.ok(api, 'returns an API');
    assert.equal(ta.hidden, true, 'textarea hidden');
    assert.equal(ta.dataset.vditorComment, '1');
    assert.ok(w.document.querySelector('.vditor-mount.vditor-comment'), 'mount inserted');

    /* 等待 EditorEngine.load()（async）完成 */
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 5)); if (w.__fakeVditorInstances) break; }
    assert.ok(w.__fakeVditorInstances, 'Vditor constructed');
    const fake = w.__fakeVditorInstances[0];
    assert.equal(fake.value, 'hello', 'initial value propagated');

    /* 外部脚本写 textarea.value 时，Vditor 同步更新 */
    ta.value = 'world';
    assert.equal(fake.value, 'world');

    /* Vditor 内部输入时，textarea 同步更新 */
    fake.insertValue(' more');
    assert.equal(ta.value, 'world more');
  } finally {
    dom.window.close();
  }
});

test('the comment-image toolbar button opens the picker and inserts ![alt](url)', options, async () => {
  const { w, dom } = await loadEditor();
  try {
    const ta = w.document.getElementById('ta');
    w.CommentEditor.enhance(ta);
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 5)); if (w.__fakeVditorInstances) break; }
    assert.ok(w.__fakeVditorInstances, 'Vditor constructed');
    const fake = w.__fakeVditorInstances[0];
    const custom = fake.options.toolbar.find((item) => typeof item === 'object' && item.name === 'comment-image');
    assert.ok(custom, 'comment-image custom toolbar item present');
    assert.ok(custom.icon.includes('<svg'), 'button has an SVG image icon');

    /* 点击该按钮：应调用 picker.onSelect，并把 markdown 插入编辑器并同步到 textarea */
    custom.click(new w.Event('click'));
    assert.equal(w.__pickerOpened, true, 'picker was opened');
    assert.match(fake.value, /!\[test\.jpg\]\(https:\/\/cdn\.invalid\/storage\/v1\/object\/public\/avatars\/u1\/comments\/x\.jpg\)/);
    assert.match(ta.value, /!\[test\.jpg\]\(https:\/\/cdn\.invalid\/storage\/v1\/object\/public\/avatars\/u1\/comments\/x\.jpg\)/);
  } finally {
    dom.window.close();
  }
});

test('legacy mode (window.__editorEngine="legacy") leaves the textarea untouched', options, async () => {
  const { w, dom } = await loadEditor();
  try {
    w.__editorEngine = 'legacy';
    const ta = w.document.getElementById('ta');
    const api = w.CommentEditor.enhance(ta);
    assert.equal(api, null, 'no API returned in legacy mode');
    assert.equal(ta.hidden, false, 'textarea stays visible');
    assert.equal(ta.dataset.vditorComment, undefined);
    assert.equal(w.document.querySelector('.vditor-mount'), null);
  } finally {
    dom.window.close();
  }
});

test('failed Vditor load restores the original textarea', options, async () => {
  const { w, dom } = await loadEditor();
  try {
    w.EditorEngine.load = () => Promise.reject(new Error('boom'));
    const ta = w.document.getElementById('ta');
    const api = w.CommentEditor.enhance(ta);
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(ta.hidden, false, 'textarea restored');
    assert.equal(ta.dataset.vditorComment, undefined, 'marker removed');
    assert.equal(w.document.querySelector('.vditor-mount'), null, 'mount removed');
  } finally {
    dom.window.close();
  }
});
