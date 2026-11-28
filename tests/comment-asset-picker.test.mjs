import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const domModule = process.env.COMMUNITY_DOM_MODULE;
const options = { skip: !domModule && 'Set COMMUNITY_DOM_MODULE to run comment asset picker tests.' };

async function loadPicker() {
  const imported = await import(domModule);
  const JSDOM = imported.JSDOM || imported.default.JSDOM;
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://blog.invalid/post.html', runScripts: 'outside-only' });
  const w = dom.window;

  const user = { id: 'uid-1' };
  w.BlogAuth = {
    user: () => user,
    requireUser: () => user,
    ready: () => Promise.resolve(),
    client: () => w.__supa,
  };

  w.__fetchCalls = [];
  w.fetch = async (url) => {
    w.__fetchCalls.push(String(url));
    return { ok: true, blob: async () => new w.Blob([new Uint8Array(16)], { type: 'image/jpeg' }) };
  };

  const uploads = [];
  const supa = {
    from(table) {
      if (table === 'user_assets') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { object_path: 'uid-1/file.bin', mime_type: 'image/jpeg', original_name: 'picked.jpg' },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table: ' + table);
    },
    rpc: async (fn, params) => {
      assert.equal(fn, 'community_assets_page');
      assert.equal(params.p_kind, 'image');
      w.__rpcCalls = w.__rpcCalls || [];
      w.__rpcCalls.push(params);
      return { data: w.__rows || [], error: null };
    },
    storage: {
      from(bucket) {
        if (bucket === 'community-assets') {
          return {
            createSignedUrl: async () => ({
              data: { signedUrl: 'https://cdn.invalid/sign?token=x' },
              error: null,
            }),
          };
        }
        if (bucket === 'avatars') {
          return {
            upload: async (path, blob) => { uploads.push({ path, blob }); return { error: null }; },
            getPublicUrl: (path) => ({ data: { publicUrl: 'https://cdn.invalid/storage/v1/object/public/avatars/' + encodeURIComponent(path) } }),
          };
        }
        throw new Error('unexpected bucket: ' + bucket);
      },
    },
  };
  w.__supa = supa;

  /* jsdom 对 <dialog> 支持有限；补一个最小桩统一生命周期。 */
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };

  w.eval(await readFile(new URL('../js/comment-asset-picker.js', import.meta.url), 'utf8'));
  return { w, dom, user, uploads, supa };
}

test('picker lists images, signs the private bytes and returns a permanent public URL', options, async () => {
  const { w, dom, user, uploads } = await loadPicker();
  try {
    w.__rows = [{ id: 'asset-1', original_name: 'picked.jpg', mime_type: 'image/jpeg', size_bytes: 16, created_at: '2026-11-28T00:00:00Z', reference_count: 0 }];

    let received = null;
    w.CommentAssetPicker.open({ onSelect: (img) => { received = img; } });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));

    const dialog = w.document.querySelector('dialog.comment-asset-picker');
    assert.ok(dialog, 'picker dialog is mounted');
    assert.equal(dialog.open, true, 'dialog is open');
    const item = dialog.querySelector('[data-asset-id="asset-1"]');
    assert.ok(item, 'asset row rendered');

    /* 类型下拉与资源中心一致，默认「图片」。 */
    assert.equal(dialog.querySelector('[data-kind]').value, 'image', 'kind dropdown defaults to image');

    /* 卡片与资源中心一致：「预览」+「选择并返回」两个按钮。 */
    assert.ok(item.querySelector('.rm-actions button.btn'), 'action buttons rendered');
    assert.equal(item.querySelectorAll('.rm-actions button').length, 2, 'preview + choose buttons');
    const chooseBtn = [...item.querySelectorAll('.rm-actions button')].find(b => b.textContent === '选择并返回');
    assert.ok(chooseBtn, 'choose-and-return button present');
    chooseBtn.click();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));

    assert.equal(uploads.length, 1, 'uploaded exactly once');
    assert.match(uploads[0].path, new RegExp('^' + user.id + '/comments/.+\\.jpg$'));
    assert.equal(uploads[0].blob.type, 'image/jpeg');

    assert.ok(received, 'callback fired');
    assert.match(received.url, /^https:\/\/cdn\.invalid\/storage\/v1\/object\/public\/avatars\//);
    assert.equal(received.name, 'picked.jpg');
  } finally {
    dom.window.close();
  }
});

test('picker hides non-image resources from the selection list', options, async () => {
  const { w, dom } = await loadPicker();
  try {
    w.__rows = [
      { id: 'video-1', original_name: 'movie.mp4', mime_type: 'video/mp4', size_bytes: 10, created_at: '2026-11-28T00:00:00Z', reference_count: 0 },
    ];
    w.CommentAssetPicker.open({ onSelect: () => {} });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));

    const dialog = w.document.querySelector('dialog.comment-asset-picker');
    assert.equal(dialog.querySelector('[data-asset-id="video-1"]'), null, 'video not offered as a comment image');
    assert.match(dialog.querySelector('[data-status]').textContent, /没有图片资源/);
  } finally {
    dom.window.close();
  }
});

test('picker keeps the editor usable when the resource center is unreachable', options, async () => {
  const { w, dom } = await loadPicker();
  try {
    w.__rows = [];
    w.__supa.rpc = async () => ({ data: null, error: { message: 'RPC 不可用' } });
    w.CommentAssetPicker.open({ onSelect: () => {} });
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));

    const status = w.document.querySelector('dialog.comment-asset-picker [data-status]');
    assert.match(status.textContent, /资源加载失败/);
  } finally {
    dom.window.close();
  }
});
