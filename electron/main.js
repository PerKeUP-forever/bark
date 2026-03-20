const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const db = require('./database')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: '预算编制系统',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 开发环境加载 Vite dev server，生产环境加载打包文件
  if (process.env.NODE_ENV !== 'production' && !app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  db.initialize()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ========== 项目 IPC ==========
ipcMain.handle('project:list', () => db.getProjects())
ipcMain.handle('project:create', (_, name, description) => db.createProject(name, description))
ipcMain.handle('project:delete', (_, id) => db.deleteProject(id))
ipcMain.handle('project:rename', (_, id, name) => db.renameProject(id, name))

// ========== 预算项 IPC ==========
ipcMain.handle('item:list', (_, projectId) => db.getItems(projectId))
ipcMain.handle('item:create', (_, item) => db.createItem(item))
ipcMain.handle('item:update', (_, id, fields) => db.updateItem(id, fields))
ipcMain.handle('item:delete', (_, id) => db.deleteItem(id))
ipcMain.handle('item:reorder', (_, items) => db.reorderItems(items))

// ========== 汇总 IPC ==========
ipcMain.handle('summary:get', (_, projectId) => db.getSummary(projectId))
