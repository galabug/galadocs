// Keep this file valid ES2015; the portable interface has no build step.
const element = (id) => document.getElementById(id)
const token = location.hash.slice(1)
let importSessionId = ''
let importing = false
let jobBusy = false
let resultSignature = ''
let sourceInfoSequence = 0
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
  if (pickerTarget === 'source') {
    inspectSource(value)
    importSessionId = ''
    element('selection').textContent = '已选择本机路径：' + value
  }
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
  element('boot-warning').style.display = 'none'
  const busy = ['setup', 'running', 'stopping'].indexOf(state.status) !== -1
  jobBusy = busy
  element('settings').disabled = busy || importing
  element('start').disabled = busy || importing
  element('start').textContent = busy ? '正在处理…' : '开始压缩'
  element('cancel').disabled = !busy || state.status === 'stopping'
  element('exit').disabled = busy || importing
  element('message').textContent = state.message
  element('counter').textContent = state.total ? `${state.current} / ${state.total} 张` : busy ? '准备中' : state.status === 'idle' ? '等待开始' : '任务结束'
  if (busy && !state.total) element('progress').removeAttribute('value')
  else element('progress').value = state.total ? (state.current / state.total) * 100 : 0
  const complete = state.status === 'done'
  element('count').textContent = complete ? `${state.success} / ${state.failed}` : '—'
  element('before').textContent = complete ? bytes(state.before) : '—'
  element('after').textContent = complete ? bytes(state.after) : '—'
  element('saved').textContent = complete ? `${state.saved_percent}%` : '—'
  renderFiles(state)
  element('download-all').disabled = !complete || !state.success
  element('savings-title').textContent = complete ? '本次压缩节省了 ' + state.saved_percent + '%' : '让图片更轻，让画质依然清晰'
  element('summary-text').textContent = complete ? state.success + ' 张图片已压缩 · 共减少 ' + bytes(Math.max(0, state.before - state.after)) : state.message
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
  if (importing || jobBusy) return
  if (!importSessionId && !element('source').value.trim()) {
    notice('请先选择图片或文件夹')
    return
  }
  element('start').disabled = true
  api('/api/start', { import_id: importSessionId, input: element('source').value.trim(), parent: element('parent').value.trim(), name: element('name').value.trim(), profile: element('profile').value, flat: element('flat').checked, flat_name: element('flat-name').value.trim() || '0000' })
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

function renderFiles(state) {
  const items = state.items || []
  const signature = JSON.stringify([state.status, items])
  if (signature === resultSignature) return
  resultSignature = signature
  clearChildren(element('file-results'))
  items.forEach((item) => {
    const row = document.createElement('div')
    row.className = 'file-row'
    const icon = document.createElement('span')
    icon.className = 'file-icon'
    icon.textContent = item.file.split('.').pop().toUpperCase()
    const name = document.createElement('div')
    name.className = 'file-name'
    const title = document.createElement('strong')
    title.textContent = item.file
    const original = document.createElement('small')
    original.textContent = '压缩前 ' + bytes(item.before)
    name.appendChild(title)
    name.appendChild(original)
    const size = document.createElement('div')
    size.className = 'file-size'
    const saved = document.createElement('b')
    saved.textContent = item.status === 'ok' ? '减少 ' + item.saved_percent + '%' : '处理失败'
    const after = document.createElement('span')
    after.textContent = item.status === 'ok' ? '压缩后 ' + bytes(item.after) : item.error
    size.appendChild(saved)
    size.appendChild(after)
    const download = document.createElement('button')
    download.type = 'button'
    download.textContent = '下载'
    download.disabled = state.status !== 'done' || item.status !== 'ok'
    download.addEventListener('click', () => downloadFile('/api/download?file=' + encodeURIComponent(item.file), item.file.split('/').pop()))
    row.appendChild(icon)
    row.appendChild(name)
    row.appendChild(size)
    row.appendChild(download)
    element('file-results').appendChild(row)
  })
}

function downloadFile(path, filename) {
  const request = new XMLHttpRequest()
  request.open('GET', path, true)
  request.responseType = 'blob'
  request.setRequestHeader('Authorization', 'Bearer ' + token)
  request.onload = () => {
    if (request.status !== 200) {
      notice('下载失败，请确认压缩已完成后重试')
      return
    }
    const url = URL.createObjectURL(request.response)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  request.onerror = () => notice('无法下载，请检查本机服务是否正在运行')
  request.send()
}

element('download-all').addEventListener('click', () => downloadFile('/api/download-all', '压缩图片.zip'))

function supported(name) {
  return /\.(jpe?g|png|webp|gif)$/i.test(name)
}

function uploadImage(identifier, item) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('POST', '/api/import-file?session=' + encodeURIComponent(identifier) + '&path=' + encodeURIComponent(item.path), true)
    request.timeout = 120000
    request.setRequestHeader('Authorization', 'Bearer ' + token)
    request.setRequestHeader('Content-Type', 'application/octet-stream')
    request.onreadystatechange = () => {
      if (request.readyState !== 4) return
      if (request.status === 200) resolve()
      else {
        let message = '图片导入失败，请重新选择'
        try {
          message = JSON.parse(request.responseText).error || message
        } catch (error) {
          message += error.message ? '（服务响应异常）' : ''
        }
        reject(new Error(message))
      }
    }
    request.onerror = () => reject(new Error('无法连接本机服务'))
    request.ontimeout = () => reject(new Error('图片导入超时，请重新选择'))
    request.send(item.file)
  })
}

