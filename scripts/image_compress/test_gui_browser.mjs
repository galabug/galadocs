import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import * as acorn from 'acorn'
import { JSDOM } from 'jsdom'

const testDirectory = path.dirname(fileURLToPath(import.meta.url))

const script = fs.readFileSync(path.join(testDirectory, 'gui.js'), 'utf8')
const html = fs.readFileSync(path.join(testDirectory, 'gui.html'), 'utf8')
const settle = () => new Promise((resolve) => setImmediate(resolve))

function createInterface() {
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:7777/#test-session',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  })
  const window = dom.window
  const requests = []
  let poll
  let startError = ''
  let state = { status: 'idle', message: '等待开始', total: 0, current: 0, logs: [], output: '', flat_output: '', before: 0, after: 0, success: 0, failed: 0, saved_percent: 0 }
  // Remove APIs that are newer than the browser baseline.
  window.fetch = undefined
  window.Element.prototype.replaceChildren = undefined
  window.Element.prototype.append = undefined
  window.Element.prototype.closest = undefined
  window.Array.prototype.includes = undefined
  window.Promise.prototype.finally = undefined
  if (window.HTMLDialogElement) window.HTMLDialogElement.prototype.showModal = undefined
  window.HTMLElement.prototype.scrollIntoView = (value) => assert.equal(typeof value, 'boolean')
  window.setInterval = (callback) => {
    poll = callback
    return 1
  }
  window.XMLHttpRequest = class {
    constructor() {
      this.headers = {}
    }
    open(method, url) {
      this.method = method
      this.url = url
    }
    setRequestHeader(name, value) {
      this.headers[name] = value
    }
    send(body) {
      requests.push({ method: this.method, url: this.url, headers: this.headers, body: typeof body === 'string' ? JSON.parse(body) : body })
      window.Promise.resolve().then(() => {
        this.status = 200
        let data = { ok: true }
        if (this.url === '/api/state') data = state
        else if (this.url.indexOf('/api/browse') === 0)
          data = {
            path: '/图片目录',
            parent: '/',
            truncated: false,
            entries: [
              { name: '<img src=x>.png', path: '/图片目录/图片.png', directory: false },
              { name: '子目录', path: '/图片目录/子目录', directory: true },
            ],
          }
        else if (this.url === '/api/import') data = { import_id: 'local-import', parent: '/输出', name: '图片-compressed' }
        else if (this.url === '/api/start') {
          if (startError) {
            this.status = 400
            data = { error: startError }
          } else state = { ...state, status: 'running', message: '正在压缩', total: 2 }
        } else if (this.url === '/api/cancel') state = { ...state, status: 'cancelled' }
        this.responseText = JSON.stringify(data)
        this.readyState = 4
        this.onreadystatechange()
      })
    }
  }
  window.eval(script)
  return {
    window,
    document: window.document,
    requests,
    poll: () => poll(),
    setState: (next) => {
      state = { ...state, ...next }
    },
    setStartError: (value) => {
      startError = value
    },
    close: () => dom.window.close(),
  }
}

test('delivered GUI JavaScript is strictly ES2015', () => {
  assert.doesNotThrow(() => acorn.parse(script, { ecmaVersion: 2015, sourceType: 'script' }))
  assert.equal(html.indexOf('<dialog'), -1)
})

test('file browser works without fetch, native dialog or new DOM APIs', async () => {
  const ui = createInterface()
  try {
    await settle()
    ui.document.getElementById('browse-source').click()
    await settle()
    const picker = ui.document.getElementById('picker')
    assert.equal(picker.style.display, 'flex')
    assert.equal(picker.getAttribute('aria-hidden'), 'false')
    assert.equal(picker.querySelectorAll('#entries button').length, 2)
    assert.equal(picker.querySelectorAll('#entries img').length, 0)
    ui.document.getElementById('select-folder').click()
    assert.equal(ui.document.getElementById('source').value, '/图片目录')
    assert.equal(ui.document.getElementById('parent').value, '/')
    assert.equal(picker.style.display, 'none')
    assert.ok(ui.requests.every((request) => request.headers.Authorization === 'Bearer test-session'))
  } finally {
    ui.close()
  }
})

