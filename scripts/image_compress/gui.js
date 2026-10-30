// Keep this file valid ES2015; the portable interface has no build step.
const element = (id) => document.getElementById(id)
const token = location.hash.slice(1)
let pickerTarget = 'source'
let currentDirectory = ''
let parentDirectory = ''
let closed = false
let polling = false
let browseSequence = 0
let pickerReturnFocus = null

function api(path, body) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(body === undefined ? 'GET' : 'POST', path, true)
    request.timeout = 30000
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    if (body !== undefined) request.setRequestHeader('Content-Type', 'application/json')
    request.onreadystatechange = () => {
      if (request.readyState !== 4) return
      if (request.status === 0) {
        reject(new Error('本机服务未响应'))
        return
      }
      try {
        const data = JSON.parse(request.responseText)
        if (request.status >= 200 && request.status < 300) resolve(data)
        else reject(new Error(data.error || '操作失败'))
      } catch (error) {
        reject(new Error(`无法读取服务返回的结果：${error.message}`))
      }
    }
    request.onerror = () => reject(new Error('无法连接本机服务'))
    request.ontimeout = () => reject(new Error('请求超时，请重试'))
    request.send(body === undefined ? null : JSON.stringify(body))
  })
}

function clearChildren(node) {
  while (node.firstChild) node.removeChild(node.firstChild)
}

function notice(message = '') {
  element('notice').textContent = message
  element('notice').style.display = message ? 'block' : 'none'
}

function bytes(value) {
  if (value < 1000) return `${value} B`
  if (value < 1000000) return `${(value / 1000).toFixed(1)} KB`
  return `${(value / 1000000).toFixed(2)} MB`
}

function closePicker() {
  browseSequence += 1
  element('picker').style.display = 'none'
  element('picker').setAttribute('aria-hidden', 'true')
  document.body.style.overflow = ''
  if (pickerReturnFocus) pickerReturnFocus.focus()
}

function selectPath(value) {
  element(pickerTarget).value = value
  if (pickerTarget === 'source') {
    const split = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
    const name = value.slice(split + 1)
    const dot = name.lastIndexOf('.')
    element('name').value = `${dot > 0 ? name.slice(0, dot) : name}-compressed`
    element('parent').value = split === 0 ? '/' : split === 2 && value[1] === ':' ? value.slice(0, 3) : value.slice(0, split)
  }
  closePicker()
  notice()
}

function browse(path = '') {
  const sequence = ++browseSequence
  element('browse-error').textContent = ''
  return api(`/api/browse?path=${encodeURIComponent(path)}`)
    .then((data) => {
      if (sequence !== browseSequence) return
      currentDirectory = data.path
      parentDirectory = data.parent
      element('browse-path').value = data.path
      element('up').disabled = data.path === data.parent
      const container = element('entries')
      clearChildren(container)
      const entries = data.entries.filter((item) => pickerTarget === 'source' || item.directory)
      entries.forEach((item) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'entry'
        const icon = document.createElement('span')
        icon.textContent = item.directory ? '▣' : '▧'
        icon.setAttribute('aria-hidden', 'true')
        const name = document.createElement('span')
        name.textContent = item.name
        button.appendChild(icon)
        button.appendChild(name)
        button.addEventListener('click', () => (item.directory ? browse(item.path) : selectPath(item.path)))
        container.appendChild(button)
      })
      if (!entries.length) {
        const empty = document.createElement('div')
        empty.className = 'empty'
        empty.textContent = '此处没有可显示的图片或子文件夹，可直接选择当前文件夹。'
        container.appendChild(empty)
      }
      element('browse-hint').textContent = data.truncated ? '仅显示前 500 项，可输入更具体的路径。' : pickerTarget === 'source' ? '点击文件夹进入，点击图片选择。' : '进入目标位置后，点击“选择此文件夹”。'
    })
    .catch((error) => {
      if (sequence === browseSequence) element('browse-error').textContent = error.message
    })
}

function openPicker(target) {
  pickerTarget = target
  currentDirectory = ''
  pickerReturnFocus = document.activeElement
  element('picker-title').textContent = target === 'source' ? '选择图片或文件夹' : '选择输出位置'
  clearChildren(element('entries'))
  element('picker').style.display = 'flex'
  element('picker').setAttribute('aria-hidden', 'false')
  document.body.style.overflow = 'hidden'
  element('close-picker').focus()
  return browse(element(target).value.trim())
}

