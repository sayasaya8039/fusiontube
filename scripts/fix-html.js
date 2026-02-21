const fs = require('fs')
const path = require('path')

const htmlPath = path.join(__dirname, '../out/renderer/index.html')
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8')
  html = html.replace(/ crossorigin/g, '')
  fs.writeFileSync(htmlPath, html)
  console.log('Fixed: removed crossorigin from', htmlPath)
} else {
  console.log('index.html not found at', htmlPath)
}
