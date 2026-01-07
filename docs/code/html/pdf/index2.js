//var url = 'https://test.hccb.cc:18180/docfilepublic/test1/test3/123.pdf'
var url = location.search.substring(1)

// PDFJS.cMapUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/";
pdfjsLib.cMapUrl = 'cmaps'
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'
pdfjsLib.cMapPacked = true

var pdfDoc = null
var currentPageNum = 0
var loadMaxNum = 2

// 下载pdf文件
pdfjsLib.getDocument(url).promise.then(
  function (loadedPdfDoc) {
    console.log('pdf file loaded success', loadedPdfDoc)
    pdfDoc = loadedPdfDoc
    loadMaxNum = 2
    renderPage()
    window.addEventListener('scroll', handleScroll) // 添加滚动事件监听
  },
  function (reason) {
    console.error('pdf file loading error', reason)
  }
)

// 页面滚动事件回调函数
function handleScroll() {
  console.log('触发滚动事件，加载所有pdf')
  // 当滚动接近底部时
  pdfDoc && (loadMaxNum = pdfDoc.numPages)
  renderPage()
  // 移除事件监听器
  window.removeEventListener('scroll', handleScroll)
}

// 创建挂载canvas元素
function createPage() {
  var canvasDom = document.createElement('canvas')
  document.body.appendChild(canvasDom)
  return canvasDom
}
// 控制10个页面并发一起渲染
var rendering = 0
function renderPage() {
  while (rendering < 10 && currentPageNum < pdfDoc.numPages && currentPageNum < loadMaxNum) {
    renderPage2()
  }
}
// 渲染pdf页面到canvas
function renderPage2() {
  rendering++
  currentPageNum++
  console.log(currentPageNum, ' start page')

  var num = currentPageNum
  pdfDoc
    .getPage(currentPageNum)
    .then(function (page) {
      var viewport = page.getViewport({ scale: 2.0 })
      var canvas = createPage()
      var ctx = canvas.getContext('2d')

      canvas.height = viewport.height
      canvas.width = viewport.width

      // console.log(num, 'page', typeof page, page)
      console.log(num, ' start render')

      page
        .render({
          canvasContext: ctx,
          viewport: viewport,
        })
        .promise.then(function () {
          console.log(num, 'rendered success')

          rendering--
          renderPage()
        })
        .catch(function (error) {
          console.error(num, 'rendered error', error)
          rendering--
          renderPage()
        })
    })
    .catch(function (error) {
      console.error(num, 'getPage error', error)
      rendering--
      renderPage()
    })
}
