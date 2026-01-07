import { defineConfig } from 'vitepress'
import { asideBarList } from './asideBarConfig';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'galadocs',
  description: "一个记录文档",
  lang: 'zh-Hans',
  lastUpdated: true,
  themeConfig: {
    // 侧边栏配置
    sidebar: asideBarList,

    // footer: {
    //   // message: '基于 MIT 许可发布',
    //   copyright: `版权所有 © 2025-${new Date().getFullYear()}`
    // },

    docFooter: {
      prev: '上一页',
      next: '下一页'
    },
    // 本地搜索配置
    search: {
      provider: 'local',
      options: {
        // 搜索选项
        locales: {
          root: {
            translations: {
              button: {
                buttonText: '搜索',
                buttonAriaLabel: '搜索'
              },
              modal: {
                noResultsText: '无法找到相关结果',
                resetButtonTitle: '清除查询',
                footer: {
                  selectText: '选择',
                  navigateText: '切换',
                  closeText: '关闭'
                }
              }
            }
          }
        }
      }
    }
  },
  markdown: {
    // 启用代码高亮
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    }
  },
  vite: {
    publicDir: './public',
    resolve: {
      alias: {
        '@': '/src' // 根据你的项目结构调整路径
      }
    },
    server: {
      watch: {
        // 忽略不需要监视的目录
        ignored: ['**/node_modules/**', '**/.git/**', '**/.temp/**', '**/cache/**', '**/dist/**']
      }
    }
}
})