function importImages(items, label) {
  items = items.filter((item) => supported(item.path))
  sourceInfoSequence += 1
  const groups = Object.create(null)
  items.forEach((item) => {
    groups[item.path.split('/').slice(0, -1).join('/')] = true
  })
  updateFlatOptions(Object.keys(groups).length)
  if (!items.length) {
    notice('没有找到 JPG、PNG、WebP 或 GIF 图片')
    return Promise.resolve()
  }
  if (items.length > 20000 || items.some((item) => item.file.size > 100 * 1024 * 1024)) {
    notice('一次最多选择 20000 张图片，单张不能超过 100 MB')
    return Promise.resolve()
  }
  const seen = Object.create(null)
  let duplicate = false
  items.forEach((item) => {
    if (seen[item.path]) duplicate = true
    seen[item.path] = true
  })
  if (duplicate) {
    notice('所选图片存在相同路径，请按文件夹分别选择')
    return Promise.resolve()
  }
  importSessionId = ''
  importing = true
  element('settings').disabled = true
  element('start').disabled = true
  element('exit').disabled = true
  notice()
  let identifier
  element('selection').textContent = '正在将所选图片复制到本机临时目录…'
  return api('/api/import', { name: label })
    .then((session) => {
      identifier = session.import_id
      if (!element('parent').value.trim()) element('parent').value = session.parent
      element('name').value = session.name
      let sequence = Promise.resolve()
      items.forEach((item, index) => {
        sequence = sequence.then(() => {
          element('selection').textContent = '正在导入 ' + (index + 1) + ' / ' + items.length + ' 张：' + item.path
          return uploadImage(identifier, item)
        })
      })
      return sequence
    })
    .then(() => api('/api/import-ready', { import_id: identifier }))
    .then(() => {
      importSessionId = identifier
      element('source').value = ''
      element('selection').textContent = '已选择 ' + items.length + ' 张图片 · ' + label + '（保留子目录）'
    })
    .catch((error) => {
      element('selection').textContent = '图片导入未完成，请重新选择'
      notice(error.message)
    })
    .then(() => {
      importing = false
      return refresh()
    })
}

function selectedFiles(input, folder) {
  if (importing || jobBusy) return
  const files = Array.prototype.slice.call(input.files || [])
  input.value = ''
  if (!files.length) return
  const label = folder && files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : files.length === 1 ? files[0].name.split('.').slice(0, -1).join('.') : '所选图片'
  importImages(
    files.map((file) => ({ file, path: folder && file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name })),
    label
  )
}

element('file-input').addEventListener('change', () => selectedFiles(element('file-input'), false))
element('folder-input').addEventListener('change', () => selectedFiles(element('folder-input'), true))
element('source').addEventListener('input', () => {
  importSessionId = ''
  element('selection').textContent = '使用本机输入路径'
  inspectSource(element('source').value.trim())
})

function updateFlatOptions(count) {
  element('flat-options').style.display = count > 1 ? 'flex' : 'none'
  element('flat-hint').textContent = count > 1 ? '检测到多个图片目录，可按需生成汇总目录。' : count === 1 ? '只有一个图片目录，不生成汇总目录。' : '只有一个图片目录时不生成汇总目录；多个目录时可选择生成。'
  element('flat-name').disabled = !element('flat').checked
}

function inspectSource(value) {
  const sequence = ++sourceInfoSequence
  updateFlatOptions(0)
  if (!value) return
  setTimeout(() => {
    if (sequence !== sourceInfoSequence) return
    api('/api/source-info?path=' + encodeURIComponent(value))
      .then((data) => {
        if (sequence === sourceInfoSequence) updateFlatOptions(data.directories)
      })
      .catch(() => {
        /* The start endpoint reports invalid paths. */
      })
  }, 300)
}

element('flat').addEventListener('change', () => {
  element('flat-name').disabled = !element('flat').checked
})

function readEntry(entry, prefix) {
  if (entry.isFile) {
    return new Promise((resolve, reject) => entry.file((file) => resolve([{ file, path: prefix + file.name }]), reject))
  }
  if (!entry.isDirectory) return Promise.resolve([])
  const reader = entry.createReader()
  let children = []
  function readBatch() {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject)).then((batch) => {
      if (!batch.length) return children
      children = children.concat(batch)
      return readBatch()
    })
  }
  return readBatch()
    .then((entries) => Promise.all(entries.map((child) => readEntry(child, prefix + entry.name + '/'))))
    .then((groups) => [].concat.apply([], groups))
}

const dropZone = element('drop-zone')
document.addEventListener('dragover', (event) => event.preventDefault())
document.addEventListener('drop', (event) => event.preventDefault())
dropZone.addEventListener('dragover', () => dropZone.classList.add('dragging'))
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'))
dropZone.addEventListener('drop', (event) => {
  event.preventDefault()
  dropZone.classList.remove('dragging')
  if (importing || jobBusy) return
  const transfer = event.dataTransfer
  const entries = Array.prototype.map.call(transfer.items || [], (item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null)).filter((entry) => entry)
  const fallback = Array.prototype.slice.call(transfer.files || [])
  if (!entries.length) {
    importImages(
      fallback.map((file) => ({ file, path: file.name })),
      '拖入图片'
    )
    return
  }
  importing = true
  element('settings').disabled = true
  element('start').disabled = true
  element('selection').textContent = '正在读取文件夹中的图片…'
  Promise.all(entries.map((entry) => readEntry(entry, '')))
    .then((groups) => {
      const items = [].concat.apply([], groups)
      const singleFolder = entries.length === 1 && entries[0].isDirectory
      if (singleFolder)
        items.forEach((item) => {
          item.path = item.path.slice(entries[0].name.length + 1)
        })
      importing = false
      return importImages(items, singleFolder ? entries[0].name : '拖入图片')
    })
    .catch((error) => {
      importing = false
      notice('无法读取拖入内容：' + error.message)
      refresh()
    })
    .then(() => {
      if (!importing) refresh()
    })
})
