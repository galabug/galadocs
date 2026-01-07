const rootBar = {
  text: '我的文档',
  items: [
    { text: '语法示例', link: '/guide/markdown-examples' },
    { text: '运行时API示例', link: '/guide/api-examples' },
    { text: '项目文档开发说明', link: '/index' },
  ],
}
const toolBar = {
  text: '工具',
  items: [
    { text: 'git', link: '/tool/git' },
    { text: 'docker', link: '/tool/docker' },
    { text: 'npm', link: '/tool/npm' },
    { text: 'qinglong', link: '/tool/qinglong/install' },
    { text: 'vscode', link: '/tool/vscode/vscodedownload' },
  ],
}
const osBar = {
  text: '系统',
  items: [
    {
      text: 'linux',
      items: [
        { text: 'apache', link: '/os/linux/apache' },
        { text: 'commands', link: '/os/linux/commonCommands' },
        { text: 'ssh', link: '/os/linux/ssh-keygen' },
      ],
    },
    {
      text: 'mac',
      items: [
        { text: 'helloMac', link: '/os/mac/helloMac' },
        { text: 'nano', link: '/os/mac/nano' },
      ],
    },
    { text: 'win', link: '/os/win' },
  ],
}

const lifeBar = {
  text: '生活',
  items: [
    { text: 'baby', link: '/life/baby' },
    { text: 'child', link: '/life/child' },
    { text: 'cooking', link: '/life/cooking' },
  ],
}

const asideBarList = {
  '/tool': toolBar,
  '/life': lifeBar,
  '/os': osBar,
  '/': [
    rootBar,
    lifeBar,
    osBar,
    // toolBar,
    toolBar,
  ],
}

export { asideBarList }
