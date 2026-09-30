import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const server = path.resolve(process.env.MAC_BUILD_SERVER_DIR ?? '/Users/zhulijian/mac-build-server')
const serverPackage = path.join(server, 'package.json')
if (!fs.existsSync(serverPackage) || JSON.parse(fs.readFileSync(serverPackage, 'utf8')).name !== 'mac-build-server') {
  throw new Error(`未找到指定的 Mac Build Server：${server}`)
}

const target = path.join(server, 'public/review')
const dataOnly = process.argv.includes('--data-only')
if (dataOnly) {
  if (!fs.existsSync(path.join(target, 'index.html'))) throw new Error('请先运行 npm run deploy:mac-build-server')
  for (const name of ['review.json', 'sources.json']) {
    const source = path.join(project, 'public/data', name)
    if (!fs.existsSync(source)) continue
    const destination = path.join(target, 'data', name)
    const temporary = `${destination}.${process.pid}.tmp`
    fs.copyFileSync(source, temporary)
    fs.renameSync(temporary, destination)
  }
  console.log(`已更新 /review/ 的最新复盘数据：${target}/data`)
  process.exit(0)
}

const build = spawnSync('npm', ['run', 'build'], {
  cwd: project,
  stdio: 'inherit',
  env: { ...process.env, REVIEW_BASE: '/review/' },
})
if (build.status !== 0) process.exit(build.status ?? 1)

const output = path.join(project, 'dist')
if (fs.existsSync(path.join(output, 'a'))) throw new Error('构建产物含有原始日行情，停止部署')
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8')
if (!html.includes('/review/assets/')) throw new Error('构建资源路径未使用 /review/ 前缀')

const staging = path.join(server, 'public', `.review-next-${process.pid}`)
const previous = path.join(server, 'public', `.review-previous-${process.pid}`)
fs.cpSync(output, staging, { recursive: true })
try {
  if (fs.existsSync(target)) fs.renameSync(target, previous)
  fs.renameSync(staging, target)
  if (fs.existsSync(previous)) fs.rmSync(previous, { recursive: true })
} catch (error) {
  if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target)
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true })
  throw error
}
console.log(`已部署盘后复盘：${target}（/review/）`)
