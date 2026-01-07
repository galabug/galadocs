// var url = location.search.substring(1);
var url = 'https://test.hccb.cc:18180/docfilepublic/test1/test3/123.pdf'

// pdfjsLib.cMapUrl = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/cmaps/";
pdfjsLib.cMapUrl = 'cmaps'
pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdf.worker.min.js'
pdfjsLib.cMapPacked = true

var pdfDoc = null

function createPage() {
  var div = document.createElement('canvas')
  document.body.appendChild(div)
  return div
}

function renderPage(num) {
  pdfDoc.getPage(num).then(function (page) {
    var viewport = page.getViewport({ scale: 2.0 })
    var canvas = createPage()
    var ctx = canvas.getContext('2d')

    canvas.height = viewport.height
    canvas.width = viewport.width

    page.render({
      canvasContext: ctx,
      viewport: viewport,
    })
  })
}

pdfjsLib.getDocument(url).promise.then(function (pdf) {
  pdfDoc = pdf
  for (var i = 1; i <= pdfDoc.numPages; i++) {
    renderPage(i)
  }
})