test('start, progress, results and folder buttons work with ES2015 APIs', async () => {
  const ui = createInterface()
  try {
    await settle()
    ui.document.getElementById('source').value = '/图片目录'
    ui.document.getElementById('compress-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
    await settle()
    const start = ui.requests.find((request) => request.url === '/api/start')
    assert.equal(start.body.input, '/图片目录')
    assert.equal(start.body.flat, true)
    assert.equal(ui.document.getElementById('settings').disabled, true)
    ui.setState({ status: 'done', current: 2, success: 2, before: 1000, after: 400, output: '/结果', flat_output: '/0000', saved_percent: 60, logs: ['完成'] })
    ui.poll()
    await settle()
    assert.equal(ui.document.getElementById('progress').value, 100)
    assert.equal(ui.document.getElementById('saved').textContent, '60%')
    assert.equal(ui.document.getElementById('flat-path').textContent, '/0000')
    assert.equal(ui.document.getElementById('settings').disabled, false)
    ui.document.getElementById('open-flat').click()
    await settle()
    assert.ok(ui.requests.some((request) => request.url === '/api/open' && request.body.kind === 'flat_output'))
  } finally {
    ui.close()
  }
})

test('request errors restore the start button and remain visible', async () => {
  const ui = createInterface()
  try {
    await settle()
    ui.setStartError('输出位置无效')
    ui.document.getElementById('source').value = '/图片目录'
    ui.document.getElementById('compress-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
    await settle()
    assert.equal(ui.document.getElementById('notice').textContent, '输出位置无效')
    assert.equal(ui.document.getElementById('start').disabled, false)
  } finally {
    ui.close()
  }
})

test('Escape closes the custom picker and restores focus', async () => {
  const ui = createInterface()
  try {
    await settle()
    const button = ui.document.getElementById('browse-source')
    button.focus()
    button.click()
    await settle()
    ui.document.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
    assert.equal(ui.document.getElementById('picker').style.display, 'none')
    assert.equal(ui.document.activeElement, button)
  } finally {
    ui.close()
  }
})

test('native file selection imports binary images and submits the local session', async () => {
  const ui = createInterface()
  try {
    await settle()
    const file = new ui.window.File(['sample'], '中文.png', { type: 'image/png' })
    const input = ui.document.getElementById('file-input')
    assert.equal(input.type, 'file')
    assert.equal(ui.document.querySelector('label[for="file-input"]').getAttribute('for'), input.id)
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new ui.window.Event('change'))
    await settle()
    assert.ok(ui.requests.some((request) => request.url.indexOf('/api/import-file?') === 0 && request.body === file))
    assert.match(ui.document.getElementById('selection').textContent, /已选择 1 张/)
    ui.document.getElementById('compress-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
    await settle()
    assert.equal(ui.requests.find((request) => request.url === '/api/start').body.import_id, 'local-import')
  } finally {
    ui.close()
  }
})

test('folder selection preserves nested paths without duplicating the selected root', async () => {
  const ui = createInterface()
  try {
    await settle()
    const file = new ui.window.File(['sample'], '图片.png')
    Object.defineProperty(file, 'webkitRelativePath', { value: '产品/横幅/图片.png' })
    const input = ui.document.getElementById('folder-input')
    assert.ok(input.hasAttribute('webkitdirectory'))
    Object.defineProperty(input, 'files', { value: [file] })
    input.dispatchEvent(new ui.window.Event('change'))
    await settle()
    const request = ui.requests.find((item) => item.url.indexOf('/api/import-file?') === 0)
    assert.equal(new URL(request.url, 'http://localhost').searchParams.get('path'), '横幅/图片.png')
    assert.equal(ui.document.getElementById('flat-options').style.display, 'none')
  } finally {
    ui.close()
  }
})

test('directory drop reads all entry batches including more than 100 files', async () => {
  const ui = createInterface()
  try {
    await settle()
    const entries = Array.from({ length: 105 }, (_, index) => ({ isFile: true, name: index + '.png', file: (resolve) => resolve(new ui.window.File(['x'], index + '.png')) }))
    let batch = 0
    const folder = { name: '相册', isDirectory: true, createReader: () => ({ readEntries: (resolve) => resolve(batch++ === 0 ? entries.slice(0, 100) : batch === 2 ? entries.slice(100) : []) }) }
    const event = new ui.window.Event('drop', { cancelable: true, bubbles: true })
    Object.defineProperty(event, 'dataTransfer', { value: { items: [{ webkitGetAsEntry: () => folder }], files: [] } })
    ui.document.getElementById('drop-zone').dispatchEvent(event)
    await settle()
    assert.equal(ui.requests.filter((item) => item.url.indexOf('/api/import-file?') === 0).length, 105)
    assert.match(ui.document.getElementById('selection').textContent, /已选择 105 张/)
  } finally {
    ui.close()
  }
})

test('per-image results display before size, after size and savings safely in Chinese', async () => {
  const ui = createInterface()
  try {
    await settle()
    ui.setState({ status: 'done', success: 1, before: 2000, after: 500, saved_percent: 75, output: '/结果', items: [{ file: '横幅/<img>.png', status: 'ok', before: 2000, after: 500, saved_percent: 75 }] })
    ui.poll()
    await settle()
    const results = ui.document.getElementById('file-results')
    assert.match(results.textContent, /压缩前 2.0 KB/)
    assert.match(results.textContent, /压缩后 500 B/)
    assert.match(results.textContent, /减少 75%/)
    assert.equal(results.querySelectorAll('img').length, 0)
    assert.equal(ui.document.getElementById('download-all').disabled, false)
  } finally {
    ui.close()
  }
})

test('multiple image folders expose an optional collection with a custom name', async () => {
  const ui = createInterface()
  try {
    await settle()
    const files = ['root/one/one.png', 'root/two/two.png'].map((relative) => {
      const file = new ui.window.File(['image'], relative.split('/').pop())
      Object.defineProperty(file, 'webkitRelativePath', { value: relative })
      return file
    })
    const input = ui.document.getElementById('folder-input')
    Object.defineProperty(input, 'files', { value: files })
    input.dispatchEvent(new ui.window.Event('change'))
    await settle()
    assert.equal(ui.document.getElementById('flat-options').style.display, 'flex')
    ui.document.getElementById('flat-name').value = 'all-images'
    ui.document.getElementById('flat').click()
    assert.equal(ui.document.getElementById('flat-name').disabled, true)
    ui.document.getElementById('flat').click()
    ui.document.getElementById('compress-form').dispatchEvent(new ui.window.Event('submit', { cancelable: true }))
    await settle()
    const start = ui.requests.find((request) => request.url === '/api/start')
    assert.equal(start.body.flat, true)
    assert.equal(start.body.flat_name, 'all-images')
  } finally {
    ui.close()
  }
})