function renderState(state) {
  const busy = ['setup', 'running', 'stopping'].indexOf(state.status) !== -1
  element('settings').disabled = busy
  element('start').disabled = busy
  element('start').textContent = busy ? '正在处理…' : '开始压缩'
  element('cancel').disabled = !busy || state.status === 'stopping'
  element('exit').disabled = busy
  element('message').textContent = state.message
  element('counter').textContent = state.total ? `${state.current} / ${state.total} 张` : busy ? '准备中' : state.status === 'idle' ? '等待开始' : '任务结束'
  if (busy && !state.total) element('progress').removeAttribute('value')
  else element('progress').value = state.total ? (state.current / state.total) * 100 : 0
  const complete = state.status === 'done'
  element('count').textContent = complete ? `${state.success} / ${state.failed}` : '—'
  element('before').textContent = complete ? bytes(state.before) : '—'
  element('after').textContent = complete ? bytes(state.after) : '—'
  element('saved').textContent = complete ? `${state.saved_percent}%` : '—'
  element('logs').textContent = state.logs.join('\n') || '尚无日志'
  element('results').style.display = state.output && !busy ? 'block' : 'none'
  element('output-path').textContent = state.output
  element('flat-result').style.display = state.flat_output ? 'flex' : 'none'
  element('flat-path').textContent = state.flat_output || ''
}

function refresh() {
  if (closed || polling) return Promise.resolve()
  polling = true
  return api('/api/state')
    .then(renderState)
    .then(
      () => {
        polling = false
      },
      (error) => {
        polling = false
        if (!closed) notice(`无法连接工具：${error.message}。请检查启动窗口，必要时重新运行启动器。`)
      }
    )
}

element('browse-source').addEventListener('click', () => openPicker('source'))
element('browse-parent').addEventListener('click', () => openPicker('parent'))
element('close-picker').addEventListener('click', closePicker)
element('picker').addEventListener('click', (event) => {
  if (event.target === element('picker')) closePicker()
})
document.addEventListener('keydown', (event) => {
  if (element('picker').style.display !== 'flex') return
  if (event.key === 'Escape' || event.keyCode === 27) {
    event.preventDefault()
    closePicker()
  } else if (event.key === 'Tab' || event.keyCode === 9) {
    const nodes = element('picker').querySelectorAll('button, input')
    const focusable = Array.prototype.filter.call(nodes, (node) => !node.disabled)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
})
element('go').addEventListener('click', () => browse(element('browse-path').value.trim()))
element('browse-path').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.keyCode === 13) {
    event.preventDefault()
    browse(element('browse-path').value.trim())
  }
})
element('up').addEventListener('click', () => browse(parentDirectory))
element('home').addEventListener('click', () => browse())
element('select-folder').addEventListener('click', () => {
  if (currentDirectory) selectPath(currentDirectory)
})
element('compress-form').addEventListener('submit', (event) => {
  event.preventDefault()
  notice()
  element('start').disabled = true
  api('/api/start', { input: element('source').value.trim(), parent: element('parent').value.trim(), name: element('name').value.trim(), profile: element('profile').value, flat: element('flat').checked })
    .then(() => {
      element('progress-section').scrollIntoView(false)
    })
    .catch((error) => {
      notice(error.message)
    })
    .then(refresh)
})
element('cancel').addEventListener('click', () => {
  api('/api/cancel', {})
    .then(refresh)
    .catch((error) => notice(error.message))
})
for (const [id, kind] of [
  ['open-output', 'output'],
  ['open-flat', 'flat_output'],
]) {
  element(id).addEventListener('click', () => {
    api('/api/open', { kind }).catch((error) => notice(error.message))
  })
}
element('exit').addEventListener('click', () => {
  api('/api/exit', {})
    .then(() => {
      closed = true
      element('settings').disabled = true
      element('start').disabled = true
      element('exit').disabled = true
      element('message').textContent = '工具已退出，可以关闭此页面。'
    })
    .catch((error) => notice(error.message))
})
if (!token) notice('请通过 start.py、start.command 或 start.bat 打开界面。')
else {
  refresh()
  setInterval(refresh, 1000)
}
